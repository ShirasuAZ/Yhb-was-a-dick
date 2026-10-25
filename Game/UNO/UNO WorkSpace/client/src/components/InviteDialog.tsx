import { useEffect, useState } from "react";
import type { GameKind, RoomRole } from "@shared/social.ts";

const TOKEN_KEY = "uno.accountToken";

type Friend = { id: string; username: string };

async function loadFriends(): Promise<Friend[]> {
  const response = await fetch("/api/social", { headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ""}` } });
  const result = await response.json() as { data?: { friends?: Friend[] } };
  return result.data?.friends ?? [];
}

export async function sendRoomInvite(targetId: string, game: GameKind, roomCode: string, role: RoomRole): Promise<boolean> {
  const response = await fetch("/api/social/invitations", {
    method: "POST",
    headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ targetId, game, roomCode, role })
  });
  return response.ok;
}

const ROLE_TEXT: Record<RoomRole, { title: string; hint: string; action: string }> = {
  player: { title: "对战席邀请", hint: "对方接受后会占用一个对局座位。", action: "邀请参战" },
  spectator: { title: "观战席邀请", hint: "对方接受后进入观战席，只能查看对局。", action: "邀请观战" }
};

/**
 * One dialog per seat kind: the room owner opens the player window or the spectator window
 * separately, so a friend never has to guess which seat an invite was meant for.
 */
export function InviteDialog({ game, roomCode, role, onClose }: { game: GameKind; roomCode: string; role: RoomRole; onClose: () => void }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void loadFriends().then((list) => { if (active) setFriends(list); }).catch(() => { if (active) setFriends([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const invite = async (friend: Friend): Promise<void> => {
    const ok = await sendRoomInvite(friend.id, game, roomCode, role);
    setSent((current) => ({ ...current, [friend.id]: ok }));
    setMessage(ok ? `已邀请 ${friend.username}` : "邀请失败，请确认好友关系和房间状态");
  };

  const text = ROLE_TEXT[role];
  return <div className="invite-dialog-backdrop" role="presentation" onClick={onClose}>
    <section className="invite-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-dialog-title" onClick={(event) => event.stopPropagation()}>
      <div className="invite-dialog-head">
        <div><p className="eyebrow">房间 {roomCode}</p><h2 id="invite-dialog-title">{text.title}</h2></div>
        <button type="button" className="text-button" onClick={onClose}>关闭</button>
      </div>
      <p className="muted">{text.hint}</p>
      {friends === null ? <p className="muted">正在加载好友…</p>
        : friends.length === 0 ? <p className="muted">还没有好友。到「我的好友」里搜索账号并添加后即可邀请。</p>
          : <ul className="invite-dialog-list">{friends.map((friend) => <li key={friend.id}>
            <span>{friend.username}<small>{friend.id}</small></span>
            <button type="button" className="primary" disabled={sent[friend.id]} onClick={() => void invite(friend)}>{sent[friend.id] ? "已邀请" : text.action}</button>
          </li>)}</ul>}
      {message ? <p className="muted" role="status">{message}</p> : null}
    </section>
  </div>;
}
