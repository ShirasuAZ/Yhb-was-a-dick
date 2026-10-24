import { describe, expect, it } from "vitest";
import { actingPlayerId, applyAction, type EngineContext } from "../../../../Arknights/ArknightsWorkSpace/src/shared/engine.ts";
import { createTutorial, finishMulligan, stepDone, testAction, TUTORIAL_OPPONENT, TUTORIAL_STEPS } from "../../../../Arknights/ArknightsWorkSpace/src/client/tutorial.ts";
import { UNION_ARENA_CATALOG } from "../../../../Arknights/ArknightsWorkSpace/src/server/catalog.ts";
import { cardContext } from "../../../../Arknights/ArknightsWorkSpace/src/shared/abilities/registry.ts";

const byId = new Map(UNION_ARENA_CATALOG.map((card) => [card.id, card]));
const ctx: EngineContext = cardContext((id) => byId.get(id));

describe("Arknights tutorial", () => {
  it("uses only cards that exist with printed data and images", () => {
    const s = createTutorial("me", "我");
    const ids = [...s.me.hand, ...s.me.library, ...s.test.hand, ...s.test.library, ...Object.values(s.lifeToDeal).flat()];
    for (const id of ids) {
      expect(byId.get(id)?.imageAvailable, id).toBe(true);
      expect(byId.get(id)?.stats, id).toBeTruthy();
    }
  });

  it("can be played from the first step to a won game with the rules engine, the same way every time", () => {
    for (let run = 0; run < 2; run += 1) {
      const s = createTutorial("me", "我");
      let guard = 0;
      for (const [index, step] of TUTORIAL_STEPS.entries()) {
        if (step.next) continue;
        if (step.mulligan) { finishMulligan(s); continue; }
        if (!step.expect && !step.until) break;
        let acted = false;
        for (;;) {
          guard += 1;
          expect(guard, `step ${index} never finishes`).toBeLessThan(2000);
          if (s.game.step === "turn" && actingPlayerId(s.game) === TUTORIAL_OPPONENT.id) {
            applyAction(s.game, s.players, ctx, TUTORIAL_OPPONENT.id, testAction(s)!);
            continue;
          }
          if (stepDone(step, s, acted)) break;
          expect(step.demo, `step ${index} waits for the player but has no demo`).toBeTruthy();
          const action = step.demo!(s);
          expect(step.expect!(action, s), `step ${index} rejects its own demo`).toBe(true);
          applyAction(s.game, s.players, ctx, "me", action);
          acted = true;
        }
      }
      expect(s.game.step).toBe("over");
      expect(s.game.winnerId).toBe("me");
      expect(s.test.life).toHaveLength(0);
    }
  });
});
