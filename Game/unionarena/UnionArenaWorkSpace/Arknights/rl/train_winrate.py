"""The win-rate network: from what one player can see (src/shared/ai/features.ts `observe`), the chance that this player wins.

Data comes from rl/winrate_data.ts (computer players on random and preset decks), generated in parallel Node processes. Games are split
by game into training, validation and test sets, so positions of one game never end up on two sides. Training stops at the epoch with
the best validation loss; a temperature fitted on the validation set then makes the probabilities honest (it is folded into the last
layer). The test report shows log loss, Brier score, accuracy and a calibration table (predicted vs actual win rate). The weights go to
src/shared/ai/winrate-weights.json, which src/shared/ai/winrate.ts runs on the server (Players vs Players) and in the browser.

Run with the conda AIEnv environment:
    conda run -n AIEnv python rl/train_winrate.py --games 40000
"""
from __future__ import annotations

import argparse
import base64
import copy
import json
import os
import subprocess
import tempfile
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(HERE)
SITE = os.path.abspath(os.path.join(WORKSPACE, "..", "..", "..", "UNO", "UNO WorkSpace"))
GENERATOR = os.path.join(HERE, "winrate_data.ts")
SHIPPED = os.path.join(WORKSPACE, "src", "shared", "ai", "winrate-weights.json")
OBSERVATION_SIZE = 978  # src/shared/ai/features.ts OBSERVATION_SIZE (checked against the data below)


class WinNet(nn.Module):
    """Layer names and shapes must match src/shared/ai/winrate.ts."""

    def __init__(self, obs_size: int) -> None:
        super().__init__()
        self.layer1 = nn.Linear(obs_size, 256)
        self.layer2 = nn.Linear(256, 128)
        self.layer3 = nn.Linear(128, 64)
        self.out = nn.Linear(64, 1)

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        """Logit of the viewer's win chance."""
        return self.out(F.relu(self.layer3(F.relu(self.layer2(F.relu(self.layer1(obs))))))).squeeze(-1)

    def export(self, path: str) -> None:
        def layer(module: nn.Linear) -> dict:
            weight = module.weight.detach().float().cpu().contiguous().numpy()
            bias = module.bias.detach().float().cpu().contiguous().numpy()
            return {"in": weight.shape[1], "out": weight.shape[0], "w": base64.b64encode(weight.tobytes()).decode(), "b": base64.b64encode(bias.tobytes()).decode()}

        data = {"version": 1, "observationSize": self.layer1.in_features, "layers": {name: layer(getattr(self, name)) for name in ["layer1", "layer2", "layer3", "out"]}}
        tmp = f"{path}.tmp"
        with open(tmp, "w") as file:
            json.dump(data, file)
        os.replace(tmp, path)


def generate(workers: int, games: int, seed: int, directory: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Runs the generator in `workers` Node processes and joins their files (observations kept as float16 to save memory)."""
    per = (games + workers - 1) // workers
    prefixes = [os.path.join(directory, f"part{index}") for index in range(workers)]
    procs = [subprocess.Popen(["npx", "tsx", GENERATOR, str(seed * 1000 + index + 1), str(per), prefix], cwd=SITE, stdout=subprocess.PIPE, text=True) for index, prefix in enumerate(prefixes)]
    for proc in procs:
        out, _ = proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError("win-rate data generator failed")
    obs, wins, game_ids = [], [], []
    for prefix in prefixes:
        part = np.fromfile(f"{prefix}.obs", dtype=np.float32)
        if part.size % OBSERVATION_SIZE:
            raise RuntimeError("observation size changed: update OBSERVATION_SIZE")
        obs.append(part.reshape(-1, OBSERVATION_SIZE).astype(np.float16))
        wins.append(np.fromfile(f"{prefix}.win", dtype=np.uint8))
        game_ids.append(np.fromfile(f"{prefix}.game", dtype=np.int32))
        for suffix in ("obs", "win", "game"):
            os.remove(f"{prefix}.{suffix}")
    return np.concatenate(obs), np.concatenate(wins).astype(np.float32), np.concatenate(game_ids)


def report(probabilities: np.ndarray, labels: np.ndarray) -> dict:
    eps = 1e-6
    p = np.clip(probabilities, eps, 1 - eps)
    log_loss = float(-np.mean(labels * np.log(p) + (1 - labels) * np.log(1 - p)))
    brier = float(np.mean((p - labels) ** 2))
    accuracy = float(np.mean((p >= 0.5) == (labels >= 0.5)))
    bins = []
    calibration_error = 0.0
    for low in np.arange(0, 1, 0.1):
        mask = (p >= low) & (p < low + 0.1)
        if mask.sum():
            bins.append((f"{low:.1f}-{low + 0.1:.1f}", int(mask.sum()), float(p[mask].mean()), float(labels[mask].mean())))
            calibration_error += mask.mean() * abs(p[mask].mean() - labels[mask].mean())
    return {"log_loss": log_loss, "brier": brier, "accuracy": accuracy, "ece": float(calibration_error), "bins": bins}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", type=int, default=40000)
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--epochs", type=int, default=8, help="at most; the epoch with the best validation loss is kept")
    parser.add_argument("--batch", type=int, default=4096)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--holdout", type=float, default=0.1, help="share of games for validation, and the same share for the test")
    parser.add_argument("--device", default="auto", help="auto: mps when available, else cpu")
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    device = torch.device(("mps" if torch.backends.mps.is_available() else "cpu") if args.device == "auto" else args.device)

    started = time.time()
    with tempfile.TemporaryDirectory() as directory:
        obs, wins, game_ids = generate(args.workers, args.games, args.seed, directory)
    print(f"data: {len(wins)} positions from {len(np.unique(game_ids))} games in {time.time() - started:.0f}s, viewer win share {wins.mean():.3f}", flush=True)

    games = rng.permutation(np.unique(game_ids))
    size = max(1, int(len(games) * args.holdout))
    split = np.zeros(len(game_ids), np.int8)  # 0 train, 1 validation, 2 test
    split[np.isin(game_ids, games[:size])] = 1
    split[np.isin(game_ids, games[size:2 * size])] = 2
    train_index, val_index, test_index = (np.flatnonzero(split == part) for part in range(3))

    net = WinNet(OBSERVATION_SIZE).to(device)
    optimizer = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=1e-3)
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs * ((len(train_index) + args.batch - 1) // args.batch))

    def logits(index: np.ndarray) -> np.ndarray:
        net.eval()
        out = []
        with torch.no_grad():
            for begin in range(0, len(index), 16384):
                batch = torch.from_numpy(obs[index[begin:begin + 16384]].astype(np.float32)).to(device)
                out.append(net(batch).cpu().numpy())
        net.train()
        return np.concatenate(out)

    def sigmoid(values: np.ndarray) -> np.ndarray:
        return 1 / (1 + np.exp(-values))

    best_loss, best_state, best_epoch = float("inf"), None, 0

    for epoch in range(args.epochs):
        order = rng.permutation(train_index)
        losses = []
        for begin in range(0, len(order), args.batch):
            index = np.sort(order[begin:begin + args.batch])
            x = torch.from_numpy(obs[index].astype(np.float32)).to(device)
            y = torch.from_numpy(wins[index]).to(device)
            loss = F.binary_cross_entropy_with_logits(net(x), y)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            schedule.step()
            losses.append(loss.item())
        val = report(sigmoid(logits(val_index)), wins[val_index])
        print(f"epoch {epoch + 1}: train loss {np.mean(losses):.4f}, validation log loss {val['log_loss']:.4f}, brier {val['brier']:.4f}, "
              f"accuracy {val['accuracy']:.3f}, calibration error {val['ece']:.4f}", flush=True)
        if val["log_loss"] < best_loss:
            best_loss, best_state, best_epoch = val["log_loss"], copy.deepcopy(net.state_dict()), epoch + 1
    net.load_state_dict(best_state)

    # Temperature scaling on the validation set: p = sigmoid(logit / T), folded into the last layer.
    val_logits = torch.from_numpy(logits(val_index)).double()
    val_labels = torch.from_numpy(wins[val_index]).double()
    log_t = torch.zeros(1, dtype=torch.float64, requires_grad=True)
    fit = torch.optim.LBFGS([log_t], lr=0.1, max_iter=200)

    def closure() -> torch.Tensor:
        fit.zero_grad()
        loss = F.binary_cross_entropy_with_logits(val_logits / log_t.exp(), val_labels)
        loss.backward()
        return loss

    fit.step(closure)
    temperature = float(log_t.detach().exp())
    with torch.no_grad():
        net.out.weight /= temperature
        net.out.bias /= temperature
    print(f"kept epoch {best_epoch} (validation log loss {best_loss:.4f}); temperature {temperature:.3f}")

    final = report(sigmoid(logits(test_index)), wins[test_index])
    print(f"test: log loss {final['log_loss']:.4f}, brier {final['brier']:.4f}, accuracy {final['accuracy']:.3f}, calibration error {final['ece']:.4f}")
    print("calibration on the test games (predicted range, positions, mean prediction, actual win share):")
    for name, count, predicted, actual in final["bins"]:
        print(f"  {name}: {count:7d}  {predicted:.3f}  {actual:.3f}")
    net.export(SHIPPED)
    print(f"weights written to {SHIPPED} ({time.time() - started:.0f}s in all)")


if __name__ == "__main__":
    main()
