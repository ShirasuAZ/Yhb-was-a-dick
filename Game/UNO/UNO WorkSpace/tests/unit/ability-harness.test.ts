import { describe, expect, it } from "vitest";
import { bpOf } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/engine.ts";
import { choice, ctx, field, energy, setup } from "./ability-harness.ts";

describe("ability test harness", () => {
  it("plays an Arknights card by its number and answers the engine's question", () => {
    const { game, a, act } = setup("main");
    const texas = field(a, "energy", "UC01BT/ARK-1-074");
    energy(a, 3, "UC01BT/ARK-1-088");
    a.hand.push("UC01BT/ARK-1-070");
    act("a", { type: "play", handIndex: 0, line: "front" });
    expect(choice(game, "a").options).toContain(texas.uid);
    act("a", { type: "choose", picks: [texas.uid] });
    expect(bpOf(ctx, texas)).toBe(4000);
  });
});
