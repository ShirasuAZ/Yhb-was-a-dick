/**
 * Every rule-manual move a player can make right now, as a list of engine actions. It is the action space of the computer opponents and of
 * reinforcement learning. Manual operations (applying a card's own ability text) and conceding are not listed: the computer players only use
 * cards whose abilities the engine runs by itself.
 *
 * Moves that lead to the same result are listed once (two copies of a card in hand, life cards the attacker cannot tell apart). Lists that
 * could grow very large (simultaneous movement, discarding down to eight) are capped, keeping the most sensible options first.
 */
import type { UnionArenaAction, UnionArenaFieldCard } from "../protocol.ts";
import { abilitiesOf, actingPlayerId, activationIssue, canBlock, choiceAllowed, costOf, flagsOf, energyOf, hasKeyword, HAND_LIMIT, LINE_LIMIT, raidTargetMatches, triggerNeeds, type EngineContext, type EngineGame, type EnginePlayer } from "../engine.ts";
import { energyLineOnly, mustStillAttack, playOnlyByAbility } from "../engine.ts";
import { mustBeBlocked } from "../engine.ts";
import { eventUsable } from "../engine.ts";
import { playConditionHolds } from "../engine.ts";

const MOVE_LIMIT = 48;
const DISCARD_LIMIT = 48;
const CHOICE_LIMIT = 48;

function find(players: readonly EnginePlayer[], id: string): EnginePlayer {
  return players.find((player) => player.accountId === id)!;
}

function other(players: readonly EnginePlayer[], id: string): EnginePlayer {
  return players.find((player) => player.accountId !== id)!;
}

const isCharacter = (ctx: EngineContext, card: UnionArenaFieldCard): boolean => ctx.card(card.cardId)?.type === "character";

/** Placing onto a line: as is when there is room, else once per card that could go to the removal area first. */
function withRoom<T>(cards: readonly UnionArenaFieldCard[], make: (remove?: string) => T): T[] {
  return cards.length < LINE_LIMIT ? [make()] : cards.map((card) => make(card.uid));
}

/** All subsets of `items`, smallest first, at most `limit` of them (the empty set excluded). */
function subsets<T>(items: readonly T[], limit: number): T[][] {
  const result: T[][] = [];
  for (let size = 1; size <= items.length; size += 1) {
    const pick = (start: number, chosen: T[]): void => {
      if (result.length >= limit) return;
      if (chosen.length === size) { result.push(chosen); return; }
      for (let index = start; index < items.length; index += 1) pick(index + 1, [...chosen, items[index]!]);
    };
    pick(0, []);
  }
  return result;
}

/** A rough worth of a hand card, used to decide which cards to give up first when discarding. */
export function handCardValue(ctx: EngineContext, cardId: string): number {
  const stats = ctx.card(cardId);
  if (!stats) return 0;
  return (stats.bp ?? 2000) / 1000 + (stats.trigger ? 0.5 : 0) + stats.keywords.length * 0.4 - stats.energyCost * 0.15;
}

export function legalActions(game: EngineGame, players: readonly EnginePlayer[], ctx: EngineContext, playerId: string): UnionArenaAction[] {
  if (game.step !== "turn" || actingPlayerId(game) !== playerId) return [];
  const me = find(players, playerId);
  const opponent = other(players, playerId);
  const pending = game.pending;
  if (pending) {
    switch (pending.kind) {
      case "choose": {
        if (pending.purpose !== "target" || pending.max === 1) {
          const singles = pending.options.map((option): UnionArenaAction => ({ type: "choose", picks: [option] }));
          return pending.min === 0 ? [{ type: "choose", picks: [] }, ...singles] : singles;
        }
        if (pending.ordered) return [{ type: "choose", picks: [...pending.options] }];
        const combos = subsets(pending.options, CHOICE_LIMIT * 8).filter((combo) => combo.length >= pending.min && combo.length <= pending.max && choiceAllowed(game, players, ctx, combo)).slice(0, CHOICE_LIMIT);
        return [...(pending.min === 0 ? [{ type: "choose" as const, picks: [] }] : []), ...combos.map((picks): UnionArenaAction => ({ type: "choose", picks }))];
      }
      case "block":
        const attacker = opponent.front.find((card) => card.uid === pending.attackerUid);
        return [...(attacker && mustBeBlocked(ctx, attacker, me) ? [] : [{ type: "block", blockerUid: null } as UnionArenaAction]), ...me.front.filter((card) => attacker && canBlock(ctx, attacker, card)).map((card): UnionArenaAction => ({ type: "block", blockerUid: card.uid }))];
      case "damage": {
        // Face-down life cards cannot be told apart, so which ones are picked makes no difference to the attacker.
        const defender = find(players, pending.defenderId);
        return [{ type: "damage", lifeIds: defender.life.slice(0, pending.amount).map((slot) => slot.id) }];
      }
      case "triggers": {
        const attacker = find(players, pending.attackerId);
        const actions: UnionArenaAction[] = [];
        for (const slot of pending.revealed) {
          actions.push({ type: "trigger", lifeId: slot.id, activate: false });
          const stats = ctx.card(slot.cardId);
          if (!stats?.trigger) continue;
          const needs = triggerNeeds(ctx, me, attacker, slot.cardId, me.hand);
          if (stats.trigger.label === "突进") {
            actions.push({ type: "trigger", lifeId: slot.id, activate: true });
            for (const uid of needs.raidTargets) {
              actions.push({ type: "trigger", lifeId: slot.id, activate: true, raid: { targetUid: uid } });
              if (me.energy.some((card) => card.uid === uid) && me.front.length < LINE_LIMIT) actions.push({ type: "trigger", lifeId: slot.id, activate: true, raid: { targetUid: uid, toFront: true } });
            }
          } else if (needs.hand.length) {
            for (const index of needs.hand) actions.push(...withRoom(me.front, (remove): UnionArenaAction => ({ type: "trigger", lifeId: slot.id, activate: true, handIndex: index, remove })));
          } else if (needs.sideline.length) {
            for (const index of needs.sideline) actions.push(...withRoom(me.front, (remove): UnionArenaAction => ({ type: "trigger", lifeId: slot.id, activate: true, sidelineIndex: index, remove })));
          } else if (needs.targets.length) {
            for (const uid of needs.targets) actions.push({ type: "trigger", lifeId: slot.id, activate: true, targetUid: uid });
          } else {
            actions.push({ type: "trigger", lifeId: slot.id, activate: true });
          }
        }
        return actions;
      }
      case "discard": {
        // Give up the least useful cards first; the first options drop the lowest-valued ones.
        const order = me.hand.map((cardId, index) => ({ index, value: handCardValue(ctx, cardId) })).sort((a, b) => a.value - b.value).map((entry) => entry.index);
        const drop = me.hand.length - HAND_LIMIT;
        const combos = subsets(order, Number.MAX_SAFE_INTEGER).filter((combo) => combo.length === drop).slice(0, DISCARD_LIMIT);
        return combos.map((dropped) => ({ type: "discard", keep: me.hand.map((_, index) => index).filter((index) => !dropped.includes(index)) }));
      }
    }
  }
  if (game.turnPlayerId !== playerId) return [];
  const activeAp = me.ap.filter((card) => !card.rested).length;
  switch (game.phase) {
    case "start": {
      const actions: UnionArenaAction[] = [{ type: "next_phase" }];
      if (!game.extraDrawUsed && activeAp >= 1 && me.library.length) actions.push({ type: "extra_draw" });
      return actions;
    }
    case "movement": {
      const actions: UnionArenaAction[] = [{ type: "next_phase" }];
      const movable = (card: UnionArenaFieldCard): boolean => !flagsOf(card).includes("cannotMove");
      const forward = me.energy.filter((card) => isCharacter(ctx, card) && movable(card)).map((card) => ({ uid: card.uid, toFront: true }));
      const back = me.front.filter((card) => hasKeyword(ctx, card, "撤步") && movable(card)).map((card) => ({ uid: card.uid, toFront: false }));
      for (const combo of subsets([...forward, ...back], MOVE_LIMIT * 4)) {
        const toFront = combo.filter((entry) => entry.toFront).map((entry) => entry.uid);
        const toEnergy = combo.filter((entry) => !entry.toFront).map((entry) => entry.uid);
        if (me.front.length - toEnergy.length + toFront.length > LINE_LIMIT || me.energy.length - toFront.length + toEnergy.length > LINE_LIMIT) continue;
        actions.push({ type: "move", toFront, toEnergy, remove: [] });
        if (actions.length > MOVE_LIMIT) break;
      }
      return actions;
    }
    case "main": {
      // A character that must attack if it can keeps the turn from ending before the attack phase.
      const actions: UnionArenaAction[] = mustStillAttack(ctx, me) ? [{ type: "next_phase" }] : [{ type: "next_phase" }, { type: "end_turn" }];
      const seen = new Set<string>();
      me.hand.forEach((cardId, handIndex) => {
        if (seen.has(cardId)) return;
        seen.add(cardId);
        const stats = ctx.card(cardId);
        if (!stats) return;
        const cost = costOf(game, players, ctx, playerId, cardId);
        if (activeAp < cost.ap || energyOf(ctx, me, stats.color) < cost.energy) return;
        if (stats.type === "event") { if (eventUsable(game, players, ctx, playerId, cardId)) actions.push({ type: "event", handIndex }); return; }
        // 此卡牌只能通过我方的能力登场或进行突进: no plain play (only the Raid below).
        if (!playOnlyByAbility(ctx, cardId) && playConditionHolds(game, players, ctx, playerId, cardId)) {
          if (stats.type === "character" && !energyLineOnly(ctx, cardId, me)) actions.push(...withRoom(me.front, (remove): UnionArenaAction => ({ type: "play", handIndex, line: "front", remove })));
          actions.push(...withRoom(me.energy, (remove): UnionArenaAction => ({ type: "play", handIndex, line: "energy", remove })));
        }
        if (stats.raid) {
          for (const target of [...me.front, ...me.energy].filter((card) => raidTargetMatches(ctx, stats, card))) {
            actions.push({ type: "raid", handIndex, targetUid: target.uid });
            if (me.energy.includes(target) && me.front.length < LINE_LIMIT) actions.push({ type: "raid", handIndex, targetUid: target.uid, toFront: true });
          }
        }
      });
      for (const card of [...me.front, ...me.energy]) {
        abilitiesOf(ctx, card.cardId).forEach((ability, index) => {
          if (ability.kind === "activated" && activationIssue(game, players, ctx, playerId, card.uid, index) === null) actions.push({ type: "activate", uid: card.uid, ability: index });
        });
      }
      return actions.map((action) => (action.type === "play" && action.remove === undefined ? { type: "play", handIndex: action.handIndex, line: action.line } : action));
    }
    case "attack": {
      const actions: UnionArenaAction[] = mustStillAttack(ctx, me) ? [] : [{ type: "end_turn" }];
      // An energy-line character with the "attackFromEnergyLine" mark can attack too.
      for (const card of [...me.front, ...me.energy.filter((entry) => flagsOf(entry).includes("attackFromEnergyLine"))]) {
        if (card.rested || !isCharacter(ctx, card) || flagsOf(card).includes("cannotAttack")) continue;
        actions.push({ type: "attack", attackerUid: card.uid });
        if (hasKeyword(ctx, card, "瞄准攻击")) for (const target of opponent.front) if (!flagsOf(target).includes("unsnipeable")) actions.push({ type: "attack", attackerUid: card.uid, targetUid: target.uid });
      }
      return actions;
    }
    default:
      return [];
  }
}
