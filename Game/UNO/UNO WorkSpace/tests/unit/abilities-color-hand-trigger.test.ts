/** AOT's 《COLOR》 life-card trigger that plays a green character card from the HAND (the Arknights one plays from the sideline). */
import { describe, expect, it } from "vitest";
import { legalActions } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ai/legal.ts";
import { triggerNeeds } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { ctx, field, setup } from "./ability-harness.ts";

const LEVI = "UE10BT/AOT-1-056"; // Bertholdt Hoover: life card with the COLOR trigger that plays from the hand
const GREEN_CHEAP = "UE10BT/AOT-1-043"; // green character, cost 1, AP 1, no ability text
const GREEN_EXPENSIVE = "UE10BT/AOT-1-042"; // green, cost 0, no ability text: also fits
const OTHER_COLOUR = "UC01BT/ARK-1-088"; // not green

function revealed() {
  const result = setup("attack", "b");
  const { a, b, game, act } = result;
  a.life[0]!.cardId = LEVI;
  const attacker = field(b, "front", OTHER_COLOUR);
  act("b", { type: "attack", attackerUid: attacker.uid });
  act("b", { type: "damage", lifeIds: [a.life[0]!.id] });
  expect(game.pending?.kind).toBe("triggers");
  return result;
}

describe("COLOR trigger: play a green character from the hand", () => {
  it("is described to the clients as a hand choice, not a sideline one", () => {
    const { a, b } = setup("attack", "b");
    a.hand.push(GREEN_CHEAP, OTHER_COLOUR, GREEN_EXPENSIVE);
    const needs = triggerNeeds(ctx, a, b, LEVI, a.hand);
    expect(needs.hand).toEqual([0, 2]);
    expect(needs.sideline).toEqual([]);
    expect(ctx.card(LEVI)!.trigger!.text).toContain("从我方手牌");
  });

  it("puts the chosen hand card onto the front line, active, and the life card goes to the sideline", () => {
    const { a, game, act, players } = revealed();
    a.hand.push(OTHER_COLOUR, GREEN_CHEAP);
    const options = legalActions(game, players, ctx, "a").filter((action) => action.type === "trigger" && action.activate);
    expect(options.map((action) => (action.type === "trigger" ? action.handIndex : null))).toEqual([1]);
    act("a", { type: "trigger", lifeId: a.life.length ? "a:life:0" : "", activate: true, handIndex: 1 });
    expect(a.front.map((card) => [card.cardId, card.rested])).toEqual([[GREEN_CHEAP, false]]);
    expect(a.hand).toEqual([OTHER_COLOUR]);
    expect(a.sideline).toContain(LEVI);
  });

  it("refuses a hand card that does not fit (wrong colour), and may be declined", () => {
    const first = revealed();
    first.a.hand.push(OTHER_COLOUR, GREEN_CHEAP);
    expect(() => first.act("a", { type: "trigger", lifeId: "a:life:0", activate: true, handIndex: 0 })).toThrow("TRIGGER_TARGET_REQUIRED");
    first.act("a", { type: "trigger", lifeId: "a:life:0", activate: false });
    expect(first.a.hand).toEqual([OTHER_COLOUR, GREEN_CHEAP]);
    expect(first.a.front).toEqual([]);
  });
});
