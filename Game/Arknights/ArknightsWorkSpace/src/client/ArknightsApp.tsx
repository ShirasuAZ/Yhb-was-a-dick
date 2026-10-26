import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ActionAck,
  ClientToServerEvents,
  ServerToClientEvents,
  UnionArenaAction,
  UnionArenaLifeCard,
  UnionArenaRoomState
} from "../shared/protocol.ts";
import { CardLightbox } from "./CardLightbox.tsx";
import { HalfBoard, Seat, type LifeCardEntry } from "./board.tsx";
import { errorText, useCatalog, type Account, type CardRecord } from "./cards.ts";
import { useGameController } from "./game.tsx";
import { useFloatNotices, type FloatNotice } from "./floatNotices.tsx";
import { SpectatorSeats } from "@uno-client/components/SpectatorSeats.tsx";
import { ArknightsRoomPage } from "./ArknightsRoomPage.tsx";
import { InviteDialog } from "@uno-client/components/InviteDialog.tsx";
import type { RoomRole } from "@shared/social.ts";
import { AP_COUNT, DECK_SIZE, MAX_COPIES, useDeck } from "./deck.ts";
import { PRESET_DECKS } from "../shared/ai/decks.ts";
import "./arknights.css";
import { ThemeControl } from "@uno-client/components/ThemeControl.tsx";

type UnionSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Where the game's own lobby lives. */
export const ARKNIGHTS_HOME = "/arknights-union-arena/";

function emitAck<T>(socket: UnionSocket, event: keyof ClientToServerEvents, payload: unknown): Promise<ActionAck<T>> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve({ ok: false, code: "TIMEOUT", message: "服务器响应超时" }), 5000);
    (socket as unknown as { emit: (name: string, body: unknown, callback: (result: ActionAck<T>) => void) => void })
      .emit(event, payload, (result) => { window.clearTimeout(timer); resolve(result); });
  });
}

/** Compact = narrow window, short window (phone landscape) or touch-sized screen. Re-evaluated on resize/rotation. */
export function useCompactLayout(): boolean {
  const query = "(max-width: 900px), (max-height: 520px)";
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (): void => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}

/** Mirrors the visual viewport into CSS variables so Android address bars and the soft keyboard never hide controls. */
export function useViewportVars(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const update = (): void => {
      const height = viewport?.height ?? window.innerHeight;
      root.style.setProperty("--ua-vh", `${Math.round(height)}px`);
      const keyboard = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      root.style.setProperty("--ua-kb", `${Math.round(keyboard)}px`);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      root.style.removeProperty("--ua-vh");
      root.style.removeProperty("--ua-kb");
    };
  }, []);
}

/** Life areas come straight from the room state, in the server's order. A null cardId is a face-down card (drawn as a card back); a face-up
 * one is looked up in the catalog (a card missing from it is drawn face down rather than dropped, so the count stays right). */
export function toLifeEntries(life: readonly UnionArenaLifeCard[] | undefined, cardsById: ReadonlyMap<string, CardRecord>): LifeCardEntry[] {
  return (life ?? []).map((slot) => ({ id: slot.id, card: slot.cardId ? cardsById.get(slot.cardId) : undefined }));
}

export function ArknightsApp({ account, token }: { account: Account; token: string | null }) {
  const [state, setState] = useState<UnionArenaRoomState | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [roomWindowOpen, setRoomWindowOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<RoomRole | null>(null);
  const [incomingInvite, setIncomingInvite] = useState<{ id: string; roomCode: string; role: string; inviter: string } | null>(null);
  const { cards, cardsById, ctx } = useCatalog(setError);
  const [selectedCard, setSelectedCard] = useState<CardRecord | null>(null);
  const [cardSearch, setCardSearch] = useState("");
  /** The deck being built (kept in this browser for the account). */
  const myDeck = useDeck(cards, cardsById, account.id);
  const { deck, total: deckTotal, source: deckSource, key: deckKey, canAdd, setCopies } = myDeck;
  /** The deck (as `deckKey`) the server last accepted, so "ready" is only offered for a deck it has seen and approved. */
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  const [deckIssues, setDeckIssues] = useState<string[]>([]);
  const [zoomCard, setZoomCard] = useState<CardRecord | null>(null);
  const previewRef = useRef<HTMLButtonElement>(null);
  useViewportVars();
  const compact = useCompactLayout();
  const [panelOpen, setPanelOpen] = useState<boolean | null>(null);
  // The panel overlays the table on every screen size and starts closed, so the table owns the whole window.
  // The single source of truth for both the desktop dock and the compact drawer.
  const panelVisible = panelOpen ?? false;
  const togglePanel = (): void => setPanelOpen(!panelVisible);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const lastVisible = useRef(panelVisible);

  // Esc closes the panel.
  useEffect(() => {
    if (!panelVisible) return undefined;
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") setPanelOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelVisible]);

  // Keep keyboard focus sensible when the panel opens or closes.
  useEffect(() => {
    if (panelVisible && !lastVisible.current) closeRef.current?.focus({ preventScroll: true });
    if (!panelVisible && lastVisible.current) {
      const active = document.activeElement;
      if (!active || active === document.body || panelRef.current?.contains(active)) toggleRef.current?.focus({ preventScroll: true });
    }
    lastVisible.current = panelVisible;
  }, [compact, panelVisible]);
  const socket = useMemo(() => io("/arknights", { autoConnect: false, auth: { token }, transports: ["websocket", "polling"] }) as UnionSocket, [token]);

  useEffect(() => {
    if (!token) return undefined;
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch("/api/social/invitations", { headers: { Authorization: `Bearer ${token}` } });
        const result = await response.json() as { data?: Array<{ id: string; game: string; roomCode: string; role: string; inviter: string }> };
        setIncomingInvite(result.data?.find((entry) => entry.game === "arknights") ?? null);
      } catch { /* retain the last visible invitation */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => window.clearInterval(timer);
  }, [token]);

  useEffect(() => {
    socket.on("ua:state", setState);
    socket.on("connect_error", (reason) => setError(reason.message === "AUTH_REQUIRED" ? "登录状态已失效，请返回重新登录。" : "无法连接明日方舟对战服务。"));
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("room");
    const watch = params.get("watch") === "1";
    const create = params.get("create") === "1";
    if (invite) setRoomCode(invite);
    socket.connect();
    const onConnect = (): void => {
      if (invite) void emitAck(socket, watch ? "ua:spectate_room" : "ua:join_room", { roomCode: invite });
      else if (create) void emitAck(socket, "ua:create_room", {});
    };
    socket.on("connect", onConnect);
    return () => { socket.off("connect", onConnect); socket.disconnect(); socket.removeAllListeners(); };
  }, [socket]);

  const action = async <T,>(event: keyof ClientToServerEvents, payload: unknown): Promise<ActionAck<T> | null> => {
    setBusy(true); setError("");
    try { return await emitAck<T>(socket, event, payload); }
    finally { setBusy(false); }
  };

  const createRoom = async (): Promise<void> => {
    const result = await action<{ roomCode: string }>("ua:create_room", {});
    if (!result?.ok) setError(errorText(result, "创建房间失败"));
    else setPanelOpen(false);
  };
  const joinRoom = async (): Promise<void> => {
    const result = await action<{ roomCode: string }>("ua:join_room", { roomCode: roomCode.trim().toUpperCase() });
    if (!result?.ok) setError(errorText(result, "加入房间失败"));
    else setPanelOpen(false);
  };
  const spectateRoom = async (): Promise<void> => {
    const result = await action<{ roomCode: string }>("ua:spectate_room", { roomCode: roomCode.trim() });
    if (!result?.ok) setError(errorText(result, "进入观战席失败")); else setPanelOpen(false);
  };
  const toggleReady = async (): Promise<void> => {
    const result = await action("ua:ready", { ready: !state?.you.ready });
    if (!result?.ok) setError(errorText(result, "更新准备状态失败"));
  };
  const startGame = async (): Promise<void> => {
    const result = await action("ua:start_game", {});
    if (!result?.ok) setError(errorText(result, "当前不能开始对局"));
  };
  const answerMulligan = async (redraw: boolean): Promise<void> => {
    const result = await action("ua:mulligan", { redraw });
    if (!result?.ok) setError(errorText(result, "换牌操作失败"));
  };
  const leaveRoom = async (): Promise<void> => {
    const result = await action(state?.youAreSpectator ? "ua:leave_spectating" : "ua:leave_room", {});
    if (!result?.ok) setError(errorText(result, "离开房间失败"));
    else setState(null);
  };
  const sendGameAction = async (gameAction: UnionArenaAction): Promise<string | null> => {
    if (state?.youAreSpectator) return "观战席只能查看对局";
    setBusy(true);
    try {
      const result = await emitAck(socket, "ua:action", gameAction);
      return result.ok ? null : errorText(result, "操作失败");
    } finally { setBusy(false); }
  };
  const returnToLobby = async (): Promise<void> => {
    const result = await action("ua:return_to_lobby", {});
    if (!result?.ok) setError(errorText(result, "返回房间失败"));
  };

  const opponent = state?.players.find((player) => player.id !== account.id);
  const me = state?.players.find((player) => player.id === account.id);
  const selfLife = useMemo(() => toLifeEntries(state?.life.you, cardsById), [state?.life.you, cardsById]);
  const opponentLife = useMemo(() => toLifeEntries(state?.life.opponent, cardsById), [state?.life.opponent, cardsById]);
  const visibleCards = cards.filter((card) => `${card.number} ${card.name}`.toLocaleLowerCase().includes(cardSearch.trim().toLocaleLowerCase()));

  const submitDeck = async (): Promise<void> => {
    const result = await action<{ structuralOk: boolean; issues: string[] }>("ua:submit_deck", { cardIds: myDeck.cardIds, apCount: AP_COUNT });
    if (!result?.ok) { setError(errorText(result, "提交牌组失败")); return; }
    setDeckIssues(result.data?.issues ?? []);
    setSubmittedKey(result.data?.structuralOk ? deckKey : null);
  };
  const deckSubmitted = submittedKey !== null && submittedKey === deckKey && deckTotal === DECK_SIZE;
  const deckEditable = state?.phase === "lobby";
  const readOnly = state?.youAreSpectator ?? false;
  // Cosmetic only: events float over the card they happened to, instead of the action bar's log line.
  const floatNotices = useFloatNotices(state?.game?.events, !readOnly);
  const noticesFor = useMemo(() => {
    const byUid = new Map<string, FloatNotice[]>();
    for (const notice of floatNotices) {
      const uid = notice.cardKey.slice(2);
      const list = byUid.get(uid);
      if (list) list.push(notice); else byUid.set(uid, [notice]);
    }
    return (uid: string): FloatNotice[] => byUid.get(uid) ?? [];
  }, [floatNotices]);
  const answerIncomingInvite = async (accept: boolean): Promise<void> => {
    if (!incomingInvite || !token) return;
    await fetch(`/api/social/invitations/${encodeURIComponent(incomingInvite.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    const inviteToJoin = incomingInvite;
    setIncomingInvite(null);
    if (accept) window.location.assign(`${ARKNIGHTS_HOME}pvp?room=${inviteToJoin.roomCode}${inviteToJoin.role === "spectator" ? "&watch=1" : ""}`);
  };

  const game = state?.game ?? null;
  const nameOf = (playerId: string | null | undefined): string => state?.players.find((player) => player.id === playerId)?.username ?? "";
  const controller = useGameController({
    state, meId: account.id, cardsById, ctx, compact, busy, send: sendGameAction,
    onMulligan: (redraw) => void answerMulligan(redraw),
    overButton: { label: "返回房间（保留牌组）", run: () => void returnToLobby() }
  });
  // When it is your turn to decide on the mulligan, bring the tools panel (where the choice lives) up.
  const needsMulligan = game?.mulliganPlayerId === account.id;
  useEffect(() => { if (needsMulligan) setPanelOpen(true); }, [needsMulligan]);
  const gameStatus = !game ? "" : game.step === "mulligan"
    ? (needsMulligan ? "换牌阶段：轮到你选择" : `换牌阶段：等待 ${nameOf(game.mulliganPlayerId)}`)
    : game.step === "over" ? `对局结束 · ${game.winnerId === account.id ? "你获胜了" : `${nameOf(game.winnerId)} 获胜`}`
    : `第 ${game.turn} 回合 · ${game.turnPlayerId === account.id ? "你的回合" : `${nameOf(game.turnPlayerId)} 的回合`}`;
  const anyLightbox = zoomCard !== null || controller.lightboxOpen;
  // Until you are in a room, the player-vs-player route is the standalone room page, like UNO and shogi.
  if (!state) {
    return <>
      {incomingInvite ? <aside className="invite-toast"><strong>{incomingInvite.inviter} 邀请你{incomingInvite.role === "spectator" ? "观战" : "加入房间"}</strong><span>明日方舟 · {incomingInvite.roomCode}</span><button className="ua-primary" onClick={() => void answerIncomingInvite(true)}>{incomingInvite.role === "spectator" ? "前往观战" : "接受邀请"}</button><button className="ua-secondary" onClick={() => void answerIncomingInvite(false)}>忽略</button></aside> : null}
      <ArknightsRoomPage account={account} roomCode={roomCode} busy={busy} error={error}
        onRoomCode={setRoomCode} onCreate={() => void createRoom()} onJoin={() => void joinRoom()} onSpectate={() => void spectateRoom()} />
    </>;
  }
  return <div className="ua-app" data-compact={compact} data-in-game={game ? "true" : undefined}>
    {incomingInvite ? <aside className="invite-toast"><strong>{incomingInvite.inviter} 邀请你{incomingInvite.role === "spectator" ? "观战" : "加入房间"}</strong><span>明日方舟 · {incomingInvite.roomCode}</span><button className="ua-primary" onClick={() => void answerIncomingInvite(true)}>{incomingInvite.role === "spectator" ? "前往观战" : "接受邀请"}</button><button className="ua-secondary" onClick={() => void answerIncomingInvite(false)}>忽略</button></aside> : null}
    <header className="ua-header" inert={anyLightbox}>
      <button className="ua-back" onClick={() => window.location.assign(ARKNIGHTS_HOME)}>返回大厅</button>
      <div className="ua-roominfo">{state ? <span className="ua-roominfo-main">房间 <strong>{state.roomCode}</strong> · {state.playerCount}/{state.requiredPlayers} 人{gameStatus ? ` · ${gameStatus}` : ""}</span> : <span>未加入房间</span>}{error ? <span className="ua-roominfo-error" role="alert">{error}</span> : null}</div>
      <div className="ua-header-end">
        <button type="button" className="ua-toggle" onClick={() => setRoomWindowOpen(true)}>房间信息</button>
        <button ref={toggleRef} type="button" className="ua-toggle" aria-expanded={panelVisible} aria-controls="ua-panel" aria-label={compact ? "打开工具面板" : panelVisible ? "收起侧栏" : "展开侧栏"} onClick={togglePanel}>{compact ? "工具" : panelVisible ? "侧栏 ›" : "‹ 侧栏"}</button>
        <ThemeControl />
        <div className="ua-account" title={account.username}>{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : null}<span>{account.username}</span></div>
      </div>
    </header>
    {controller.actionBar && !readOnly ? <div className="ua-actionbar-row" inert={anyLightbox}>{controller.actionBar}</div> : null}
    <main className="ua-main" data-panel-open={panelVisible} inert={anyLightbox}>
      <div className="ua-stage">
        <div className="ua-table-wrapper">
          <section className="ua-table" aria-label="明日方舟 UNION ARENA 对战桌面">
            <span className="ua-centerline" aria-hidden="true" />
            <div className="ua-seatbar" data-side="opponent"><Seat player={opponent} self={false} onInvite={readOnly ? undefined : () => setInviteRole("player")} />{controller.opponentHand}</div>
            <HalfBoard side="opponent" life={opponentLife} board={game?.board.opponent} deckCount={game?.deckCount.opponent} cardsById={cardsById} ctx={ctx} interaction={readOnly ? undefined : controller.interaction} noticesFor={noticesFor} activePhase={controller.activePhase("opponent")} />
            <HalfBoard side="self" life={selfLife} board={game?.board.you} deckCount={game?.deckCount.you} cardsById={cardsById} ctx={ctx} interaction={readOnly ? undefined : controller.interaction} noticesFor={noticesFor} activePhase={controller.activePhase("self")} />
            <div className="ua-seatbar" data-side="self"><Seat player={me} self />{readOnly ? null : controller.handStrip}</div>
          </section>
        </div>
      </div>
      {compact ? <div className="ua-backdrop" data-open={panelVisible} onClick={() => setPanelOpen(false)} aria-hidden="true" /> : null}
      <div className="ua-dock" data-open={panelVisible}>
      <aside ref={panelRef} id="ua-panel" className="ua-panel" data-open={panelVisible} inert={!panelVisible} aria-hidden={!panelVisible} aria-label="房间与卡牌目录">
        <div className="ua-panel-head"><strong>房间 · 卡牌目录</strong><button ref={closeRef} type="button" className="ua-secondary ua-panel-close" aria-label="关闭工具面板" onClick={() => setPanelOpen(false)}>关闭</button></div>
        <div className="ua-status"><span>玩家人数</span><strong>{state?.playerCount ?? 0}/{state?.requiredPlayers ?? 2}</strong></div>
        {state && !readOnly && deckEditable && !state.you.isHost ? <div className="ua-room-actions"><button className="ua-secondary" disabled={busy || (!state.you.ready && !deckSubmitted)} onClick={() => void toggleReady()}>{state.you.ready ? "取消准备" : "准备"}</button></div> : null}
        {state && !readOnly && deckEditable && state.you.isHost ? <div className="ua-room-actions"><button className="ua-primary" disabled={busy || !state.startAllowed} onClick={() => void startGame()}>开始游戏</button></div> : null}
        {!state ? <div className="ua-room-actions"><p>建房、加入和观战入口位于顶部“房间”窗口。</p></div> : null}
        {state && deckEditable && !state.startAllowed ? <p className="ua-hint">需要两名在线玩家各自提交合法牌组并准备，房主才能开始。</p> : null}
        {error ? <p className="ua-error" role="alert">{error}</p> : null}
        {state && !state.youAreSpectator && deckEditable ? <section className="ua-deck" aria-labelledby="ua-deck-heading">
          <div className="ua-deck-head"><h2 id="ua-deck-heading">我的牌组</h2><span>{deckTotal}/{DECK_SIZE} 张 · AP {AP_COUNT}/{AP_COUNT}</span></div>
          <p className="ua-hint">在下方卡牌目录用 ＋ 选卡：主牌组 {DECK_SIZE} 张，同卡号最多 {MAX_COPIES} 张，只能用同一作品代码（当前：{deckSource ?? "未定"}），【特殊】【色彩】【最终】触发的卡每种最多 {MAX_COPIES} 张。AP 卡固定 {AP_COUNT} 张，无需选择。</p>
          <div className="ua-deck-actions">
            <select className="ua-deck-preset" aria-label="以预设牌组为基础" value="" disabled={busy} onChange={(event) => {
              const preset = PRESET_DECKS.find((entry) => entry.id === event.target.value);
              if (preset) { myDeck.fromPreset(preset); setSubmittedKey(null); setDeckIssues([]); }
            }}>
              <option value="">以预设牌组为基础…</option>
              {PRESET_DECKS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
            <button type="button" className="ua-secondary" disabled={busy || deckTotal >= DECK_SIZE || !cards.length} onClick={() => myDeck.quickFill(selectedCard)}>快速组牌</button>
            <button type="button" className="ua-secondary" disabled={busy || deckTotal === 0} onClick={() => { myDeck.clear(); setSubmittedKey(null); setDeckIssues([]); }}>清空</button>
            <button type="button" className="ua-primary" disabled={busy || deckTotal !== DECK_SIZE} onClick={() => void submitDeck()}>提交牌组</button>
          </div>
          {deckSubmitted ? <p className="ua-deck-ok" role="status">牌组已通过校验{state.you.ready ? "，你已准备。" : "，可以准备了。"}</p> : null}
          {!deckSubmitted && deckIssues.length ? <ul className="ua-deck-issues" role="alert">{deckIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
        </section> : null}
        {game && state ? <section className="ua-game" aria-labelledby="ua-game-heading">
          <div className="ua-deck-head"><h2 id="ua-game-heading">对局</h2><span>{gameStatus}</span></div>
          <p className="ua-hint">先手：{nameOf(game.firstPlayerId)}{game.firstPlayerId === account.id ? "（你）" : ""}。手牌：你 {game.handCount.you} 张，对手 {game.handCount.opponent} 张；牌库：你 {game.deckCount.you} 张，对手 {game.deckCount.opponent} 张。</p>
          {needsMulligan ? <div className="ua-mulligan" role="group" aria-label="换牌选择">
            <p>起手牌可以重抽一次：现有手牌放到牌库底，抽 7 张新牌，再洗牌。</p>
            <div className="ua-deck-actions">
              <button type="button" className="ua-primary" disabled={busy} onClick={() => void answerMulligan(false)}>保留起手牌</button>
              <button type="button" className="ua-secondary" disabled={busy} onClick={() => void answerMulligan(true)}>重抽 7 张</button>
            </div>
          </div> : null}
          <ul className="ua-hand" aria-label={`你的手牌，${state.hand.length} 张`}>
            {state.hand.map((cardId, index) => {
              const card = cardsById.get(cardId);
              return <li key={`${cardId}-${index}`} title={card ? `${card.name} ${card.number}` : "手牌"}>
                <button type="button" className="ua-hand-zoom" aria-label={`放大查看手牌 ${card ? `${card.name} ${card.number}` : index + 1}`} aria-haspopup="dialog" onClick={(event) => controller.openHandCard(index, event.currentTarget)}>
                  {card?.imageUrl ? <img src={card.imageUrl} alt="" draggable={false} /> : <span className="ua-card-missing">?</span>}
                </button>
              </li>;
            })}
          </ul>
          {game.log.length ? <ol className="ua-log" aria-label="对局记录">{game.log.slice(-12).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol> : null}
        </section> : null}
        <section className="ua-catalog" aria-labelledby="ua-catalog-heading">
          <div className="ua-catalog-heading"><h2 id="ua-catalog-heading">卡牌目录</h2><span>{visibleCards.length} / {cards.length}</span></div>
          <input aria-label="搜索卡牌" value={cardSearch} onChange={(event) => setCardSearch(event.target.value)} placeholder="搜索卡名或卡号" />
          {selectedCard?.imageUrl ? <figure className="ua-card-preview">
            <button ref={previewRef} type="button" className="ua-card-zoom" aria-label={`放大查看 ${selectedCard.name} ${selectedCard.number}`} aria-haspopup="dialog" onClick={() => setZoomCard(selectedCard)}><img src={selectedCard.imageUrl} alt="" /></button>
            <figcaption><strong>{selectedCard.name}</strong><small>{selectedCard.number} · {selectedCard.rarity} · {selectedCard.parallelIds.length} 种异图</small></figcaption>
          </figure> : null}
          <div className="ua-card-list" role="list" aria-label="卡牌">
            {visibleCards.map((card) => {
              const copies = deck.get(card.id) ?? 0;
              return <div key={card.id} role="listitem" className={`ua-card-row ${selectedCard?.id === card.id ? "is-selected" : ""}`}>
                <button type="button" className="ua-card-pick" onClick={() => setSelectedCard(card)} aria-pressed={selectedCard?.id === card.id}>
                  {card.imageUrl ? <img src={card.imageUrl} alt="" loading="lazy" /> : <span className="ua-card-missing">?</span>}
                  <span><strong>{card.name}</strong><small>{card.number} · {card.rarity}</small></span>
                </button>
                {deckEditable && !readOnly ? <span className="ua-stepper">
                  <button type="button" aria-label={`从牌组移出 ${card.name} ${card.number}`} disabled={copies === 0} onClick={() => setCopies(card, copies - 1)}>－</button>
                  <output aria-label={`${card.name} 已选 ${copies} 张`}>{copies}</output>
                  <button type="button" aria-label={`加入牌组 ${card.name} ${card.number}`} disabled={!canAdd(card)} onClick={() => setCopies(card, copies + 1)}>＋</button>
                </span> : null}
              </div>;
            })}
          </div>
        </section>
      </aside>
      </div>
    </main>
    {roomWindowOpen ? <div className="ua-room-window-backdrop" role="presentation" onClick={() => setRoomWindowOpen(false)}>
      <section className="ua-room-window" role="dialog" aria-modal="true" aria-labelledby="ua-room-window-title" onClick={(event) => event.stopPropagation()}>
        <div className="ua-panel-head"><strong id="ua-room-window-title">房间</strong><button type="button" className="ua-secondary" onClick={() => setRoomWindowOpen(false)}>关闭</button></div>
        {!state ? <div className="ua-room-actions"><p className="ua-hint">还没有加入房间。到房间页面创建或加入一个房间。</p><button className="ua-primary" disabled={busy} onClick={() => window.location.assign(`${ARKNIGHTS_HOME}pvp`)}>前往房间页面</button></div> : <>
          <p className="ua-room-window-code">房间号 <strong>{state.roomCode}</strong> · {state.playerCount}/{state.requiredPlayers} 人{readOnly ? " · 观战中" : ""}</p>
          <div className="ua-room-window-players"><strong>玩家</strong>{state.players.map((player) => <span key={player.id}>{player.username}{player.isHost ? " · 房主" : ""}{player.connected ? "" : " · 离线"}</span>)}</div>
          <div className="spectator-block"><strong>观战席（{state.spectators.length}）</strong><SpectatorSeats spectators={state.spectators.map((person) => ({ id: person.id, name: person.username, connected: person.connected, avatarUrl: person.avatarUrl }))} canInvite={!readOnly} onInvite={() => setInviteRole("spectator")} /></div>
          {/* Inviting to a seat happens on the table itself: the empty seat's "+" and the spectator list's button. */}
          <button className="ua-secondary" disabled={busy} onClick={() => void leaveRoom()}>离开房间</button>
        </>}
        {error ? <p className="ua-error" role="alert">{error}</p> : null}
      </section>
    </div> : null}
    {inviteRole && state ? <InviteDialog game="arknights" roomCode={state.roomCode} role={inviteRole} onClose={() => setInviteRole(null)} /> : null}
    {zoomCard?.imageUrl ? <CardLightbox src={zoomCard.imageUrl} label={zoomCard.name} alt={`${zoomCard.name} ${zoomCard.number}`} compact={compact} getOrigin={() => previewRef.current?.getBoundingClientRect() ?? null} getReturnFocus={() => previewRef.current} onClose={() => setZoomCard(null)} /> : null}
    {controller.lightbox}
  </div>;
}
