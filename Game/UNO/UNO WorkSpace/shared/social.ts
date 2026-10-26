export type GameKind = "uno" | "shogi" | "arknights";
export type RoomRole = "player" | "spectator";
/**
 * A friend as the site shows them. `online` comes from the live socket connection, and `game` from that game's own room
 * bookkeeping — a friend offline is never reported as playing anything.
 */
export interface FriendProfile {
  id: string;
  username: string;
  avatarUrl: string | null;
  online?: boolean;
  game?: GameKind | null;
  /** The room this friend is in (playing or watching), so their friends can join to spectate; null outside a room. */
  roomCode?: string | null;
  /** True when the friend is only watching that room. */
  watching?: boolean;
}
export interface FriendState { friends: FriendProfile[]; incoming: FriendProfile[]; outgoing: FriendProfile[]; }
export interface RoomInvitation { id: string; fromId: string; toId: string; game: GameKind; roomCode: string; role: RoomRole; createdAt: number; expiresAt: number; }
export interface InvitationView extends RoomInvitation { inviter: string; }
