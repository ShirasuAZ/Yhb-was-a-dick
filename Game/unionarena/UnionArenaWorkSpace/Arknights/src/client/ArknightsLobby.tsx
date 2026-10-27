import type { Account } from "./cards.ts";
import { ACCOUNT_SETTINGS } from "./ArknightsApp.tsx";
import "./arknights.css";

const card = (file: string): string => `/assets/union-arena/cards/${encodeURIComponent(file)}`;

/** The three ways into the game. A mode without `href` is shown as not open yet. Each cover is a different title, so the
 * lobby reads as one game several titles appear in rather than as an Arknights-only game. */
const MODES: ReadonlyArray<{ id: string; title: string; text: string; href: string | null; cover: string }> = [
  { id: "pvp", title: "玩家对战", text: "创建或加入房间，各自组好 50 张牌组后与其他玩家联机对战。双方可以用不同作品的牌组。", href: "/arknights-union-arena/pvp", cover: "UC01BT-ARK-1-042_阿米娅_7065.png" },
  { id: "ai", title: "人机对战", text: "与电脑对手对局，有简单、普通、困难（蒙特卡洛搜索）和大师（强化学习）四档。你和电脑可以各选一个作品。", href: "/arknights-union-arena/ai", cover: "EX04BT-JJK-1-040_虎杖悠仁_100855.png" },
  { id: "tutorial", title: "新手教程", text: "用固定的牌组，一步一步学会牌桌区域、回合流程、使用卡牌、攻击与触发，打完一整局。", href: "/arknights-union-arena/tutorial", cover: "UA05BT-KMY-1-005_灶门炭治郎_101897.png" }
];

/** The Arknights game lobby, between the site's home page and a game mode. */
export function ArknightsLobby({ account }: { account: Account }) {
  return <div className="ua-lobby">
    <header className="ua-lobby-header">
      <button type="button" className="ua-back" onClick={() => window.location.assign("/")}>返回首页</button>
      <h1>UNION ARENA</h1>
      <a className="ua-room-page-settings" href={ACCOUNT_SETTINGS}>账号设置</a>
      <div className="ua-account" title={account.username}>{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : null}<span>{account.username}</span></div>
    </header>
    <main className="ua-lobby-modes" aria-label="选择游戏模式">
      {MODES.map((mode) => {
        const open = mode.href !== null;
        return <section key={mode.id} className="ua-mode" data-mode={mode.id} data-closed={open ? undefined : "true"} aria-labelledby={`ua-mode-${mode.id}`}>
          <div className="ua-mode-cover" aria-hidden="true"><img src={card(mode.cover)} alt="" draggable={false} /></div>
          <div className="ua-mode-body">
            <h2 id={`ua-mode-${mode.id}`}>{mode.title}{open ? null : <span className="ua-mode-tag">暂未开放</span>}</h2>
            <p>{mode.text}</p>
            {open
              ? <button type="button" className="ua-primary" onClick={() => window.location.assign(mode.href!)}>{mode.id === "tutorial" ? "开始教程" : "进入"}</button>
              : <button type="button" className="ua-secondary" disabled aria-disabled="true">暂未开放</button>}
          </div>
        </section>;
      })}
    </main>
  </div>;
}
