"""PPO training for the Arknights UNION ARENA computer player.

The games run in Node (rl/env_worker.ts, the real rules engine); this script only holds the network and the PPO update. The network
scores each legal action from the observation and the action's own features (see src/shared/ai/features.ts), so it works with any number
of legal actions. The trained weights are written as JSON that src/shared/ai/policy.ts runs in the browser.

Opponents: heuristic "easy" and "normal" at first; once the policy beats "normal" often enough, frozen snapshots of itself join the mix.
With --net v2 the network also learns a vector per card number (PolicyNetV2), and --init-v1 starts it as an exact copy of a version 1
model. --pool keeps several past snapshots as opponents (plus any --pool-extra models), --random-decks gives that share of games random
legal decks, --shaping 0 rewards only the result, and --eval-opponent policy:<weights.json> picks the best model by head-to-head games.

The PPO update runs on the GPU (MPS) when there is one: it scores every legal action of every sample, which is most of the learner's work.
Evaluation runs in its own Node process while training goes on; its result is applied when it arrives.

Run with the conda AIEnv environment:
    conda run -n AIEnv python rl/train.py --minutes 60
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import select
import shutil
import subprocess
import time
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(HERE)
SITE = os.path.abspath(os.path.join(WORKSPACE, "..", "..", "..", "UNO", "UNO WorkSpace"))
WORKER = os.path.join(HERE, "env_worker.ts")
SHIPPED = os.path.join(WORKSPACE, "src", "shared", "ai", "policy-weights.json")


class Worker:
    """One Node process running a batch of games."""

    def __init__(self) -> None:
        self.proc = subprocess.Popen(["npx", "tsx", WORKER], cwd=SITE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

    def send(self, message: dict) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(message) + "\n")
        self.proc.stdin.flush()

    def receive(self) -> dict:
        assert self.proc.stdout is not None
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("env worker exited")
        reply = json.loads(line)
        if not reply.get("ok"):
            raise RuntimeError(reply.get("error"))
        return reply

    def ask(self, message: dict) -> dict:
        self.send(message)
        return self.receive()

    def ready(self) -> bool:
        """Whether a reply is waiting (it is one line, so it can then be read without blocking)."""
        assert self.proc.stdout is not None
        return bool(select.select([self.proc.stdout], [], [], 0)[0])

    def close(self) -> None:
        self.proc.kill()


def decode(text: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(text), dtype=np.float32)


class PolicyNet(nn.Module):
    """Layer names and shapes must match src/shared/ai/policy.ts."""

    def __init__(self, obs_size: int, act_size: int) -> None:
        super().__init__()
        self.state1 = nn.Linear(obs_size, 256)
        self.state2 = nn.Linear(256, 128)
        self.action1 = nn.Linear(act_size, 128)
        self.action2 = nn.Linear(128, 128)
        self.head1 = nn.Linear(384, 128)
        self.head2 = nn.Linear(128, 1)
        self.value1 = nn.Linear(128, 64)
        self.value2 = nn.Linear(64, 1)

    def forward(self, obs: torch.Tensor, feats: torch.Tensor, mask: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        state = F.relu(self.state2(F.relu(self.state1(obs))))  # (B, 128)
        action = F.relu(self.action2(F.relu(self.action1(feats))))  # (B, A, 128)
        expanded = state.unsqueeze(1).expand_as(action)
        joined = torch.cat([expanded, action, expanded * action], dim=-1)
        logits = self.head2(F.relu(self.head1(joined))).squeeze(-1)
        logits = logits.masked_fill(~mask, -1e9)
        value = self.value2(F.relu(self.value1(state))).squeeze(-1)
        return logits, value

    def export(self, path: str) -> None:
        data = {
            "version": 1,
            "observationSize": self.state1.in_features,
            "actionFeatures": self.action1.in_features,
            "layers": {name: export_layer(getattr(self, name)) for name in ["state1", "state2", "action1", "action2", "head1", "head2"]},
        }
        write_json(path, data)


def b64(array: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(array, dtype=np.float32).tobytes()).decode()


def export_layer(module: nn.Linear) -> dict:
    weight = module.weight.detach().float().cpu().numpy()
    return {"in": weight.shape[1], "out": weight.shape[0], "w": b64(weight), "b": b64(module.bias.detach().float().cpu().numpy())}


def write_json(path: str, data: dict) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w") as file:
        json.dump(data, file)
    os.replace(tmp, path)


class PolicyNetV2(PolicyNet):
    """PolicyNet plus a learned vector per card number. The inputs carry the card ids after the plain values (as floats): observation rows
    are obs_size values then obs_cards ids, action rows act_size values then act_cards ids. Matches policy.ts version 2."""

    def __init__(self, obs_size: int, act_size: int, obs_cards: int = 28, act_cards: int = 3, rows: int = 195, dim: int = 16) -> None:
        super().__init__(obs_size + obs_cards * dim, act_size + act_cards * dim)
        self.obs_size, self.act_size, self.obs_cards, self.act_cards = obs_size, act_size, obs_cards, act_cards
        self.cards = nn.Embedding(rows, dim, padding_idx=0)
        nn.init.normal_(self.cards.weight, std=0.1)
        with torch.no_grad():
            self.cards.weight[0].zero_()

    def expand(self, rows: torch.Tensor, size: int) -> torch.Tensor:
        ids = rows[..., size:].round().long()
        return torch.cat([rows[..., :size], self.cards(ids).flatten(-2)], dim=-1)

    def forward(self, obs: torch.Tensor, feats: torch.Tensor, mask: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        return super().forward(self.expand(obs, self.obs_size), self.expand(feats, self.act_size), mask)

    def load_v1(self, path: str) -> None:
        """Copies a version 1 model (its weights JSON); the card columns start at zero, so the scores are exactly the old model's."""
        with open(path) as file:
            data = json.load(file)
        with torch.no_grad():
            for name, entry in data["layers"].items():
                module: nn.Linear = getattr(self, name)
                weight = torch.from_numpy(np.frombuffer(base64.b64decode(entry["w"]), dtype=np.float32).reshape(entry["out"], entry["in"]).copy())
                module.weight.zero_()
                module.weight[:, :entry["in"]] = weight
                module.bias.copy_(torch.from_numpy(np.frombuffer(base64.b64decode(entry["b"]), dtype=np.float32).copy()))

    def export(self, path: str) -> None:
        data = {
            "version": 2,
            "observationSize": self.obs_size,
            "actionFeatures": self.act_size,
            "layers": {name: export_layer(getattr(self, name)) for name in ["state1", "state2", "action1", "action2", "head1", "head2"]},
            "embedding": {"rows": self.cards.num_embeddings, "dim": self.cards.embedding_dim, "w": b64(self.cards.weight.detach().float().cpu().numpy())},
        }
        write_json(path, data)


def make_net(kind: str, sizes: dict) -> PolicyNet:
    if kind == "v2":
        return PolicyNetV2(sizes["observation"], sizes["action"], sizes["observationCards"], sizes["actionCards"])
    return PolicyNet(sizes["observation"], sizes["action"])


@dataclass
class Batch:
    obs: np.ndarray  # (N, D)
    feats: list[np.ndarray]  # N arrays of (count, F)
    rewards: np.ndarray
    dones: np.ndarray
    outcomes: np.ndarray
    opponents: list[str]


class Envs:
    """All workers together, stepped in parallel (requests go out first, then the replies are read)."""

    def __init__(self, workers: int, envs_per_worker: int, seed: int, mix: dict, cards: bool = False, random_decks: float = 0.0, shaping: float = 0.05) -> None:
        self.workers = [Worker() for _ in range(workers)]
        self.sizes = self.workers[0].ask({"cmd": "sizes"})
        # Row widths as sent (with the card ids appended when `cards`).
        self.obs_size = self.sizes["observation"] + (self.sizes["observationCards"] if cards else 0)
        self.act_size = self.sizes["action"] + (self.sizes["actionCards"] if cards else 0)
        self.per = envs_per_worker
        for index, worker in enumerate(self.workers):
            worker.send({"cmd": "init", "envs": envs_per_worker, "seed": seed * 1000 + index, "mix": mix, "cards": cards, "randomDecks": random_decks, "shaping": shaping})
        self.last = self._collect([worker.receive() for worker in self.workers])

    def _collect(self, replies: list[dict]) -> Batch:
        obs, feats, rewards, dones, outcomes, opponents = [], [], [], [], [], []
        for reply in replies:
            obs.append(decode(reply["obs"]).reshape(-1, self.obs_size))
            flat = decode(reply["feats"]).reshape(-1, self.act_size)
            offset = 0
            for count in reply["counts"]:
                feats.append(flat[offset:offset + count])
                offset += count
            rewards += reply["rewards"]
            dones += reply["dones"]
            outcomes += reply["outcomes"]
            opponents += reply["opponents"]
        return Batch(np.concatenate(obs), feats, np.array(rewards, np.float32), np.array(dones, np.float32), np.array(outcomes, np.float32), opponents)

    def step(self, actions: np.ndarray) -> Batch:
        for index, worker in enumerate(self.workers):
            worker.send({"cmd": "step", "actions": actions[index * self.per:(index + 1) * self.per].tolist()})
        self.last = self._collect([worker.receive() for worker in self.workers])
        return self.last

    def broadcast(self, message: dict) -> None:
        for worker in self.workers:
            worker.send(message)
        for worker in self.workers:
            worker.receive()

    def close(self) -> None:
        for worker in self.workers:
            worker.close()


def load_v2_json(path: str, net: PolicyNet) -> dict:
    """The state dict of a version 2 weights JSON (the value head is not exported, so it keeps its current weights)."""
    with open(path) as file:
        data = json.load(file)
    state = {}
    for name, entry in data["layers"].items():
        state[f"{name}.weight"] = torch.from_numpy(np.frombuffer(base64.b64decode(entry["w"]), dtype=np.float32).reshape(entry["out"], entry["in"]).copy())
        state[f"{name}.bias"] = torch.from_numpy(np.frombuffer(base64.b64decode(entry["b"]), dtype=np.float32).copy())
    embedding = data["embedding"]
    state["cards.weight"] = torch.from_numpy(np.frombuffer(base64.b64decode(embedding["w"]), dtype=np.float32).reshape(embedding["rows"], embedding["dim"]).copy())
    return state


def pad(feats: list[np.ndarray], act_size: int) -> tuple[np.ndarray, np.ndarray]:
    width = max(1, max(len(entry) for entry in feats))
    out = np.zeros((len(feats), width, act_size), np.float32)
    mask = np.zeros((len(feats), width), bool)
    for index, entry in enumerate(feats):
        out[index, :len(entry)] = entry
        mask[index, :len(entry)] = True
    return out, mask


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--minutes", type=float, default=60)
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--envs", type=int, default=16, help="games per worker")
    parser.add_argument("--horizon", type=int, default=64)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--minibatch", type=int, default=2048)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--gamma", type=float, default=0.995)
    parser.add_argument("--lam", type=float, default=0.95)
    parser.add_argument("--clip", type=float, default=0.2)
    parser.add_argument("--entropy", type=float, default=0.01)
    parser.add_argument("--eval-every", type=int, default=10)
    parser.add_argument("--eval-games", type=int, default=200)
    parser.add_argument("--self-play-at", type=float, default=0.55, help="win rate against normal that brings snapshots into the opponent mix")
    parser.add_argument("--device", default="auto", help="auto: mps when available, else cpu")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--resume", default="")
    parser.add_argument("--net", choices=["v1", "v2"], default="v1")
    parser.add_argument("--init-v1", default="", help="v2 only: start from this version 1 weights JSON")
    parser.add_argument("--init-json", default="", help="v2 only: start from this version 2 weights JSON (e.g. a behaviour-cloned model)")
    parser.add_argument("--shaping", type=float, default=0.05, help="reward per life card of difference (0: only the result)")
    parser.add_argument("--random-decks", type=float, default=0.0, help="share of games with random legal decks")
    parser.add_argument("--mix", default="", help='starting opponent mix as JSON, e.g. {"normal":0.2,"policy":0.8}')
    parser.add_argument("--pool", type=int, default=1, help="past snapshots kept as opponents (1: only the latest)")
    parser.add_argument("--pool-extra", nargs="*", default=[], help="fixed opponent models (weights JSON) always in the pool")
    parser.add_argument("--eval-opponent", default="normal", help='"normal", "hard" or "policy:<weights.json>"')
    parser.add_argument("--out", default="checkpoints", help="checkpoint directory under rl/")
    parser.add_argument("--no-ship", action="store_true", help="leave src/shared/ai/policy-weights.json alone (the best model stays in checkpoints/)")
    args = parser.parse_args()
    # The workers run in the site directory, so model paths go to them absolute.
    args.pool_extra = [os.path.abspath(path) for path in args.pool_extra]
    if args.eval_opponent.startswith("policy:"):
        args.eval_opponent = "policy:" + os.path.abspath(args.eval_opponent[len("policy:"):])

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    out_dir = os.path.join(HERE, args.out)
    log_dir = os.path.join(HERE, "logs")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(log_dir, exist_ok=True)
    log_file = open(os.path.join(log_dir, "train.log"), "a")

    def log(text: str) -> None:
        line = f"[{time.strftime('%H:%M:%S')}] {text}"
        print(line, flush=True)
        log_file.write(line + "\n")
        log_file.flush()

    mix = json.loads(args.mix) if args.mix else {"easy": 0.5, "normal": 0.5, "policy": 0.0}
    envs = Envs(args.workers, args.envs, args.seed, mix, cards=args.net == "v2", random_decks=args.random_decks, shaping=args.shaping)
    evaluator = Worker()
    device = torch.device(("mps" if torch.backends.mps.is_available() else "cpu") if args.device == "auto" else args.device)
    net = make_net(args.net, envs.sizes)
    if args.init_v1:
        net.load_v1(args.init_v1)
    if args.init_json:
        net.load_state_dict(load_v2_json(args.init_json, net), strict=False)
    net = net.to(device)
    if args.resume:
        net.load_state_dict(torch.load(args.resume, map_location=device))
    # Opponent snapshots (newest last); the fixed extras stay in the pool.
    snapshots: list[str] = []

    def send_pool() -> None:
        envs.broadcast({"cmd": "pool", "paths": args.pool_extra + snapshots})

    if args.pool_extra:
        send_pool()
    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)
    n = len(envs.last.feats)
    log(f"start: {args.workers} workers x {args.envs} games = {n} games, obs {envs.obs_size}, action {envs.act_size}, device {device}")

    started = time.time()
    update = 0
    total_steps = 0
    best_rate = -1.0
    self_play = False
    # The evaluation in flight: (update, exported weights, state dict copy), or None.
    pending_eval: tuple[int, str, dict] | None = None

    def finish_eval() -> None:
        nonlocal pending_eval, best_rate, self_play, mix
        assert pending_eval is not None
        evaluated, path, state = pending_eval
        pending_eval = None
        result = evaluator.receive()
        rate = result["winRate"]
        log(f"eval vs {args.eval_opponent} (update {evaluated}): win rate {rate:.3f} ({result['wins']}/{result['games']}), as Player One {result['firstWinRate']:.3f}")
        # Ties go to the newer model: once the policy beats "normal" nearly every time, later models are still stronger.
        if rate >= best_rate:
            best_rate = rate
            shutil.copyfile(path, os.path.join(out_dir, "best.json"))
            torch.save(state, os.path.join(out_dir, "best.pt"))
            log(f"new best {rate:.3f}")
        if rate >= args.self_play_at:
            snapshot = os.path.join(out_dir, f"opponent-{evaluated}.json")
            shutil.copyfile(path, snapshot)
            snapshots.append(snapshot)
            while len(snapshots) > args.pool:
                os.remove(snapshots.pop(0))
            send_pool()
            if not self_play and not args.mix:
                self_play = True
                mix = {"easy": 0.15, "normal": 0.45, "policy": 0.4}
                envs.broadcast({"cmd": "mix", "mix": mix})
                log("self-play snapshots join the opponent mix")
        os.remove(path)
    while time.time() - started < args.minutes * 60:
        # ---- Rollout ----
        store_obs, store_feats, store_actions, store_logp, store_values, store_rewards, store_dones = [], [], [], [], [], [], []
        batch = envs.last
        for _ in range(args.horizon):
            feats, mask = pad(batch.feats, envs.act_size)
            with torch.no_grad():
                logits, values = net(torch.from_numpy(batch.obs).to(device), torch.from_numpy(feats).to(device), torch.from_numpy(mask).to(device))
                dist = torch.distributions.Categorical(logits=logits)
                actions = dist.sample()
                logp = dist.log_prob(actions)
            store_obs.append(batch.obs)
            store_feats.append(batch.feats)
            store_actions.append(actions.cpu().numpy())
            store_logp.append(logp.cpu().numpy())
            store_values.append(values.cpu().numpy())
            batch = envs.step(store_actions[-1])
            store_rewards.append(batch.rewards)
            store_dones.append(batch.dones)
            total_steps += n
        with torch.no_grad():
            feats, mask = pad(batch.feats, envs.act_size)
            _, last_value = net(torch.from_numpy(batch.obs).to(device), torch.from_numpy(feats).to(device), torch.from_numpy(mask).to(device))
        values = np.stack(store_values + [last_value.cpu().numpy()])
        rewards = np.stack(store_rewards)
        dones = np.stack(store_dones)
        advantages = np.zeros_like(rewards)
        running = np.zeros(n, np.float32)
        for t in reversed(range(args.horizon)):
            keep = 1.0 - dones[t]
            delta = rewards[t] + args.gamma * values[t + 1] * keep - values[t]
            running = delta + args.gamma * args.lam * keep * running
            advantages[t] = running
        returns = advantages + values[:-1]

        # ---- PPO update ----
        flat_obs = np.concatenate(store_obs)
        flat_feats = [entry for step in store_feats for entry in step]
        flat_actions = np.concatenate(store_actions)
        flat_logp = np.concatenate(store_logp)
        flat_adv = advantages.reshape(-1)
        flat_ret = returns.reshape(-1)
        flat_adv = (flat_adv - flat_adv.mean()) / (flat_adv.std() + 1e-8)
        size = len(flat_actions)
        stats = []
        for _ in range(args.epochs):
            order = np.random.permutation(size)
            for begin in range(0, size, args.minibatch):
                index = order[begin:begin + args.minibatch]
                feats, mask = pad([flat_feats[i] for i in index], envs.act_size)
                logits, value = net(torch.from_numpy(flat_obs[index]).to(device), torch.from_numpy(feats).to(device), torch.from_numpy(mask).to(device))
                dist = torch.distributions.Categorical(logits=logits)
                act = torch.from_numpy(flat_actions[index]).to(device)
                logp = dist.log_prob(act)
                ratio = torch.exp(logp - torch.from_numpy(flat_logp[index]).to(device))
                adv = torch.from_numpy(flat_adv[index]).to(device)
                policy_loss = -torch.min(ratio * adv, torch.clamp(ratio, 1 - args.clip, 1 + args.clip) * adv).mean()
                value_loss = F.mse_loss(value, torch.from_numpy(flat_ret[index]).to(device))
                entropy = dist.entropy().mean()
                loss = policy_loss + 0.5 * value_loss - args.entropy * entropy
                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(net.parameters(), 0.5)
                optimizer.step()
                stats.append((policy_loss.item(), value_loss.item(), entropy.item()))
        update += 1
        worker_stats = [worker.ask({"cmd": "stats"}) for worker in envs.workers]
        wins = sum(entry["wins"] for entry in worker_stats)
        games = sum(entry["wins"] + entry["losses"] + entry["draws"] for entry in worker_stats)
        truncated = sum(entry["truncated"] for entry in worker_stats)
        mean = np.mean(stats, axis=0)
        elapsed = time.time() - started
        log(f"update {update} steps {total_steps} ({total_steps / elapsed:.0f}/s) games {games} train win {wins / max(1, games):.3f} "
            f"policy {mean[0]:.4f} value {mean[1]:.4f} entropy {mean[2]:.3f} truncated {truncated} mix {mix}")

        # ---- Evaluation, snapshots and the opponent mix ----
        # The evaluator works on a copy of the weights while training goes on; a due evaluation is skipped if the last one is still running.
        if pending_eval is not None and evaluator.ready():
            finish_eval()
        if update % args.eval_every == 0:
            latest = os.path.join(out_dir, "latest.json")
            net.export(latest)
            state = {key: value.detach().cpu().clone() for key, value in net.state_dict().items()}
            torch.save(state, os.path.join(out_dir, "latest.pt"))
            if pending_eval is None:
                path = os.path.join(out_dir, f"eval-{update}.json")
                shutil.copyfile(latest, path)
                evaluator.send({"cmd": "eval", "games": args.eval_games, "path": path, "opponent": args.eval_opponent, "seed": update})
                pending_eval = (update, path, state)
            else:
                log(f"eval of update {update} skipped: update {pending_eval[0]} is still being evaluated")

    if pending_eval is not None:
        finish_eval()
    best = os.path.join(out_dir, "best.json")
    if os.path.exists(best) and not args.no_ship:
        shutil.copyfile(best, SHIPPED)
        log(f"best model (win rate vs {args.eval_opponent} {best_rate:.3f}) copied to {SHIPPED}")
    envs.close()
    evaluator.close()


if __name__ == "__main__":
    main()
