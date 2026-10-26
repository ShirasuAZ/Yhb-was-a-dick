import type { GameKind } from "../shared/social.ts";

/** What the friends list shows for one account: whether it is connected right now, which game it is in, and where. */
export interface PresenceState {
  online: boolean;
  game: GameKind | null;
  /** The room the account is in (seated or watching), so a friend can be joined; null outside a room. */
  roomCode: string | null;
  /** True when the account is watching that room rather than playing in it. */
  watching: boolean;
}

/** Where an account is in a game: the room, and whether it is playing or watching. */
export interface SeatLocation { game: GameKind; roomCode: string; watching: boolean; }

/** The accounts that hold at least one live socket on this server. */
export type OnlineAccounts = () => ReadonlySet<string>;
/** Asks a game's own room bookkeeping where an account is (seated or watching), if anywhere. */
export type GameResolver = (accountId: string) => SeatLocation | null;

/**
 * Who is online, and in which game.
 *
 * "Online" is read from the live sockets of this server (the site's own socket and the Arknights namespace) plus the
 * shogi service, which runs as its own process and reports the accounts it holds over HTTP. It is never inferred from
 * "has a login" and never from the last page a browser showed: a closed tab, a dropped connection or an expired
 * session removes the socket, and the account is offline the moment socket.io notices.
 *
 * The game comes from each game's own rooms, so a friend is only ever shown in a game whose server agrees.
 */
export class PresenceService {
  /** Accounts the shogi service reports as connected, and where each of them is in a shogi room. */
  private shogiConnected = new Set<string>();
  /** Account id → the shogi room it holds, and whether it is only watching. */
  private shogiInRoom = new Map<string, { roomCode: string; watching: boolean }>();
  private readonly resolvers: GameResolver[] = [];
  /** The last state announced per account, so only real changes wake up anyone's friends. */
  private readonly announced = new Map<string, string>();
  /** Called with an account id whenever that account's presence actually changed, so its friends can be told. */
  onChange: ((accountId: string) => void) | null = null;

  constructor(private readonly onlineAccounts: OnlineAccounts) {}

  register(resolver: GameResolver): void {
    this.resolvers.push(resolver);
  }

  /**
   * Re-reads one account's presence and announces it if it moved. Called on every event that can change it: a socket
   * opening or closing, a login, entering or leaving a room, and each shogi report.
   */
  touch(accountId: string): void {
    const state = this.stateOf(accountId);
    const stamp = `${state.online ? "on" : "off"}:${state.game ?? "-"}:${state.roomCode ?? "-"}:${state.watching ? "w" : "p"}`;
    if (this.announced.get(accountId) === stamp) return;
    this.announced.set(accountId, stamp);
    this.onChange?.(accountId);
  }

  /** Replaces what the shogi service reported; accounts whose state changed are announced to their friends. */
  reportShogi(connected: readonly string[], seated: readonly { id: string; roomCode: string; watching: boolean }[]): void {
    const nextConnected = new Set(connected);
    const nextSeated = new Map(seated.map((entry) => [entry.id, { roomCode: entry.roomCode, watching: entry.watching }]));
    const touched = new Set<string>([...this.shogiConnected, ...nextConnected, ...this.shogiInRoom.keys(), ...nextSeated.keys()]);
    this.shogiConnected = nextConnected;
    this.shogiInRoom = nextSeated;
    for (const id of touched) this.touch(id);
  }

  /** Where an account is, from each game's own room bookkeeping. */
  private locationOf(accountId: string): SeatLocation | null {
    for (const resolver of this.resolvers) {
      try {
        const where = resolver(accountId);
        if (where) return where;
      } catch { /* a resolver that throws must not take presence down with it */ }
    }
    const shogi = this.shogiInRoom.get(accountId);
    return shogi ? { game: "shogi", roomCode: shogi.roomCode, watching: shogi.watching } : null;
  }

  stateOf(accountId: string): PresenceState {
    const online = this.onlineAccounts().has(accountId) || this.shogiConnected.has(accountId);
    if (!online) return { online: false, game: null, roomCode: null, watching: false };
    const where = this.locationOf(accountId);
    return { online: true, game: where?.game ?? null, roomCode: where?.roomCode ?? null, watching: where?.watching ?? false };
  }

  /** Whether any of these accounts is connected (the caller may skip the rest of the work when none is). */
  anyOnline(accountIds: readonly string[]): boolean {
    const online = this.onlineAccounts();
    return accountIds.some((id) => online.has(id) || this.shogiConnected.has(id));
  }
}
