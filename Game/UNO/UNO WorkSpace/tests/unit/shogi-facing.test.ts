import { describe, expect, it } from "vitest";
import { shogiPieceFacing } from "../../client/src/shogiFacing.ts";

describe("shogi piece orientation", () => {
  it("identifies each piece relative to the viewer for the perspective-aware board render", () => {
    expect(shogiPieceFacing("sente", "sente")).toBe("own");
    expect(shogiPieceFacing("gote", "sente")).toBe("opponent");
    expect(shogiPieceFacing("gote", "gote")).toBe("own");
    expect(shogiPieceFacing("sente", "gote")).toBe("opponent");
  });

  it("keeps pieces in both players' hands upright", () => {
    expect(shogiPieceFacing("sente", "sente", "hand")).toBe("own");
    expect(shogiPieceFacing("gote", "sente", "hand")).toBe("own");
    expect(shogiPieceFacing("sente", "gote", "hand")).toBe("own");
    expect(shogiPieceFacing("gote", "gote", "hand")).toBe("own");
  });
});
