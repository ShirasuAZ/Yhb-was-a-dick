import { useEffect, useLayoutEffect, useRef } from "react";

const DURATION_MS = 280;
const EASING = "cubic-bezier(0.22, 0.8, 0.24, 1)";

export interface CardLightboxProps {
  /** Original-size card art. */
  src: string;
  /** Accessible name of the dialog, normally the card's name. */
  label: string;
  /** Alt text of the enlarged picture. */
  alt: string;
  /** Where the small picture is on screen right now (asked once on open and once on close). Null or off-screen: the card zooms in place instead of flying. */
  getOrigin: () => DOMRect | null;
  /** Phones: no flight, the card just zooms and fades in the middle of the screen. */
  compact: boolean;
  /** Where focus goes after closing. Defaults to whatever had focus when the lightbox opened (browsers such as Safari do not focus a button on click). */
  getReturnFocus?: () => HTMLElement | null;
  /** Called after the close animation has finished; the owner unmounts the lightbox here. */
  onClose: () => void;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isOnScreen(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
}

/**
 * Full-screen enlarged view of one card: dimmed backdrop, the card centred at the largest size that fits (5:7, never cropped or stretched),
 * a close button in the top-right corner. Opening and closing animate only `transform` and `opacity` (FLIP: the card flies between the small
 * picture and the middle of the screen). Esc, the close button and a click on the backdrop all close it; focus returns to whatever had it before.
 * Render it at the root of the page, never inside a transformed ancestor, or `position: fixed` stops covering the screen.
 */
export function CardLightbox({ src, label, alt, getOrigin, compact, getReturnFocus, onClose }: CardLightboxProps) {
  const scrimRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /** The card's keyframes between "at the small picture" (or zoomed out) and "full size", from the closed state to the open one. */
  const cardFrames = (): Keyframe[] => {
    const card = cardRef.current;
    // Measure the card at rest: a running animation (or a development double-mount) would otherwise be measured at its transformed size.
    card?.getAnimations().forEach((animation) => animation.cancel());
    const origin = compact ? null : getOrigin();
    if (card && origin && isOnScreen(origin)) {
      const target = card.getBoundingClientRect();
      if (target.width > 0) {
        const scale = origin.width / target.width;
        const dx = origin.left + origin.width / 2 - (target.left + target.width / 2);
        const dy = origin.top + origin.height / 2 - (target.top + target.height / 2);
        return [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 1 }, { transform: "translate(0px, 0px) scale(1)", opacity: 1 }];
      }
    }
    return [{ transform: "scale(0.86)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }];
  };

  // Open: move focus to the close button and play the opening animation.
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    if (!prefersReducedMotion()) {
      scrimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION_MS, easing: "ease-out", fill: "backwards" });
      cardRef.current?.animate(cardFrames(), { duration: DURATION_MS, easing: EASING, fill: "backwards" });
    }
    // Give focus back after the commit: the owner makes the page behind `inert` while the lightbox is open and only lifts that in the same
    // commit that unmounts us. The check keeps a development double-mount from pulling focus off the close button.
    return () => { window.setTimeout(() => { if (!document.querySelector(".ua-lb")) (getReturnFocus?.() ?? previous)?.focus({ preventScroll: true }); }, 0); };
    // Runs once per mount; the frames are computed from the layout at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock background scrolling while open.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { root.style.overflow = previous; };
  }, []);

  const requestClose = (): void => {
    if (closingRef.current) return;
    closingRef.current = true;
    const card = cardRef.current;
    if (prefersReducedMotion() || !card || typeof card.animate !== "function") { onCloseRef.current(); return; }
    const frames = cardFrames().reverse();
    scrimRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION_MS, easing: "ease-in", fill: "forwards" });
    const animation = card.animate(frames, { duration: DURATION_MS, easing: EASING, fill: "forwards" });
    const done = (): void => onCloseRef.current();
    animation.addEventListener("finish", done, { once: true });
    animation.addEventListener("cancel", done, { once: true });
  };

  // Esc closes only the lightbox (capture phase, so the tools panel's own Esc handler never sees it). Tab has nowhere else to go: the page behind is inert.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="ua-lb" role="dialog" aria-modal="true" aria-label={label}>
    <div ref={scrimRef} className="ua-lb-scrim" onClick={requestClose} />
    <img ref={cardRef} className="ua-lb-card" src={src} alt={alt} draggable={false} />
    <button ref={closeRef} type="button" className="ua-lb-close" aria-label="关闭放大查看" onClick={requestClose}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
    </button>
  </div>;
}
