import { useEffect, useMemo, useRef, useState } from "react";
import { HalfBoard, Seat, NO_KEYS, type BoardInteraction } from "./board.tsx";
import { CardLightbox } from "./CardLightbox.tsx";
import type { CardRecord } from "./cards.ts";
import { cardContext } from "../shared/abilities/registry.ts";
import type { DuelSnapshot } from "../../rl/model-duel-types.ts";
import "./arknights.css";
import "./model-duel.css";

const PHASE: Record<string, string> = { start: "起始", movement: "移动", main: "主要", attack: "攻击", end: "结束", mulligan: "换牌" };
const DECK: Record<string, string> = { lungmen: "龙门", chernobog: "切尔诺伯格", rhodes: "罗德岛", reunion: "整合运动" };

export function ModelDuelView() {
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [live, setLive] = useState<DuelSnapshot | null>(null);
  const [networkError, setNetworkError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [preview, setPreview] = useState<{ cards: CardRecord[]; index: number } | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const ctx = useMemo(() => cardContext((id) => cardsById.get(id)), [cardsById]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    void fetch("/catalog").then((res) => { if (!res.ok) throw new Error("卡牌目录加载失败"); return res.json(); }).then((data: CardRecord[]) => { if (!stopped) setCards(data); }).catch((error: Error) => setNetworkError(error.message));
    const poll = async () => {
      try {
        const response = await fetch("/snapshot", { cache: "no-store" });
        if (!response.ok) throw new Error("观战连接异常");
        const snapshot = await response.json() as DuelSnapshot;
        if (!stopped) { setLive(snapshot); setNetworkError(""); }
      } catch { if (!stopped) setNetworkError("观战连接已断开，正在重连…"); }
      if (!stopped) timer = setTimeout(() => { void poll(); }, 600);
    };
    void poll();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { stopped = true; clearTimeout(timer); clearInterval(clock); };
  }, []);
  const open = (ids: string[], index: number, element: HTMLElement) => {
    const group = ids.map((id) => cardsById.get(id)).filter((card): card is CardRecord => !!card);
    if (!group.length) return;
    origin.current = element;
    setPreview({ cards: group, index: Math.min(index, group.length - 1) });
  };
  const board = live?.state.game?.board;
  // Returns whether the click was handled (the card's preview opened), as BoardInteraction.onCard asks.
  const interaction: BoardInteraction = { candidates: NO_KEYS, selected: NO_KEYS, onCard: (key, element) => {
    if (!board) return false;
    if (key.startsWith("f:")) {
      for (const side of [board.you, board.opponent]) for (const line of [side.front, side.energy]) {
        const index = line.findIndex((card) => card.uid === key.slice(2));
        if (index >= 0) { open(line.map((card) => card.cardId), index, element); return true; }
      }
    } else if (key.startsWith("p:")) {
      const [, side, pile] = key.split(":");
      open(board[side as "you" | "opponent"][pile as "sideline" | "removal"], 0, element);
      return true;
    }
    return false;
  } };
  if (!live || !live.state.game || !cards.length) return <main className="duel-loading">{networkError || "正在连接对局…"}</main>;
  const { state } = live;
  const game = state.game!;
  const thinkingLabel = live.thinkingSeat ? live.labels[live.thinkingSeat] : "";
  const winner = state.players.find((player) => player.id === game.winnerId)?.username;
  const status = networkError || live.error || (live.status === "finished" ? `${winner ?? "对局"} 获胜 · ${game.endReason ?? ""}` : live.status === "thinking" ? `${thinkingLabel} 正在思考 · ${Math.max(0, Math.floor((now - (live.thinkingSince ?? now)) / 1000))}s` : "正在推进对局");
  const hand = (ids: string[], label: string) => <ul className="ua-handstrip" aria-label={`${label}的手牌`}>{ids.map((id, index) => {
    const card = cardsById.get(id);
    return <li key={`${id}-${index}`}><button type="button" aria-label={`${card?.name ?? "卡牌"} ${card?.number ?? ""}`} onClick={(event) => open(ids, index, event.currentTarget)}>{card?.imageUrl ? <img src={card.imageUrl} alt={card.name} /> : card?.name}</button></li>;
  })}</ul>;
  const phaseIndex = (id: string) => game.turnPlayerId !== id ? 5 : ["start", "movement", "main", "attack", "end"].indexOf(game.phase ?? "");
  const activeCard = preview?.cards[preview.index];
  return <div className="ua-app duel-app" data-in-game="true">
    <header className="duel-header" inert={!!preview}>
      <div><strong>{live.labels.p1} <span className="duel-vs">VS</span> {live.labels.p2}</strong><small>{DECK[live.decks.p1!] ?? live.decks.p1} / {DECK[live.decks.p2!] ?? live.decks.p2} · {game.step === "mulligan" ? "起手换牌" : `第 ${game.turn} 回合 · ${PHASE[game.phase ?? ""] ?? ""}`}</small></div>
      <span className="duel-live" data-error={live.status === "error" || !!networkError} role="status"><i data-active={live.status === "thinking"} />{status}</span>
    </header>
    <main className="ua-main duel-main" inert={!!preview}>
      <div className="ua-stage"><div className="ua-table-wrapper"><section className="ua-table" aria-label="模型对战观战牌桌">
        <span className="ua-centerline" aria-hidden="true" />
        <div className="ua-seatbar" data-side="opponent"><Seat player={state.players[1]} self={false} status={`生命 ${state.life.opponent.length} · ${live.thinkingSeat === "p2" ? "思考中" : "对战中"}`} />{hand(live.opponentHand, live.labels.p2!)}</div>
        <HalfBoard side="opponent" board={game.board.opponent} life={state.life.opponent.map((slot) => ({ id: slot.id, card: slot.cardId ? cardsById.get(slot.cardId) : undefined }))} deckCount={game.deckCount.opponent} cardsById={cardsById} ctx={ctx} interaction={interaction} activePhase={phaseIndex("p2")} />
        <HalfBoard side="self" board={game.board.you} life={state.life.you.map((slot) => ({ id: slot.id, card: slot.cardId ? cardsById.get(slot.cardId) : undefined }))} deckCount={game.deckCount.you} cardsById={cardsById} ctx={ctx} interaction={interaction} activePhase={phaseIndex("p1")} />
        <div className="ua-seatbar" data-side="self"><Seat player={state.players[0]} self status={`生命 ${state.life.you.length} · ${live.thinkingSeat === "p1" ? "思考中" : "对战中"}`} />{hand(state.hand, live.labels.p1!)}</div>
      </section></div></div>
      <aside className="duel-log" aria-label="对局记录">
        <div className="duel-log-title"><strong>对局记录</strong><span>{live.moves.length} 次决策</span></div>
        {live.status === "thinking" ? <div className="duel-thinking">{thinkingLabel} 正在选择动作…</div> : null}
        {live.error ? <div className="duel-error">对局暂停：{live.error}</div> : null}
        {live.status === "finished" ? <div className="duel-result">{winner} 获胜</div> : null}
        <ol>{live.moves.slice(-100).reverse().map((move) => <li key={move.number} data-seat={move.seat}>
          <div><b>{move.label}</b><small>#{move.number} · {move.phase === "mulligan" ? "换牌" : `T${move.turn} ${PHASE[move.phase] ?? move.phase}`} · {(move.elapsedMs / 1000).toFixed(1)}s</small></div>
          <strong>{move.action}</strong>{move.reason ? <p>{move.reason}</p> : null}
        </li>)}</ol>
        <details><summary>规则引擎日志</summary>{game.log.map((line, index) => <p key={index}>{line}</p>)}</details>
      </aside>
    </main>
    {activeCard?.imageUrl ? <CardLightbox src={activeCard.imageUrl} label={activeCard.name} alt={`${activeCard.name} ${activeCard.number}`} getOrigin={() => origin.current?.getBoundingClientRect() ?? null} compact={window.innerWidth < 700} onClose={() => setPreview(null)} onPrev={preview!.index > 0 ? () => setPreview({ ...preview!, index: preview!.index - 1 }) : undefined} onNext={preview!.index < preview!.cards.length - 1 ? () => setPreview({ ...preview!, index: preview!.index + 1 }) : undefined} position={`${preview!.index + 1} / ${preview!.cards.length}`} /> : null}
  </div>;
}

