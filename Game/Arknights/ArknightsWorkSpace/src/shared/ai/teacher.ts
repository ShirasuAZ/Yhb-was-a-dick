/**
 * The teacher for expert iteration: the determinized search (search.ts) steered by the trained networks. Candidate actions come from the
 * policy network's scores, rollouts are cut after a number of moves and the position is valued by the win-rate network. It is slower than
 * the policy alone but stronger, so its choices make training data for the next network (rl/expert_data.ts).
 */
import type { EngineContext } from "../engine.ts";
import { chooseByPolicy, policyScores, type Policy } from "./policy.ts";
import type { SearchOptions } from "./search.ts";
import { estimateWinRate, type WinRateModel } from "./winrate.ts";

/** `rollout`: who plays the rollout moves — the policy network (slower, realistic) or the normal heuristic (fast). Depth 0 values the position
 *  right after the candidate action. */
export interface TeacherSettings { candidates: number; rollouts: number; depth: number; rollout: "policy" | "heuristic"; turns?: number; margin?: number }

export const DEFAULT_TEACHER: TeacherSettings = { candidates: 4, rollouts: 4, depth: 10, rollout: "policy" };

export function teacherOptions(policy: Policy, winRate: WinRateModel, ctx: EngineContext, settings: TeacherSettings = DEFAULT_TEACHER): SearchOptions {
  return {
    budgetMs: 1e9,
    maxActions: settings.candidates,
    maxRollouts: settings.rollouts,
    rolloutDepth: settings.depth,
    rolloutTurns: settings.turns,
    keepMargin: settings.margin,
    prior: (match, playerId, actions) => policyScores(policy, match.game, match.players, ctx, playerId, actions),
    leafValue: (match, playerId) => estimateWinRate(winRate, match.game, match.players, ctx, playerId) ?? 0.5,
    rolloutPolicy: settings.rollout === "policy" ? (match, actor) => chooseByPolicy(policy, match.game, match.players, ctx, actor)! : undefined
  };
}
