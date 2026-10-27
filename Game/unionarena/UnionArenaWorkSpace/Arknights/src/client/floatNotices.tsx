import { useEffect, useRef, useState, type CSSProperties } from "react";
import { flyCardToPile } from "./flyCard.ts";

/** One event as the engine reports it. */
export type FloatEvent = { seq: number; text: string; uid?: string; kind: string };

type Notice = {
  /** Unique per rendered notice, so two events on one card never collide. */
  key: string;
  /** The board card this notice floats above (`data-card-key="f:<uid>"`). */
  cardKey: string;
  text: string;
  /** Stack index among the notices currently on the same card; keeps them from overlapping. */
  slot: number;
};

export type FloatNotice = Notice;

/** How long a notice is fully visible before it starts to drift up. */
const HOLD_MS = 1100;
/** How long the drift-and-fade takes. Must match the CSS animation duration. */
const FADE_MS = 1500;

/**
 * Turns engine events into short texts shown over the card they happened to. Purely cosmetic: it only
 * reads `game.events`, never writes to game state, and removes each notice once its animation ends.
 */
export function useFloatNotices(events: FloatEvent[] | undefined, enabled: boolean): Notice[] {
  const [notices, setNotices] = useState<Notice[]>([]);
  const seen = useRef<number>(-1);
  const timers = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!enabled || !events?.length) return;
    // First sight of a game (or a resubscribe) should not replay its whole history.
    if (seen.current < 0) { seen.current = events[events.length - 1]!.seq; return; }
    const fresh = events.filter((event) => event.seq > seen.current && event.uid);
    if (!fresh.length) return;
    seen.current = events[events.length - 1]!.seq;

    // A card that just left the field (beaten as a blocker, or sent off by an effect) travels from where it stood to its
    // pile, so the eye can follow it instead of the card simply vanishing. The board still has its old position on screen
    // for this frame, which is exactly what the flight starts from.
    for (const event of fresh) {
      if (event.kind !== "leave" || !event.uid) continue;
      const source = document.querySelector<HTMLElement>(`[data-card-key="f:${event.uid}"]`);
      if (source) flyCardToPile(source);
    }

    const added: Notice[] = fresh.map((event) => ({
      key: `${event.seq}-${event.uid}`,
      cardKey: `f:${event.uid}`,
      text: shortText(event),
      slot: 0
    }));
    setNotices((current) => {
      // Stack new notices under whatever is already showing on the same card.
      const used = new Map<string, number>();
      for (const notice of current) used.set(notice.cardKey, Math.max(used.get(notice.cardKey) ?? -1, notice.slot));
      return [...current, ...added.map((notice) => {
        const slot = (used.get(notice.cardKey) ?? -1) + 1;
        used.set(notice.cardKey, slot);
        return { ...notice, slot };
      })];
    });

    for (const notice of added) {
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        setNotices((current) => current.filter((entry) => entry.key !== notice.key));
      }, HOLD_MS + FADE_MS);
      timers.current.add(timer);
    }
  }, [events, enabled]);

  // A card that leaves the board must not keep an orphaned notice around.
  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); timers.current.clear(); }, []);

  return notices;
}

/**
 * The log line is written for the log list, which names both sides of a battle. Over a card that is far
 * too long, so a battle is shortened to its outcome and other events lose their "「card」：" prefix.
 */
function shortText(event: FloatEvent): string {
  const text = event.text;
  if (event.kind === "battle-win") {
    const mine = /「([^」]+)」\((\d+)\) 胜过/.exec(text);
    return mine ? `战斗胜利 ${mine[2]}` : "战斗胜利";
  }
  if (event.kind === "battle-lose") {
    const mine = /「([^」]+)」\((\d+)\) 不敌「[^」]+」\((\d+)\)/.exec(text);
    return mine ? `战斗失败 ${mine[2]} < ${mine[3]}` : "战斗失败";
  }
  if (event.kind === "leave") return "退场";
  if (event.kind === "draw") return "抽牌";
  // "「X」：「Y」获得《Z》" -> "获得《Z》"; anything else keeps its own wording, trimmed of the card name.
  const tail = text.includes("：") ? text.slice(text.lastIndexOf("：") + 1) : text;
  return tail.length > 18 ? `${tail.slice(0, 17)}…` : tail;
}

/** Renders the notices for one card. Call inside the card's own element so they sit over it. */
export function CardNotices({ notices }: { notices: Notice[] }) {
  if (!notices.length) return null;
  return <span className="ua-notices" aria-hidden="true">
    {notices.map((notice) => <span key={notice.key} className="ua-notice" style={{ "--slot": notice.slot } as CSSProperties}>{notice.text}</span>)}
  </span>;
}
