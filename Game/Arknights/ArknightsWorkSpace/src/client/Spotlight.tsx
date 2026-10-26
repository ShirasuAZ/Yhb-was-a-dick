import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** How far the highlight ring stands off the target's own box, and the ring's corner radius. */
const RING_PAD = 6;
const RING_RADIUS = 10;
/** How often the target's box is measured while a step is up; resize and scroll measure at once as well. */
const MEASURE_MS = 180;

export interface SpotRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * A step can name its target either with a CSS selector, or as `btn:<label>` for a button in the action bar — the buttons
 * that move the turn along have no stable selector of their own, only their text.
 */
function elementsFor(target: string): HTMLElement[] {
  // A target may be a comma-separated list, and each part may name a button by its label instead of a selector.
  const parts = target.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.some((part) => part.startsWith("btn:"))) {
    const labels = parts.filter((part) => part.startsWith("btn:")).map((part) => part.slice(4));
    const selectors = parts.filter((part) => !part.startsWith("btn:"));
    return [
      ...[...document.querySelectorAll<HTMLElement>(".ua-actionbar-buttons > button:not(:disabled)")]
        .filter((element) => labels.includes((element.textContent ?? "").trim())),
      ...selectors.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)])
    ];
  }
  return [...document.querySelectorAll<HTMLElement>(target)];
}

/** The union of the boxes of everything the target matches, with the ring's padding; null when nothing matches. */
function measure(selector: string | null): SpotRect | null {
  if (!selector) return null;
  const boxes = elementsFor(selector)
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0);
  if (!boxes.length) return null;
  const top = Math.min(...boxes.map((box) => box.top));
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return {
    top: Math.max(0, top - RING_PAD),
    left: Math.max(0, left - RING_PAD),
    width: Math.min(window.innerWidth, right + RING_PAD) - Math.max(0, left - RING_PAD),
    height: Math.min(window.innerHeight, bottom + RING_PAD) - Math.max(0, top - RING_PAD)
  };
}

/**
 * Tracks the box of the step's target element. It is measured from the live DOM (never from fixed coordinates), so it stays
 * right when the page scrolls, the window is resized or the board's layout changes under it — and the caller can ask for a
 * fresh measurement after a state change.
 */
export function useSpotRect(selector: string | null, refreshKey: unknown): SpotRect | null {
  const [rect, setRect] = useState<SpotRect | null>(() => measure(selector));
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const update = useCallback((): void => {
    setRect((current) => {
      const next = measure(selectorRef.current);
      if (current === next) return current;
      if (current && next && current.top === next.top && current.left === next.left && current.width === next.width && current.height === next.height) return current;
      return next;
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

  return rect;
}

/** Where the tooltip sits: under the target when there is room, else above it, always inside the window. */
export function tooltipStyle(rect: SpotRect | null, tipHeight: number): React.CSSProperties {
  const margin = 12;
  if (!rect) return { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  const gap = 12;
  const below = rect.top + rect.height + gap;
  const fitsBelow = below + tipHeight <= window.innerHeight - margin;
  const top = fitsBelow ? below : Math.max(margin, rect.top - gap - tipHeight);
  const centered = rect.left + rect.width / 2;
  const half = Math.min(190, Math.max(0, (window.innerWidth - margin * 2) / 2));
  const left = Math.min(Math.max(centered, margin + half), Math.max(margin + half, window.innerWidth - margin - half));
  return { left, top, transform: "translateX(-50%)", width: `min(380px, calc(100vw - ${margin * 2}px))` };
}

/**
 * The dimming layer with a hole over the target. Four panels cover everything outside the target's box, so the target itself
 * stays at full brightness and can still be clicked; `block` makes the panels eat clicks outside the hole (used while a step
 * only explains something), and `block={false}` leaves the board usable while the player carries out the step.
 */
export function SpotlightScrim({ rect, block, visible }: { rect: SpotRect | null; block: boolean; visible: boolean }) {
  // The panels sit above the table but must never swallow a click: a misclick is stopped by `inert` on the board instead, which
  // keeps the header, the action bar and the tour's own buttons reachable. `block` is kept for callers that want a hard modal.
  const events = block ? "auto" : "none";
  const style = (panel: React.CSSProperties): React.CSSProperties => ({ ...panel, pointerEvents: events, opacity: visible ? 1 : 0, transition: "opacity .24s ease" });
  if (!rect) return <div className="ua-spot-scrim" aria-hidden="true"><i style={style({ inset: 0 })} /></div>;
  const bottom = rect.top + rect.height;
  const right = rect.left + rect.width;
  return <div className="ua-spot-scrim" aria-hidden="true">
    <i style={style({ left: 0, top: 0, right: 0, height: rect.top })} />
    <i style={style({ left: 0, top: bottom, right: 0, bottom: 0 })} />
    <i style={style({ left: 0, top: rect.top, width: rect.left, height: rect.height })} />
    <i style={style({ left: right, top: rect.top, right: 0, height: rect.height })} />
  </div>;
}

/** The bright window around the target; it never takes clicks, so whatever is under it keeps working. */
export function SpotlightRing({ rect, visible }: { rect: SpotRect | null; visible: boolean }) {
  if (!rect) return null;
  return <div className="ua-spot-ring" aria-hidden="true" style={{
    top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: RING_RADIUS, opacity: visible ? 1 : 0
  }} />;
}
