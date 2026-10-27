/** Second half of rl/check_parity.py: the same inputs through src/shared/ai/policy.ts, compared with PyTorch's logits. */
import { readFileSync } from "node:fs";
import { loadPolicy, scoreActions, type PolicyWeightsJson } from "../src/shared/ai/policy.ts";

const data = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as { weights: string; cases: Array<{ obs: number[]; feats: number[][]; logits: number[] }> };
const policy = loadPolicy(JSON.parse(readFileSync(data.weights, "utf8")) as PolicyWeightsJson);
let worst = 0;
for (const entry of data.cases) {
  const scores = scoreActions(policy, Float32Array.from(entry.obs), entry.feats.map((row) => Float32Array.from(row)));
  scores.forEach((score, index) => { worst = Math.max(worst, Math.abs(score - entry.logits[index]!)); });
}
console.log(`largest difference between PyTorch and TypeScript scores: ${worst.toExponential(2)}`);
if (worst > 1e-3) process.exit(1);
