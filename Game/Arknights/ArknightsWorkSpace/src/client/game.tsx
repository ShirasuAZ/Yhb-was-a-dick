import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { UnionArenaAction, UnionArenaFieldCard, UnionArenaRoomState } from "../shared/protocol.ts";
import { bpOf, damageOf, energyOf, GRANTABLE_KEYWORDS, hasKeyword, LINE_LIMIT, raidTargetMatches, triggerNeeds, type EngineContext } from "../shared/engine.ts";
import { CardLightbox } from "./CardLightbox.tsx";
import { cardKey, type BoardInteraction } from "./board.tsx";
import { COLOR_NAME, TYPE_NAME, type CardRecord } from "./cards.ts";
import { clearDropMarks, markDrops, startGesture, type DropInfo } from "./gestures.ts";

const NO_DROPS: ReadonlyMap<string, DropInfo> = new Map();

/** Confirm / cancel buttons floating above the card being moved (below it when there is no room above). */
function MoveBubble({ anchorKey, count, blocked, busy, onConfirm, onCancel }: { anchorKey: string; count: number; blocked: boolean; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const [, setTick] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    const place = (): void => {
      const element = document.querySelector<HTMLElement>(`[data-ghost="${anchorKey}"]`);
      if (!element) { setPos(null); return; }
      const rect = element.getBoundingClientRect();
      const below = rect.top < 56;
      setPos({ x: Math.min(Math.max(rect.left + rect.width / 2, 90), window.innerWidth - 90), y: below ? rect.bottom + 6 : rect.top - 6, below });
    };
    place();
    const again = (): void => { place(); setTick((tick) => tick + 1); };
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    return () => { window.removeEventListener("resize", again); window.removeEventListener("scroll", again, true); };
  }, [anchorKey, count]);
  if (!pos) return null;
  // Rendered at the page root (next to the lightbox), so `position: fixed` is relative to the screen.
  return <div className="ua-move-bubble" role="group" aria-label="确认移动" data-below={pos.below || undefined} style={{ left: pos.x, top: pos.y }}>
    <button type="button" className="ua-primary" disabled={busy || blocked || count === 0} onClick={onConfirm}>确认移动（{count}）</button>
    <button type="button" className="ua-secondary" disabled={busy} onClick={onCancel}>取消</button>
  </div>;
}

/** A group of cards the lightbox browses with its "<" and ">" buttons. */
export type CardGroup =
  | { kind: "hand" }
  | { kind: "line"; owner: "you" | "opponent"; line: "front" | "energy" }
  | { kind: "pile"; owner: "you" | "opponent"; pile: "sideline" | "removal" }
  | { kind: "revealed" };

interface Choice { label: string; run: () => void; }
/** A question the table is asking right now: pick one of `keys` on the table, or press one of `options`. */
interface Ask { prompt: string; keys: string[]; onPick?: (key: string) => void; options?: Choice[]; }

export interface GameControllerProps {
  state: UnionArenaRoomState | null;
  meId: string;
  cardsById: ReadonlyMap<string, CardRecord>;
  ctx: EngineContext;
  compact: boolean;
  busy: boolean;
  /** Sends one action; resolves to an error message, or null when it was accepted. */
  send: (action: UnionArenaAction) => Promise<string | null>;
  onMulligan?: (redraw: boolean) => void;
  /** Shown once the game is over. */
  overButton?: { label: string; run: () => void };
}

const LINE_NAME = { front: "前线", energy: "能量线" } as const;
const PHASE_INDEX = { start: 0, movement: 1, main: 2, attack: 3, end: 4 } as const;
const PHASE_NAME = { start: "起始阶段", movement: "移动阶段", main: "主要阶段", attack: "攻击阶段", end: "结束阶段" } as const;
const uidOf = (key: string): string => key.slice(2);

export function useGameController({ state, meId, cardsById, ctx, compact, busy, send, onMulligan, overButton }: GameControllerProps) {
  const game = state?.game ?? null;
  const board = game?.board;
  const pending = game?.pending ?? null;
  const myPending = pending && pending.playerId === meId ? pending : null;
  const playing = game?.step === "turn";
  const myTurn = playing && game?.turnPlayerId === meId;
  const free = myTurn && !pending;
  const hand = state?.hand ?? [];
  const nameOf = (id: string | null | undefined): string => state?.players.find((player) => player.id === id)?.username ?? "";
  const opponentName = state?.players.find((player) => player.id !== meId)?.username ?? "对手";

  const [ask, setAsk] = useState<Ask | null>(null);
  const [notice, setNotice] = useState("");
  const [moveSel, setMoveSel] = useState<{ toFront: string[]; toEnergy: string[]; remove: string[] }>({ toFront: [], toEnergy: [], remove: [] });
  /** The card the player touched last during the movement phase: the confirm bubble floats above it. */
  const [moveAnchor, setMoveAnchor] = useState<string | null>(null);
  const [lifePicked, setLifePicked] = useState<string[]>([]);
  const [keepPicked, setKeepPicked] = useState<number[]>([]);
  const [choicePicked, setChoicePicked] = useState<string[]>([]);
  const [triggerFocus, setTriggerFocus] = useState<string | null>(null);
  const [view, setView] = useState<{ group: CardGroup; index: number } | null>(null);
  /** The card a click has picked up: its drop zones light up and a click on one of them does the move, like a drag would. */
  const [armed, setArmed] = useState<string | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const swallowRef = useRef(false);

  // Every new decision starts clean.
  const pendingKey = `${game?.turn}:${game?.phase}:${pending?.kind}:${pending?.playerId}:${pending?.kind === "triggers" ? pending.revealed.length : ""}:${pending?.kind === "choose" ? `${pending.prompt}|${pending.options.join(",")}` : ""}`;
  useEffect(() => { setAsk(null); setArmed(null); setMoveAnchor(null); setMoveSel({ toFront: [], toEnergy: [], remove: [] }); setLifePicked([]); setKeepPicked([]); setChoicePicked([]); setTriggerFocus(null); }, [pendingKey]);
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(""), 4000); return () => window.clearTimeout(timer); } return undefined; }, [notice]);

  const run = async (action: UnionArenaAction): Promise<boolean> => {
    const error = await send(action);
    if (error) { setNotice(error); return false; }
    setAsk(null);
    setArmed(null);
    setNotice("");
    return true;
  };

  const stats = (cardId: string) => ctx.card(cardId);
  const mine = board?.you;
  const theirs = board?.opponent;
  const findField = (uid: string): { owner: "you" | "opponent"; line: "front" | "energy"; card: UnionArenaFieldCard } | null => {
    for (const owner of ["you", "opponent"] as const) for (const line of ["front", "energy"] as const) {
      const card = board?.[owner][line].find((entry) => entry.uid === uid);
      if (card) return { owner, line, card };
    }
    return null;
  };

  /** Asks for a card of a full line to put into the removal area, then continues with it. */
  const withRoom = (line: "front" | "energy", cards: readonly UnionArenaFieldCard[], then: (remove?: string) => void, exclude: string[] = []): void => {
    const free = cards.filter((card) => !exclude.includes(card.uid));
    if (cards.length - exclude.length < LINE_LIMIT) { then(); return; }
    setAsk({ prompt: `${LINE_NAME[line]}已满：选择 1 张置于移除区`, keys: free.map((card) => cardKey.field(card.uid)), onPick: (key) => then(uidOf(key)), options: [{ label: "取消", run: () => setAsk(null) }] });
  };

  const closeView = (): void => setView(null);
  const playTo = (handIndex: number, line: "front" | "energy"): void => {
    closeView();
    withRoom(line, mine?.[line] ?? [], (remove) => void run({ type: "play", handIndex, line, remove }));
  };
  /** After a Raid target is chosen: a character on the energy line may move to the front line. */
  const raidOnto = (targetUid: string, finish: (target: { targetUid: string; toFront?: boolean; remove?: string }) => unknown): void => {
    const onEnergy = mine?.energy.some((card) => card.uid === targetUid);
    if (!onEnergy) { void finish({ targetUid }); return; }
    setAsk({ prompt: "突进后，这张角色可以移动至前线", keys: [], options: [
      { label: "移动至前线", run: () => withRoom("front", mine?.front ?? [], (remove) => void finish({ targetUid, toFront: true, remove })) },
      { label: "留在能量线", run: () => void finish({ targetUid, toFront: false }) }
    ] });
  };
  const startAttack = (uid: string, snipe: boolean): void => {
    closeView();
    if (!snipe) { void run({ type: "attack", attackerUid: uid }); return; }
    setAsk({ prompt: "选择对手前线中要攻击的角色", keys: (theirs?.front ?? []).map((card) => cardKey.field(card.uid)), onPick: (key) => void run({ type: "attack", attackerUid: uid, targetUid: uidOf(key) }), options: [{ label: "取消", run: () => setAsk(null) }] });
  };

  // ---- Movement phase: pick characters to move, simultaneously. ----
  const moving = free && game?.phase === "movement";
  const frontAfter = (mine?.front.length ?? 0) - moveSel.toEnergy.length + moveSel.toFront.length - moveSel.remove.filter((uid) => mine?.front.some((card) => card.uid === uid)).length;
  const energyAfter = (mine?.energy.length ?? 0) - moveSel.toFront.length + moveSel.toEnergy.length - moveSel.remove.filter((uid) => mine?.energy.some((card) => card.uid === uid)).length;
  const frontOver = Math.max(0, frontAfter - LINE_LIMIT);
  const energyOver = Math.max(0, energyAfter - LINE_LIMIT);
  const moveCandidates = (): string[] => {
    if (!mine) return [];
    const keys = [
      ...mine.energy.filter((card) => stats(card.cardId)?.type === "character" && !moveSel.remove.includes(card.uid)).map((card) => card.uid),
      ...mine.front.filter((card) => hasKeyword(ctx, card, "撤步") && !moveSel.remove.includes(card.uid)).map((card) => card.uid)
    ];
    if (frontOver || moveSel.remove.some((uid) => mine.front.some((card) => card.uid === uid))) keys.push(...mine.front.filter((card) => !moveSel.toEnergy.includes(card.uid)).map((card) => card.uid));
    if (energyOver || moveSel.remove.some((uid) => mine.energy.some((card) => card.uid === uid))) keys.push(...mine.energy.filter((card) => !moveSel.toFront.includes(card.uid)).map((card) => card.uid));
    return [...new Set(keys)].map(cardKey.field);
  };
  const toggleMove = (uid: string): void => {
    if (!mine) return;
    setMoveAnchor(uid);
    const toggle = (list: string[]): string[] => list.includes(uid) ? list.filter((entry) => entry !== uid) : [...list, uid];
    const onFront = mine.front.some((card) => card.uid === uid);
    if (moveSel.remove.includes(uid)) { setMoveSel({ ...moveSel, remove: toggle(moveSel.remove) }); return; }
    if (onFront) {
      if (moveSel.toEnergy.includes(uid)) setMoveSel({ ...moveSel, toEnergy: toggle(moveSel.toEnergy) });
      else if (frontOver) setMoveSel({ ...moveSel, remove: toggle(moveSel.remove) });
      else if (hasKeyword(ctx, mine.front.find((card) => card.uid === uid)!, "撤步")) setMoveSel({ ...moveSel, toEnergy: toggle(moveSel.toEnergy) });
    } else {
      if (moveSel.toFront.includes(uid)) setMoveSel({ ...moveSel, toFront: toggle(moveSel.toFront) });
      else if (energyOver) setMoveSel({ ...moveSel, remove: toggle(moveSel.remove) });
      else setMoveSel({ ...moveSel, toFront: toggle(moveSel.toFront) });
    }
  };

  // ---- Pending decisions. ----
  const blockKeys = myPending?.kind === "block" ? (mine?.front ?? []).filter((card) => !card.rested && stats(card.cardId)?.type === "character").map((card) => cardKey.field(card.uid)) : [];
  const damageKeys = myPending?.kind === "damage" ? (state?.life.opponent ?? []).map((slot) => cardKey.life(slot.id)) : [];
  const keepKeys = myPending?.kind === "discard" ? hand.map((_, index) => cardKey.hand(index)) : [];
  const revealed = pending?.kind === "triggers" ? pending.revealed : [];
  const focusedLife = myPending?.kind === "triggers" ? (revealed.find((slot) => slot.id === triggerFocus) ?? revealed[0] ?? null) : null;

  const resolveTrigger = (activate: boolean): void => {
    if (!focusedLife || myPending?.kind !== "triggers" || !mine || !theirs) return;
    const lifeId = focusedLife.id;
    const cardId = focusedLife.cardId!;
    const card = stats(cardId);
    if (!activate || !card?.trigger) { void run({ type: "trigger", lifeId, activate: false }); return; }
    const needs = triggerNeeds(ctx, mine, theirs, cardId);
    const label = card.trigger.label;
    if (label === "突进") {
      setAsk({ prompt: "【突进】触发：把这张卡加入手牌，或在满足所需能量时进行突进（不支付 AP）", keys: [], options: [
        { label: "加入手牌", run: () => void run({ type: "trigger", lifeId, activate: true }) },
        ...(needs.raidTargets.length ? [{ label: "进行突进", run: () => setAsk({ prompt: "选择突进的目标", keys: needs.raidTargets.map(cardKey.field), onPick: (key: string) => raidOnto(uidOf(key), (raid) => run({ type: "trigger", lifeId, activate: true, raid })) }) }] : [])
      ] });
      return;
    }
    if (needs.sideline.length) {
      setAsk({ prompt: "选择要从场外登场到前线的角色", keys: [], options: needs.sideline.map((index) => ({
        label: cardsById.get(mine.sideline[index]!)?.name ?? "卡牌",
        run: () => withRoom("front", mine.front, (remove) => void run({ type: "trigger", lifeId, activate: true, sidelineIndex: index, remove }))
      })) });
      return;
    }
    if (needs.targets.length) {
      const whose = label === "激活" ? "我方场上" : "对手前线中";
      setAsk({ prompt: `【${label}】选择${whose}的 1 张角色`, keys: needs.targets.map(cardKey.field), onPick: (key) => void run({ type: "trigger", lifeId, activate: true, targetUid: uidOf(key) }), options: [{ label: "取消", run: () => setAsk(null) }] });
      return;
    }
    void run({ type: "trigger", lifeId, activate: true });
  };

  // ---- A card ability's choice: field cards and hand cards are picked on the table, other options with buttons. ----
  const myChoice = myPending?.kind === "choose" ? myPending : null;
  // Hand cards ("h:<index>") and field cards (their uid) are on the table; looked-at cards, sideline cards, AP cards, modes and lines are buttons.
  const onBoard = (option: string): boolean => option.startsWith("h:") || findField(option) !== null;
  const optionKey = (option: string): string => (option.startsWith("h:") ? option : cardKey.field(option));
  const choiceKeys = myChoice ? myChoice.options.filter(onBoard).map(optionKey) : [];
  const pickOption = (option: string): void => {
    if (!myChoice) return;
    if (myChoice.max === 1 && myChoice.min === 1) { void run({ type: "choose", picks: [option] }); return; }
    setChoicePicked(choicePicked.includes(option) ? choicePicked.filter((entry) => entry !== option) : choicePicked.length < myChoice.max ? [...choicePicked, option] : choicePicked);
  };

  // ---- What the table highlights and what a click does. ----
  const candidates: string[] = ask ? ask.keys
    : myChoice ? choiceKeys
    : moving ? moveCandidates()
    : myPending?.kind === "block" ? blockKeys
    : myPending?.kind === "damage" ? damageKeys
    : myPending?.kind === "discard" ? keepKeys
    : [];
  const selected: string[] = myChoice ? choicePicked.filter(onBoard).map(optionKey)
    : moving ? [...moveSel.toFront, ...moveSel.toEnergy, ...moveSel.remove].map(cardKey.field)
    : myPending?.kind === "damage" ? lifePicked.map(cardKey.life)
    : myPending?.kind === "discard" ? keepPicked.map(cardKey.hand)
    : [];

  const groupFor = (key: string): { group: CardGroup; index: number } | null => {
    if (key.startsWith("h:")) return { group: { kind: "hand" }, index: Number(key.slice(2)) };
    if (key.startsWith("f:")) {
      const found = findField(uidOf(key));
      if (!found) return null;
      return { group: { kind: "line", owner: found.owner, line: found.line }, index: board![found.owner][found.line].indexOf(found.card) };
    }
    if (key.startsWith("p:")) {
      const [, owner, pile] = key.split(":") as [string, "you" | "opponent", "sideline" | "removal"];
      const length = board?.[owner][pile].length ?? 0;
      return length ? { group: { kind: "pile", owner, pile }, index: length - 1 } : null;
    }
    return null;
  };

  const openCard = (key: string, element: HTMLElement | null): void => {
    const target = groupFor(key);
    if (!target) return;
    originRef.current = element;
    setView(target);
  };

  // ---- Drag and drop. A card is dragged to the zone that does the thing; a click picks it up and a click on a lit zone drops it. ----
  const mainPhase = free && game?.phase === "main";
  /** Why a hand card cannot be played right now, or "" when it can. */
  const playBlock = (handIndex: number): string => {
    const info = cardsById.get(hand[handIndex] ?? "")?.stats;
    if (!info || !mine || !game) return "缺少这张卡的卡面数据，无法使用";
    if (game.phase !== "main") return "卡牌只能在主要阶段使用";
    const cost = game.handCosts?.[handIndex] ?? { energy: info.energyCost, ap: info.apCost };
    const energy = energyOf(ctx, mine, info.color);
    const activeAp = mine.ap.filter((card) => !card.rested).length;
    if (energy < cost.energy) return `能量不足（需要${COLOR_NAME[info.color] ?? info.color} ${cost.energy}，当前 ${energy}）`;
    if (activeAp < cost.ap) return `AP 不足（需要 ${cost.ap}，活跃 ${activeAp}）`;
    return "";
  };
  const dropTargets = (key: string): ReadonlyMap<string, DropInfo> => {
    const out = new Map<string, DropInfo>();
    if (busy || !game || game.step !== "turn" || ask || pending || !mine || !theirs) return out;
    if (candidates.length > 0 && !moving) return out;
    if (key.startsWith("h:")) {
      const handIndex = Number(key.slice(2));
      const info = cardsById.get(hand[handIndex] ?? "")?.stats;
      const block = mainPhase ? playBlock(handIndex) : free ? "卡牌只能在主要阶段使用" : "";
      if (free && info) {
        if (info.type === "character") {
          out.set("you:front", { blocked: block || undefined });
          out.set("you:energy", { blocked: block || undefined });
          if (info.raid) for (const card of [...mine.front, ...mine.energy]) if (raidTargetMatches(ctx, info, card)) out.set(cardKey.field(card.uid), { blocked: block || undefined });
        } else if (info.type === "site") out.set("you:energy", { blocked: block || undefined });
        else out.set("you:sideline", { blocked: block || undefined });
      }
      if (!out.has("you:sideline")) out.set("you:sideline", {});
      out.set("you:removal", {});
      return out;
    }
    if (key.startsWith("f:")) {
      const found = findField(uidOf(key));
      if (!found) return out;
      const { owner, line, card } = found;
      // The opponent's cards are never dragged: moving them by hand (to resolve a printed effect) stays in the long-press detail view.
      if (owner !== "you") return out;
      const info = cardsById.get(card.cardId)?.stats;
      if (moving && !pending) {
        if (line === "energy" && info?.type === "character" && !moveSel.toFront.includes(card.uid)) out.set("you:front", {});
        if (line === "front" && hasKeyword(ctx, card, "撤步") && !moveSel.toEnergy.includes(card.uid)) out.set("you:energy", {});
      }
      if (free && game.phase === "attack" && line === "front" && !card.rested && info?.type === "character") {
        out.set("opp:front", {});
        if (hasKeyword(ctx, card, "瞄准攻击")) for (const target of theirs.front) out.set(cardKey.field(target.uid), {});
      }
      out.set("you:sideline", {});
      out.set("you:removal", {});
      out.set("hand", {});
      return out;
    }
    if (key === cardKey.pile("you", "sideline") && mine.sideline.length) out.set("hand", {});
    return out;
  };
  const drop = (key: string, target: string): void => {
    const info = dropTargets(key).get(target);
    if (!info || busy) return;
    if (info.blocked) { setNotice(info.blocked); return; }
    setArmed(null);
    closeView();
    if (key.startsWith("h:")) {
      const handIndex = Number(key.slice(2));
      const card = cardsById.get(hand[handIndex] ?? "")?.stats;
      if (target === "you:front" || target === "you:energy") { playTo(handIndex, target === "you:front" ? "front" : "energy"); return; }
      if (target.startsWith("f:")) {
        const raider = card;
        if (raider) raidOnto(uidOf(target), (raid) => run({ type: "raid", handIndex, ...raid }));
        return;
      }
      if (target === "you:sideline") { void run(card && card.type === "event" && free ? { type: "event", handIndex } : { type: "manual", manual: { op: "hand", handIndex, act: "sideline" } }); return; }
      if (target === "you:removal") void run({ type: "manual", manual: { op: "hand", handIndex, act: "removal" } });
      return;
    }
    if (key.startsWith("f:")) {
      const uid = uidOf(key);
      const found = findField(uid);
      if (!found) return;
      if (target === "opp:front") { startAttack(uid, false); return; }
      if (target.startsWith("f:")) { void run({ type: "attack", attackerUid: uid, targetUid: uidOf(target) }); return; }
      if (found.owner === "you" && moving) {
        if (target === "you:front") { setMoveSel({ ...moveSel, toFront: [...moveSel.toFront, uid] }); setMoveAnchor(uid); return; }
        if (target === "you:energy") { setMoveSel({ ...moveSel, toEnergy: [...moveSel.toEnergy, uid] }); setMoveAnchor(uid); return; }
      }
      const act = target.endsWith(":sideline") ? "sideline" : target.endsWith(":removal") ? "removal" : "hand";
      void run({ type: "manual", manual: { op: "field", owner: found.owner, uid, act } });
      return;
    }
    if (key === cardKey.pile("you", "sideline") && target === "hand") void run({ type: "manual", manual: { op: "sideline_to_hand", index: (mine?.sideline.length ?? 1) - 1 } });
  };
  const armedTargets = armed ? dropTargets(armed) : NO_DROPS;
  const armedActive = armed !== null && armedTargets.size > 0;
  // Light up where the picked-up card can go, and mark the card itself.
  useEffect(() => {
    clearDropMarks();
    for (const element of document.querySelectorAll("[data-armed]")) element.removeAttribute("data-armed");
    if (!armedActive || !armed) return;
    markDrops(armedTargets);
    document.querySelector(`[data-card-key="${armed}"]`)?.setAttribute("data-armed", "");
  });
  useEffect(() => {
    if (!armed) return undefined;
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape" && !document.querySelector(".ua-lb")) setArmed(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  /** A click on a card; true when it did something, so the click does not also count for the zone around it. */
  const onCard = (key: string, element: HTMLElement): boolean => {
    if (swallowRef.current) { swallowRef.current = false; return true; }
    if (busy) return true;
    if (ask) {
      if (ask.keys.includes(key) && ask.onPick) ask.onPick(key);
      return true;
    }
    if (myChoice && choiceKeys.includes(key)) { pickOption(key.startsWith("f:") ? uidOf(key) : key); return true; }
    if (moving && candidates.includes(key) && key.startsWith("f:")) { toggleMove(uidOf(key)); return true; }
    if (myPending?.kind === "block" && blockKeys.includes(key)) { void run({ type: "block", blockerUid: uidOf(key) }); return true; }
    if (myPending?.kind === "damage" && damageKeys.includes(key)) {
      const id = key.slice(2);
      setLifePicked(lifePicked.includes(id) ? lifePicked.filter((entry) => entry !== id) : lifePicked.length < myPending.amount ? [...lifePicked, id] : lifePicked);
      return true;
    }
    if (myPending?.kind === "discard" && keepKeys.includes(key)) {
      const index = Number(key.slice(2));
      setKeepPicked(keepPicked.includes(index) ? keepPicked.filter((entry) => entry !== index) : keepPicked.length < 8 ? [...keepPicked, index] : keepPicked);
      return true;
    }
    if (armedActive && armed !== key && armedTargets.has(key)) { drop(armed!, key); return true; }
    // A card inside a lit zone counts as a click on that zone.
    const zone = element.closest<HTMLElement>("[data-drop]")?.dataset.drop;
    if (armedActive && armed !== key && zone && armedTargets.has(zone)) { drop(armed!, zone); return true; }
    if (armed === key) { setArmed(null); return true; }
    if (dropTargets(key).size > 0) { setArmed(key); return true; }
    setArmed(null);
    return false;
  };
  const onZone = (id: string): void => {
    if (!armedActive || !armed || !armedTargets.has(id)) return;
    drop(armed, id);
  };
  const gestureHost = {
    targets: dropTargets,
    onDrop: drop,
    onLongPress: (key: string, element: HTMLElement) => { setArmed(null); openCard(key, element); },
    swallowClick: (on: boolean) => { swallowRef.current = on; }
  };
  const interaction: BoardInteraction = {
    ghosts: moving ? { front: moveSel.toFront, energy: moveSel.toEnergy } : undefined,
    onGhost: (uid) => { setMoveSel({ ...moveSel, toFront: moveSel.toFront.filter((entry) => entry !== uid), toEnergy: moveSel.toEnergy.filter((entry) => entry !== uid) }); setMoveAnchor(null); },
    candidates: new Set(candidates), selected: new Set(selected), onCard, onZone, armedTargets: new Set(armedActive ? armedTargets.keys() : []),
    onPress: (event, key) => startGesture(event, key, gestureHost),
    onDetail: (key, element) => { setArmed(null); openCard(key, element); }
  };

  // ---- Cards in the lightbox. ----
  const groupIds = (group: CardGroup): string[] => {
    switch (group.kind) {
      case "hand": return hand;
      case "line": return (board?.[group.owner][group.line] ?? []).map((card) => card.cardId);
      case "pile": return board?.[group.owner][group.pile] ?? [];
      case "revealed": return revealed.map((slot) => slot.cardId ?? "");
    }
  };
  const viewIds = view ? groupIds(view.group) : [];
  const viewIndex = view ? Math.min(view.index, viewIds.length - 1) : -1;
  const viewCard = viewIndex >= 0 ? cardsById.get(viewIds[viewIndex]!) : undefined;
  useEffect(() => { if (view && viewIndex < 0) setView(null); }, [view, viewIndex]);
  const viewKey = (): string | null => {
    if (!view) return null;
    if (view.group.kind === "hand") return cardKey.hand(viewIndex);
    if (view.group.kind === "line") { const card = board?.[view.group.owner][view.group.line][viewIndex]; return card ? cardKey.field(card.uid) : null; }
    if (view.group.kind === "pile") return cardKey.pile(view.group.owner, view.group.pile);
    return null;
  };
  const browse = (step: number): void => {
    if (!view || viewIds.length < 2) return;
    const index = (viewIndex + step + viewIds.length) % viewIds.length;
    setView({ ...view, index });
    const key = view.group.kind === "hand" ? cardKey.hand(index) : view.group.kind === "line" ? cardKey.field(board![view.group.owner][view.group.line][index]!.uid) : null;
    const element = key ? document.querySelector<HTMLElement>(`.ua-table [data-card-key="${key}"]`) : null;
    if (element) originRef.current = element;
  };

  const cardActions = (): ReactNode => {
    if (!view || !viewCard || !game || game.step !== "turn") return null;
    const info = viewCard.stats;
    const key = viewKey();
    const field = key?.startsWith("f:") ? findField(uidOf(key)) : null;
    const parts: ReactNode[] = [];
    if (!info) parts.push(<p key="missing" className="ua-lb-warn">缺少这张卡的卡面数据，无法使用。服务器需要带上 Cards/cards.json（重新构建并部署服务端）。</p>);
    if (info) {
      const bp = field && info.type === "character" ? bpOf(ctx, field.card) : info.bp;
      const textLines = info.abilityText.split("\n").map((line) => line.trim()).filter(Boolean);
      const hasOwnText = textLines.some((line) => !/^《[^》]+》（[^）]*）$/.test(line));
      if (hasOwnText) parts.push(<p key="auto" className={ctx.card(viewCard.id)?.abilities ? "ua-lb-auto" : "ua-lb-manual"}>{ctx.card(viewCard.id)?.abilities ? "卡面能力由引擎自动结算。" : "卡面能力需要用下方「卡牌效果」手动结算。"}</p>);
      parts.push(<p key="info" className="ua-lb-info"><strong>{viewCard.name}</strong> · {TYPE_NAME[info.type]} · 需要{COLOR_NAME[info.color] ?? info.color}能量 {info.energyCost} · AP {info.apCost}{bp !== null ? ` · BP ${bp}` : ""}{field ? ` · ${field.card.rested ? "休息" : "活跃"}` : ""}{info.trigger ? ` · 触发【${info.trigger.label}】` : ""}</p>);
    }
    // Playing, attacking and raiding are done by dragging the card (see dropTargets); the detail view only explains why a play would fail.
    const buttons: ReactNode[] = [];
    if (view.group.kind === "hand" && free && info && !ask) {
      const short = game.phase === "main" ? playBlock(viewIndex) : "卡牌只能在主要阶段使用";
      if (short) parts.push(<p key="short" className="ua-lb-warn">{short}</p>);
      else parts.push(<p key="drag" className="ua-hint">关闭后，把这张卡拖到前线或能量线即可登场。</p>);
    }
    if (field && field.owner === "you" && free && game.phase === "main" && !ask) {
      const activated = (ctx.card(field.card.cardId)?.abilities ?? []).map((ability, index) => ({ ability, index })).filter((entry) => entry.ability.kind === "activated");
      for (const { index } of activated) buttons.push(<button key={`activate-${index}`} type="button" className="ua-primary" disabled={busy} onClick={() => { closeView(); void run({ type: "activate", uid: field.card.uid, ability: index }); }}>发动【启动主要】{activated.length > 1 ? ` ${activated.findIndex((entry) => entry.index === index) + 1}` : ""}</button>);
    }
    if (buttons.length) parts.push(<div key="buttons" className="ua-lb-buttons">{buttons}</div>);
    // Manual operations for printed abilities; the opponent sees each one in the log.
    const manual: ReactNode[] = [];
    const op = (label: string, action: UnionArenaAction, keepOpen = false): ReactNode => <button key={label} type="button" className="ua-secondary" disabled={busy} onClick={() => { if (!keepOpen) closeView(); void run(action); }}>{label}</button>;
    if (field) {
      const owner = field.owner;
      const uid = field.card.uid;
      manual.push(op(field.card.rested ? "转为活跃" : "转为休息", { type: "manual", manual: { op: "field", owner, uid, act: field.card.rested ? "activate" : "rest" } }, true));
      if (info?.type === "character") manual.push(op("BP+1000", { type: "manual", manual: { op: "field", owner, uid, act: "bp+" } }, true), op("BP-1000", { type: "manual", manual: { op: "field", owner, uid, act: "bp-" } }, true));
      if (owner === "you") manual.push(op("能量产出+1", { type: "manual", manual: { op: "field", owner, uid, act: "energy+" } }, true), op("能量产出-1", { type: "manual", manual: { op: "field", owner, uid, act: "energy-" } }, true));
      manual.push(op("退场", { type: "manual", manual: { op: "field", owner, uid, act: "sideline" } }), op("放回手牌", { type: "manual", manual: { op: "field", owner, uid, act: "hand" } }), op("置于移除区", { type: "manual", manual: { op: "field", owner, uid, act: "removal" } }));
      if (info?.type === "character") manual.push(<select key="grant" aria-label="本回合给予关键字" value="" disabled={busy} onChange={(event) => { if (event.target.value) void run({ type: "manual", manual: { op: "grant", owner, uid, keyword: event.target.value } }); }}>
        <option value="">本回合给予关键字…</option>
        {GRANTABLE_KEYWORDS.map((keyword) => <option key={keyword} value={keyword}>{keyword}</option>)}
      </select>);
    } else if (view.group.kind === "hand") {
      manual.push(op("置于场外", { type: "manual", manual: { op: "hand", handIndex: viewIndex, act: "sideline" } }), op("置于移除区", { type: "manual", manual: { op: "hand", handIndex: viewIndex, act: "removal" } }));
    } else if (view.group.kind === "pile" && view.group.owner === "you" && view.group.pile === "sideline") {
      manual.push(op("加入手牌", { type: "manual", manual: { op: "sideline_to_hand", index: viewIndex } }));
    }
    if (manual.length) parts.push(<details key="manual" className="ua-manual"><summary>卡牌效果（按卡面文字手动结算，操作会记入日志）</summary><div className="ua-lb-buttons">{manual}</div></details>);
    return parts.length ? <>{parts}</> : null;
  };

  const viewLabel = (): string => {
    if (!view) return "";
    if (view.group.kind === "hand") return "手牌";
    if (view.group.kind === "line") return `${view.group.owner === "you" ? "我方" : "对方"}${LINE_NAME[view.group.line]}`;
    if (view.group.kind === "pile") return `${view.group.owner === "you" ? "我方" : "对方"}${view.group.pile === "sideline" ? "场外" : "移除区"}`;
    return "翻开的生命卡";
  };
  const moveCount = moveSel.toFront.length + moveSel.toEnergy.length;
  const movers = [...moveSel.toFront, ...moveSel.toEnergy];
  const bubbleAnchor = moving && !ask && moveCount > 0 && !view ? (moveAnchor && movers.includes(moveAnchor) ? moveAnchor : movers[0]!) : null;
  const moveBubble = bubbleAnchor ? <MoveBubble anchorKey={bubbleAnchor} count={moveCount} blocked={frontOver > 0 || energyOver > 0} busy={busy}
    onConfirm={() => void run({ type: "move", ...moveSel })} onCancel={() => { setMoveSel({ toFront: [], toEnergy: [], remove: [] }); setMoveAnchor(null); }} /> : null;
  const lightbox = view && viewCard?.imageUrl ? <CardLightbox key="game-lightbox" src={viewCard.imageUrl} label={viewCard.name} alt={`${viewCard.name} ${viewCard.number}`} compact={compact}
    getOrigin={() => originRef.current?.isConnected ? originRef.current.getBoundingClientRect() : null} getReturnFocus={() => originRef.current?.isConnected ? originRef.current : null}
    onClose={closeView} onPrev={viewIds.length > 1 ? () => browse(-1) : undefined} onNext={viewIds.length > 1 ? () => browse(1) : undefined}
    position={`${viewLabel()} ${viewIndex + 1} / ${viewIds.length}`}>{cardActions()}</CardLightbox> : null;

  // ---- The action bar: what is happening and what you can do. ----
  const activeAp = mine?.ap.filter((card) => !card.rested).length ?? 0;
  const bar = (): { text: string; buttons: ReactNode[] } => {
    const button = (label: string, onClick: () => void, primary = false, disabled = false): ReactNode => <button key={label} type="button" className={primary ? "ua-primary" : "ua-secondary"} disabled={busy || disabled} onClick={onClick}>{label}</button>;
    if (!game) return { text: "", buttons: [] };
    if (game.step === "mulligan") {
      const mineToDecide = game.mulliganPlayerId === meId;
      return { text: mineToDecide ? "换牌：起手 7 张可以重抽一次（放到牌库底，抽 7 张新牌，再洗牌）" : `换牌阶段：等待 ${nameOf(game.mulliganPlayerId)}`, buttons: mineToDecide && onMulligan ? [button("保留起手牌", () => onMulligan(false), true), button("重抽 7 张", () => onMulligan(true))] : [] };
    }
    if (game.step === "over") return { text: `对局结束：${game.winnerId === meId ? "你获胜了！" : `${nameOf(game.winnerId)} 获胜`}${game.endReason ? `（${game.endReason}）` : ""}`, buttons: overButton ? [button(overButton.label, overButton.run, true)] : [] };
    if (ask) return { text: ask.prompt, buttons: (ask.options ?? []).map((option, index) => button(option.label, option.run, index === 0 && option.label !== "取消")) };
    if (pending && !myPending) {
      const waiting = { block: "选择是否阻挡", damage: "选择你的生命卡", triggers: "确认触发", discard: "选择保留的手牌", choose: "结算卡牌能力" }[pending.kind];
      return { text: `等待 ${nameOf(pending.playerId)} ${waiting}…`, buttons: [] };
    }
    if (myPending?.kind === "block") {
      const attacker = findField(myPending.attackerUid)?.card;
      const attackerName = attacker ? cardsById.get(attacker.cardId)?.name ?? "角色" : "角色";
      return { text: `${opponentName} 的「${attackerName}」（BP ${attacker ? bpOf(ctx, attacker) : "?"}）正在攻击你${attacker ? `，未被阻挡将受到 ${damageOf(ctx, attacker)} 点伤害` : ""}。点击你前线中高亮的活跃角色阻挡，或选择不阻挡。`, buttons: [button("不阻挡", () => void run({ type: "block", blockerUid: null }))] };
    }
    if (myPending?.kind === "damage") {
      const life = state?.life.opponent ?? [];
      const pickRandom = (): void => {
        const ids = [...life].sort(() => Math.random() - .5).slice(0, myPending.amount).map((slot) => slot.id);
        void run({ type: "damage", lifeIds: ids });
      };
      return { text: `造成 ${myPending.amount} 点伤害：点击对手生命区，选择 ${myPending.amount} 张生命卡（已选 ${lifePicked.length}）`, buttons: [button("确认", () => void run({ type: "damage", lifeIds: lifePicked }), true, lifePicked.length !== myPending.amount), button("随机选择", pickRandom)] };
    }
    if (myPending?.kind === "triggers" && focusedLife) {
      const card = focusedLife.cardId ? stats(focusedLife.cardId) : null;
      const chooser = revealed.length > 1 ? revealed.map((slot) => button(`${slot.id === focusedLife.id ? "▶ " : ""}${cardsById.get(slot.cardId ?? "")?.name ?? "卡牌"}`, () => setTriggerFocus(slot.id))) : [];
      if (!card?.trigger) return { text: `翻开的生命卡「${card?.name ?? "卡牌"}」没有触发，将置于场外。`, buttons: [...chooser, button("确认", () => resolveTrigger(false), true)] };
      return { text: `翻开的生命卡「${card.name}」有触发【${card.trigger.label}】：${card.trigger.text} 是否发动？`, buttons: [...chooser, button("发动", () => resolveTrigger(true), true), button("不发动", () => resolveTrigger(false))] };
    }
    if (myChoice) {
      const nameAt = (index: number): string => (myChoice.cards[index] ? cardsById.get(myChoice.cards[index]!)?.name ?? "卡牌" : "卡牌");
      if (myChoice.purpose === "confirm") return { text: myChoice.prompt, buttons: [button("是", () => void run({ type: "choose", picks: ["yes"] }), true), button("否", () => void run({ type: "choose", picks: ["no"] }))] };
      if (myChoice.purpose === "order") return { text: myChoice.prompt, buttons: myChoice.options.map((option, index) => button(`先结算「${nameAt(index)}」`, () => void run({ type: "choose", picks: [option] }), index === 0)) };
      const offBoard = myChoice.options.map((option, index) => ({ option, index })).filter((entry) => !onBoard(entry.option));
      const range = myChoice.min === myChoice.max ? `选 ${myChoice.min} 张` : `可选 ${myChoice.min}–${myChoice.max} 张`;
      return {
        text: `${myChoice.prompt}（${choiceKeys.length ? "点击高亮的卡牌，" : ""}${range}，已选 ${choicePicked.length}）`,
        buttons: [
          ...offBoard.map(({ option, index }) => {
            const picked = choicePicked.indexOf(option);
            const mark = picked < 0 ? "" : myChoice.ordered ? `${picked + 1}. ` : "✓ ";
            return <button key={`option-${option}`} type="button" className="ua-secondary" aria-pressed={picked >= 0} disabled={busy} onClick={() => pickOption(option)}>{mark}{myChoice.labels?.[index] || nameAt(index)}</button>;
          }),
          button("确定", () => void run({ type: "choose", picks: choicePicked }), true, choicePicked.length < myChoice.min || choicePicked.length > myChoice.max),
          ...(myChoice.min === 0 ? [button("不选择", () => void run({ type: "choose", picks: [] }))] : [])
        ]
      };
    }
    if (myPending?.kind === "discard") return { text: `手牌超过 8 张：点击手牌，选择要保留的 8 张（已选 ${keepPicked.length}），其余置于移除区`, buttons: [button("确认保留", () => void run({ type: "discard", keep: keepPicked }), true, keepPicked.length !== 8)] };
    if (!myTurn) return { text: `${nameOf(game.turnPlayerId)} 的回合 · ${game.phase ? PHASE_NAME[game.phase] : ""}`, buttons: [] };
    switch (game.phase) {
      case "start":
        return { text: `起始阶段：AP 卡与场上卡牌已转为活跃${game.turn === 1 ? "（先手第 1 回合不抽卡）" : "，并已抽 1 张卡"}。可以支付 1 AP 额外抽 1 张（每回合 1 次）。`, buttons: [button("额外抽卡（1 AP）", () => void run({ type: "extra_draw" }), false, game.extraDrawUsed || activeAp < 1 || !game.deckCount.you), button("进入移动阶段", () => void run({ type: "next_phase" }), true)] };
      case "movement": {
        const count = moveSel.toFront.length + moveSel.toEnergy.length;
        const over = frontOver ? `前线将超过 4 张，再点击 ${frontOver} 张前线的卡置于移除区。` : energyOver ? `能量线将超过 4 张，再点击 ${energyOver} 张能量线的卡置于移除区。` : "";
        // The confirm button floats above the card that was just moved (see MoveBubble); the bar keeps only the way out.
        return { text: over || (count ? "已选择移动：在发生移动的卡牌上方确认，或继续拖动其他角色。所有移动同时进行。" : "移动阶段：把能量线的角色拖到前线；有《撤步》的前线角色可拖回能量线（场地不能移动）。所有移动同时进行。"), buttons: [button("不移动，进入主要阶段", () => void run({ type: "next_phase" }))] };
      }
      case "main":
        return { text: `主要阶段：把手牌拖到前线或能量线登场（事件拖到场外，突进拖到目标角色上）；长按卡牌查看详情（活跃 AP ${activeAp}）。场上卡牌的能力可用详情里的「卡牌效果」手动结算。`, buttons: [button("进入攻击阶段", () => void run({ type: "next_phase" }), true), button("结束回合", () => void run({ type: "end_turn" }))] };
      case "attack":
        return { text: "攻击阶段：把前线中活跃的角色拖到对手前线进行攻击（瞄准攻击可直接拖到目标角色上）。攻击不消耗 AP。", buttons: [button("结束回合", () => void run({ type: "end_turn" }), true)] };
      default:
        return { text: "结束阶段", buttons: [] };
    }
  };
  const barState = bar();
  const lastLog = game?.log.length ? game.log[game.log.length - 1] : "";
  const effectMenu = playing ? <details className="ua-effects">
    <summary>效果</summary>
    <div className="ua-effects-menu">
      <button type="button" className="ua-secondary" disabled={busy || !game?.deckCount.you} onClick={() => void run({ type: "manual", manual: { op: "draw" } })}>抽 1 张卡</button>
      <button type="button" className="ua-secondary" disabled={busy || !mine?.ap.some((card) => card.rested)} onClick={() => { const card = mine?.ap.find((entry) => entry.rested); if (card) void run({ type: "manual", manual: { op: "ap", apId: card.id, act: "activate" } }); }}>1 张 AP 转为活跃</button>
      <button type="button" className="ua-secondary" disabled={busy || !mine?.ap.some((card) => !card.rested)} onClick={() => { const card = mine?.ap.find((entry) => !entry.rested); if (card) void run({ type: "manual", manual: { op: "ap", apId: card.id, act: "rest" } }); }}>1 张 AP 转为休息</button>
      <button type="button" className="ua-secondary" disabled={busy} onClick={() => { if (window.confirm("确定认输吗？")) void run({ type: "concede" }); }}>认输</button>
    </div>
  </details> : null;
  // The player's own win chance (estimated by a network from what this player can see): a small unlabelled ring, filled clockwise from the top.
  const winRate = playing && typeof game?.winRate === "number" ? game.winRate : null;
  const RING = 2 * Math.PI * 7;
  const winRateRing = winRate === null ? null : <svg className="ua-winring" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="7" />
    <circle cx="10" cy="10" r="7" strokeDasharray={`${winRate * RING} ${RING}`} />
  </svg>;
  const actionBar = game ? <div className="ua-actionbar" role="region" aria-label="对局操作" data-mine={(myTurn && !pending) || !!myPending || undefined}>
    <div className="ua-actionbar-text">
      <p className="ua-actionbar-prompt" aria-live="polite">{barState.text}</p>
      {notice ? <p className="ua-actionbar-notice" role="alert">{notice}</p> : lastLog ? <p className="ua-actionbar-log" title={lastLog}>{lastLog}</p> : null}
    </div>
    <div className="ua-actionbar-buttons">{barState.buttons}{effectMenu}{winRateRing}</div>
  </div> : null;

  // ---- Hands. ----
  const handStrip = game && game.step !== "over" ? <ol className="ua-handstrip" aria-label={`你的手牌，${hand.length} 张`} data-drop="hand" onClick={() => onZone("hand")}>
    {hand.map((cardId, index) => {
      const card = cardsById.get(cardId);
      const key = cardKey.hand(index);
      return <li key={`${cardId}-${index}`}>
        <button type="button" data-card-key={key} data-candidate={interaction.candidates.has(key) || undefined} data-selected={interaction.selected.has(key) || undefined}
          aria-label={`手牌 ${index + 1}：${card?.name ?? "卡牌"}`} onClick={(event) => { event.stopPropagation(); onCard(key, event.currentTarget); }}
          onPointerDown={(event) => startGesture(event, key, gestureHost)} onContextMenu={(event) => { event.preventDefault(); setArmed(null); openCard(key, event.currentTarget); }}>
          {card?.imageUrl ? <img src={card.imageUrl} alt="" draggable={false} /> : <span className="ua-card-missing">?</span>}
        </button>
      </li>;
    })}
  </ol> : null;
  const opponentHand = game && game.step !== "over" ? <div className="ua-opp-hand" aria-label={`对手手牌 ${game.handCount.opponent} 张`}>
    {Array.from({ length: Math.min(game.handCount.opponent, 10) }, (_, index) => <span key={index} className="ua-card-back" aria-hidden="true" />)}
    <small>{game.handCount.opponent}</small>
  </div> : null;

  const activePhase = (side: "self" | "opponent"): number | undefined => {
    if (!game || game.step !== "turn" || !game.phase) return undefined;
    const turnIsMine = game.turnPlayerId === meId;
    return (side === "self") === turnIsMine ? PHASE_INDEX[game.phase] : 5;
  };

  return {
    interaction: game ? interaction : undefined,
    actionBar,
    handStrip,
    opponentHand,
    lightbox: <>{lightbox}{moveBubble}</>,
    lightboxOpen: lightbox !== null,
    activePhase,
    /** Opens a hand card in the lightbox from somewhere else on the page (the side panel's hand list). */
    openHandCard: (index: number, element: HTMLElement) => { originRef.current = element; setView({ group: { kind: "hand" }, index }); }
  };
}

