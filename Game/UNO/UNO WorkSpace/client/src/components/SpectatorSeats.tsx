import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** One spectator as the room state reports them. */
export type Spectator = { id: string; name: string; connected: boolean; avatarUrl: string | null };

/** How long a press must last before the name card appears. */
const LONG_PRESS_MS = 420;
/** Places in the gallery; the official playmat has four. */
const SEAT_COUNT = 4;

/**
 * The spectator gallery shared by all three games: four dashed "+" places in a row, filled by whoever
 * has joined. An empty place invites a friend; pressing a filled avatar and holding shows that
 * person's name card. A quick tap does nothing, so the gallery never interferes with the table's own
 * drag and tap handling.
 */
export function SpectatorSeats({ spectators, canInvite, onInvite }: { spectators: Spectator[]; canInvite: boolean; onInvite: () => void }) {
  const [peek, setPeek] = useState<{ person: Spectator; x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);

  const clear = (): void => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
  };
  useEffect(() => clear, []);

  const start = (person: Spectator) => (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    clear();
    timer.current = window.setTimeout(() => setPeek({ person, x: rect.left + rect.width / 2, y: rect.top }), LONG_PRESS_MS);
  };
  const end = (): void => { clear(); setPeek(null); };
  const show = (person: Spectator) => (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPeek({ person, x: rect.left + rect.width / 2, y: rect.top });
  };

  return <div className="spectator-seats" role="list" aria-label={`观战席，${spectators.length} 人`}>
    {spectators.map((person) => <button key={person.id} type="button" role="listitem" className="spectator-seat is-filled"
      aria-label={`${person.name}${person.connected ? "" : "（已离线）"}，长按查看资料`}
      data-offline={person.connected ? undefined : "true"}
      onPointerDown={start(person)} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}
      onContextMenu={(event) => { event.preventDefault(); show(person)(event as unknown as ReactPointerEvent<HTMLButtonElement>); }}>
      {person.avatarUrl ? <img src={person.avatarUrl} alt="" draggable={false} /> : <span className="spectator-initial" aria-hidden="true">{person.name.slice(0, 1)}</span>}
    </button>)}
    {Array.from({ length: Math.max(0, SEAT_COUNT - spectators.length) }, (_, index) => canInvite
      ? <button key={`empty-${index}`} type="button" role="listitem" className="spectator-seat is-empty" aria-label="邀请好友观战" title="邀请好友观战" onClick={onInvite}>+</button>
      : <span key={`empty-${index}`} role="listitem" className="spectator-seat is-empty" aria-hidden="true">+</span>)}
    {peek ? <div className="spectator-peek" style={{ left: peek.x, top: peek.y }} role="tooltip">
      {peek.person.avatarUrl ? <img src={peek.person.avatarUrl} alt="" /> : <span className="spectator-initial" aria-hidden="true">{peek.person.name.slice(0, 1)}</span>}
      <strong>{peek.person.name}</strong>
      <small>{peek.person.connected ? "在线观战" : "已离线"}</small>
    </div> : null}
  </div>;
}
