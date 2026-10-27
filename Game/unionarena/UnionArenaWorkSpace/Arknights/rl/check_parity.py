"""Checks that the browser's TypeScript network (src/shared/ai/policy.ts) computes the same scores as the PyTorch one.

    conda run -n AIEnv python rl/check_parity.py [checkpoints/latest.pt]
Writes random inputs and PyTorch's logits to rl/checkpoints/parity.json, exports the same weights, then runs rl/check_parity.ts on them.
"""
import json
import os
import subprocess
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train import SITE, PolicyNet  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OBS, ACT = 978, 92
checkpoint = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "checkpoints", "latest.pt")
net = PolicyNet(OBS, ACT)
net.load_state_dict(torch.load(checkpoint, map_location="cpu"))
net.eval()
rng = np.random.default_rng(0)
cases = []
for _ in range(5):
    count = int(rng.integers(2, 20))
    obs = rng.random(OBS, dtype=np.float32)
    feats = rng.random((count, ACT), dtype=np.float32)
    with torch.no_grad():
        logits, _ = net(torch.from_numpy(obs)[None], torch.from_numpy(feats)[None], torch.ones(1, count, dtype=torch.bool))
    cases.append({"obs": obs.tolist(), "feats": feats.tolist(), "logits": logits[0].tolist()})
weights = os.path.join(HERE, "checkpoints", "parity-weights.json")
net.export(weights)
with open(os.path.join(HERE, "checkpoints", "parity.json"), "w") as file:
    json.dump({"weights": weights, "cases": cases}, file)
subprocess.run(["npx", "tsx", os.path.join(HERE, "check_parity.ts"), os.path.join(HERE, "checkpoints", "parity.json")], cwd=SITE, check=True)
