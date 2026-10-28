"""Behaviour cloning for expert iteration: teaches the version 2 network to choose what the search teacher chose (rl/expert_data.ts).

The network starts as an exact copy of a version 1 model (--init-v1, normally the shipped one) with card vectors added, so training only has
to learn where the teacher plays differently. The teacher's estimates are noisy, so the target is not just its choice: it is the old
network's own move distribution with the teacher's choice mixed in, more strongly the more the teacher preferred it over the old favourite
(gap / --gap-scale, at most 1). Copying every small override outright made the network worse than the one it started from. The value head learns who won from each position, which gives the later PPO fine-tuning
(rl/train.py --resume) a sensible start. Games are split into training and validation sets; the epoch with the lowest validation loss is
kept.

    conda run -n AIEnv python rl/train_bc.py --data rl/data --init-v1 rl/checkpoints/master-v1.json --epochs 6
Writes rl/checkpoints/bc.pt (all weights, for --resume) and rl/checkpoints/bc.json (the browser's weights file).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import time

import numpy as np
import torch
import torch.nn.functional as F

from train import HERE, PolicyNetV2, Worker, load_v2_json, pad

def _sizes() -> dict:
    worker = Worker()
    try:
        return worker.ask({"cmd": "sizes"})
    finally:
        worker.close()


_SIZES = _sizes()
OBS, ACT, OBS_CARDS, ACT_CARDS, ROWS = _SIZES["observation"], _SIZES["action"], _SIZES["observationCards"], _SIZES["actionCards"], _SIZES["cardRows"]


def load(prefix: str) -> tuple[np.ndarray, list[np.ndarray], list[dict]]:
    """Observation rows (values then card ids) and per decision the action rows (values then card ids), with the jsonl metadata."""
    rows = [json.loads(line) for line in open(f"{prefix}.jsonl")]
    n = len(rows)
    obs = np.fromfile(f"{prefix}.obs", np.float32)[:n * OBS].reshape(n, OBS)
    obs_ids = np.fromfile(f"{prefix}.obsids", np.int32)[:n * OBS_CARDS].reshape(n, OBS_CARDS).astype(np.float32)
    total = sum(row["count"] for row in rows)
    feats = np.fromfile(f"{prefix}.feats", np.float32)[:total * ACT].reshape(total, ACT)
    act_ids = np.fromfile(f"{prefix}.actids", np.int32)[:total * ACT_CARDS].reshape(total, ACT_CARDS).astype(np.float32)
    actions = np.concatenate([feats, act_ids], axis=1)
    offsets = np.concatenate([[0], np.cumsum([row["count"] for row in rows])])
    return np.concatenate([obs, obs_ids], axis=1), [actions[offsets[i]:offsets[i + 1]] for i in range(n)], rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default=os.path.join(HERE, "data"))
    parser.add_argument("--init-v1", default=os.path.join(HERE, "checkpoints", "master-v1.json"))
    parser.add_argument("--init-v2", default="", help="start from this version 2 weights JSON instead (widened to the current feature vectors and card rows, so it computes the same as before)")
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--minibatch", type=int, default=1024)
    parser.add_argument("--value-weight", type=float, default=0.5)
    parser.add_argument("--gap-scale", type=float, default=0.15, help="value gap at which the teacher's choice fully replaces the old network's")
    parser.add_argument("--freeze-cards", action="store_true", help="keep the card vectors out of it (as the version 1 network)")
    parser.add_argument("--agree-mix", type=float, default=0.5, help="share of the teacher's choice in the target where both agree")
    parser.add_argument("--validation", type=float, default=0.05, help="share of games held out")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--out", default=os.path.join(HERE, "checkpoints", "bc"))
    args = parser.parse_args()
    torch.manual_seed(1)
    rng = np.random.default_rng(1)

    obs_list, feats, rows = [], [], []
    for path in sorted(glob.glob(os.path.join(args.data, "*.jsonl"))):
        if os.path.getsize(path) == 0:
            continue
        obs, actions, meta = load(path[:-len(".jsonl")])
        obs_list.append(obs)
        feats += actions
        rows += meta
    obs = np.concatenate(obs_list)
    chosen = np.array([row["chosen"] for row in rows])
    prior = np.array([row["prior"] for row in rows])
    weight = np.array([row.get("weight", 1.0) for row in rows], np.float32)
    outcome = np.array([2 * row["outcome"] - 1 for row in rows], np.float32)
    games = np.array([row["game"] for row in rows])
    unique = np.unique(games)
    held = set(rng.choice(unique, max(1, int(len(unique) * args.validation)), replace=False).tolist())
    is_val = np.array([game in held for game in games])
    train_idx, val_idx = np.where(~is_val)[0], np.where(is_val)[0]
    print(f"{len(rows)} decisions from {len(unique)} games; teacher differs from the network in {np.mean(chosen != prior):.1%}; "
          f"train {len(train_idx)}, validation {len(val_idx)}", flush=True)

    device = torch.device(("mps" if torch.backends.mps.is_available() else "cpu") if args.device == "auto" else args.device)
    net = PolicyNetV2(OBS, ACT, OBS_CARDS, ACT_CARDS, ROWS)
    if args.init_v2:
        net.load_state_dict(load_v2_json(args.init_v2, net), strict=False)
    else:
        net.load_v1(args.init_v1)
    net = net.to(device)
    # Mixing weight of the teacher's choice per decision; the old network's distribution makes up the rest of the target.
    gap = np.array([row["values"][row["chosen"]] - row["values"][row["prior"]] for row in rows], np.float32)
    mix = np.where(chosen == prior, args.agree_mix, np.clip(gap / args.gap_scale, 0.0, 1.0)).astype(np.float32)
    old_probs: list[np.ndarray] = []
    with torch.no_grad():
        for begin in range(0, len(rows), 4096):
            batch = np.arange(begin, min(begin + 4096, len(rows)))
            padded, mask = pad([feats[i] for i in batch], ACT + ACT_CARDS)
            logits, _ = net(torch.from_numpy(obs[batch]).to(device), torch.from_numpy(padded).to(device), torch.from_numpy(mask).to(device))
            probs = torch.softmax(logits, -1).cpu().numpy()
            old_probs += [probs[k, :len(feats[i])] for k, i in enumerate(batch)]
    if args.freeze_cards:
        with torch.no_grad():
            net.cards.weight.zero_()
        net.cards.weight.requires_grad_(False)
    optimizer = torch.optim.Adam([parameter for parameter in net.parameters() if parameter.requires_grad], lr=args.lr)

    def run(index: np.ndarray, train: bool) -> dict:
        net.train(train)
        totals = {"loss": 0.0, "value": 0.0, "agree": 0.0, "agree_differ": 0.0, "differ": 0.0, "weight": 0.0}
        order = rng.permutation(index) if train else index
        for begin in range(0, len(order), args.minibatch):
            batch = order[begin:begin + args.minibatch]
            padded, mask = pad([feats[i] for i in batch], ACT + ACT_CARDS)
            with torch.set_grad_enabled(train):
                logits, value = net(torch.from_numpy(obs[batch]).to(device), torch.from_numpy(padded).to(device), torch.from_numpy(mask).to(device))
                soft = np.zeros(mask.shape, np.float32)
                for k, i in enumerate(batch):
                    soft[k, :len(old_probs[i])] = (1 - mix[i]) * old_probs[i]
                    soft[k, chosen[i]] += mix[i]
                w = torch.from_numpy(weight[batch]).to(device)
                log_probs = torch.log_softmax(logits, -1).masked_fill(~torch.from_numpy(mask).to(device), 0.0)
                policy_loss = (-(torch.from_numpy(soft).to(device) * log_probs).sum(-1) * w).sum() / w.sum()
                value_loss = F.mse_loss(value, torch.from_numpy(outcome[batch]).to(device))
                loss = policy_loss + args.value_weight * value_loss
                if train:
                    optimizer.zero_grad()
                    loss.backward()
                    torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
                    optimizer.step()
            picks = logits.argmax(-1).cpu().numpy()
            differ = chosen[batch] != prior[batch]
            totals["loss"] += policy_loss.item() * float(weight[batch].sum())
            totals["value"] += value_loss.item() * len(batch)
            totals["agree"] += float(((picks == chosen[batch]) * weight[batch]).sum())
            totals["agree_differ"] += float((picks == chosen[batch])[differ].sum())
            totals["differ"] += float(differ.sum())
            totals["weight"] += float(weight[batch].sum())
        return {"loss": totals["loss"] / totals["weight"], "value": totals["value"] / len(order), "agree": totals["agree"] / totals["weight"],
                "learned": totals["agree_differ"] / max(1.0, totals["differ"])}

    start = run(val_idx, False)
    print(f"start: validation loss {start['loss']:.4f}, agrees with the teacher {start['agree']:.1%}, "
          f"on the decisions where the old network differs {start['learned']:.1%}", flush=True)
    best = float("inf")
    started = time.time()
    for epoch in range(1, args.epochs + 1):
        train = run(train_idx, True)
        val = run(val_idx, False)
        print(f"epoch {epoch} ({time.time() - started:.0f}s): train loss {train['loss']:.4f} agree {train['agree']:.1%} | validation loss "
              f"{val['loss']:.4f} value {val['value']:.4f} agree {val['agree']:.1%} where the old network differs {val['learned']:.1%}", flush=True)
        if val["loss"] < best:
            best = val["loss"]
            torch.save({key: value.detach().cpu() for key, value in net.state_dict().items()}, f"{args.out}.pt")
            net.export(f"{args.out}.json")
            print(f"saved {args.out}.json", flush=True)


if __name__ == "__main__":
    main()
