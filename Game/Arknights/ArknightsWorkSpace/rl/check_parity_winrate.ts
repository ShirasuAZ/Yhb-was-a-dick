/** Second half of rl/check_parity_winrate.py: the same inputs through src/shared/ai/winrate.ts, compared with PyTorch's win chances. */
import { readFileSync } from "node:fs";
import { loadWinRate, winProbability, type WinRateWeightsJson } from "../src/shared/ai/winrate.ts";

const data = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as { weights: string; obs: number[][]; probabilities: number[] };
const model = loadWinRate(JSON.parse(readFileSync(data.weights, "utf8")) as WinRateWeightsJson);
let worst = 0;
data.obs.forEach((row, index) => { worst = Math.max(worst, Math.abs(winProbability(model, Float32Array.from(row)) - data.probabilities[index]!)); });
console.log(`largest difference between PyTorch and TypeScript win chances: ${worst.toExponential(2)}`);
if (worst > 1e-4) process.exit(1);
