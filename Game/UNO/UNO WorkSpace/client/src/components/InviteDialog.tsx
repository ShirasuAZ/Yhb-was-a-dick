import { useEffect, useState } from "react";
import type { GameKind, RoomRole } from "@shared/social.ts";

const TOKEN_KEY = "uno.accountToken";

type Friend = { id: string; username: string; avatarUrl: string | null; online?: boolean; game?: GameKind | null; roomCode?: string | null; watching?: boolean };

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
 * One friend's avatar, in the same circle and crop as the friends page (34px, round, cover). The friend's initial
 * stands in when they have no picture yet, and again if the picture fails to load.
 */
function FriendAvatar({ friend, onBroken }: { friend: Friend; onBroken: () => void }) {
  if (friend.avatarUrl) return <img className="friend-avatar" src={friend.avatarUrl} alt={`${friend.username}的头像`} loading="lazy" onError={onBroken} />;
  return <span className="friend-avatar friend-avatar-fallback" aria-hidden="true">{friend.username.slice(0, 1)}</span>;
}

/**
 * One dialog per seat kind: the room owner opens the player window or the spectator window
 * separately, so a friend never has to guess which seat an invite was meant for.
 */
export function InviteDialog({ game, roomCode, role, onClose }: { game: GameKind; roomCode: string; role: RoomRole; onClose: () => void }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  /** Avatars that failed to load fall back to the friend's initial. */
  const [broken, setBroken] = useState<Record<string, boolean>>({});

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
    setMessage(ok ? `已邀请 ${friend.username}` : "邀请失败：对方离线，或已经在别的房间中");
    if (!ok) void refresh();
  };
  /** Re-read the list after a refusal, so the row shows why instead of staying stale. */
  const refresh = async (): Promise<void> => {
    await loadFriends().then(setFriends).catch(() => undefined);
  };

  /**
   * Only an online friend with no room of their own can be invited: an invite to a closed tab is never seen, and someone
   * already playing or watching somewhere cannot be pulled into a second room. Online friends come first.
   */
  const inviteState = (friend: Friend): { usable: boolean; note: string } => {
    if (friend.online !== true) return { usable: false, note: "离线" };
    if (friend.roomCode) return { usable: false, note: friend.watching ? "观战中" : "对局中" };
    return { usable: true, note: "" };
  };
  const ordered = friends ? [...friends].sort((left, right) => {
    const usable = Number(inviteState(right).usable) - Number(inviteState(left).usable);
    if (usable !== 0) return usable;
    const online = Number(right.online === true) - Number(left.online === true);
    if (online !== 0) return online;
    return left.username.localeCompare(right.username, "zh-Hans-CN");
  }) : [];

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
          : <ul className="invite-dialog-list">{ordered.map((friend) => {
            const state = inviteState(friend);
            return <li key={friend.id} className={state.usable ? undefined : "is-unavailable"} data-unavailable={state.usable ? undefined : "true"}>
              {broken[friend.id] ? <span className="friend-avatar friend-avatar-fallback" aria-hidden="true">{friend.username.slice(0, 1)}</span>
                : <FriendAvatar friend={friend} onBroken={() => setBroken((current) => ({ ...current, [friend.id]: true }))} />}
              <span className="friend-name">{friend.username}<small>{friend.id}</small></span>
              <span className="invite-dialog-state">
                <span className={`friend-presence ${friend.online ? "is-online" : "is-offline"}`}>
                  <i className="friend-dot" aria-hidden="true">·</i>
                  <span>{friend.online ? "在线" : "离线"}</span>
                  {state.note ? <span className="friend-playing">· {state.note}</span> : null}
                </span>
                <button type="button" className="primary" disabled={!state.usable || sent[friend.id]}
                  title={state.usable ? undefined : `该好友${state.note}，无法邀请`}
                  onClick={() => void invite(friend)}>{sent[friend.id] ? "已邀请" : text.action}</button>
              </span>
            </li>;
          })}</ul>}
      {message ? <p className="muted" role="status">{message}</p> : null}
    </section>
  </div>;
}
