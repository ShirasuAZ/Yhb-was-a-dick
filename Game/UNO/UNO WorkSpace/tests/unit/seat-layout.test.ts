import { describe, expect, it } from "vitest";
import type { PublicPlayer } from "../../shared/protocol.ts";
import {
  opponentSlotsFor,
  playersRelativeToSelf,
  seatedOpponents
} from "../../client/src/components/seatLayout.ts";

function players(count: number): PublicPlayer[] {
  return Array.from({ length: count }, (_, seat) => ({
    id: `p${seat}`,
    name: `玩家${seat}`,
    seat,
    connected: true,
    ready: true,
    isHost: seat === 0,
    active: true,
    handCount: 7,
    unoDeclared: false
  }));
}

describe("table seat layout", () => {
  it.each([2, 3, 4, 5, 6])(
    "assigns exactly %i-1 opponents to unique table slots",
    (count) => {
      const assigned = seatedOpponents(players(count), "p0");
      expect(assigned).toHaveLength(count - 1);
      expect(new Set(assigned.map((seat) => seat.slot)).size).toBe(count - 1);
      expect(assigned.map((seat) => seat.slot)).toEqual(
        opponentSlotsFor(count)
      );
    }
  );

  it("orders opponents relative to the current user's seat", () => {
    const all = players(6);
    expect(playersRelativeToSelf(all, "p3").map((player) => player.id)).toEqual([
      "p4",
      "p5",
      "p0",
      "p1",
      "p2"
    ]);
    expect(seatedOpponents(all, "p3").map((seat) => seat.player.id)).toEqual([
      "p4",
      "p5",
      "p0",
      "p1",
      "p2"
    ]);
  });

  it("keeps the literal six-player slot arrangement self plus five opponents", () => {
    expect(opponentSlotsFor(6)).toEqual([
      "top-left",
      "top-right",
      "left-middle",
      "right-middle",
      "bottom-left"
    ]);
  });

  it("hides a player who has left the current game", () => {
    const all = players(4);
    all[3]!.active = false;
    const assigned = seatedOpponents(all, "p0");
    expect(assigned.map((seat) => seat.player.id)).toEqual(["p1", "p2"]);
    expect(assigned.map((seat) => seat.slot)).toEqual(
      opponentSlotsFor(3)
    );
  });
});
