import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type Spectator = { id: string; username: string; connected: boolean; avatarUrl: string | null };

/** How long a press must last before the name card appears. */
const LONG_PRESS_MS = 420;

/**
 * The spectator gallery: four dashed "+" places, filled by whoever has been invited and joined.
 * Pressing a filled avatar and holding shows that person's name card; a quick tap does nothing, so
 * the gallery never interferes with the table's own drag and tap handling.
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

  return <div className="ua-spectator-seats" role="list" aria-label={`观战席，${spectators.length} 人`}>
    {spectators.map((person) => <button key={person.id} type="button" role="listitem" className="ua-spectator-seat is-filled"
      aria-label={`${person.username}${person.connected ? "" : "（已离线）"}，长按查看资料`}
      data-offline={person.connected ? undefined : "true"}
      onPointerDown={start(person)} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}
      onContextMenu={(event) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setPeek({ person, x: rect.left + rect.width / 2, y: rect.top }); }}>
      {person.avatarUrl ? <img src={person.avatarUrl} alt="" draggable={false} /> : <span className="ua-spectator-initial" aria-hidden="true">{person.username.slice(0, 1)}</span>}
    </button>)}
    {Array.from({ length: Math.max(0, 4 - spectators.length) }, (_, index) => canInvite
      ? <button key={`empty-${index}`} type="button" role="listitem" className="ua-spectator-seat is-empty" aria-label="邀请好友观战" title="邀请好友观战" onClick={onInvite}>+</button>
      : <span key={`empty-${index}`} role="listitem" className="ua-spectator-seat is-empty" aria-hidden="true">+</span>)}
    {peek ? <div className="ua-spectator-peek" style={{ left: peek.x, top: peek.y }} role="tooltip">
      {peek.person.avatarUrl ? <img src={peek.person.avatarUrl} alt="" /> : <span className="ua-spectator-initial" aria-hidden="true">{peek.person.username.slice(0, 1)}</span>}
      <strong>{peek.person.username}</strong>
      <small>{peek.person.connected ? "在线观战" : "已离线"}</small>
    </div> : null}
  </div>;
}
