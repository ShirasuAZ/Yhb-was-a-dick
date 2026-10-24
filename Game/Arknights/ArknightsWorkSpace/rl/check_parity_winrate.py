"""Checks that src/shared/ai/winrate.ts computes the same win chances as the PyTorch network of rl/train_winrate.py.

    conda run -n AIEnv python rl/check_parity_winrate.py
Exports a randomly initialised network and random inputs to a temporary folder, then runs rl/check_parity_winrate.ts on them.
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_winrate import OBSERVATION_SIZE, SITE, WinNet  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
torch.manual_seed(0)
net = WinNet(OBSERVATION_SIZE).eval()
rng = np.random.default_rng(0)
obs = rng.random((20, OBSERVATION_SIZE), dtype=np.float32)
with torch.no_grad():
    probabilities = torch.sigmoid(net(torch.from_numpy(obs))).tolist()
with tempfile.TemporaryDirectory() as directory:
    weights = os.path.join(directory, "weights.json")
    net.export(weights)
    cases = os.path.join(directory, "cases.json")
    with open(cases, "w") as file:
        json.dump({"weights": weights, "obs": obs.tolist(), "probabilities": probabilities}, file)
    subprocess.run(["npx", "tsx", os.path.join(HERE, "check_parity_winrate.ts"), cases], cwd=SITE, check=True)
