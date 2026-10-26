import { useEffect, useState, type ReactNode } from "react";
import { socket } from "../socket.ts";
import type { GameKind } from "@shared/social.ts";

type Person = { id: string; username: string; avatarUrl: string | null; online?: boolean; game?: GameKind | null; roomCode?: string | null; watching?: boolean };
type Social = { friends: Person[]; incoming: Person[]; outgoing: Person[] };
function emit<T>(event: string, payload: unknown): Promise<{ ok: boolean; data?: T; message?: string }> {
  return new Promise((resolve) => (socket as unknown as { emit: (e: string, p: unknown, cb: (r: { ok: boolean; data?: T; message?: string }) => void) => void }).emit(event, payload, resolve));
}

/** How each game is named in the friends list. */
const GAME_LABEL: Record<GameKind, string> = {
  uno: "UNO",
  shogi: "日本将棋",
  arknights: "明日方舟 UNION ARENA"
};

/** The page a spectator opens to watch a room of each game. */
const WATCH_URL: Record<GameKind, (roomCode: string) => string> = {
  arknights: (code) => `/arknights-union-arena/pvp?room=${encodeURIComponent(code)}&watch=1`,
  shogi: (code) => `/shogi?room=${encodeURIComponent(code)}&watch=1`,
  uno: (code) => `/room/${encodeURIComponent(code)}?watch=1`
};

/** A friend's avatar, falling back to the first character of their name (and to it again if the picture fails to load). */
function Avatar({ person }: { person: Person }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [person.avatarUrl]);
  const initial = person.username.slice(0, 1);
  return person.avatarUrl && !broken
    ? <img className="friend-avatar" src={person.avatarUrl} alt={`${person.username}的头像`} loading="lazy" onError={() => setBroken(true)} />
    : <span className="friend-avatar friend-avatar-fallback" aria-hidden="true">{initial}</span>;
}

/**
 * Online state as a dot plus words, so it never depends on colour alone: a green dot and "在线", a grey one and
 * "离线". An online friend in a game also says which one, from the server's own room bookkeeping.
 */
function Presence({ person }: { person: Person }) {
  const online = person.online === true;
  const game = online ? person.game ?? null : null;
  return <span className={`friend-presence ${online ? "is-online" : "is-offline"}`}>
    <i className="friend-dot" aria-hidden="true">·</i>
    <span>{online ? "在线" : "离线"}</span>
    {game ? <span className="friend-playing">· 正在游玩 {GAME_LABEL[game] ?? game}</span> : null}
    {online && person.watching ? <span className="friend-playing">· 观战中</span> : null}
  </span>;
}

/** Watching a friend is only possible when the friend is in a room of a game that still serves it (vs-computer has no room). */
function canWatch(person: Person): boolean {
  return person.online === true && !!person.roomCode && !!person.game && !!WATCH_URL[person.game];
}

function PersonRow({ person, children }: { person: Person; children?: ReactNode }) {
  return <li>
    <Avatar person={person} />
    <span className="friend-name">{person.username}<small>{person.id}</small></span>
    {children}
  </li>;
}

/** Online friends first (they are the ones you can play with), then names in order, so the list never jumps around. */
function byAvailability(left: Person, right: Person): number {
  const online = Number(right.online === true) - Number(left.online === true);
  if (online !== 0) return online;
  return left.username.localeCompare(right.username, "zh-Hans-CN");
}

export function FriendsPage({ onBack }: { onBack: () => void }) {
  const [social, setSocial] = useState<Social>({ friends: [], incoming: [], outgoing: [] });
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState(""); const [message, setMessage] = useState("");
  const load = async (): Promise<void> => {
    const result = await emit<Social>("social_get", {});
    if (result.ok && result.data) { setSocial(result.data); setLoaded(true); }
  };
  // The server pushes "social_updated" when anything the list shows changes — including presence, which it reads from
  // the live sockets — so this page never polls on a timer of its own.
  useEffect(() => { void load(); const refresh = () => void load(); socket.on("social_updated", refresh); return () => { socket.off("social_updated", refresh); }; }, []);
  const request = async (): Promise<void> => { const result = await emit("social_request", { target: query.trim() }); setMessage(result.ok ? "好友申请已发送" : result.message ?? "发送失败"); if (result.ok) { setQuery(""); void load(); } };
  const decide = async (id: string, accept: boolean): Promise<void> => { await emit(accept ? "social_accept" : "social_reject", { requesterId: id }); void load(); };
  const watch = (person: Person): void => {
    if (!person.game || !person.roomCode) return;
    window.location.assign(WATCH_URL[person.game](person.roomCode));
  };
  const friends = [...social.friends].sort(byAvailability);
  // Two blocks side by side: the page's own "返回主页" on the left, and the friends panel on the right. The button sits
  // outside the panel, so nothing about the list's box is changed by it.
  return <div className="friends-layout">
    <div className="friends-side">
      <button type="button" className="friends-home" onClick={onBack}>返回主页</button>
    </div>
    <section className="panel friends-page">
    <div className="friends-body">
      <div className="section-heading"><h2>我的好友</h2></div>
      <div className="friend-search"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入用户名或账号 ID" onKeyDown={(e) => { if (e.key === "Enter") void request(); }} /><button className="primary" disabled={!query.trim()} onClick={() => void request()}>发送好友申请</button></div>
      {message ? <p className="muted">{message}</p> : null}
      <h3>好友（{social.friends.length}）</h3>
      {friends.length ? <ul className="simple-list">{friends.map((f) => <PersonRow key={f.id} person={f}>
        <span className="friend-actions">
          <Presence person={f} />
          {canWatch(f) ? <button type="button" className="secondary friend-watch" onClick={() => watch(f)}>{f.watching ? "一起观战" : "观战"}</button> : null}
        </span>
      </PersonRow>)}</ul> : <p className="muted">{loaded ? "还没有好友。" : "正在加载好友…"}</p>}
      <h3>收到的申请</h3>
      {social.incoming.length ? <ul className="simple-list">{social.incoming.map((f) => <PersonRow key={f.id} person={f}><span className="friend-actions"><button className="primary" onClick={() => void decide(f.id, true)}>接受</button><button className="secondary" onClick={() => void decide(f.id, false)}>拒绝</button></span></PersonRow>)}</ul> : <p className="muted">暂无新的好友申请。</p>}
      <h3>已发送</h3>
      {social.outgoing.length ? <ul className="simple-list">{social.outgoing.map((f) => <PersonRow key={f.id} person={f}><span className="muted">等待对方确认</span></PersonRow>)}</ul> : <p className="muted">暂无待确认的申请。</p>}
    </div>
    </section>
  </div>;
}
