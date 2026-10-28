/**
 * A small harness for card-ability tests of any title: a two-player game started at a chosen phase, with helpers to put cards on the
 * field and to answer the engine's questions. Cards are addressed by card number (the image-free catalog's ids), so a test needs no
 * card art. Example:
 *
 *   const { game, a, b, act } = setup("main");
 *   energy(a, 3);                              // three energy cards for the turn player
 *   a.hand.push("UC01BT/ARK-1-070");           // a hand card
 *   act("a", { type: "play", handIndex: 0, line: "front" });
 *   expect(choice(game).options)...; act("a", { type: "choose", picks: [uid] });
 */
import { expect } from "vitest";
import { applyAction, beginFirstTurn, newEngineGame, type EngineGame, type EnginePlayer } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import type { UnionArenaAction, UnionArenaChoice, UnionArenaFieldCard } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/protocol.ts";
import { titleContext } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/title-catalog.ts";

export const ctx = titleContext;
/** A plain 0-cost card that fills the decks and life areas. */
export const FILLER = "UC01BT/ARK-1-004";

export function player(accountId: string, filler = FILLER): EnginePlayer {
  return {
    accountId, username: accountId.toUpperCase(), hand: [], library: Array(30).fill(filler),
    life: Array.from({ length: 7 }, (_, index) => ({ id: `${accountId}:life:${index}`, cardId: filler, faceUp: false })),
    apCount: 3, ap: [], front: [], energy: [], sideline: [], removal: []
  };
}

let seq = 0;
/** Puts a card on a line of `owner`'s field and returns it. */
export function field(owner: EnginePlayer, line: "front" | "energy", number: string, rested = false): UnionArenaFieldCard {
  seq += 1;
  const card: UnionArenaFieldCard = { uid: `${owner.accountId}:t${seq}`, cardId: number, under: [], rested, bpMod: 0, energyMod: 0, grants: [], attacks: 0, blocks: 0, skipNextActivate: false, used: [] };
  owner[line].push(card);
  return card;
}
/** `count` energy-line cards (default: a card that makes one energy of `color`'s title colour — pass the number of a suitable card). */
export const energy = (owner: EnginePlayer, count: number, number: string): void => { for (let index = 0; index < count; index += 1) field(owner, "energy", number); };

/** `first`'s turn, in the given phase, with three active AP cards; both players' decks are `filler` cards. */
export function setup(phase: "movement" | "main" | "attack" = "main", first: "a" | "b" = "a", filler = FILLER) {
  const a = player("a", filler);
  const b = player("b", filler);
  const game = newEngineGame(first, []);
  beginFirstTurn(game, [a, b]);
  (first === "a" ? a : b).ap = [0, 1, 2].map((index) => ({ id: `${first}:ap${index}`, rested: false }));
  const players = [a, b];
  const act = (who: string, action: UnionArenaAction): void => applyAction(game, players, ctx, who, action);
  while (game.phase !== phase) act(first, { type: "next_phase" });
  return { game, a, b, players, act };
}

/** The pending question as a choice (optionally checking who is asked). */
export const choice = (game: EngineGame, playerId?: string): UnionArenaChoice => {
  expect(game.pending?.kind).toBe("choose");
  if (playerId) expect(game.pending?.playerId).toBe(playerId);
  return game.pending as UnionArenaChoice;
};
