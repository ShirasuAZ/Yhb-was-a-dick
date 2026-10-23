import { useState, type CSSProperties, type ReactNode } from "react";
import type { UnionArenaApCard, UnionArenaBoard, UnionArenaFieldCard, UnionArenaPlayer } from "../shared/protocol.ts";
import { bpOf, type EngineContext } from "../shared/engine.ts";
import type { CardRecord } from "./cards.ts";

/** Maximum cards per zone, from the official playmat. */
export const ZONE_LIMITS = { front: 4, energy: 4, actionPoints: 3 } as const;
export const PHASES = ["起始阶段", "移动阶段", "主要阶段", "攻击阶段", "结束阶段", "对方的回合"] as const;
const PHASE_MARKS = ["①", "②", "③", "④", "⑤", "⑥"] as const;
/** Two-character labels for pills too narrow for the full phase name. */
const PHASE_SHORT = ["起始", "移动", "主要", "攻击", "结束", "对方"] as const;

/** Keyword descriptions, from the rule manual's keyword abilities pages; names as printed on the Chinese cards. */
export const KEYWORDS: ReadonlyArray<{ name: string; text: string }> = [
  { name: "撤步", text: "移动阶段中，可将此卡从前线移到能量线（与能量线移向前线的角色同时进行）。" },
  { name: "瞄准攻击", text: "可指定对手前线的角色（活动或横置均可）进行攻击，对手不能阻挡；被指定的角色不视为阻挡，但仍会进行战斗。" },
  { name: "2次攻击", text: "此角色本回合第一次攻击时，将其变为活动。" },
  { name: "2次阻挡", text: "此角色本回合第一次阻挡时，将其变为活动。" },
  { name: "冲击1", text: "此角色攻击并赢得战斗时，对对手造成1点伤害。" },
  { name: "伤害2", text: "此角色攻击并造成直接伤害时，改为造成2点伤害（从对手生命区选2张，同时翻开并确认触发）。" },
  { name: "冲击无效", text: "与此角色战斗的角色，在本次战斗中失去冲击。" },
  { name: "冲击+1", text: "冲击伤害+1；若本来没有冲击，则获得冲击。" },
  { name: "突进", text: "宣告突进并叠放到指定角色上：下方角色的能力失效；若该角色为横置则变为活动；若在能量线可移到前线；然后发动此卡的突进相关能力。" }
];

/** How the table reacts to clicks: cards in `candidates` can be picked now, `selected` ones are already picked. */
export interface BoardInteraction {
  candidates: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  onCard: (key: string, element: HTMLElement) => void;
}
export const NO_KEYS: ReadonlySet<string> = new Set();

/** Keys that identify a clickable thing on the table. */
export const cardKey = {
  field: (uid: string) => `f:${uid}`,
  life: (id: string) => `l:${id}`,
  hand: (index: number) => `h:${index}`,
  pile: (side: "you" | "opponent", pile: "sideline" | "removal") => `p:${side}:${pile}`
};

/** A player's nameplate. It lives in the bar on the outer edge of that player's half: top for the opponent, bottom for you. */
export function Seat({ player, self, status: statusText }: { player?: UnionArenaPlayer; self: boolean; status?: string }) {
  const status = statusText ?? (player ? `${player.connected ? "在线" : "已断线"} · ${player.ready ? "已准备" : "未准备"}` : "空座位");
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
  /** Small labels on the card: current BP, stack size, pile size. */
  badges?: ReactNode;
  pickKey?: string;
  interaction?: BoardInteraction;
  label?: string;
  children?: ReactNode;
}

export function CardSlot({ card, rested = false, faceDown = false, badges, pickKey, interaction, label, children }: SlotProps) {
  const clickable = pickKey !== undefined && interaction !== undefined && (card !== undefined || faceDown || interaction.candidates.has(pickKey));
  const content = <>
    {card
      ? card.imageUrl
        ? <img className="ua-slot-card" src={card.imageUrl} alt={clickable ? "" : `${card.name} ${card.number}`} draggable={false} />
        : <span className="ua-slot-card ua-slot-name">{card.name}</span>
      : faceDown ? <span className="ua-slot-card ua-card-back" aria-hidden="true" /> : null}
    {children}
    {badges ? <span className="ua-badges">{badges}</span> : null}
  </>;
  const state = {
    "data-rested": rested || undefined,
    "data-candidate": (pickKey && interaction?.candidates.has(pickKey)) || undefined,
    "data-selected": (pickKey && interaction?.selected.has(pickKey)) || undefined
  };
  if (!clickable) return <div className="ua-slot" {...state}>{content}</div>;
  return <button type="button" className="ua-slot ua-slot-button" {...state} data-card-key={pickKey} aria-label={label ?? (card ? `${card.name} ${card.number}` : "卡牌")} onClick={(event) => interaction!.onCard(pickKey!, event.currentTarget)}>{content}</button>;
}

function ZoneFrame({ className, name, count, large = false, children }: { className: string; name: string; count: number; large?: boolean; children: ReactNode }) {
  return <div className={`ua-zone ${large ? "ua-zone-large" : ""} ${className}`} style={{ "--n": count } as CSSProperties} role="group" aria-label={name}>
    {children}
    <span className="ua-zone-name" aria-hidden="true">{name}</span>
  </div>;
}

export function SlotZone({ className, name, count, large = false }: { className: string; name: string; count: number; large?: boolean }) {
  return <ZoneFrame className={className} name={name} count={count} large={large}>
    {Array.from({ length: count }, (_, index) => <CardSlot key={index} />)}
  </ZoneFrame>;
}

/** A front line or energy line: its cards in order, then empty slots up to four. */
function LineZone({ className, name, cards, cardsById, ctx, interaction }: { className: string; name: string; cards: readonly UnionArenaFieldCard[]; cardsById: ReadonlyMap<string, CardRecord>; ctx: EngineContext; interaction?: BoardInteraction }) {
  return <ZoneFrame className={className} name={name} count={ZONE_LIMITS.front}>
    {Array.from({ length: ZONE_LIMITS.front }, (_, index) => {
      const field = cards[index];
      if (!field) return <CardSlot key={`empty-${index}`} />;
      const record = cardsById.get(field.cardId);
      const isCharacter = record?.stats?.type === "character";
      const bp = isCharacter ? bpOf(ctx, field) : null;
      const label = `${record?.name ?? "卡牌"}${field.rested ? "（休息）" : "（活跃）"}${bp !== null ? ` BP${bp}` : ""}${field.under.length ? `，下方 ${field.under.length} 张` : ""}`;
      return <CardSlot key={field.uid} card={record} rested={field.rested} pickKey={cardKey.field(field.uid)} interaction={interaction} label={label}
        badges={<>
          {bp !== null ? <span className={`ua-badge ua-badge-bp ${field.bpMod > 0 ? "is-up" : field.bpMod < 0 ? "is-down" : ""}`}>{bp}</span> : null}
          {field.under.length ? <span className="ua-badge">叠{field.under.length}</span> : null}
          {field.grants.length ? <span className="ua-badge ua-badge-kw">{field.grants.join(" ")}</span> : null}
          {field.skipNextActivate ? <span className="ua-badge is-down">锁</span> : null}
        </>} />;
    })}
  </ZoneFrame>;
}

function ApZone({ cards }: { cards: readonly UnionArenaApCard[] }) {
  const active = cards.filter((card) => !card.rested).length;
  return <ZoneFrame className="ua-z-ap" name="行动点区" count={ZONE_LIMITS.actionPoints}>
    {Array.from({ length: ZONE_LIMITS.actionPoints }, (_, index) => {
      const card = cards[index];
      return <CardSlot key={card?.id ?? `empty-${index}`} rested={card?.rested}>{card ? <span className="ua-slot-card ua-ap-card" aria-hidden="true">AP</span> : null}</CardSlot>;
    })}
    {cards.length ? <span className="ua-ap-count" aria-label={`AP ${active}/${cards.length} 活跃`}>{active}/{cards.length}</span> : null}
  </ZoneFrame>;
}

/** A face-up pile (sideline or removal area): its top card and how many cards are in it. */
function PileZone({ className, name, cards, cardsById, pickKey, interaction }: { className: string; name: string; cards: readonly string[]; cardsById: ReadonlyMap<string, CardRecord>; pickKey: string; interaction?: BoardInteraction }) {
  const top = cards.length ? cardsById.get(cards[cards.length - 1]!) : undefined;
  return <ZoneFrame className={className} name={name} count={1} large>
    {cards.length
      ? <CardSlot card={top} pickKey={pickKey} interaction={interaction} label={`${name}，${cards.length} 张`} badges={<span className="ua-badge">{cards.length}</span>} />
      : <CardSlot />}
  </ZoneFrame>;
}

function DeckZone({ count }: { count: number }) {
  return <ZoneFrame className="ua-z-deck" name="卡组放置处" count={1} large>
    {count > 0 ? <CardSlot faceDown badges={<span className="ua-badge">{count}</span>} /> : <CardSlot />}
  </ZoneFrame>;
}

/** One life card. `card` is absent for a face-down card whose identity this client does not know. */
export interface LifeCardEntry { id: string; card?: CardRecord; }
const NO_LIFE: readonly LifeCardEntry[] = [];

/**
 * Life cards lie sideways; the first is on top and each later one peeks out below it (stacking via z-index, data order untouched). One element per entry in `cards`
 * and none when it is empty; the offset is derived in CSS from the entry count and the zone's size.
 */
function LifeZone({ cards, interaction }: { cards: readonly LifeCardEntry[]; interaction?: BoardInteraction }) {
  return <div className="ua-zone ua-z-life" role="group" aria-label={`生命区，${cards.length} 张`}>
    <span className="ua-life-title" aria-hidden="true">生命区</span>
    <ol className="ua-life-stack" style={{ "--n": cards.length } as CSSProperties}>
      {cards.map((entry, index) => {
        const key = cardKey.life(entry.id);
        const pickable = interaction?.candidates.has(key) ?? false;
        const face = entry.card
          ? entry.card.imageUrl
            ? <img className="ua-life-art" src={entry.card.imageUrl} alt={`${entry.card.name} ${entry.card.number}`} draggable={false} />
            : <span className="ua-life-art ua-slot-name">{entry.card.name}</span>
          : <span className="ua-card-back" aria-hidden="true" />;
        return <li className="ua-life-card" key={entry.id} style={{ "--i": index, zIndex: cards.length - index } as CSSProperties} title={entry.card ? `${entry.card.name} ${entry.card.number}` : "生命卡（背面）"}
          data-candidate={pickable || undefined} data-selected={interaction?.selected.has(key) || undefined}>
          {pickable ? <button type="button" className="ua-life-pick" data-card-key={key} aria-label={`第 ${index + 1} 张生命卡`} aria-pressed={interaction!.selected.has(key)} onClick={(event) => interaction!.onCard(key, event.currentTarget)}>{face}</button> : face}
        </li>;
      })}
    </ol>
  </div>;
}

export function PhaseBar({ activePhase }: { activePhase?: number }) {
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

export interface HalfBoardProps {
  side: "self" | "opponent";
  activePhase?: number;
  life?: readonly LifeCardEntry[];
  /** The cards on this player's field, AP area and piles; absent outside a game. */
  board?: UnionArenaBoard;
  deckCount?: number;
  cardsById?: ReadonlyMap<string, CardRecord>;
  ctx?: EngineContext;
  interaction?: BoardInteraction;
}

/** One player's half of the mat. The opponent's half is the same board rotated 180 degrees. */
export function HalfBoard({ side, activePhase, life = NO_LIFE, board, deckCount = 0, cardsById, ctx, interaction }: HalfBoardProps) {
  const self = side === "self";
  const owner = self ? "you" : "opponent";
  const inGame = board && cardsById && ctx;
  return <div className="ua-half" data-side={side}>
    {inGame ? <LineZone className="ua-z-front" name="前线" cards={board.front} cardsById={cardsById} ctx={ctx} interaction={interaction} /> : <SlotZone className="ua-z-front" name="前线" count={ZONE_LIMITS.front} />}
    {inGame ? <LineZone className="ua-z-energy" name="能量线" cards={board.energy} cardsById={cardsById} ctx={ctx} interaction={interaction} /> : <SlotZone className="ua-z-energy" name="能量线" count={ZONE_LIMITS.energy} />}
    {inGame ? <ApZone cards={board.ap} /> : <SlotZone className="ua-z-ap" name="行动点区" count={ZONE_LIMITS.actionPoints} />}
    <LifeZone cards={life} interaction={interaction} />
    {inGame ? <DeckZone count={deckCount} /> : <SlotZone className="ua-z-deck" name="卡组放置处" count={1} large />}
    <PhaseBar activePhase={activePhase} />
    {inGame ? <PileZone className="ua-z-removal" name="移除区" cards={board.removal} cardsById={cardsById} pickKey={cardKey.pile(owner, "removal")} interaction={interaction} /> : <SlotZone className="ua-z-removal" name="移除区" count={1} large />}
    {inGame ? <PileZone className="ua-z-discard" name="场外" cards={board.sideline} cardsById={cardsById} pickKey={cardKey.pile(owner, "sideline")} interaction={interaction} /> : <SlotZone className="ua-z-discard" name="场外" count={1} large />}
    {self ? <KeywordTable /> : null}
  </div>;
}

