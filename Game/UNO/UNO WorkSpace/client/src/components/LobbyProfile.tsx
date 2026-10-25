import { useEffect, useState } from "react";

// Left, centre (front), right. Served from the local Arknights catalog whitelist.
const arknightsCoverCards = [
  "UCEX01BT-ARK-2-014_阿米娅_9031.png",
  "UCEX01BT-ARK-2-051_阿米娅_9084.png",
  "UC01BT-ARK-1-042_阿米娅_7065.png"
];

const UPDATE_HISTORY = [{
  version: "2.3.0",
  content: "明日方舟 UNION ARENA 可以联机开局：侧栏新增牌组构建与提交，两名玩家准备后房主开始游戏，按规则书依次完成起手 7 张牌、换牌与 7 张盖着的生命卡；卡牌目录预览图可点击放大查看；牌桌中间新增一条淡细的分隔线；关键字说明去掉了多余的标记。"
}, {
  version: "2.2.0",
  content: "明日方舟 UNION ARENA 牌桌更新：生命区改为按实际数量叠放的无边框展示；房间状态新增生命卡数据；牌桌顶部栏压缩，房间号与人数合并显示。"
}, {
  version: "2.1.0",
  content: "主页与游戏入口整合更新：新增明日方舟 UNION ARENA 游戏入口；接入网站游戏路由；优化主页多设备布局；新增游戏分类、主题预览图和更新日志区域。"
}].slice(0, 3);

/** How long each update stays on screen before the log advances on its own. */
const AUTO_ADVANCE_MS = 5000;

export function LobbyProfile({ onEnterGame }: { onEnterGame: () => void }) {
  const updateHistory = UPDATE_HISTORY;
  const [updateIndex, setUpdateIndex] = useState(0);
  /** Which way the last change went, so the slide animation matches the arrow that caused it. */
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const update = updateHistory[updateIndex]!;

  const step = (delta: number): void => {
    setDirection(delta >= 0 ? "next" : "prev");
    setUpdateIndex((index) => (index + delta + updateHistory.length) % updateHistory.length);
  };

  // Advance on its own, and restart the countdown whenever the reader picks an entry by hand.
  useEffect(() => {
    if (updateHistory.length < 2) return undefined;
    const timer = window.setTimeout(() => { setDirection("next"); setUpdateIndex((index) => (index + 1) % updateHistory.length); }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [updateIndex, updateHistory.length]);

  return (
    <div className="lobby-waterfall">
      <section className="game-feature uno-feature panel" aria-labelledby="uno-feature-title">
        <div className="uno-cover" aria-hidden="true">
          <div className="uno-cover-card" style={{ backgroundPosition: "53.85% 0%" }} />
          <div className="uno-cover-card" style={{ backgroundPosition: "76.92% 14.29%" }} />
          <div className="uno-cover-card" style={{ backgroundPosition: "76.92% 42.86%" }} />
        </div>
        <div className="uno-feature-details">
          <div>
            <p className="eyebrow">卡牌</p>
            <h2 id="uno-feature-title">UNO</h2>
          </div>
          <button className="primary" onClick={onEnterGame}>
            进入游戏
          </button>
        </div>
      </section>

      <section className="game-feature panel" aria-labelledby="shogi-feature-title">
        <div className="shogi-cover" aria-hidden="true">
          <div className="shogi-cover-board">
            {Array.from({ length: 81 }, (_, index) => <span key={index} />)}
          </div>
          <img className="shogi-cover-piece shogi-cover-piece-gote" src="/assets/shogi/white_king.png" alt="" />
          <img className="shogi-cover-piece shogi-cover-piece-sente" src="/assets/shogi/black_rook.png" alt="" />
        </div>
        <div className="uno-feature-details">
          <div>
            <p className="eyebrow">棋类</p>
            <h2 id="shogi-feature-title">日本将棋</h2>
          </div>
          <button className="primary" onClick={() => window.location.assign("/shogi")}>
            进入游戏
          </button>
        </div>
      </section>

      <section className="game-feature panel" aria-labelledby="arknights-feature-title">
        <div className="arknights-cover" aria-hidden="true">
          {arknightsCoverCards.map((file, index) => (
            <img key={file} className="arknights-cover-card" src={`/assets/arknights/cards/${encodeURIComponent(file)}`} alt="" draggable={false} data-slot={index} />
          ))}
        </div>
        <div className="uno-feature-details">
          <div>
            <p className="eyebrow">卡牌</p>
            <h2 id="arknights-feature-title">明日方舟 UNION ARENA</h2>
          </div>
          <button className="primary" onClick={() => window.location.assign("/arknights-union-arena/")}>进入游戏</button>
        </div>
      </section>

      <section className="update-log panel" aria-labelledby="update-log-heading">
        <div className="update-log-heading">
          <p className="eyebrow">更新记录</p>
          <h2 id="update-log-heading">v{update.version}</h2>
        </div>
        <div className="update-log-viewport">
          <p className="update-log-body" key={update.version} data-dir={direction}>{update.content}</p>
        </div>
        <div className="update-log-footer">
          <div className="update-dots" role="tablist" aria-label="更新记录分页">
            {updateHistory.map((entry, index) => (
              <button key={entry.version} type="button" role="tab" aria-selected={index === updateIndex}
                aria-label={`第 ${index + 1} 条更新：v${entry.version}`} title={`v${entry.version}`}
                className={`update-dot ${index === updateIndex ? "is-active" : ""}`}
                onClick={() => { setDirection(index >= updateIndex ? "next" : "prev"); setUpdateIndex(index); }} />
            ))}
          </div>
          <div className="update-arrows">
            <button type="button" className="update-arrow" aria-label="上一条更新" title="上一条更新" disabled={updateHistory.length < 2} onClick={() => step(-1)}>‹</button>
            <button type="button" className="update-arrow" aria-label="下一条更新" title="下一条更新" disabled={updateHistory.length < 2} onClick={() => step(1)}>›</button>
          </div>
        </div>
      </section>

    </div>
  );
}
