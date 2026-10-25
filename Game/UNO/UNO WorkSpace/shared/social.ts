export type GameKind = "uno" | "shogi" | "arknights";
export type RoomRole = "player" | "spectator";
export interface FriendProfile { id: string; username: string; avatarUrl: string | null; }
export interface FriendState { friends: FriendProfile[]; incoming: FriendProfile[]; outgoing: FriendProfile[]; }
export interface RoomInvitation { id: string; fromId: string; toId: string; game: GameKind; roomCode: string; role: RoomRole; createdAt: number; expiresAt: number; }
export interface InvitationView extends RoomInvitation { inviter: string; }
