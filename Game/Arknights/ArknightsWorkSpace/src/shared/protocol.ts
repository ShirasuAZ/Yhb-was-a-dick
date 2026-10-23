export interface ActionAck<T = undefined> {
  ok: boolean;
  code?: string;
  message?: string;
  data?: T;
}

export type UnionArenaPhase = "lobby" | "playing";

export interface UnionArenaPlayer {
  id: string;
  username: string;
  avatarUrl: string | null;
  seat: 0 | 1;
  connected: boolean;
  isHost: boolean;
  ready: boolean;
}

/** One life card, in life-area order (index 0 = first). `cardId` is null while the card is face down, so a face-down card's identity never leaves the server. */
export interface UnionArenaLifeCard {
  id: string;
  cardId: string | null;
}

export interface UnionArenaLifeState {
  you: UnionArenaLifeCard[];
  opponent: UnionArenaLifeCard[];
}

/** `mulligan`: each player in turn decides whether to redraw the starting hand. `turn`: the game proper (the first turn has begun). */
export type UnionArenaGameStep = "mulligan" | "turn";

/** Public facts about a running game. Hands and decks are shown as counts only. */
export interface UnionArenaGameState {
  step: UnionArenaGameStep;
  /** Player One, who takes the first turn and decides on the mulligan first. */
  firstPlayerId: string;
  /** Whose turn it is; null while `step` is "mulligan". */
  turnPlayerId: string | null;
  turn: number;
  /** Who must decide on the mulligan now; null once `step` is "turn". */
  mulliganPlayerId: string | null;
  handCount: { you: number; opponent: number };
  deckCount: { you: number; opponent: number };
}

export interface UnionArenaRoomState {
  roomCode: string;
  phase: UnionArenaPhase;
  players: UnionArenaPlayer[];
  you: UnionArenaPlayer;
  life: UnionArenaLifeState;
  /** Null in the lobby. */
  game: UnionArenaGameState | null;
  /** Your own hand, in draw order. Only ever sent to its owner; empty in the lobby. */
  hand: string[];
  playerCount: number;
  requiredPlayers: 2;
  startAllowed: boolean;
}

export interface UnionArenaRoomResult {
  roomCode: string;
  you?: UnionArenaPlayer;
}

export interface ServerToClientEvents {
  "ua:state": (state: UnionArenaRoomState) => void;
}

export interface ClientToServerEvents {
  "ua:create_room": (
    payload: Record<string, never>,
    ack: (result: ActionAck<UnionArenaRoomResult>) => void
  ) => void;
  "ua:join_room": (
    payload: { roomCode: string },
    ack: (result: ActionAck<UnionArenaRoomResult>) => void
  ) => void;
  "ua:resume_room": (
    payload: Record<string, never>,
    ack: (result: ActionAck<UnionArenaRoomResult>) => void
  ) => void;
  "ua:submit_deck": (
    payload: { cardIds: string[]; apCount: number },
    ack: (result: ActionAck<{ structuralOk: boolean; issues: string[] }>) => void
  ) => void;
  "ua:ready": (
    payload: { ready: boolean },
    ack: (result: ActionAck) => void
  ) => void;
  "ua:start_game": (
    payload: Record<string, never>,
    ack: (result: ActionAck) => void
  ) => void;
  "ua:mulligan": (
    payload: { redraw: boolean },
    ack: (result: ActionAck) => void
  ) => void;
  "ua:leave_room": (
    payload: Record<string, never>,
    ack: (result: ActionAck) => void
  ) => void;
}

export interface UnionArenaAccount {
  id: string;
  username: string;
  avatarUrl: string | null;
}

export interface UnionArenaAuthProvider {
  verifyToken(token: unknown): UnionArenaAccount | null;
  findAccount(accountId: string | undefined): UnionArenaAccount | null;
}
