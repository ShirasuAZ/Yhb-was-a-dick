import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** How far the highlight ring stands off the target's own box, and the ring's corner radius. */
const RING_PAD = 6;
const RING_RADIUS = 10;
/** How often the targets' boxes are re-measured while a step is up; a resize or a scroll measures at once as well. */
const MEASURE_MS = 180;
/** The floating text's width — also what its placement maths assumes. */
const TIP_WIDTH = "min(380px, calc(100vw - 24px))";

export interface SpotRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * One part of a step's target: a CSS selector, or `btn:<label>` for a button in the action bar — the buttons that move the
 * turn along have no stable selector of their own, only their text.
 */
function elementsOfPart(part: string): HTMLElement[] {
  if (part.startsWith("btn:")) {
    const label = part.slice(4);
    return [...document.querySelectorAll<HTMLElement>(".ua-actionbar-buttons > button")]
      .filter((element) => (element.textContent ?? "").trim() === label);
  }
  return [...document.querySelectorAll<HTMLElement>(part)];
}

/**
 * Splits a target list on the commas that separate its parts — the ones outside parentheses, so a selector such as
 * `:is(.a, .b)` stays whole.
 */
function splitTargets(target: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < target.length; index += 1) {
    const character = target[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) { parts.push(target.slice(start, index)); start = index + 1; }
  }
  parts.push(target.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Everything a step points at, in the order the step names it. A target is a comma-separated list, and each part is either a
 * selector or `btn:<label>`. A step may name several things at once — the button to press and the zone the text talks about —
 * and each of them is highlighted on its own: nothing is boxed by the union of them, which used to draw one huge ring across
 * half the table and park the text in the middle of it.
 */
export function elementsFor(target: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const part of splitTargets(target)) {
    for (const element of elementsOfPart(part)) if (!out.includes(element)) out.push(element);
  }
  return out;
}

/** An element's box, padded for the ring and clamped to the window, rounded so sub-pixel layout churn cannot move anything. */
function boxOf(element: HTMLElement): SpotRect | null {
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const top = Math.max(0, Math.round(box.top - RING_PAD));
  const left = Math.max(0, Math.round(box.left - RING_PAD));
  const right = Math.min(window.innerWidth, Math.round(box.right + RING_PAD));
  const bottom = Math.min(window.innerHeight, Math.round(box.bottom + RING_PAD));
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function contains(outer: SpotRect, inner: SpotRect): boolean {
  return inner.left >= outer.left - 1 && inner.top >= outer.top - 1
    && inner.left + inner.width <= outer.left + outer.width + 1
    && inner.top + inner.height <= outer.top + outer.height + 1;
}

/**
 * The boxes to ring: one per target, with a target that sits inside another folded into it, so a card and the line it is in
 * do not draw two nested borders.
 */
function ringsOf(elements: readonly HTMLElement[]): SpotRect[] {
  const boxes = elements.map(boxOf).filter((box): box is SpotRect => box !== null);
  const unique = boxes.filter((box, index) => boxes.findIndex((other) => other.top === box.top && other.left === box.left
    && other.width === box.width && other.height === box.height) === index);
  return unique.filter((box) => !unique.some((other) => other.width * other.height > box.width * box.height && contains(other, box)));
}

export interface SpotTargets {
  /** One box per highlighted thing (nested ones folded away), which is what the rings are drawn around. */
  rects: SpotRect[];
  /** The box the floating text follows: the first thing the step names, while it is on the table. */
  anchor: SpotRect | null;
}

function readTargets(selector: string | null, anchorRef: { current: HTMLElement | null }): SpotTargets {
  if (!selector) {
    anchorRef.current = null;
    return { rects: [], anchor: null };
  }
  const elements = elementsFor(selector);
  // The square the text sits next to is chosen once: as long as the element it chose is still on the table, it keeps following
  // that one, instead of hopping to whichever of the step's targets measured first this time.
  const kept = anchorRef.current && elements.includes(anchorRef.current) ? anchorRef.current : null;
  const anchorElement = kept ?? elements.find((element) => boxOf(element) !== null) ?? null;
  anchorRef.current = anchorElement;
  return { rects: ringsOf(elements), anchor: anchorElement ? boxOf(anchorElement) : null };
}

function sameRect(a: SpotRect, b: SpotRect): boolean {
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function sameTargets(a: SpotTargets, b: SpotTargets): boolean {
  if (a.rects.length !== b.rects.length) return false;
  if (!a.rects.every((rect, index) => sameRect(rect, b.rects[index]!))) return false;
  return a.anchor === b.anchor || (a.anchor !== null && b.anchor !== null && sameRect(a.anchor, b.anchor));
}

/**
 * Tracks every box a step points at. They are measured from the live DOM (never from fixed coordinates), so they stay right
 * when the page scrolls, the window is resized or the board's layout changes under them — and the caller can ask for a fresh
 * measurement after a state change.
 */
export function useSpotTargets(selector: string | null, refreshKey: unknown): SpotTargets {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const anchorRef = useRef<HTMLElement | null>(null);
  const lastSelector = useRef<string | null>(null);
  const [targets, setTargets] = useState<SpotTargets>(() => readTargets(selector, anchorRef));

  const update = useCallback((): void => {
    const current = selectorRef.current;
    if (lastSelector.current !== current) {
      lastSelector.current = current;
      anchorRef.current = null;
    }
    setTargets((previous) => {
      const next = readTargets(current, anchorRef);
      return sameTargets(previous, next) ? previous : next;
    });
  }, []);

  useLayoutEffect(() => { update(); }, [selector, refreshKey, update]);

  useEffect(() => {
    if (!selector) return undefined;
    const timer = window.setInterval(update, MEASURE_MS);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("orientationchange", update);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("orientationchange", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [selector, update]);

  return targets;
}

export type TipSide = "below" | "above";

/**
 * Where the text goes for a target: under it, or over it when there is no room, always kept inside the window and never on
 * top of the target. `preferred` is the side the step already uses; it is only abandoned when it cannot work — the panel grew
 * a line and would now cover the thing it talks about.
 */
function placeTip(anchor: SpotRect, tipHeight: number, preferred: TipSide | null): { top: number; left: number; side: TipSide } {
  const margin = 12;
  const gap = 12;
  const room = { below: window.innerHeight - margin - (anchor.top + anchor.height + gap), above: anchor.top - gap - margin };
  const topFor = (side: TipSide): number => (side === "below" ? anchor.top + anchor.height + gap : anchor.top - gap - tipHeight);
  // A side works when the whole panel fits there without touching the target.
  const works = (side: TipSide): boolean => room[side] >= tipHeight;
  const first = preferred ?? (works("below") ? "below" : "above");
  const side = works(first) ? first : works(first === "below" ? "above" : "below") ? (first === "below" ? "above" : "below") : first;
  // Even a side that does not fit keeps its edge: the panel is clamped into the window rather than covering the target's centre.
  const top = Math.max(margin, Math.min(topFor(side), Math.max(margin, window.innerHeight - margin - tipHeight)));
  const half = Math.min(190, Math.max(0, (window.innerWidth - margin * 2) / 2));
  const centered = anchor.left + anchor.width / 2;
  const left = Math.min(Math.max(centered, margin + half), Math.max(margin + half, window.innerWidth - margin - half));
  return { top: Math.round(top), left: Math.round(left), side };
}

/**
 * Where the floating text sits, and how it is kept still.
 *
 * The side — under its target or over it — is decided once per step and then kept. It used to be re-decided on every
 * measurement with whatever height the panel happened to have at that moment, so the panel grew a line (a reminder, a notice),
 * flipped to the other side of the board, and flipped back again: the jumping the tour was doing. Only the position is
 * clamped now, and only within the side it already chose.
 *
 * A target can vanish the moment its own button is pressed, and re-measuring then finds nothing; the step keeps its last
 * placement for the length of its fade-out instead of dropping to the middle of the screen. A step that points at nothing at
 * all (a pure explanation) still centres.
 */
export function useTipPlacement(anchor: SpotRect | null, tipHeight: number, stepKey: unknown): React.CSSProperties {
  const kept = useRef<{ key: unknown; side: TipSide | null; top: number; left: number } | null>(null);
  if (!kept.current || kept.current.key !== stepKey) kept.current = { key: stepKey, side: null, top: 0, left: 0 };
  const state = kept.current;
  if (anchor) {
    const placed = placeTip(anchor, tipHeight, state.side);
    state.top = placed.top;
    state.left = placed.left;
    // The side is only committed once the panel has been measured: before that it has no height, and picking a side from a
    // height of 0 would freeze the panel on the wrong side of its target.
    if (tipHeight > 0 || state.side !== null) state.side = placed.side;
    return { left: placed.left, top: placed.top, transform: "translateX(-50%)", width: TIP_WIDTH };
  }
  if (state.side !== null) return { left: state.left, top: state.top, transform: "translateX(-50%)", width: TIP_WIDTH };
  return { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: TIP_WIDTH };
}

/**
 * The dimming layer, with a hole left over each of the step's targets. One path with an even-odd rule: the window as the outer
 * ring, every target cut out of it as an inner ring. The layer never takes a click (a misclick is stopped by `inert` on the
 * board instead, which keeps the header, the action bar and the tour's own buttons reachable); `block` is there for a caller
 * that wants a hard modal.
 */
export function SpotlightScrim({ rects, block = false, visible }: { rects: readonly SpotRect[]; block?: boolean; visible: boolean }) {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const path = `M0 0H${width}V${height}H0Z`
    + rects.map((rect) => ` M${rect.left} ${rect.top}h${rect.width}v${rect.height}h${-rect.width}Z`).join("");
  return <>
    <svg className="ua-spot-scrim" aria-hidden="true" style={{ opacity: visible ? 1 : 0 }}>
      <path d={path} fillRule="evenodd" />
    </svg>
    {block && visible ? <div className="ua-spot-block" aria-hidden="true" /> : null}
  </>;
}

/** The bright window around each target; they never take clicks, so whatever is under them keeps working. */
export function SpotlightRings({ rects, visible }: { rects: readonly SpotRect[]; visible: boolean }) {
  return <>
    {rects.map((rect, index) => <div key={`${rect.top}:${rect.left}:${rect.width}:${rect.height}:${index}`} className="ua-spot-ring" aria-hidden="true" style={{
      top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: RING_RADIUS, opacity: visible ? 1 : 0
    }} />)}
  </>;
}
