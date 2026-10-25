/**
 * Rule-of-thumb computer player. Each legal action gets a score from simple card-game sense (build enough energy, put strong characters on
 * the front line, attack when a block would not pay off, block when it wins or when life is short, always use triggers well); the best one
 * is played. "easy" plays a random legal move part of the time and never takes the extra draw.
 */
import type { UnionArenaAction, UnionArenaFieldCard } from "../protocol.ts";
import { bpOf, damageOf, energyOf, LINE_LIMIT, type EngineContext, type EngineGame, type EnginePlayer } from "../engine.ts";
import { handCardValue, legalActions } from "./legal.ts";
import { nextRandom, randomInt, type Rng } from "./match.ts";

export type HeuristicLevel = "easy" | "normal";

interface View { game: EngineGame; players: readonly EnginePlayer[]; }

const find = (players: readonly EnginePlayer[], id: string): EnginePlayer => players.find((player) => player.accountId === id)!;
const other = (players: readonly EnginePlayer[], id: string): EnginePlayer => players.find((player) => player.accountId !== id)!;

/** Energy the hand asks for, per colour: the highest required energy of a character or site in hand, at most what four cards can make. */
function energyNeeds(ctx: EngineContext, me: EnginePlayer): Map<string, number> {
  const needs = new Map<string, number>();
  for (const cardId of me.hand) {
    const stats = ctx.card(cardId);
    if (!stats || stats.energyCost === 0) continue;
    needs.set(stats.color, Math.max(needs.get(stats.color) ?? 0, Math.min(stats.energyCost, 8)));
  }
  return needs;
}

function scoreAction(view: View, ctx: EngineContext, playerId: string, action: UnionArenaAction): number {
  const { game, players } = view;
  const me = find(players, playerId);
  const opponent = other(players, playerId);
  const field = (owner: EnginePlayer, uid: string | undefined): UnionArenaFieldCard | undefined => uid ? [...owner.front, ...owner.energy].find((card) => card.uid === uid) : undefined;
  const activeBlockers = (owner: EnginePlayer): UnionArenaFieldCard[] => owner.front.filter((card) => !card.rested && ctx.card(card.cardId)?.type === "character");
  switch (action.type) {
    case "next_phase":
    case "end_turn":
      return 0;
    case "extra_draw": {
      const activeAp = me.ap.filter((card) => !card.rested).length;
      return me.hand.length <= 3 && activeAp >= 2 ? 1 : -1;
    }
    case "move": {
      const needs = energyNeeds(ctx, me);
      let score = 0;
      for (const uid of action.toFront) {
        const card = me.energy.find((entry) => entry.uid === uid)!;
        score += bpOf(ctx, card) / 1000 - 0.5;
      }
      // Moving must not starve the hand of energy it is waiting for.
      const afterEnergy = [...me.energy.filter((card) => !action.toFront.includes(card.uid)), ...me.front.filter((card) => action.toEnergy.includes(card.uid))];
      for (const [color, need] of needs) {
        const now = energyOf(ctx, me, color);
        const after = energyOf(ctx, { energy: afterEnergy }, color);
        if (after < Math.min(need, now) || (after < need && after < now)) score -= 6;
      }
      if (me.front.length + action.toFront.length - action.toEnergy.length === 0) score -= 1;
      return score;
    }
    case "play": {
      const stats = ctx.card(me.hand[action.handIndex]!)!;
      const needs = energyNeeds(ctx, me);
      const wanted = Math.max(1, ...needs.values());
      const energyCount = me.energy.length;
      let score = action.remove ? -2.5 : 0;
      if (action.line === "front") score += 1 + (stats.bp ?? 0) / 1000 - (energyCount < Math.min(2, wanted) ? 2 : 0);
      else score += (energyCount < Math.min(LINE_LIMIT, wanted) ? 3 : 0.2) - (stats.bp ?? 0) / 4000 + (stats.energyGen ?? 0) * 0.3;
      return score;
    }
    case "raid": {
      const stats = ctx.card(me.hand[action.handIndex]!)!;
      return 5 + (stats.bp ?? 0) / 1000 + (action.toFront ? 1 : 0);
    }
    case "event":
      return 2;
    case "attack": {
      const attacker = field(me, action.attackerUid)!;
      const power = bpOf(ctx, attacker);
      if (action.targetUid) {
        const target = field(opponent, action.targetUid)!;
        return bpOf(ctx, target) <= power ? 4 + bpOf(ctx, target) / 1000 : -3;
      }
      const blockers = activeBlockers(opponent);
      if (!blockers.length) return 5 + damageOf(ctx, attacker);
      const strongest = Math.max(...blockers.map((card) => bpOf(ctx, card)));
      if (power >= strongest) return 3;
      return opponent.life.length <= 2 ? 0.5 : -1;
    }
    case "block": {
      if (game.pending?.kind !== "block") return 0;
      const attacker = field(opponent, game.pending.attackerUid);
      if (!attacker) return 0;
      const incoming = damageOf(ctx, attacker);
      if (action.blockerUid === null) return me.life.length <= incoming ? -10 : 0;
      const blocker = field(me, action.blockerUid)!;
      if (bpOf(ctx, blocker) > bpOf(ctx, attacker)) return 4 - bpOf(ctx, blocker) / 10000;
      // A losing block saves life at the price of the blocker.
      if (me.life.length <= incoming) return 3 - bpOf(ctx, blocker) / 10000;
      return me.life.length <= 2 ? 1 - bpOf(ctx, blocker) / 2000 : -2;
    }
    case "damage":
      return 0;
    case "trigger": {
      if (!action.activate) return 0;
      const pending = game.pending;
      const attacker = pending?.kind === "triggers" ? find(players, pending.attackerId) : opponent;
      if (action.raid) return 4 + (action.raid.toFront ? 0.5 : 0);
      if (action.sidelineIndex !== undefined) return 3 - (action.remove ? 2 : 0);
      if (action.targetUid) {
        const own = field(me, action.targetUid);
        if (own) return 2 + (own.rested ? 1 : 0) + (me.front.includes(own) ? 0.5 : 0) + bpOf(ctx, own) / 5000;
        const theirs = field(attacker, action.targetUid);
        return theirs ? 2 + bpOf(ctx, theirs) / 1000 : 1;
      }
      return 2;
    }
    case "discard":
      return 0;
    case "activate":
      return 1.5;
    case "choose": {
      const pending = game.pending;
      if (pending?.kind !== "choose") return 0;
      if (pending.purpose === "confirm") return action.picks[0] === "yes" ? 1 : 0;
      if (pending.purpose === "order") return 0;
      // Targets: helpful effects on our strongest characters, harmful ones on the opponent's strongest; give up the least useful hand cards.
      return action.picks.reduce((sum, pick) => {
        if (/^[hs]:\d+$/.test(pick)) {
          const cardId = (pick.startsWith("h:") ? me.hand : me.sideline)[Number(pick.slice(2))] ?? "";
          return sum + (pending.good ? 1 : -1) * (1 + handCardValue(ctx, cardId) / 5);
        }
        const own = field(me, pick);
        const theirs = field(opponent, pick);
        const card = own ?? theirs;
        if (!card) return sum;
        const weight = 1 + bpOf(ctx, card) / 5000;
        return sum + (pending.good === false ? (theirs ? weight : -2 * weight) : (own ? weight : -2 * weight));
      }, 0);
    }
    default:
      return -100;
  }
}

/** The heuristic player's choice among `actions` (all legal), or null when it has nothing to do. */
export function chooseHeuristic(view: View, ctx: EngineContext, playerId: string, level: HeuristicLevel, rng: Rng, actions: UnionArenaAction[] = legalActions(view.game, view.players, ctx, playerId)): UnionArenaAction | null {
  if (!actions.length) return null;
  if (actions.length === 1) return actions[0]!;
  if (level === "easy") {
    const choices = actions.filter((action) => action.type !== "extra_draw");
    if (nextRandom(rng) < 0.35) return choices[randomInt(rng, choices.length)]!;
  }
  let best = actions[0]!;
  let bestScore = -Infinity;
  for (const action of actions) {
    if (level === "easy" && action.type === "extra_draw") continue;
    const score = scoreAction(view, ctx, playerId, action);
    if (score > bestScore) { best = action; bestScore = score; }
  }
  return best;
}

export { scoreAction };
