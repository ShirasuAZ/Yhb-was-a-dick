import type { Account } from "./cards.ts";
import { ARKNIGHTS_HOME } from "./ArknightsApp.tsx";
import "./arknights.css";

const card = (file: string): string => `/assets/arknights/cards/${encodeURIComponent(file)}`;

/**
 * The player-vs-player room page: a standalone screen between the game lobby and the table,
 * the same shape as the UNO and shogi room screens. Creating, joining and spectating all live here.
 */
export function ArknightsRoomPage({ account, roomCode, busy, error, onRoomCode, onCreate, onJoin, onSpectate }: {
  account: Account;
  roomCode: string;
  busy: boolean;
  error: string;
  onRoomCode: (code: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onSpectate: () => void;
}) {
  const valid = roomCode.length === 4;
  return <div className="ua-room-page">
    <header className="ua-room-page-header">
      <button type="button" className="ua-back" onClick={() => window.location.assign(ARKNIGHTS_HOME)}>返回大厅</button>
      <div className="ua-room-page-brand"><p className="eyebrow">LayUDown · 在线对局</p><h1>明日方舟 UNION ARENA</h1></div>
      <div className="ua-account" title={account.username}>{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : null}<span>{account.username}</span></div>
    </header>
    <main className="ua-room-page-main">
      <section className="ua-room-page-card" aria-labelledby="ua-room-page-title">
        <div className="ua-room-page-head">
          <div><p className="eyebrow">玩家对战</p><h2 id="ua-room-page-title">创建或加入房间</h2></div>
          <img className="ua-room-page-cover" src={card("UCEX01BT-ARK-2-051_阿米娅_9084.png")} alt="" draggable={false} />
        </div>
        <p className="ua-hint">两名玩家各自提交合法牌组并准备后，房主即可开始对局。房间号是 4 位数字。</p>
        <button type="button" className="ua-primary ua-room-page-create" disabled={busy} onClick={onCreate}>创建对战房间</button>
        <div className="ua-room-page-join">
          <label htmlFor="ua-room-code-page">房间号</label>
          <input id="ua-room-code-page" value={roomCode} maxLength={4} inputMode="numeric" autoComplete="off"
            placeholder="输入 4 位房间号"
            onChange={(event) => onRoomCode(event.target.value.replace(/\D/g, "").slice(0, 4))}
            onKeyDown={(event) => { if (event.key === "Enter" && valid && !busy) onJoin(); }} />
          <button type="button" className="ua-secondary" disabled={busy || !valid} onClick={onJoin}>加入房间</button>
          <button type="button" className="ua-secondary" disabled={busy || !valid} onClick={onSpectate}>进入观战席</button>
        </div>
        {error ? <p className="ua-error" role="alert">{error}</p> : null}
      </section>
    </main>
  </div>;
}
