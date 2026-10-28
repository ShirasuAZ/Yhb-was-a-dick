"""Checks that the browser's TypeScript network (src/shared/ai/policy.ts) computes the same scores as the PyTorch one.

    conda run -n AIEnv python rl/check_parity.py [checkpoints/latest.pt] [--v2]
Writes random inputs and PyTorch's logits to rl/checkpoints/parity.json, exports the same weights, then runs rl/check_parity.ts on them.
Without a checkpoint, --v2 checks a fresh version 2 network (random card vectors, so the card inputs matter).
"""
import json
import os
import subprocess
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train import SITE, PolicyNet, PolicyNetV2, Worker  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
_worker = Worker()
_sizes = _worker.ask({"cmd": "sizes"})
_worker.close()
OBS, ACT, OBS_CARDS, ACT_CARDS, ROWS = _sizes["observation"], _sizes["action"], _sizes["observationCards"], _sizes["actionCards"], _sizes["cardRows"]
v2 = "--v2" in sys.argv
paths = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
checkpoint = paths[0] if paths else ("" if v2 else os.path.join(HERE, "checkpoints", "latest.pt"))
net = PolicyNetV2(OBS, ACT, OBS_CARDS, ACT_CARDS, ROWS) if v2 else PolicyNet(OBS, ACT)
if checkpoint:
    net.load_state_dict(torch.load(checkpoint, map_location="cpu"), strict=False)
else:
    for parameter in net.parameters():
        torch.nn.init.normal_(parameter, std=0.05)
net.eval()
rng = np.random.default_rng(0)
cases = []
for _ in range(5):
    count = int(rng.integers(2, 20))
    obs = rng.random(OBS, dtype=np.float32)
    feats = rng.random((count, ACT), dtype=np.float32)
    obs_ids = rng.integers(0, ROWS, OBS_CARDS)
    act_ids = rng.integers(0, ROWS, (count, ACT_CARDS))
    obs_in = np.concatenate([obs, obs_ids.astype(np.float32)]) if v2 else obs
    feats_in = np.concatenate([feats, act_ids.astype(np.float32)], axis=1) if v2 else feats
    with torch.no_grad():
        logits, _ = net(torch.from_numpy(obs_in)[None], torch.from_numpy(feats_in)[None], torch.ones(1, count, dtype=torch.bool))
    cases.append({"obs": obs.tolist(), "feats": feats.tolist(), "obsIds": obs_ids.tolist(), "actIds": act_ids.tolist(), "logits": logits[0].tolist()})
weights = os.path.join(HERE, "checkpoints", "parity-weights.json")
os.makedirs(os.path.dirname(weights), exist_ok=True)
net.export(weights)
with open(os.path.join(HERE, "checkpoints", "parity.json"), "w") as file:
    json.dump({"weights": weights, "cases": cases}, file)
subprocess.run(["npx", "tsx", os.path.join(HERE, "check_parity.ts"), os.path.join(HERE, "checkpoints", "parity.json")], cwd=SITE, check=True)
