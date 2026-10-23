import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ActionAck,
  ClientToServerEvents,
  ServerToClientEvents,
  UnionArenaLifeCard,
  UnionArenaPlayer,
  UnionArenaRoomState
} from "../shared/protocol.ts";
import { CardLightbox } from "./CardLightbox.tsx";
import "./arknights.css";

type UnionSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
interface Account { id: string; username: string; avatarUrl: string | null; }
interface CardRecord { id: string; number: string; name: string; rarity: string; file: string; sourceMaterialCode: string; parallelIds: string[]; imageAvailable: boolean; imageUrl: string | null; }

/** Deck rules from the rule manual ("Decks"): exactly 50 cards plus three AP cards, one source material code, at most four copies per card number. */
const DECK_SIZE = 50;
const AP_COUNT = 3;
const MAX_COPIES = 4;

/** Server error codes (the ack's `code`) in plain words. */
const ERROR_TEXT: Readonly<Record<string, string>> = {
  ALREADY_IN_ROOM: "你已经在一个房间里了。",
  ROOM_NOT_FOUND: "找不到这个房间。",
  ROOM_FULL: "房间已满。",
  GAME_IN_PROGRESS: "这个房间的对局已经开始。",
  NO_ACTIVE_ROOM: "没有可恢复的房间。",
  NOT_IN_ROOM: "你不在房间里。",
  GAME_ALREADY_STARTED: "对局已经开始。",
  INVALID_DECK: "牌组数据无效。",
  INVALID_AP_COUNT: "AP 卡数量无效。",
  DECK_INCOMPLETE: "请先提交合法的牌组。",
  HOST_ONLY: "只有房主可以开始游戏。",
  NOT_ENOUGH_PLAYERS: "需要两名在线玩家才能开始。",
  DECKS_NOT_READY: "双方都要提交合法牌组并准备好。",
  NOT_MULLIGAN_STEP: "现在不是换牌阶段。",
  NOT_YOUR_MULLIGAN: "还没轮到你决定是否换牌。",
  AUTH_REQUIRED: "登录状态已失效，请返回重新登录。"
};
const errorText = (result: ActionAck<unknown> | null, fallback: string): string => (result?.code && ERROR_TEXT[result.code]) || result?.message || fallback;

const tokenKey = "uno.accountToken";

/** Maximum cards per zone, from the official playmat. */
const ZONE_LIMITS = { front: 4, energy: 4, actionPoints: 3 } as const;
const PHASES = ["起始阶段", "移动阶段", "主要阶段", "攻击阶段", "结束阶段", "对方的回合"] as const;
const PHASE_MARKS = ["①", "②", "③", "④", "⑤", "⑥"] as const;
/** Two-character labels for pills too narrow for the full phase name. */
const PHASE_SHORT = ["起始", "移动", "主要", "攻击", "结束", "对方"] as const;

/** Keyword descriptions, from the rule manual's keyword abilities pages. */
const KEYWORDS: ReadonlyArray<{ name: string; text: string }> = [
  { name: "步进", text: "移动阶段中，可将此卡从前线移到能量线（与能量线移向前线的角色同时进行）。" },
  { name: "瞄准攻击", text: "可指定对手前线的角色（活动或横置均可）进行攻击，对手不能阻挡；被指定的角色不视为阻挡，但仍会进行战斗。" },
  { name: "2次攻击", text: "此角色本回合第一次攻击时，将其变为活动。" },
  { name: "2次阻挡", text: "此角色本回合第一次阻挡时，将其变为活动。" },
  { name: "冲击❶", text: "此角色攻击并赢得战斗时，对对手造成1点伤害。" },
  { name: "伤害❷", text: "此角色攻击并造成直接伤害时，改为造成2点伤害（从对手生命区选2张，同时翻开并确认触发）。" },
  { name: "冲击无效", text: "与此角色战斗的角色，在本次战斗中失去冲击。" },
  { name: "冲击+1", text: "冲击伤害+1；若本来没有冲击，则获得冲击。" },
  { name: "突进", text: "宣告突进并叠放到指定角色上：下方角色的能力失效；若该角色为横置则变为活动；若在能量线可移到前线；然后发动此卡的突进相关能力。" }
];

function emitAck<T>(socket: UnionSocket, event: keyof ClientToServerEvents, payload: unknown): Promise<ActionAck<T>> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve({ ok: false, code: "TIMEOUT", message: "服务器响应超时" }), 5000);
    (socket as unknown as { emit: (name: string, body: unknown, callback: (result: ActionAck<T>) => void) => void })
      .emit(event, payload, (result) => { window.clearTimeout(timer); resolve(result); });
  });
}

/** A player's nameplate. It lives in the bar on the outer edge of that player's half: top for the opponent, bottom for you. */
function Seat({ player, self }: { player?: UnionArenaPlayer; self: boolean }) {
  const status = player ? `${player.connected ? "在线" : "已断线"} · ${player.ready ? "已准备" : "未准备"}` : "空座位";
  return <div className={`ua-seat ${self ? "ua-seat-self" : ""}`} title={player ? `${player.username} · ${status}` : "待玩家加入"}>
    {player
      ? player.avatarUrl ? <img src={player.avatarUrl} alt={`${player.username}的头像`} /> : <span className="ua-avatar-fallback">{player.username.slice(0, 1)}</span>
      : <span className="ua-empty-avatar">+</span>}
    <div className="ua-seat-text"><strong>{player ? player.username : "待玩家加入"}</strong><small>{status}</small></div>
  </div>;
}

interface SlotProps {
  card?: CardRecord;
  /** Rested (horizontal) cards are drawn rotated 90 degrees. */
  rested?: boolean;
  /** No card-back artwork exists yet, so face-down cards are drawn in plain CSS. */
  faceDown?: boolean;
}

function CardSlot({ card, rested = false, faceDown = false }: SlotProps) {
  return <div className="ua-slot" data-rested={rested || undefined}>
    {card
      ? card.imageUrl
        ? <img className="ua-slot-card" src={card.imageUrl} alt={`${card.name} ${card.number}`} draggable={false} />
        : <span className="ua-slot-card ua-slot-name">{card.name}</span>
      : faceDown ? <span className="ua-slot-card ua-card-back" aria-hidden="true" /> : null}
  </div>;
}

function SlotZone({ className, name, count, large = false }: { className: string; name: string; count: number; large?: boolean }) {
  return <div className={`ua-zone ${large ? "ua-zone-large" : ""} ${className}`} style={{ "--n": count } as CSSProperties} role="group" aria-label={name}>
    {Array.from({ length: count }, (_, index) => <CardSlot key={index} />)}
    <span className="ua-zone-name" aria-hidden="true">{name}</span>
  </div>;
}

/** One life card. `card` is absent for a face-down card whose identity this client does not know. */
interface LifeCardEntry { id: string; card?: CardRecord; }
const NO_LIFE: readonly LifeCardEntry[] = [];

/**
 * Life cards lie sideways; the first is on top and each later one peeks out below it (stacking via z-index, data order untouched). One element per entry in `cards`
 * and none when it is empty; the offset is derived in CSS from the entry count and the zone's size.
 */
function LifeZone({ cards }: { cards: readonly LifeCardEntry[] }) {
  return <div className="ua-zone ua-z-life" role="group" aria-label={`生命区，${cards.length} 张`}>
    <span className="ua-life-title" aria-hidden="true">生命区</span>
    <ol className="ua-life-stack" style={{ "--n": cards.length } as CSSProperties}>
      {cards.map((entry, index) => <li className="ua-life-card" key={entry.id} style={{ "--i": index, zIndex: cards.length - index } as CSSProperties} title={entry.card ? `${entry.card.name} ${entry.card.number}` : "生命卡（背面）"}>
        {entry.card
          ? entry.card.imageUrl
            ? <img className="ua-life-art" src={entry.card.imageUrl} alt={`${entry.card.name} ${entry.card.number}`} draggable={false} />
            : <span className="ua-life-art ua-slot-name">{entry.card.name}</span>
          : <span className="ua-card-back" aria-hidden="true" />}
      </li>)}
    </ol>
  </div>;
}

function PhaseBar({ activePhase }: { activePhase?: number }) {
  return <ol className="ua-phases" aria-label="回合阶段">
    {PHASES.map((label, index) => <li key={label} className={`ua-phase ${activePhase === index ? "is-active" : ""}`} title={label} aria-current={activePhase === index ? "step" : undefined}>
      <i aria-hidden="true">{PHASE_MARKS[index]}</i><span className="ua-phase-label">{label}</span><span className="ua-phase-short" aria-hidden="true">{PHASE_SHORT[index]}</span>
    </li>)}
  </ol>;
}

/** The mat's keyword box is tiny, so it lists names and shows the description of the picked one in a bubble. */
function KeywordTable() {
  const [picked, setPicked] = useState<number | null>(null);
  const keyword = picked === null ? null : KEYWORDS[picked];
  return <section className="ua-keywords" aria-label="关键字说明">
    <h3>关键字</h3>
    <ul>
      {KEYWORDS.map((item, index) => <li key={item.name}>
        <button type="button" className="ua-kw" aria-pressed={picked === index} onClick={() => setPicked(picked === index ? null : index)}>{item.name}</button>
      </li>)}
    </ul>
    {keyword ? <div className="ua-kw-bubble" role="note">
      <strong>{keyword.name}</strong>
      <p>{keyword.text}</p>
    </div> : null}
  </section>;
}

/** One player's half of the mat. The opponent's half is the same board rotated 180 degrees. */
function HalfBoard({ side, activePhase, life = NO_LIFE }: { side: "self" | "opponent"; activePhase?: number; life?: readonly LifeCardEntry[] }) {
  const self = side === "self";
  return <div className="ua-half" data-side={side}>
    <SlotZone className="ua-z-front" name="前线" count={ZONE_LIMITS.front} />
    <SlotZone className="ua-z-energy" name="能量线" count={ZONE_LIMITS.energy} />
    <SlotZone className="ua-z-ap" name="行动点区" count={ZONE_LIMITS.actionPoints} />
    <LifeZone cards={life} />
    <SlotZone className="ua-z-deck" name="卡组放置处" count={1} large />
    <PhaseBar activePhase={activePhase} />
    <SlotZone className="ua-z-removal" name="移除区" count={1} large />
    <SlotZone className="ua-z-discard" name="场外" count={1} large />
    {self ? <KeywordTable /> : null}
  </div>;
}

/** Compact = narrow window, short window (phone landscape) or touch-sized screen. Re-evaluated on resize/rotation. */
function useCompactLayout(): boolean {
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
function useViewportVars(): void {
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

export function ArknightsApp({ account, token }: { account: Account; token: string | null }) {
  const [state, setState] = useState<UnionArenaRoomState | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardRecord | null>(null);
  const [cardSearch, setCardSearch] = useState("");
  /** The deck being built: card id -> copies. */
  const [deck, setDeck] = useState<ReadonlyMap<string, number>>(() => new Map());
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
    socket.on("ua:state", setState);
    socket.on("connect_error", (reason) => setError(reason.message === "AUTH_REQUIRED" ? "登录状态已失效，请返回重新登录。" : "无法连接明日方舟对战服务。"));
    socket.connect();
    return () => { socket.disconnect(); socket.removeAllListeners(); };
  }, [socket]);

  useEffect(() => {
    let active = true;
    void fetch("/api/arknights/catalog").then((response) => response.json()).then((data: { cards?: CardRecord[] }) => {
      if (active) setCards(data.cards ?? []);
    }).catch(() => { if (active) setError("卡牌目录暂时无法加载。"); });
    return () => { active = false; };
  }, []);

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
    const result = await action("ua:leave_room", {});
    if (!result?.ok) setError(errorText(result, "离开房间失败"));
    else setState(null);
  };

  const opponent = state?.players.find((player) => player.id !== account.id);
  const me = state?.players.find((player) => player.id === account.id);
  // Life areas come straight from the room state, in the server's order. A null cardId is a face-down card (drawn as a card back);
  // a face-up one is looked up in the catalog (a card missing from it is drawn face down rather than dropped, so the count stays right).
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const toLifeEntries = (life: readonly UnionArenaLifeCard[] | undefined): LifeCardEntry[] =>
    (life ?? []).map((slot) => ({ id: slot.id, card: slot.cardId ? cardsById.get(slot.cardId) : undefined }));
  const selfLife = useMemo(() => toLifeEntries(state?.life.you), [state?.life.you, cardsById]);
  const opponentLife = useMemo(() => toLifeEntries(state?.life.opponent), [state?.life.opponent, cardsById]);
  const visibleCards = cards.filter((card) => `${card.number} ${card.name}`.toLocaleLowerCase().includes(cardSearch.trim().toLocaleLowerCase()));

  // Deck builder. The server checks the same rules and has the last word; these only keep the buttons honest.
  const deckKey = [...deck].filter(([, copies]) => copies > 0).map(([id, copies]) => `${id}x${copies}`).sort().join(",");
  const deckTotal = [...deck.values()].reduce((sum, copies) => sum + copies, 0);
  const deckNumberCopies = new Map<string, number>();
  let deckSource: string | null = null;
  for (const [id, copies] of deck) {
    const card = cardsById.get(id);
    if (!card || copies <= 0) continue;
    deckNumberCopies.set(card.number, (deckNumberCopies.get(card.number) ?? 0) + copies);
    deckSource ??= card.sourceMaterialCode;
  }
  const canAdd = (card: CardRecord): boolean =>
    card.imageAvailable && deckTotal < DECK_SIZE && (deckNumberCopies.get(card.number) ?? 0) < MAX_COPIES && (deckSource === null || deckSource === card.sourceMaterialCode);
  const setCopies = (card: CardRecord, copies: number): void => {
    const next = new Map(deck);
    if (copies > 0) next.set(card.id, copies); else next.delete(card.id);
    setDeck(next);
  };
  /** Tops the deck up to 50 with four copies of each card number in catalog order, from the deck's work (or the picked card's, else the first card's). */
  const quickFill = (): void => {
    const source = deckSource ?? selectedCard?.sourceMaterialCode ?? cards.find((card) => card.imageAvailable)?.sourceMaterialCode;
    if (!source) return;
    const next = new Map(deck);
    const numbers = new Map(deckNumberCopies);
    let total = deckTotal;
    for (const card of cards) {
      if (total >= DECK_SIZE) break;
      if (!card.imageAvailable || card.sourceMaterialCode !== source) continue;
      const have = numbers.get(card.number) ?? 0;
      const add = Math.min(MAX_COPIES - have, DECK_SIZE - total);
      if (add <= 0) continue;
      next.set(card.id, (next.get(card.id) ?? 0) + add);
      numbers.set(card.number, have + add);
      total += add;
    }
    setDeck(next);
  };
  const submitDeck = async (): Promise<void> => {
    const cardIds = [...deck].flatMap(([id, copies]) => Array<string>(copies).fill(id));
    const result = await action<{ structuralOk: boolean; issues: string[] }>("ua:submit_deck", { cardIds, apCount: AP_COUNT });
    if (!result?.ok) { setError(errorText(result, "提交牌组失败")); return; }
    setDeckIssues(result.data?.issues ?? []);
    setSubmittedKey(result.data?.structuralOk ? deckKey : null);
  };
  const deckSubmitted = submittedKey !== null && submittedKey === deckKey && deckTotal === DECK_SIZE;
  const deckEditable = state?.phase === "lobby";

  const game = state?.game ?? null;
  const nameOf = (playerId: string | null | undefined): string => state?.players.find((player) => player.id === playerId)?.username ?? "";
  // When it is your turn to decide on the mulligan, bring the tools panel (where the choice lives) up.
  const needsMulligan = game?.mulliganPlayerId === account.id;
  useEffect(() => { if (needsMulligan) setPanelOpen(true); }, [needsMulligan]);
  const gameStatus = !game ? "" : game.step === "mulligan"
    ? (needsMulligan ? "换牌阶段：轮到你选择" : `换牌阶段：等待 ${nameOf(game.mulliganPlayerId)}`)
    : `第 ${game.turn} 回合 · ${game.turnPlayerId === account.id ? "你的回合" : `${nameOf(game.turnPlayerId)} 的回合`}`;
  return <div className="ua-app" data-compact={compact}>
    <header className="ua-header" inert={zoomCard !== null}>
      <button className="ua-back" onClick={() => window.location.assign("/")}>返回大厅</button>
      <div className="ua-roominfo">{state ? <span className="ua-roominfo-main">房间 <strong>{state.roomCode}</strong> · {state.playerCount}/{state.requiredPlayers} 人{gameStatus ? ` · ${gameStatus}` : ""}</span> : <span>未加入房间</span>}{error ? <span className="ua-roominfo-error" role="alert">{error}</span> : null}</div>
      <div className="ua-header-end">
        <button ref={toggleRef} type="button" className="ua-toggle" aria-expanded={panelVisible} aria-controls="ua-panel" aria-label={compact ? "打开工具面板" : panelVisible ? "收起侧栏" : "展开侧栏"} onClick={togglePanel}>{compact ? "工具" : panelVisible ? "侧栏 ›" : "‹ 侧栏"}</button>
        <div className="ua-account" title={account.username}>{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : null}<span>{account.username}</span></div>
      </div>
    </header>
    <main className="ua-main" data-panel-open={panelVisible} inert={zoomCard !== null}>
      <div className="ua-stage">
        <div className="ua-table-wrapper">
          <section className="ua-table" aria-label="明日方舟 UNION ARENA 对战桌面">
            <span className="ua-centerline" aria-hidden="true" />
            <div className="ua-seatbar" data-side="opponent"><Seat player={opponent} self={false} /></div>
            <HalfBoard side="opponent" life={opponentLife} />
            <HalfBoard side="self" life={selfLife} />
            <div className="ua-seatbar" data-side="self"><Seat player={me} self /></div>
          </section>
        </div>
      </div>
      {compact ? <div className="ua-backdrop" data-open={panelVisible} onClick={() => setPanelOpen(false)} aria-hidden="true" /> : null}
      <div className="ua-dock" data-open={panelVisible}>
      <aside ref={panelRef} id="ua-panel" className="ua-panel" data-open={panelVisible} inert={!panelVisible} aria-hidden={!panelVisible} aria-label="房间与卡牌目录">
        <div className="ua-panel-head"><strong>房间 · 卡牌目录</strong><button ref={closeRef} type="button" className="ua-secondary ua-panel-close" aria-label="关闭工具面板" onClick={() => setPanelOpen(false)}>关闭</button></div>
        <div className="ua-status"><span>玩家人数</span><strong>{state?.playerCount ?? 0}/{state?.requiredPlayers ?? 2}</strong></div>
        {!state ? <div className="ua-room-actions"><button className="ua-primary" disabled={busy} onClick={() => void createRoom()}>创建对战房间</button><label htmlFor="ua-room-code">房间号</label><input id="ua-room-code" value={roomCode} maxLength={6} onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} placeholder="输入 6 位房间号" /><button className="ua-secondary" disabled={busy || roomCode.length !== 6} onClick={() => void joinRoom()}>加入房间</button></div> : <div className="ua-room-actions"><p>房间号 <strong>{state.roomCode}</strong></p>{deckEditable ? <button className="ua-secondary" disabled={busy || (!state.you.ready && !deckSubmitted)} onClick={() => void toggleReady()}>{state.you.ready ? "取消准备" : "准备"}</button> : null}{state.you.isHost && deckEditable ? <button className="ua-primary" disabled={busy || !state.startAllowed} onClick={() => void startGame()}>开始游戏</button> : null}<button className="ua-secondary" disabled={busy} onClick={() => void leaveRoom()}>离开房间</button></div>}
        {state && deckEditable && !state.startAllowed ? <p className="ua-hint">需要两名在线玩家各自提交合法牌组并准备，房主才能开始。</p> : null}
        {error ? <p className="ua-error" role="alert">{error}</p> : null}
        {state && deckEditable ? <section className="ua-deck" aria-labelledby="ua-deck-heading">
          <div className="ua-deck-head"><h2 id="ua-deck-heading">我的牌组</h2><span>{deckTotal}/{DECK_SIZE} 张 · AP {AP_COUNT}/{AP_COUNT}</span></div>
          <p className="ua-hint">在下方卡牌目录用 ＋ 选卡：主牌组 {DECK_SIZE} 张，同卡号最多 {MAX_COPIES} 张，只能用同一作品代码（当前：{deckSource ?? "未定"}）。AP 卡固定 {AP_COUNT} 张，无需选择。</p>
          <div className="ua-deck-actions">
            <button type="button" className="ua-secondary" disabled={busy || deckTotal >= DECK_SIZE || !cards.length} onClick={quickFill}>快速组牌</button>
            <button type="button" className="ua-secondary" disabled={busy || deckTotal === 0} onClick={() => { setDeck(new Map()); setSubmittedKey(null); setDeckIssues([]); }}>清空</button>
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
              return <li key={`${cardId}-${index}`} title={card ? `${card.name} ${card.number}` : "手牌"}>{card?.imageUrl ? <img src={card.imageUrl} alt={`${card.name} ${card.number}`} draggable={false} /> : <span className="ua-card-missing">?</span>}</li>;
            })}
          </ul>
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
                {deckEditable ? <span className="ua-stepper">
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
    {zoomCard?.imageUrl ? <CardLightbox src={zoomCard.imageUrl} label={zoomCard.name} alt={`${zoomCard.name} ${zoomCard.number}`} compact={compact} getOrigin={() => previewRef.current?.getBoundingClientRect() ?? null} getReturnFocus={() => previewRef.current} onClose={() => setZoomCard(null)} /> : null}
  </div>;
}
