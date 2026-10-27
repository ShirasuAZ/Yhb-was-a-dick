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
import { ALL_IPS, IpSelect, ipFilterName, matchesIp } from "./IpSelect.tsx";
import { DEFAULT_IP_ID, ipName, type IpId } from "../shared/ips.ts";
import "./arknights.css";

type UnionSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Where the game's own lobby lives. */
export const ARKNIGHTS_HOME = "/arknights-union-arena/";
/** The site's account settings page, which owns the theme switch for the whole site. */
export const ACCOUNT_SETTINGS = "/about";
/** That same page, opened from inside a game: it then offers "返回对局" instead of "返回主页". */
export const settingsUrl = (from: "arknights-pvp" | "arknights-ai" | "arknights-tutorial"): string =>
  `${ACCOUNT_SETTINGS}?from=${from}`;
/**
 * Set while this tab is at a table, so a reload (or a socket reconnect) puts the player back in that room.
 * "返回大厅" clears it first, which is what keeps a deliberate exit from being undone later.
 */
const IN_ROOM_MARKER = "ua.inRoom";

function readRoomMarker(): boolean {
  try { return sessionStorage.getItem(IN_ROOM_MARKER) === "1"; } catch { return false; }
}

function writeRoomMarker(inRoom: boolean): void {
  try {
    if (inRoom) sessionStorage.setItem(IN_ROOM_MARKER, "1");
    else sessionStorage.removeItem(IN_ROOM_MARKER);
  } catch { /* private mode: the tab simply does not resume */ }
}

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
  const [closedMessage, setClosedMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** The table bar folds away during play (and whenever the tools panel is open); this re-opens it on demand. */
  const [barExpanded, setBarExpanded] = useState(false);
  const [inviteRole, setInviteRole] = useState<RoomRole | null>(null);
  const [incomingInvite, setIncomingInvite] = useState<{ id: string; roomCode: string; role: string; inviter: string } | null>(null);
  const { cards, cardsById, ctx } = useCatalog(setError);
  const [selectedCard, setSelectedCard] = useState<CardRecord | null>(null);
  const [cardSearch, setCardSearch] = useState("");
  /** Which title the card catalog shows. Arknights by default, so the players already here see what they always did. */
  const [catalogIp, setCatalogIp] = useState<IpId | "all">(DEFAULT_IP_ID);
  /** The deck being built (kept in this browser for the account). */
  const myDeck = useDeck(cards, cardsById, account.id);
  const { deck, total: deckTotal, source: deckSource, key: deckKey, canAdd, setCopies } = myDeck;
  /**
   * The deck's title drives the card catalog, so the cards shown are the ones that can actually go into the deck. It is
   * only ever a view: choosing a title in the picker never changes a saved deck.
   */
  const deckIp: IpId | null = myDeck.ipId;
  useEffect(() => { if (deckIp) setCatalogIp(deckIp); }, [deckIp]);
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
  const menuRef = useRef<HTMLDivElement>(null);
  /** Set once this page has attached to a room, so a reconnect resumes instead of staying on the room page. */
  const resumeWanted = useRef(readRoomMarker());

  // Esc closes the panel (and the room menu).
  useEffect(() => {
    if (!panelVisible && !menuOpen) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (menuOpen) setMenuOpen(false);
      else setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelVisible, menuOpen]);

  // A click anywhere else closes the room menu.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

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
    socket.on("ua:state", (next) => { setState(next); writeRoomMarker(true); resumeWanted.current = true; });
    socket.on("ua:room_closed", (payload) => {
      writeRoomMarker(false);
      resumeWanted.current = false;
      setState(null);
      setClosedMessage(payload.message || "房间已关闭");
    });
    socket.on("connect_error", (reason) => setError(reason.message === "AUTH_REQUIRED" ? "登录状态已失效，请返回重新登录。" : "无法连接 UNION ARENA 对战服务。"));
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("room");
    const watch = params.get("watch") === "1";
    const create = params.get("create") === "1";
    if (invite) setRoomCode(invite);
    socket.connect();
    const onConnect = (): void => {
      if (invite) void emitAck(socket, watch ? "ua:spectate_room" : "ua:join_room", { roomCode: invite });
      else if (create) void emitAck(socket, "ua:create_room", {});
      // A reload, or a connection that came back: only resume when this tab was at a table. A tab that never was
      // (the room page, or one that just pressed "返回大厅") stays there instead of being pulled back into a game.
      else if (resumeWanted.current) {
        void emitAck<{ roomCode: string }>(socket, "ua:resume_room", {}).then((result) => {
          if (result.ok) return;
          resumeWanted.current = false;
          writeRoomMarker(false);
        });
      }
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
    else { resumeWanted.current = true; setPanelOpen(false); }
  };
  const joinRoom = async (): Promise<void> => {
    const result = await action<{ roomCode: string }>("ua:join_room", { roomCode: roomCode.trim().toUpperCase() });
    if (!result?.ok) setError(errorText(result, "加入房间失败"));
    else { resumeWanted.current = true; setPanelOpen(false); }
  };
  const spectateRoom = async (): Promise<void> => {
    const result = await action<{ roomCode: string }>("ua:spectate_room", { roomCode: roomCode.trim() });
    if (!result?.ok) setError(errorText(result, "进入观战席失败")); else { resumeWanted.current = true; setPanelOpen(false); }
  };
  const answerMulligan = async (redraw: boolean): Promise<void> => {
    const result = await action("ua:mulligan", { redraw });
    if (!result?.ok) setError(errorText(result, "换牌操作失败"));
  };
  const forgetRoom = (): void => { resumeWanted.current = false; writeRoomMarker(false); };
  const leaveRoom = async (): Promise<void> => {
    const result = await action(state?.youAreSpectator ? "ua:leave_spectating" : "ua:leave_room", {});
    if (!result?.ok) setError(errorText(result, "离开房间失败"));
    forgetRoom();
    setState(null);
  };
  /** The menu's "返回大厅": leave the room (so nothing brings it back) and go to the game's lobby. */
  const backToLobby = async (): Promise<void> => {
    setMenuOpen(false);
    await leaveRoom();
    window.location.assign(ARKNIGHTS_HOME);
  };
  const dissolveRoom = async (): Promise<void> => {
    setMenuOpen(false);
    if (!window.confirm("解散房间后，房间内的玩家都会被移出，确定解散吗？")) return;
    const result = await action("ua:dissolve_room", {});
    forgetRoom();
    if (!result?.ok) { setError(errorText(result, "解散房间失败")); return; }
    setState(null);
    window.location.assign(ARKNIGHTS_HOME);
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
  /** The catalog: the chosen title (or every title), narrowed by the search box. Both filters apply together. */
  const visibleCards = cards.filter((card) =>
    matchesIp(card.ipId, catalogIp)
    && `${card.number} ${card.name}`.toLocaleLowerCase().includes(cardSearch.trim().toLocaleLowerCase()));
  /** How many cards each title has, for the picker and the count line. */
  const ipCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) if (card.ipId) counts.set(card.ipId, (counts.get(card.ipId) ?? 0) + 1);
    return counts;
  }, [cards]);

  const submitDeck = async (): Promise<void> => {
    // The server decides the deck's title from its cards; the declared one is only cross-checked against them.
    const result = await action<{ structuralOk: boolean; issues: string[]; ipId: IpId | null }>("ua:submit_deck", {
      cardIds: myDeck.cardIds, apCount: AP_COUNT, ipId: myDeck.ipId ?? undefined
    });
    if (!result?.ok) { setError(errorText(result, "提交牌组失败")); return; }
    setDeckIssues(result.data?.issues ?? []);
    setSubmittedKey(result.data?.structuralOk ? deckKey : null);
  };
  const deckSubmitted = submittedKey !== null && submittedKey === deckKey && deckTotal === DECK_SIZE;
  /** The saved deck is for one title while the catalog shows another: the picker says so instead of changing either. */
  const deckIpMismatch = deckIp !== null && catalogIp !== ALL_IPS && catalogIp !== deckIp;
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
  // A folded bar stays folded: closing the tools panel mid-game leaves the small key, not the full bar.
  useEffect(() => { if (game) setBarExpanded(false); }, [game?.step === "over", game?.turn]); // eslint-disable-line react-hooks/exhaustive-deps
  const gameStatus = !game ? "" : game.step === "mulligan"
    ? (needsMulligan ? "换牌阶段：轮到你选择" : `换牌阶段：等待 ${nameOf(game.mulliganPlayerId)}`)
    : game.step === "over" ? `对局结束 · ${game.winnerId === account.id ? "你获胜了" : `${nameOf(game.winnerId)} 获胜`}`
    : `第 ${game.turn} 回合 · ${game.turnPlayerId === account.id ? "你的回合" : `${nameOf(game.turnPlayerId)} 的回合`}`;
  const anyLightbox = zoomCard !== null || controller.lightboxOpen || controller.revealOpen;
  // In a game the bar folds away to one small key; opening the tools panel hides it altogether (the panel has its own close).
  /** The seat names of everyone watching this table, in join order (the server keeps that list). */
  const watchers = state?.spectators.map((person) => person.username) ?? [];
  const showBar = !panelVisible && (game === null || barExpanded);
  const showMini = !panelVisible && !showBar;
  // Until you are in a room, the player-vs-player route is the standalone room page, like UNO and shogi.
  if (!state) {
    return <>
      {incomingInvite ? <aside className="invite-toast"><strong>{incomingInvite.inviter} 邀请你{incomingInvite.role === "spectator" ? "观战" : "加入房间"}</strong><span>UNION ARENA · {incomingInvite.roomCode}</span><button className="ua-primary" onClick={() => void answerIncomingInvite(true)}>{incomingInvite.role === "spectator" ? "前往观战" : "接受邀请"}</button><button className="ua-secondary" onClick={() => void answerIncomingInvite(false)}>忽略</button></aside> : null}
      <ArknightsRoomPage account={account} roomCode={roomCode} busy={busy} error={error} notice={closedMessage}
        onRoomCode={setRoomCode} onCreate={() => void createRoom()} onJoin={() => void joinRoom()} onSpectate={() => void spectateRoom()} />
    </>;
  }
  return <div className="ua-app" data-compact={compact} data-bare="true" data-in-game={game ? "true" : undefined}>
    {incomingInvite ? <aside className="invite-toast"><strong>{incomingInvite.inviter} 邀请你{incomingInvite.role === "spectator" ? "观战" : "加入房间"}</strong><span>UNION ARENA · {incomingInvite.roomCode}</span><button className="ua-primary" onClick={() => void answerIncomingInvite(true)}>{incomingInvite.role === "spectator" ? "前往观战" : "接受邀请"}</button><button className="ua-secondary" onClick={() => void answerIncomingInvite(false)}>忽略</button></aside> : null}
    {controller.actionBar && !readOnly ? <div className="ua-actionbar-row" inert={anyLightbox}>{controller.actionBar}</div> : null}
    <main className="ua-main" data-panel-open={panelVisible} inert={anyLightbox}>
      <div className="ua-stage">
        <div className="ua-table-wrapper">
          <section className="ua-table" aria-label="UNION ARENA 对战桌面">
            <span className="ua-centerline" aria-hidden="true" />
            <div className="ua-seatbar" data-side="opponent"><Seat player={opponent} self={false} onInvite={readOnly ? undefined : () => setInviteRole("player")} />{controller.opponentHand}</div>
            <HalfBoard side="opponent" life={opponentLife} board={game?.board.opponent} deckCount={game?.deckCount.opponent} cardsById={cardsById} ctx={ctx} interaction={readOnly ? undefined : controller.interaction} noticesFor={noticesFor} activePhase={controller.activePhase("opponent")} />
            <HalfBoard side="self" life={selfLife} board={game?.board.you} deckCount={game?.deckCount.you} cardsById={cardsById} ctx={ctx} interaction={readOnly ? undefined : controller.interaction} noticesFor={noticesFor} activePhase={controller.activePhase("self")} />
            <div className="ua-seatbar" data-side="self"><Seat player={me} self />{readOnly ? null : controller.handStrip}</div>
          </section>
        </div>
      </div>
      {/* The table's own controls float in the board's top-right corner: the page has no top bar any more. */}
      {/*
        The bar only holds the room number and the controls the table needs; during a game (and while the tools panel is
        open) it folds down to a single small key in the corner, so the board keeps that space.
      */}
      {showBar ? <div className="ua-tablebar" inert={anyLightbox}>
        {error ? <span className="ua-tablebar-error" role="alert">{error}</span> : null}
        <span className="ua-roomchip" title={`房间 ${state.roomCode}`}>
          <span className="ua-roomchip-label">房间</span>
          <strong>{state.roomCode}</strong>
          <span className="ua-roomchip-people">{state.playerCount}/{state.requiredPlayers} 人{readOnly ? " · 观战中" : ""}</span>
          {gameStatus ? <span className="ua-roomchip-status">{gameStatus}</span> : <span className="ua-roomchip-status">等待对手准备</span>}
        </span>
        <button ref={toggleRef} type="button" className="ua-toggle" aria-expanded={panelVisible} aria-controls="ua-panel" aria-label={compact ? "打开工具面板" : panelVisible ? "收起侧栏" : "展开侧栏"} onClick={togglePanel}>{compact ? "工具" : panelVisible ? "侧栏 ›" : "‹ 侧栏"}</button>
        <div className="ua-menu-anchor" ref={menuRef}>
          <button type="button" className="ua-hamburger" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="房间菜单" title="房间菜单"
            onClick={() => setMenuOpen((open) => !open)}><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /></button>
          {menuOpen ? <div className="ua-menu" role="menu" aria-label="房间菜单">
            {state.you.isHost && !readOnly ? <button type="button" role="menuitem" className="ua-menu-item ua-menu-danger" disabled={busy} onClick={() => void dissolveRoom()}>解散房间</button> : null}
            <button type="button" role="menuitem" className="ua-menu-item" disabled={busy} onClick={() => void backToLobby()}>返回大厅</button>
            <button type="button" role="menuitem" className="ua-menu-item" onClick={() => { setMenuOpen(false); window.location.assign(settingsUrl("arknights-pvp")); }}>设置</button>
          </div> : null}
        </div>
      </div> : null}
      {/* A single line in the corner: who is watching. It floats, so it costs the board no space at all. */}
      {watchers.length && !readOnly ? <p className="ua-watchers" role="status" inert={anyLightbox}>
        {watchers.length === 1 ? `${watchers[0]} 正在观战` : `${watchers.length} 人正在观战`}
      </p> : null}
      {showMini ? <div className="ua-minibar" inert={anyLightbox}>
        <button type="button" className="ua-hamburger ua-hamburger-mini" aria-label="展开房间栏" title="房间与设置"
          aria-expanded={false} onClick={() => setBarExpanded(true)}><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /></button>
      </div> : null}
      {compact ? <div className="ua-backdrop" data-open={panelVisible} onClick={() => setPanelOpen(false)} aria-hidden="true" /> : null}
      <div className="ua-dock" data-open={panelVisible}>
      <aside ref={panelRef} id="ua-panel" className="ua-panel" data-open={panelVisible} inert={!panelVisible} aria-hidden={!panelVisible} aria-label="房间与卡牌目录">
        <div className="ua-panel-head"><strong>房间 <span className="ua-panel-code">{state.roomCode}</span></strong><button ref={closeRef} type="button" className="ua-secondary ua-panel-close" aria-label="关闭工具面板" onClick={() => setPanelOpen(false)}>关闭</button></div>
        {/* Room number, who is seated and who is watching: the seats on the table already show the players themselves, so the
            old head count, start button and its explanation are gone — the game starts by itself when the room is full. */}
        <section className="ua-room-card" aria-label="房间">
          <div className="ua-room-window-players">{state.players.map((player) => <span key={player.id}>
            {player.username}{player.isHost ? " · 房主" : ""}{player.connected ? "" : " · 离线"}
            {player.deckIpId ? <em className="ua-seat-ip">{ipName(player.deckIpId)}</em> : null}
          </span>)}</div>
          <div className="spectator-block"><strong>观战席（{state.spectators.length}）</strong><SpectatorSeats spectators={state.spectators.map((person) => ({ id: person.id, name: person.username, connected: person.connected, avatarUrl: person.avatarUrl }))} canInvite={!readOnly} onInvite={() => setInviteRole("spectator")} /></div>
        </section>
        {error ? <p className="ua-error" role="alert">{error}</p> : null}
        {state && !state.youAreSpectator && deckEditable ? <section className="ua-deck" aria-labelledby="ua-deck-heading">
          <div className="ua-deck-head"><h2 id="ua-deck-heading">我的牌组</h2><span>{deckTotal}/{DECK_SIZE} 张 · AP {AP_COUNT}/{AP_COUNT}</span></div>
          <div className="ua-deck-pick">
            <label>选择牌组
              <select aria-label="选择牌组" value={myDeck.active?.id ?? ""} disabled={busy || !myDeck.decks.length}
                onChange={(event) => { myDeck.selectDeck(event.target.value); setSubmittedKey(null); setDeckIssues([]); }}>
                {myDeck.decks.length === 0 ? <option value="">还没有牌组</option> : null}
                {myDeck.decks.map((entry) => <option key={entry.id} value={entry.id}>{myDeck.labelOf(entry)}</option>)}
              </select>
            </label>
            <button type="button" className="ua-secondary" disabled={busy} onClick={() => { myDeck.createDeck(catalogIp === ALL_IPS ? DEFAULT_IP_ID : catalogIp); setSubmittedKey(null); setDeckIssues([]); }}>新建牌组</button>
          </div>
          {deckIpMismatch ? <p className="ua-deck-warn" role="status">
            当前牌组属于{ipName(deckIp)}，与卡牌目录的「{ipFilterName(catalogIp)}」不一致。请选择对应的牌组，或新建一副{ipFilterName(catalogIp)}牌组。
          </p> : null}
          <p className="ua-hint">在下方卡牌目录用 ＋ 选卡：主牌组 {DECK_SIZE} 张，同卡号最多 {MAX_COPIES} 张，只能用同一作品（当前：{deckIp ? ipName(deckIp) : "未定"}），【特殊】【色彩】【最终】触发的卡每种最多 {MAX_COPIES} 张。AP 卡固定 {AP_COUNT} 张，无需选择。</p>
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
          {deckSubmitted ? <p className="ua-deck-ok" role="status">牌组已通过校验{state.you.ready ? "，已准备。" : ""}</p> : null}
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
          <div className="ua-catalog-heading">
            <h2 id="ua-catalog-heading">卡牌目录</h2>
            {/* The count is what the filters leave, never a fixed number. */}
            <span>{visibleCards.length} / {catalogIp === ALL_IPS ? cards.length : (ipCounts.get(catalogIp) ?? 0)}</span>
          </div>
          <div className="ua-catalog-filters">
            <IpSelect label="作品" allowAll value={catalogIp} onChange={setCatalogIp} disabled={!cards.length} />
            <input aria-label="搜索卡牌" value={cardSearch} onChange={(event) => setCardSearch(event.target.value)} placeholder="搜索卡名或卡号" />
          </div>
          {visibleCards.length === 0 && cards.length > 0 ? <p className="ua-hint" role="status">
            {ipFilterName(catalogIp)}下没有匹配「{cardSearch.trim()}」的卡牌。
          </p> : null}
          {selectedCard?.imageUrl ? <figure className="ua-card-preview">
            <button ref={previewRef} type="button" className="ua-card-zoom" aria-label={`放大查看 ${selectedCard.name} ${selectedCard.number}`} aria-haspopup="dialog" onClick={() => setZoomCard(selectedCard)}><img src={selectedCard.imageUrl} alt="" /></button>
            <figcaption><strong>{selectedCard.name}</strong><small>{selectedCard.number} · {selectedCard.rarity} · {selectedCard.parallelIds.length} 种异图{selectedCard.ipId ? ` · ${ipName(selectedCard.ipId)}` : ""}</small></figcaption>
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
    {inviteRole && state ? <InviteDialog game="arknights" roomCode={state.roomCode} role={inviteRole} onClose={() => setInviteRole(null)} /> : null}
    {zoomCard?.imageUrl ? <CardLightbox src={zoomCard.imageUrl} label={zoomCard.name} alt={`${zoomCard.name} ${zoomCard.number}`} compact={compact} getOrigin={() => previewRef.current?.getBoundingClientRect() ?? null} getReturnFocus={() => previewRef.current} onClose={() => setZoomCard(null)} /> : null}
    {controller.lightbox}
  </div>;
}
