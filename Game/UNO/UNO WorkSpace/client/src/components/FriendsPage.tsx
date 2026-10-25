import { useEffect, useState } from "react";
import type { AuthAccount } from "@shared/protocol.ts";
import { socket } from "../socket.ts";

type Social = { friends: AuthAccount[]; incoming: AuthAccount[]; outgoing: AuthAccount[] };
function emit<T>(event: string, payload: unknown): Promise<{ ok: boolean; data?: T; message?: string }> {
  return new Promise((resolve) => (socket as unknown as { emit: (e: string, p: unknown, cb: (r: { ok: boolean; data?: T; message?: string }) => void) => void }).emit(event, payload, resolve));
}

export function FriendsPage({ onBack }: { onBack: () => void }) {
  const [social, setSocial] = useState<Social>({ friends: [], incoming: [], outgoing: [] });
  const [query, setQuery] = useState(""); const [message, setMessage] = useState("");
  const load = async (): Promise<void> => { const result = await emit<Social>("social_get", {}); if (result.ok && result.data) setSocial(result.data); };
  useEffect(() => { void load(); const refresh = () => void load(); socket.on("social_updated", refresh); return () => { socket.off("social_updated", refresh); }; }, []);
  const request = async (): Promise<void> => { const result = await emit("social_request", { target: query.trim() }); setMessage(result.ok ? "好友申请已发送" : result.message ?? "发送失败"); if (result.ok) { setQuery(""); void load(); } };
  const decide = async (id: string, accept: boolean): Promise<void> => { await emit(accept ? "social_accept" : "social_reject", { requesterId: id }); void load(); };
  return <section className="panel friends-page"><div className="section-heading"><h2>我的好友</h2><button className="text-button" onClick={onBack}>返回主页</button></div>
    <div className="friend-search"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入用户名或账号 ID" onKeyDown={(e) => { if (e.key === "Enter") void request(); }} /><button className="primary" disabled={!query.trim()} onClick={() => void request()}>发送好友申请</button></div>{message ? <p className="muted">{message}</p> : null}
    <h3>好友（{social.friends.length}）</h3><ul className="simple-list">{social.friends.map((f) => <li key={f.id}><span>{f.username}<small>{f.id}</small></span></li>)}</ul>
    <h3>收到的申请</h3><ul className="simple-list">{social.incoming.map((f) => <li key={f.id}><span>{f.username}<small>{f.id}</small></span><span><button className="primary" onClick={() => void decide(f.id, true)}>接受</button><button className="secondary" onClick={() => void decide(f.id, false)}>拒绝</button></span></li>)}</ul>
    <h3>已发送</h3><ul className="simple-list">{social.outgoing.map((f) => <li key={f.id}>{f.username}</li>)}</ul>
  </section>;
}
