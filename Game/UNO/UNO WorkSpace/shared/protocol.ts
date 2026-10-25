import type { FriendState, FriendProfile } from "./social.ts";
export type CardColor = "red" | "yellow" | "green" | "blue";

export type CardKind =
  | "number"
  | "skip"
  | "reverse"
  | "draw2"
  | "wild"
  | "wild4"
  | "wild10";

export interface Card {
  id: string;
  kind: CardKind;
  color: CardColor | null;
  value?: number;
}

export type RoomPhase = "lobby" | "playing" | "finished";
export type GameStatus = "playing" | "finished";
export type TurnDirection = 1 | -1;

export const QUICK_EMOJIS = [
  "😹",
  "🤩",
  "😅",
  "😩",
  "👍",
  "😂",
  "😰",
  "🤣",
  "🙄"
] as const;

export type QuickEmoji = (typeof QUICK_EMOJIS)[number];

export function isQuickEmoji(value: unknown): value is QuickEmoji {
  return (
    typeof value === "string" &&
    (QUICK_EMOJIS as readonly string[]).includes(value)
  );
}

export interface EmoteMessage {
  id: string;
  playerId: string;
  emoji: QuickEmoji;
  sentAt: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
  active: boolean;
  handCount: number;
  unoDeclared: boolean;
}

export interface OwnPlayer extends PublicPlayer {
  hand: Card[];
}

export interface PendingUnoView {
  playerId: string;
  canDeclare: boolean;
  canCatch: boolean;
}

export interface PendingPenaltyView {
  attackerId: string;
  targetId: string;
  total: number;
  lastKind: "draw2" | "wild4";
  canRespond: boolean;
  canChallenge: boolean;
}

export interface PublicGameEvent {
  seq: number;
  type:
    | "game_started"
    | "card_played"
    | "card_drawn"
    | "turn_ended"
    | "uno_declared"
    | "uno_caught"
    | "penalty_stacked"
    | "penalty_accepted"
    | "wild4_challenge_won"
    | "wild4_challenge_lost"
    | "deck_recycled"
    | "deck_shortage"
    | "player_forfeited"
    | "game_finished";
  playerId?: string;
  targetId?: string;
  card?: Card;
  color?: CardColor;
  drawnCount?: number;
  requestedCount?: number;
  shortage?: number;
  message: string;
}

export interface PublicGameView {
  status: GameStatus;
  currentPlayerId: string;
  currentColor: CardColor;
  direction: TurnDirection;
  turnNumber: number;
  deckCount: number;
  discardCount: number;
  discardTop: Card;
  winnerId: string | null;
  playableCardIds: string[];
  drawnCardId: string | null;
  pendingUno: PendingUnoView | null;
  pendingPenalty: PendingPenaltyView | null;
  lastEvent: PublicGameEvent | null;
}

export interface RoomState {
  roomCode: string;
  phase: RoomPhase;
  hostId: string;
  players: PublicPlayer[];
  spectators: Array<{ id: string; name: string; connected: boolean }>;
  youAreSpectator: boolean;
  you: OwnPlayer;
  game: PublicGameView | null;
  reconnectionGraceSeconds: number;
}

export interface ActionAck<T = undefined> {
  ok: boolean;
  code?: string;
  message?: string;
  duplicate?: boolean;
  data?: T;
}

export type MutationAck = ActionAck<unknown>;

export interface CreateRoomResult {
  roomCode: string;
  playerId: string;
  token: string;
}

export interface JoinRoomResult extends CreateRoomResult {}

export interface AuthAccount {
  id: string;
  username: string;
  createdAt: string;
  email: string | null;
  avatarUrl: string | null;
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
export interface UnionArenaRoomResult { roomCode: string; }

export interface AuthResult {
  account: AuthAccount;
  token: string;
}

export interface LanStatusView {
  enabled: boolean;
  hostName: string;
  port: number;
  localUrl: string;
  addresses: Array<{
    name: string;
    address: string;
    url: string;
    kind:
      | "wlan"
      | "ethernet"
      | "radmin"
      | "uu"
      | "blue-shield"
      | "virtual"
      | "other";
    isVirtual: boolean;
  }>;
  updatedAt: number;
}

export interface ServerToClientEvents {
  room_state: (state: RoomState) => void;
  room_closed: (payload: { message: string }) => void;
  session_replaced: (payload: { message: string }) => void;
  session_expired: (payload: { message: string }) => void;
  lan_status: (status: LanStatusView) => void;
  emote: (message: EmoteMessage) => void;
  "ua:state": (state: UnionArenaRoomState) => void;
  "ua:room_closed": (payload: { message: string }) => void;
  social_updated: () => void;
  friend_room_invite: (payload: { game: "uno" | "shogi" | "arknights"; roomCode: string; inviter: string; role: "player" | "spectator" }) => void;
}

export interface ClientToServerEvents {
  auth_register: (
    payload: { username: string; email: string; password: string },
    ack: (result: ActionAck<AuthResult>) => void
  ) => void;
  auth_login: (
    payload: { username: string; password: string },
    ack: (result: ActionAck<AuthResult>) => void
  ) => void;
  auth_me: (
    payload: Record<string, never>,
    ack: (result: ActionAck<{ account: AuthAccount }>) => void
  ) => void;
  social_get: (payload: Record<string, never>, ack: (result: ActionAck<FriendState>) => void) => void;
  social_search: (payload: { query: string }, ack: (result: ActionAck<{ accounts: FriendProfile[] }>) => void) => void;
  social_request: (payload: { target: string }, ack: (result: MutationAck) => void) => void;
  social_accept: (payload: { requesterId: string }, ack: (result: MutationAck) => void) => void;
  social_reject: (payload: { requesterId: string }, ack: (result: MutationAck) => void) => void;
  social_invite: (payload: { targetId: string; game: "uno" | "shogi" | "arknights"; roomCode: string; role: "player" | "spectator" }, ack: (result: MutationAck) => void) => void;
  auth_logout: (
    payload: { actionId: string },
    ack: (result: MutationAck) => void
  ) => void;
  auth_reset_password: (
    payload: { username: string; email: string; password: string },
    ack: (result: ActionAck) => void
  ) => void;
  auth_delete_account: (
    payload: { password: string },
    ack: (result: ActionAck) => void
  ) => void;
  auth_change_password: (
    payload: { currentPassword: string; newPassword: string },
    ack: (result: ActionAck<AuthResult>) => void
  ) => void;
  auth_begin_email_change: (
    payload: { currentPassword: string; email: string },
    ack: (result: ActionAck) => void
  ) => void;
  auth_verify_email_change: (
    payload: { code: string },
    ack: (result: ActionAck<{ account: AuthAccount }>) => void
  ) => void;
  "ua:create_room": (payload: Record<string, never>, ack: (result: ActionAck<UnionArenaRoomResult>) => void) => void;
  "ua:join_room": (payload: { roomCode: string }, ack: (result: ActionAck<UnionArenaRoomResult>) => void) => void;
  "ua:resume_room": (payload: Record<string, never>, ack: (result: ActionAck<UnionArenaRoomResult>) => void) => void;
  "ua:submit_deck": (payload: { cardIds: string[]; apCount: number }, ack: (result: ActionAck<{ structuralOk: boolean; issues: string[] }>) => void) => void;
  "ua:ready": (payload: { ready: boolean }, ack: (result: MutationAck) => void) => void;
  "ua:start_game": (payload: Record<string, never>, ack: (result: MutationAck) => void) => void;
  "ua:mulligan": (payload: { redraw: boolean }, ack: (result: MutationAck) => void) => void;
  "ua:leave_room": (payload: Record<string, never>, ack: (result: MutationAck) => void) => void;
  /** A move of the running game; the payload is checked by the Arknights rules engine (UnionArenaAction in the Arknights workspace). */
  "ua:action": (payload: unknown, ack: (result: MutationAck) => void) => void;
  "ua:return_to_lobby": (payload: Record<string, never>, ack: (result: MutationAck) => void) => void;
  create_room: (
    payload: { name: string },
    ack: (result: ActionAck<CreateRoomResult>) => void
  ) => void;
  join_room: (
    payload: { roomCode: string; name: string },
    ack: (result: ActionAck<JoinRoomResult>) => void
  ) => void;
  spectate_room: (payload: { roomCode: string }, ack: (result: ActionAck) => void) => void;
  leave_spectating: (payload: Record<string, never>, ack: (result: MutationAck) => void) => void;
  resume_session: (
    payload: { roomCode: string; token: string },
    ack: (result: ActionAck<JoinRoomResult>) => void
  ) => void;
  sync_room: (
    payload: Record<string, never>,
    ack: (result: MutationAck) => void
  ) => void;
  set_ready: (
    payload: { ready: boolean; actionId: string },
    ack: (result: MutationAck) => void
  ) => void;
  start_game: (
    payload: { actionId: string },
    ack: (result: MutationAck) => void
  ) => void;
  restart_game: (
    payload: { actionId: string },
    ack: (result: MutationAck) => void
  ) => void;
  leave_room: (
    payload: { actionId: string },
    ack: (result: MutationAck) => void
  ) => void;
  play_card: (
    payload: {
      cardId: string;
      color?: CardColor;
      actionId: string;
      turnNumber: number;
    },
    ack: (result: MutationAck) => void
  ) => void;
  draw_card: (
    payload: { actionId: string; turnNumber: number },
    ack: (result: MutationAck) => void
  ) => void;
  end_turn: (
    payload: { actionId: string; turnNumber: number },
    ack: (result: MutationAck) => void
  ) => void;
  declare_uno: (
    payload: { actionId: string },
    ack: (result: MutationAck) => void
  ) => void;
  catch_uno: (
    payload: { targetId: string; actionId: string },
    ack: (result: MutationAck) => void
  ) => void;
  respond_penalty: (
    payload: {
      decision: "accept" | "challenge";
      actionId: string;
      turnNumber: number;
    },
    ack: (result: MutationAck) => void
  ) => void;
  host_get_lan_status: (
    payload: Record<string, never>,
    ack: (result: ActionAck<LanStatusView>) => void
  ) => void;
  host_set_lan_access: (
    payload: { enabled: boolean; actionId: string },
    ack: (result: ActionAck<LanStatusView>) => void
  ) => void;
  send_emote: (
    payload: { emoji: string; actionId: string },
    ack: (result: MutationAck) => void
  ) => void;
}

export const COLOR_NAMES: Record<CardColor, string> = {
  red: "红",
  yellow: "黄",
  green: "绿",
  blue: "蓝"
};
