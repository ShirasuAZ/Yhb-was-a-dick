export const BOARD_SIZE = 9;

export type Side = "sente" | "gote";
export type PieceType =
  | "king"
  | "rook"
  | "bishop"
  | "gold"
  | "silver"
  | "knight"
  | "lance"
  | "pawn";

export const PIECE_TYPES: readonly PieceType[] = [
  "king",
  "rook",
  "bishop",
  "gold",
  "silver",
  "knight",
  "lance",
  "pawn"
];

export interface Square {
  row: number;
  col: number;
}

export interface Piece {
  type: PieceType;
  side: Side;
  promoted: boolean;
}

export type Move =
  | { kind: "move"; from: Square; to: Square; promote?: boolean }
  | { kind: "drop"; piece: Exclude<PieceType, "king">; to: Square };

export type MoveRecord = Move & {
  side: Side;
  notation: string;
  captured?: PieceType;
  promoted?: boolean;
  check: boolean;
};

export type GameStatus = "playing" | "checkmate" | "draw" | "resigned";

export interface SerializedPosition {
  board: Array<Array<Piece | null>>;
  hands: Record<Side, Record<PieceType, number>>;
  turn: Side;
  status: GameStatus;
  winner: Side | null;
  check: Side | null;
  drawReason: "sennichite" | "perpetual_check" | "no_legal_moves" | null;
  history: MoveRecord[];
  repetition: Record<string, number>;
  positionHistory: Record<string, number[]>;
}

export interface GameView extends SerializedPosition {
  lastMove: MoveRecord | null;
  legalMoves: Move[];
  inCheck: boolean;
}

const BACK_RANK: PieceType[] = [
  "lance",
  "knight",
  "silver",
  "gold",
  "king",
  "gold",
  "silver",
  "knight",
  "lance"
];

const HAND_ORDER: Exclude<PieceType, "king">[] = [
  "rook",
  "bishop",
  "gold",
  "silver",
  "knight",
  "lance",
  "pawn"
];

const PIECE_LABELS: Record<PieceType, string> = {
  king: "王",
  rook: "飛",
  bishop: "角",
  gold: "金",
  silver: "銀",
  knight: "桂",
  lance: "香",
  pawn: "歩"
};

function otherSide(side: Side): Side {
  return side === "sente" ? "gote" : "sente";
}

function inside(square: Square): boolean {
  return (
    square.row >= 0 && square.row < BOARD_SIZE &&
    square.col >= 0 && square.col < BOARD_SIZE
  );
}

function equalSquare(a: Square, b: Square): boolean {
  return a.row === b.row && a.col === b.col;
}

function copyPiece(piece: Piece | null): Piece | null {
  return piece ? { ...piece } : null;
}

function cloneBoard(board: Array<Array<Piece | null>>): Array<Array<Piece | null>> {
  return board.map((row) => row.map(copyPiece));
}

function emptyHands(): Record<Side, Record<PieceType, number>> {
  const make = (): Record<PieceType, number> => ({
    king: 0,
    rook: 0,
    bishop: 0,
    gold: 0,
    silver: 0,
    knight: 0,
    lance: 0,
    pawn: 0
  });
  return { sente: make(), gote: make() };
}

function cloneHands(
  hands: Record<Side, Record<PieceType, number>>
): Record<Side, Record<PieceType, number>> {
  return { sente: { ...hands.sente }, gote: { ...hands.gote } };
}

function zone(side: Side, row: number): boolean {
  return side === "sente" ? row <= 2 : row >= 6;
}

function forward(side: Side): number {
  return side === "sente" ? -1 : 1;
}

function lastRank(side: Side, row: number): boolean {
  return side === "sente" ? row === 0 : row === 8;
}

function lastTwoRanks(side: Side, row: number): boolean {
  return side === "sente" ? row <= 1 : row >= 7;
}

function canPromote(piece: Piece): boolean {
  return !piece.promoted && !["king", "gold"].includes(piece.type);
}

function mustPromote(piece: Piece, destination: Square): boolean {
  return (
    (piece.type === "pawn" || piece.type === "lance") && lastRank(piece.side, destination.row)
  ) || (piece.type === "knight" && lastTwoRanks(piece.side, destination.row));
}

function displayPiece(piece: PieceType, promoted: boolean): string {
  return promoted ? `成${PIECE_LABELS[piece]}` : PIECE_LABELS[piece];
}

export class ShogiRuleError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ShogiRuleError";
  }
}

interface Snapshot {
  board: Array<Array<Piece | null>>;
  hands: Record<Side, Record<PieceType, number>>;
  turn: Side;
  status: GameStatus;
  winner: Side | null;
  check: Side | null;
  drawReason: SerializedPosition["drawReason"];
  history: MoveRecord[];
  repetition: Map<string, number>;
  positionHistory: Map<string, number[]>;
}

export class ShogiGame {
  private board: Array<Array<Piece | null>>;
  private hands: Record<Side, Record<PieceType, number>>;
  private turn: Side = "sente";
  private status: GameStatus = "playing";
  private winner: Side | null = null;
  private check: Side | null = null;
  private drawReason: SerializedPosition["drawReason"] = null;
  private history: MoveRecord[] = [];
  private repetition = new Map<string, number>();
  private positionHistory = new Map<string, number[]>();

  constructor(initial?: SerializedPosition) {
    if (initial) {
      this.board = cloneBoard(initial.board);
      this.hands = cloneHands(initial.hands);
      this.turn = initial.turn;
      this.status = initial.status;
      this.winner = initial.winner;
      this.check = initial.check;
      this.drawReason = initial.drawReason;
      this.history = initial.history.map((move) => ({ ...move }));
      this.repetition = new Map(Object.entries(initial.repetition));
      this.positionHistory = new Map(Object.entries(initial.positionHistory ?? {}));
      const current = this.positionKey();
      if (!this.positionHistory.has(current)) {
        this.positionHistory.set(current, [this.history.length]);
        this.repetition.set(current, this.repetition.get(current) ?? 1);
      }
    } else {
      this.board = Array.from({ length: BOARD_SIZE }, () =>
        Array<Piece | null>(BOARD_SIZE).fill(null)
      );
      this.hands = emptyHands();
      this.setupInitialPosition();
      const key = this.positionKey();
      this.repetition.set(key, 1);
      this.positionHistory.set(key, [0]);
    }
  }

  private setupInitialPosition(): void {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      this.board[0]![col] = { type: BACK_RANK[col]!, side: "gote", promoted: false };
      this.board[2]![col] = { type: "pawn", side: "gote", promoted: false };
      this.board[6]![col] = { type: "pawn", side: "sente", promoted: false };
      this.board[8]![col] = { type: BACK_RANK[col]!, side: "sente", promoted: false };
    }
    this.board[1]![1] = { type: "rook", side: "gote", promoted: false };
    this.board[1]![7] = { type: "bishop", side: "gote", promoted: false };
    this.board[7]![1] = { type: "bishop", side: "sente", promoted: false };
    this.board[7]![7] = { type: "rook", side: "sente", promoted: false };
  }

  get currentSide(): Side {
    return this.turn;
  }

  get gameStatus(): GameStatus {
    return this.status;
  }

  get currentCheck(): Side | null {
    return this.check;
  }

  serialize(): SerializedPosition {
    return {
      board: cloneBoard(this.board),
      hands: cloneHands(this.hands),
      turn: this.turn,
      status: this.status,
      winner: this.winner,
      check: this.check,
      drawReason: this.drawReason,
      history: this.history.map((move) => ({ ...move })),
      repetition: Object.fromEntries(this.repetition.entries()),
      positionHistory: Object.fromEntries([...this.positionHistory.entries()].map(([key, plies]) => [key, [...plies]]))
    };
  }

  view(): GameView {
    const inCheck = this.isInCheck(this.turn);
    return {
      ...this.serialize(),
      lastMove: this.history.at(-1) ?? null,
      legalMoves: this.status === "playing" ? this.legalMoves(this.turn) : [],
      inCheck
    };
  }

  legalMoves(side = this.turn): Move[] {
    if (this.status !== "playing" && side === this.turn) return [];
    return this.pseudoMoves(side).filter((move) => this.isLegal(move));
  }

  move(move: Move): MoveRecord {
    if (this.status !== "playing") {
      throw new ShogiRuleError("GAME_OVER", "对局已经结束");
    }
    if (!this.isLegal(move)) {
      throw new ShogiRuleError("ILLEGAL_MOVE", "这一步不符合本将棋规则");
    }
    const movingSide = this.turn;
    const movingPiece = move.kind === "move" ? (this.board[move.from.row]![move.from.col] ?? null) : null;
    const captured = move.kind === "move" ? (this.board[move.to.row]![move.to.col] ?? null) : null;
    const notation = this.notation(move, movingPiece, captured);
    this.applyRaw(move);
    this.turn = otherSide(this.turn);
    this.check = this.isInCheck(this.turn) ? this.turn : null;
    const record: MoveRecord = {
      ...move,
      side: movingSide,
      notation,
      ...(captured ? { captured: captured.type } : {}),
      ...(move.kind === "move" && move.promote ? { promoted: true } : {}),
      check: this.check === this.turn
    };
    this.history.push(record);
    const key = this.positionKey();
    const count = (this.repetition.get(key) ?? 0) + 1;
    this.repetition.set(key, count);
    const plies = this.positionHistory.get(key) ?? [];
    plies.push(this.history.length);
    this.positionHistory.set(key, plies);
    this.finishIfNeeded();
    return { ...record };
  }

  resign(side = this.turn): void {
    if (this.status !== "playing") return;
    this.status = "resigned";
    this.winner = otherSide(side);
  }

  reset(): void {
    const fresh = new ShogiGame();
    this.board = fresh.board;
    this.hands = fresh.hands;
    this.turn = fresh.turn;
    this.status = fresh.status;
    this.winner = fresh.winner;
    this.check = fresh.check;
    this.drawReason = fresh.drawReason;
    this.history = fresh.history;
    this.repetition = fresh.repetition;
    this.positionHistory = fresh.positionHistory;
  }

  private snapshot(): Snapshot {
    return {
      board: cloneBoard(this.board),
      hands: cloneHands(this.hands),
      turn: this.turn,
      status: this.status,
      winner: this.winner,
      check: this.check,
      drawReason: this.drawReason,
      history: this.history.map((move) => ({ ...move })),
      repetition: new Map(this.repetition),
      positionHistory: new Map([...this.positionHistory.entries()].map(([key, plies]) => [key, [...plies]]))
    };
  }

  private finishIfNeeded(): void {
    const next = this.turn;
    const legal = this.legalMoves(next);
    if (legal.length === 0) {
      this.status = "checkmate";
      this.winner = otherSide(next);
      if (!this.isInCheck(next)) {
        this.drawReason = "no_legal_moves";
      }
      return;
    }
    const key = this.positionKey();
    const occurrences = this.positionHistory.get(key) ?? [];
    const count = this.repetition.get(key) ?? 0;
    if (count >= 4) {
      const cycleStart = occurrences.at(-4) ?? 0;
      const cycle = this.history.slice(cycleStart);
      const continuousCheckers = (["sente", "gote"] as const).filter((side) => {
        const checks = cycle.filter((move) => move.side === side);
        return checks.length > 0 && checks.every((move) => move.check);
      });
      this.status = "draw";
      this.drawReason = continuousCheckers.length > 0 ? "perpetual_check" : "sennichite";
      if (continuousCheckers.length === 1) this.winner = otherSide(continuousCheckers[0]!);
    }
  }

  private pseudoMoves(side: Side): Move[] {
    const moves: Move[] = [];
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const piece = this.board[row]![col];
        if (!piece || piece.side !== side) continue;
        const from = { row, col };
        for (const to of this.pieceDestinations(piece, from)) {
          if (this.board[to.row]![to.col]?.type === "king") continue;
          const promoteOptions = canPromote(piece) && (zone(side, row) || zone(side, to.row));
          if (promoteOptions && !mustPromote(piece, to)) {
            moves.push({ kind: "move", from, to, promote: false });
            moves.push({ kind: "move", from, to, promote: true });
          } else {
            moves.push({ kind: "move", from, to, ...(mustPromote(piece, to) ? { promote: true } : {}) });
          }
        }
      }
    }
    for (const piece of HAND_ORDER) {
      if (this.hands[side][piece] <= 0) continue;
      for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
          if (!this.board[row]![col]) moves.push({ kind: "drop", piece, to: { row, col } });
        }
      }
    }
    return moves;
  }

  private isLegal(move: Move, options: { skipPawnDropMate?: boolean } = {}): boolean {
    if (move.kind === "move") {
      if (!inside(move.from) || !inside(move.to) || equalSquare(move.from, move.to)) return false;
      const piece = this.board[move.from.row]?.[move.from.col];
      if (!piece || piece.side !== this.turn) return false;
      if (this.board[move.to.row]?.[move.to.col]?.side === this.turn) return false;
      if (this.board[move.to.row]?.[move.to.col]?.type === "king") return false;
      if (!this.pieceDestinations(piece, move.from).some((to) => equalSquare(to, move.to))) return false;
      if (move.promote && (!canPromote(piece) || !(zone(piece.side, move.from.row) || zone(piece.side, move.to.row)))) return false;
      if (mustPromote(piece, move.to) && !move.promote) return false;
    } else {
      if (!inside(move.to) || this.board[move.to.row]?.[move.to.col]) return false;
      if (this.hands[this.turn][move.piece] <= 0) return false;
      if ((move.piece === "pawn" || move.piece === "lance") && lastRank(this.turn, move.to.row)) return false;
      if (move.piece === "knight" && lastTwoRanks(this.turn, move.to.row)) return false;
      if (move.piece === "pawn" && this.hasUnpromotedPawnOnFile(this.turn, move.to.col)) return false;
      if (move.piece === "pawn" && !options.skipPawnDropMate) {
        const copy = this.snapshot();
        this.applyRaw(move);
        this.turn = otherSide(this.turn);
        const mate = this.isInCheck(this.turn) && this.pseudoMoves(this.turn).every((candidate) => !this.isLegalForSide(candidate, this.turn, true));
        this.restore(copy);
        if (mate) return false;
      }
    }
    const snapshot = this.snapshot();
    this.applyRaw(move);
    const movingSide = this.turn;
    const safe = !this.isInCheck(movingSide);
    this.restore(snapshot);
    return safe;
  }

  private isLegalForSide(move: Move, side: Side, skipPawnDropMate: boolean): boolean {
    const snapshot = this.snapshot();
    const oldTurn = this.turn;
    this.turn = side;
    const result = this.isLegal(move, { skipPawnDropMate });
    this.turn = oldTurn;
    this.restore(snapshot);
    return result;
  }

  private restore(snapshot: Snapshot): void {
    this.board = cloneBoard(snapshot.board);
    this.hands = cloneHands(snapshot.hands);
    this.turn = snapshot.turn;
    this.status = snapshot.status;
    this.winner = snapshot.winner;
    this.check = snapshot.check;
    this.drawReason = snapshot.drawReason;
    this.history = snapshot.history.map((move) => ({ ...move }));
    this.repetition = new Map(snapshot.repetition);
    this.positionHistory = new Map([...snapshot.positionHistory.entries()].map(([key, plies]) => [key, [...plies]]));
  }

  private applyRaw(move: Move): void {
    if (move.kind === "drop") {
      this.hands[this.turn][move.piece] -= 1;
      this.board[move.to.row]![move.to.col] = { type: move.piece, side: this.turn, promoted: false };
      return;
    }
    const piece = this.board[move.from.row]![move.from.col];
    if (!piece) throw new ShogiRuleError("MISSING_PIECE", "起点没有棋子");
    const captured = this.board[move.to.row]![move.to.col];
    if (captured && captured.side !== piece.side) {
      this.hands[piece.side][captured.type] += 1;
    }
    this.board[move.from.row]![move.from.col] = null;
    this.board[move.to.row]![move.to.col] = { ...piece, promoted: piece.promoted || move.promote === true };
  }

  private hasUnpromotedPawnOnFile(side: Side, col: number): boolean {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      const piece = this.board[row]![col];
      if (piece?.side === side && piece.type === "pawn" && !piece.promoted) return true;
    }
    return false;
  }

  private pieceDestinations(piece: Piece, from: Square): Square[] {
    const result: Square[] = [];
    const f = forward(piece.side);
    const add = (row: number, col: number): boolean => {
      const to = { row, col };
      if (!inside(to)) return false;
      const target = this.board[row]![col];
      if (target?.side === piece.side) return false;
      result.push(to);
      return !target;
    };
    const step = (dr: number, dc: number) => { add(from.row + dr, from.col + dc); };
    const gold = () => {
      step(f, 0); step(f, -1); step(f, 1); step(0, -1); step(0, 1); step(-f, 0);
    };
    if (piece.promoted && ["pawn", "lance", "knight", "silver"].includes(piece.type)) {
      gold();
      return result;
    }
    switch (piece.type) {
      case "king":
        for (const dr of [-1, 0, 1]) for (const dc of [-1, 0, 1]) if (dr || dc) step(dr, dc);
        break;
      case "gold": gold(); break;
      case "silver": step(f, 0); step(f, -1); step(f, 1); step(-f, -1); step(-f, 1); break;
      case "knight": step(2 * f, -1); step(2 * f, 1); break;
      case "pawn": step(f, 0); break;
      case "lance": for (let distance = 1; distance < BOARD_SIZE; distance += 1) if (!add(from.row + f * distance, from.col)) break; break;
      case "rook":
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) for (let distance = 1; distance < BOARD_SIZE; distance += 1) if (!add(from.row + dr * distance, from.col + dc * distance)) break;
        if (piece.promoted) for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) step(dr, dc);
        break;
      case "bishop":
        for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) for (let distance = 1; distance < BOARD_SIZE; distance += 1) if (!add(from.row + dr * distance, from.col + dc * distance)) break;
        if (piece.promoted) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) step(dr, dc);
        break;
    }
    return result;
  }

  private isInCheck(side: Side): boolean {
    let king: Square | null = null;
    for (let row = 0; row < BOARD_SIZE; row += 1) for (let col = 0; col < BOARD_SIZE; col += 1) {
      const piece = this.board[row]![col];
      if (piece?.side === side && piece.type === "king") king = { row, col };
    }
    if (!king) return true;
    return this.isSquareAttacked(king, otherSide(side));
  }

  private isSquareAttacked(target: Square, bySide: Side): boolean {
    for (let row = 0; row < BOARD_SIZE; row += 1) for (let col = 0; col < BOARD_SIZE; col += 1) {
      const piece = this.board[row]![col];
      if (!piece || piece.side !== bySide) continue;
      if (this.pieceDestinations(piece, { row, col }).some((to) => equalSquare(to, target))) return true;
    }
    return false;
  }

  private positionKey(): string {
    const board = this.board.map((row) => row.map((piece) => piece ? `${piece.side}:${piece.type}:${piece.promoted ? 1 : 0}` : "-").join(",")).join("/");
    const hand = (side: Side) => HAND_ORDER.map((piece) => `${piece[0]}${this.hands[side][piece]}`).join("");
    return `${board}|${hand("sente")}|${hand("gote")}|${this.turn}`;
  }

  private notation(move: Move, piece: Piece | null, captured: Piece | null): string {
    if (move.kind === "drop") return `${PIECE_LABELS[move.piece]}打${9 - move.to.col}${move.to.row + 1}`;
    if (!piece) return "?";
    return `${displayPiece(piece.type, piece.promoted)}${9 - move.to.col}${move.to.row + 1}${move.promote ? "成" : ""}${captured ? "" : ""}`;
  }
}

export function pieceLabel(piece: PieceType): string {
  return PIECE_LABELS[piece];
}

export function handPieces(side: Side, hands: Record<Side, Record<PieceType, number>>): Array<{ type: Exclude<PieceType, "king">; count: number }> {
  return HAND_ORDER.map((type) => ({ type, count: hands[side][type] })).filter((entry) => entry.count > 0);
}

