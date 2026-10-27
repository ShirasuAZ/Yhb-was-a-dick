import type { PointerEvent as ReactPointerEvent } from "react";

/** Hold a card this long without moving to open its detail view. */
export const LONG_PRESS_MS = 450;
/** Moving further than this turns a press into a drag (or, on a card that cannot be dragged, cancels it). */
const DRAG_PX = 7;

export interface DropInfo {
  /** Why this drop cannot be done right now. The zone is still shown, but dimmed, and dropping explains the reason. */
  blocked?: string;
}

export interface GestureHost {
  /** Where this card can be dropped: zone ids (`data-drop`) and card keys (`data-card-key`). Empty means the card cannot be dragged. */
  targets(key: string): ReadonlyMap<string, DropInfo>;
  onDrop(key: string, targetId: string): void;
  onLongPress(key: string, element: HTMLElement): void;
  /** True right before the browser sends the click that belongs to a drag or long press; false when a new press starts. */
  swallowClick(on: boolean): void;
}

/** Marks every zone and card that accepts the dragged (or selected) card. */
export function markDrops(targets: ReadonlyMap<string, DropInfo>): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-drop], [data-card-key]")) {
    const info = (element.dataset.drop !== undefined ? targets.get(element.dataset.drop) : undefined) ?? (element.dataset.cardKey !== undefined ? targets.get(element.dataset.cardKey) : undefined);
    if (info) element.setAttribute("data-drop-ok", info.blocked ? "blocked" : "yes");
  }
}

export function clearDropMarks(): void {
  for (const element of document.querySelectorAll("[data-drop-ok], [data-drop-hover]")) {
    element.removeAttribute("data-drop-ok");
    element.removeAttribute("data-drop-hover");
  }
}

/** The nearest accepting card or zone at or above `start`; a card wins over the zone it sits in. */
export function dropTargetOf(start: Element, targets: ReadonlyMap<string, DropInfo>): { id: string; element: Element } | null {
  for (let node: Element | null = start; node; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    const { cardKey, drop } = node.dataset;
    if (cardKey !== undefined && targets.has(cardKey)) return { id: cardKey, element: node };
    if (drop !== undefined && targets.has(drop)) return { id: drop, element: node };
  }
  return null;
}

/** The accepting zone or card under a point. */
export function findDropTarget(x: number, y: number, targets: ReadonlyMap<string, DropInfo>): { id: string; element: Element } | null {
  for (const hit of document.elementsFromPoint(x, y)) {
    const found = dropTargetOf(hit, targets);
    if (found) return found;
  }
  return null;
}

function makeGhost(source: HTMLElement): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = "ua-drag-ghost";
  const image = source.querySelector("img");
  if (image) {
    const copy = document.createElement("img");
    copy.src = image.currentSrc || image.src;
    copy.alt = "";
    copy.draggable = false;
    ghost.append(copy);
  } else ghost.textContent = source.getAttribute("aria-label") ?? "";
  return ghost;
}

/**
 * One press on a card, mouse or touch alike: a short press is left to the click handler, holding still opens the detail view, and moving
 * picks the card up (when it can go anywhere) and drops it on the zone under the pointer.
 */
export function startGesture(event: ReactPointerEvent<HTMLElement>, key: string, host: GestureHost): void {
  if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
  host.swallowClick(false);
  const element = event.currentTarget;
  const { pointerId, clientX: startX, clientY: startY } = event;
  const targets = host.targets(key);
  let mode: "wait" | "drag" | "ended" = "wait";
  let dragged = false;
  let ghost: HTMLElement | null = null;
  let hovered: Element | null = null;

  const onMove = (move: PointerEvent): void => {
    if (move.pointerId !== pointerId || mode === "ended") return;
    if (mode === "wait") {
      if (Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_PX) return;
      // A card that cannot go anywhere: moving only cancels the long press, the click (to pick it, say) still happens.
      if (targets.size === 0) { finish(); return; }
      window.clearTimeout(timer);
      mode = "drag";
      dragged = true;
      ghost = makeGhost(element);
      document.body.append(ghost);
      element.setAttribute("data-dragging", "");
      clearDropMarks();
      markDrops(targets);
    }
    if (move.cancelable) move.preventDefault();
    ghost!.style.transform = `translate(${move.clientX}px, ${move.clientY}px) translate(-50%, -60%)`;
    const hit = findDropTarget(move.clientX, move.clientY, targets);
    if ((hit?.element ?? null) !== hovered) {
      hovered?.removeAttribute("data-drop-hover");
      hit?.element.setAttribute("data-drop-hover", "");
      hovered = hit?.element ?? null;
    }
  };
  const onUp = (up: PointerEvent): void => {
    if (up.pointerId !== pointerId || mode === "ended") return;
    const hit = mode === "drag" ? findDropTarget(up.clientX, up.clientY, targets) : null;
    if (mode === "drag") host.swallowClick(true);
    finish();
    if (hit) host.onDrop(key, hit.id);
  };
  const onCancel = (cancel: PointerEvent): void => { if (cancel.pointerId === pointerId) finish(); };
  function finish(): void {
    if (mode === "ended") return;
    mode = "ended";
    window.clearTimeout(timer);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    ghost?.remove();
    element.removeAttribute("data-dragging");
    if (dragged) clearDropMarks();
  }
  const timer = window.setTimeout(() => {
    if (mode !== "wait") return;
    finish();
    host.swallowClick(true);
    host.onLongPress(key, element);
  }, LONG_PRESS_MS);
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}
