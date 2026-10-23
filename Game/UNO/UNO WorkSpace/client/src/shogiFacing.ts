export type ShogiSide = "sente" | "gote";

export function shogiPieceFacing(
  pieceSide: ShogiSide,
  playerSide: ShogiSide,
  area: "board" | "hand" = "board"
): "own" | "opponent" {
  if (area === "hand") return "own";
  return pieceSide === playerSide ? "own" : "opponent";
}
