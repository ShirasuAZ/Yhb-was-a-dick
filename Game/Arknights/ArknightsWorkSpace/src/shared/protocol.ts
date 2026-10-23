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

/** `mulligan`: each player in turn decides whether to redraw the starting hand. `turn`: the game proper (the first turn has begun). `over`: someone has won. */
export type UnionArenaGameStep = "mulligan" | "turn" | "over";

/** The five phases of a turn, in order (rule manual, "Game Flow"). */
export type UnionArenaTurnPhase = "start" | "movement" | "main" | "attack" | "end";

/** Printed card data, transcribed from the card images (Cards/cards.json). Absent for a card whose data is unknown. */
export interface UnionArenaCardStats {
  type: "character" | "site" | "event";
  /** The required energy's colour, which is the card's colour. */
  color: string;
  energyCost: number;
  apCost: number;
  /** Characters only. */
  bp: number | null;
  /** Energy generation icons, counted only while the card is on the energy line. */
  energyGen: number;
  energyGenColor: string | null;
  energyGenPlus: boolean;
  affinities: string[];
  /** Raid targets: card names, or an affinity written as "[affinity]". */
  raid: { targets: string[]; text: string } | null;
  /** Keyword abilities the card always has (printed at the start of an ability line, as 《冲击无效》). Conditional ones are only in `abilityText`. */
  keywords: string[];
  abilityText: string;
  trigger: { label: string; text: string } | null;
}

/** One AP card in the AP area. */
export interface UnionArenaApCard {
  id: string;
  rested: boolean;
}

/** A character or site on the front line or energy line. `under` lists the cards beneath it after Raid, bottom first. */
export interface UnionArenaFieldCard {
  uid: string;
  cardId: string;
  under: string[];
  rested: boolean;
  /** BP change from abilities until the end of the turn. */
  bpMod: number;
  /** Energy generation change from abilities while it stays on the field. */
  energyMod: number;
  /** Keyword abilities given until the end of the turn. */
  grants: string[];
  attacks: number;
  blocks: number;
  /** "The next time it would switch to active, it does not." */
  skipNextActivate: boolean;
}

/** One player's visible board. Sideline and removal area are face up, so their cards are public. */
export interface UnionArenaBoard {
  ap: UnionArenaApCard[];
  front: UnionArenaFieldCard[];
  energy: UnionArenaFieldCard[];
  sideline: string[];
  removal: string[];
}

/** A decision the game is waiting for, and who has to make it. */
export type UnionArenaPending =
  | { kind: "block"; playerId: string; attackerUid: string }
  | { kind: "damage"; playerId: string; defenderId: string; amount: number }
  | { kind: "triggers"; playerId: string; attackerId: string; revealed: UnionArenaLifeCard[] }
  | { kind: "discard"; playerId: string };

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
  /** The turn player's current phase; null during the mulligan. */
  phase: UnionArenaTurnPhase | null;
  /** Whether the turn player has already taken this turn's extra draw. */
  extraDrawUsed: boolean;
  board: { you: UnionArenaBoard; opponent: UnionArenaBoard };
  pending: UnionArenaPending | null;
  winnerId: string | null;
  endReason: string | null;
  /** Recent public events, oldest first. */
  log: string[];
}

/** Effects the players resolve by hand, following a card's printed text: the engine runs the rule manual, the card abilities are applied with these. */
export type UnionArenaManualOp =
  | { op: "draw" }
  | { op: "field"; owner: "you" | "opponent"; uid: string; act: "rest" | "activate" | "bp+" | "bp-" | "energy+" | "energy-" | "sideline" | "hand" | "removal" }
  | { op: "grant"; owner: "you" | "opponent"; uid: string; keyword: string }
  | { op: "hand"; handIndex: number; act: "sideline" | "removal" }
  | { op: "ap"; apId: string; act: "rest" | "activate" }
  | { op: "sideline_to_hand"; index: number };

/** Every move a player can make once the turns have begun. */
export type UnionArenaAction =
  | { type: "next_phase" }
  | { type: "extra_draw" }
  | { type: "move"; toFront: string[]; toEnergy: string[]; remove: string[] }
  | { type: "play"; handIndex: number; line: "front" | "energy"; remove?: string }
  | { type: "raid"; handIndex: number; targetUid: string; toFront?: boolean; remove?: string }
  | { type: "event"; handIndex: number }
  | { type: "attack"; attackerUid: string; targetUid?: string }
  | { type: "block"; blockerUid: string | null }
  | { type: "damage"; lifeIds: string[] }
  | { type: "trigger"; lifeId: string; activate: boolean; targetUid?: string; sidelineIndex?: number; raid?: { targetUid: string; toFront?: boolean; remove?: string }; remove?: string }
  | { type: "end_turn" }
  | { type: "discard"; keep: number[] }
  | { type: "manual"; manual: UnionArenaManualOp }
  | { type: "concede" };

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
  "ua:action": (
    payload: UnionArenaAction,
    ack: (result: ActionAck) => void
  ) => void;
  /** After a finished game: back to the room's lobby, decks kept. */
  "ua:return_to_lobby": (
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
