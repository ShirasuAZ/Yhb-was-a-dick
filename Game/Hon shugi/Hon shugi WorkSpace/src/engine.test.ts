import { describe, expect, it } from "vitest";
import { ShogiGame, type Move, type Piece, type SerializedPosition } from "./engine";

function must(game: ShogiGame, move: Move): void {
  expect(() => game.move(move)).not.toThrow();
}

describe("Hon shugi rule engine", () => {
  it("starts with the standard 9x9 layout and forty pieces", () => {
    const game = new ShogiGame();
    const view = game.view();
    expect(view.board).toHaveLength(9);
    expect(view.board.flat().filter(Boolean)).toHaveLength(40);
    expect(view.turn).toBe("sente");
    expect(view.legalMoves).toHaveLength(30);
    expect(view.board[0]?.filter(Boolean)).toHaveLength(9);
    expect(view.board[1]?.filter(Boolean)).toHaveLength(2);
    expect(view.board[2]?.filter(Boolean)).toHaveLength(9);
    expect(view.board[6]?.filter(Boolean)).toHaveLength(9);
    expect(view.board[7]?.filter(Boolean)).toHaveLength(2);
    expect(view.board[8]?.filter(Boolean)).toHaveLength(9);
  });

  it("supports a normal move and capture", () => {
    const game = new ShogiGame();
    must(game, { kind: "move", from: { row: 6, col: 4 }, to: { row: 5, col: 4 } });
    must(game, { kind: "move", from: { row: 2, col: 4 }, to: { row: 3, col: 4 } });
    must(game, { kind: "move", from: { row: 5, col: 4 }, to: { row: 4, col: 4 } });
    must(game, { kind: "move", from: { row: 3, col: 4 }, to: { row: 4, col: 4 } });
    expect(game.view().hands.gote.pawn).toBe(1);
    expect(game.view().hands.gote.pawn).toBe(1);
  });

  it("rejects an illegal pawn move and a second unpromoted pawn on one file", () => {
    const game = new ShogiGame();
    expect(() => game.move({ kind: "move", from: { row: 6, col: 0 }, to: { row: 4, col: 0 } })).toThrow("这一步不符合");
    expect(() => game.move({ kind: "drop", piece: "pawn", to: { row: 5, col: 0 } })).toThrow("这一步不符合");
  });

  it("only exposes promotion options in the promotion zone", () => {
    const game = new ShogiGame();
    const moves = game.view().legalMoves.filter((move) => move.kind === "move" && move.promote);
    expect(moves).toHaveLength(0);
  });

  it("keeps website-visible state serializable", () => {
    const game = new ShogiGame();
    const restored = new ShogiGame(JSON.parse(JSON.stringify(game.serialize())));
    expect(restored.serialize()).toEqual(game.serialize());
  });

  it("enforces optional and forced promotion with the full restored state", () => {
    const position = sparsePosition();
    position.board[1]![0] = { type: "pawn", side: "sente", promoted: false };
    position.board[3]![2] = { type: "silver", side: "sente", promoted: false };
    const game = new ShogiGame(position);
    expect(() => game.move({ kind: "move", from: { row: 1, col: 0 }, to: { row: 0, col: 0 }, promote: false })).toThrow();
    must(game, { kind: "move", from: { row: 1, col: 0 }, to: { row: 0, col: 0 }, promote: true });
    expect(game.view().board[0]![0]?.promoted).toBe(true);
    must(game, { kind: "move", from: { row: 0, col: 4 }, to: { row: 0, col: 3 } });
    expect(game.view().legalMoves).toContainEqual({ kind: "move", from: { row: 3, col: 2 }, to: { row: 2, col: 2 }, promote: true });
    expect(game.view().legalMoves).toContainEqual({ kind: "move", from: { row: 3, col: 2 }, to: { row: 2, col: 2 }, promote: false });
    expect(game.view().board[0]![0]?.promoted).toBe(true);
  });

  it("enforces nifu and allows a legal pawn drop on another file", () => {
    const position = sparsePosition();
    position.hands.sente.pawn = 1;
    position.board[4]![0] = { type: "pawn", side: "sente", promoted: false };
    const game = new ShogiGame(position);
    expect(() => game.move({ kind: "drop", piece: "pawn", to: { row: 5, col: 0 } })).toThrow();
    must(game, { kind: "drop", piece: "pawn", to: { row: 5, col: 1 } });
    expect(game.view().board[5]![1]).toEqual({ type: "pawn", side: "sente", promoted: false });
    expect(game.view().hands.sente.pawn).toBe(0);
  });

  it("recognizes check and rejects moves that leave the king exposed", () => {
    const position = sparsePosition();
    position.board[4]![4] = { type: "rook", side: "gote", promoted: false };
    position.board[4]![0] = { type: "gold", side: "sente", promoted: false };
    const game = new ShogiGame(position);
    expect(game.view().inCheck).toBe(true);
    expect(() => game.move({ kind: "move", from: { row: 4, col: 0 }, to: { row: 3, col: 0 } })).toThrow();
  });

  it("rejects pawn-drop mate", () => {
    const position = sparsePosition();
    position.board[0]![4] = { type: "king", side: "gote", promoted: false };
    position.board[8]![4] = null;
    position.board[8]![8] = { type: "king", side: "sente", promoted: false };
    position.board[1]![2] = { type: "gold", side: "sente", promoted: false };
    position.board[1]![6] = { type: "gold", side: "sente", promoted: false };
    position.board[2]![4] = { type: "gold", side: "sente", promoted: false };
    position.hands.sente.pawn = 1;
    const game = new ShogiGame(position);
    expect(() => game.move({ kind: "drop", piece: "pawn", to: { row: 1, col: 4 } })).toThrow("这一步不符合");
    expect(game.view().board[1]![4]).toBeNull();
    expect(game.view().hands.sente.pawn).toBe(1);
  });

  it("detects checkmate after a legal mating move", () => {
    const position = sparsePosition();
    position.board[0]![4] = null;
    position.board[0]![0] = { type: "king", side: "gote", promoted: false };
    position.board[8]![4] = null;
    position.board[8]![8] = { type: "king", side: "sente", promoted: false };
    position.board[1]![1] = { type: "rook", side: "sente", promoted: false };
    position.board[1]![2] = { type: "gold", side: "sente", promoted: false };
    position.board[2]![0] = { type: "gold", side: "sente", promoted: false };
    const game = new ShogiGame(position);
    must(game, { kind: "move", from: { row: 1, col: 1 }, to: { row: 0, col: 1 } });
    expect(game.view().status).toBe("checkmate");
    expect(game.view().winner).toBe("sente");
    expect(game.view().check).toBe("gote");
  });

  // Gote king (0,4) hemmed in by its own pawns (0,3)/(0,5); sente golds (2,3)/(2,5) cover every
  // flight square; sente rook then gives check down the open e-file from (5,0) -> (5,4).
  function rookCheck(extra: (position: SerializedPosition) => void): ShogiGame {
    const position = sparsePosition();
    position.board[0]![3] = { type: "pawn", side: "gote", promoted: false };
    position.board[0]![5] = { type: "pawn", side: "gote", promoted: false };
    position.board[2]![3] = { type: "gold", side: "sente", promoted: false };
    position.board[2]![5] = { type: "gold", side: "sente", promoted: false };
    position.board[5]![0] = { type: "rook", side: "sente", promoted: false };
    extra(position);
    const game = new ShogiGame(position);
    must(game, { kind: "move", from: { row: 5, col: 0 }, to: { row: 5, col: 4 } });
    return game;
  }
  const hasMove = (game: ShogiGame, predicate: (move: Move) => boolean): boolean => game.view().legalMoves.some(predicate);

  it("is checkmate when the checked king has no escape, capture or block", () => {
    const game = rookCheck(() => {});
    expect(game.view().check).toBe("gote");
    expect(game.view().status).toBe("checkmate");
    expect(game.view().winner).toBe("sente");
    expect(game.view().legalMoves).toHaveLength(0);
    expect(() => game.move({ kind: "move", from: { row: 0, col: 4 }, to: { row: 1, col: 4 } })).toThrow();
  });

  it("is only check (not mate) when the king can step away", () => {
    const position = sparsePosition();
    position.board[5]![0] = { type: "rook", side: "sente", promoted: false };
    const game = new ShogiGame(position);
    must(game, { kind: "move", from: { row: 5, col: 0 }, to: { row: 5, col: 4 } });
    expect(game.view().check).toBe("gote");
    expect(game.view().status).toBe("playing");
    expect(hasMove(game, (m) => m.kind === "move" && m.to.row === 0 && m.to.col === 3)).toBe(true);
  });

  it("is only check (not mate) when the checking piece can be captured", () => {
    const game = rookCheck((position) => {
      position.board[5]![8] = { type: "rook", side: "gote", promoted: false };
    });
    expect(game.view().check).toBe("gote");
    expect(game.view().status).toBe("playing");
    expect(hasMove(game, (m) => m.kind === "move" && m.from.row === 5 && m.from.col === 8 && m.to.row === 5 && m.to.col === 4)).toBe(true);
  });

  it("is only check (not mate) when the line can be blocked by a move or a drop", () => {
    const blockByMove = rookCheck((position) => {
      position.board[3]![8] = { type: "rook", side: "gote", promoted: false };
    });
    expect(blockByMove.view().status).toBe("playing");
    expect(hasMove(blockByMove, (m) => m.kind === "move" && m.from.row === 3 && m.from.col === 8 && m.to.row === 3 && m.to.col === 4)).toBe(true);

    const blockByDrop = rookCheck((position) => { position.hands.gote.gold = 1; });
    expect(blockByDrop.view().status).toBe("playing");
    expect(hasMove(blockByDrop, (m) => m.kind === "drop" && m.piece === "gold" && m.to.col === 4 && m.to.row >= 1 && m.to.row <= 4)).toBe(true);
    // Every legal answer must actually resolve the check.
    for (const reply of blockByDrop.view().legalMoves) {
      const copy = new ShogiGame(blockByDrop.serialize());
      copy.move(reply);
      expect(copy.view().board[0]![4]?.type).toBe("king");
    }
  });

  it("does not count a pinned piece's block as a defence", () => {
    // Gote rook (1,5) could block at (1,4) or take the gold at (2,5), but a sente bishop on (3,7)
    // pins it to the king along the diagonal, so neither is legal and the position is mate.
    const game = rookCheck((position) => {
      position.board[1]![5] = { type: "rook", side: "gote", promoted: false };
      position.board[3]![7] = { type: "bishop", side: "sente", promoted: false };
    });
    expect(game.view().check).toBe("gote");
    expect(game.view().status).toBe("checkmate");
    expect(game.view().winner).toBe("sente");
    expect(game.view().legalMoves).toHaveLength(0);
  });

  it("declares sennichite after the same position appears four times", () => {
    const position = sparsePosition();
    const game = new ShogiGame(position);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      must(game, { kind: "move", from: { row: 8, col: 4 }, to: { row: 8, col: 3 } });
      must(game, { kind: "move", from: { row: 0, col: 4 }, to: { row: 0, col: 3 } });
      must(game, { kind: "move", from: { row: 8, col: 3 }, to: { row: 8, col: 4 } });
      must(game, { kind: "move", from: { row: 0, col: 3 }, to: { row: 0, col: 4 } });
    }
    expect(game.view().status).toBe("draw");
    expect(game.view().drawReason).toBe("sennichite");
  });
});

function sparsePosition(): SerializedPosition {
  const board: Array<Array<Piece | null>> = Array.from({ length: 9 }, () => Array(9).fill(null));
  board[8]![4] = { type: "king", side: "sente", promoted: false };
  board[0]![4] = { type: "king", side: "gote", promoted: false };
  const hand = () => ({ king: 0, rook: 0, bishop: 0, gold: 0, silver: 0, knight: 0, lance: 0, pawn: 0 });
  return { board, hands: { sente: hand(), gote: hand() }, turn: "sente", status: "playing", winner: null, check: null, drawReason: null, history: [], repetition: {}, positionHistory: {} };
}
