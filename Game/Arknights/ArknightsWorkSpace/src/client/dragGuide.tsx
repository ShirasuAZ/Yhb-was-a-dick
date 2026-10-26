import { useCallback, useEffect, useRef, useState } from "react";

/** The line appears once the pointer leaves the button by this much, so a plain tap is still a tap. */
const DRAG_THRESHOLD = 8;

export interface DragGuidance {
  /** The pressed element (the 发动 button). */
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** While a drag is in progress: where the finger is now, in client coordinates. */
  point: { x: number; y: number } | null;
  /** True while the finger is held and has moved past the threshold. */
  dragging: boolean;
}

/**
 * Turns a press-and-drag on a button into a pointing gesture: a line is drawn from the button to the pointer, and letting
 * go over a target card does the thing. A press that never moves is left alone, so the button still works as a button.
 *
 * The target is found with `document.elementFromPoint`, which means the card the player sees under their finger is the
 * card that is chosen — no coordinate maths, and it keeps working when the board is scaled or rotated.
 *
 * `onTarget` receives the element under the pointer on release; it returns true when it consumed the drop, and false when
 * the player let go over empty space (the caller then simply stays where it was).
 */
export function useDragGuidance(onTarget: (element: HTMLElement) => boolean): DragGuidance {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const active = useRef<number | null>(null);

  const reset = useCallback((): void => {
    origin.current = null;
    active.current = null;
    setDragging(false);
    setPoint(null);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    origin.current = { x: event.clientX, y: event.clientY };
    active.current = event.pointerId;
    // Capture keeps the pointer events coming even when the finger leaves the button.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  useEffect(() => {
    if (active.current === null) return undefined;
    const move = (event: PointerEvent): void => {
      const start = origin.current;
      if (!start) return;
      const far = Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_THRESHOLD;
      if (far && !dragging) setDragging(true);
      if (far) setPoint({ x: event.clientX, y: event.clientY });
    };
    const up = (event: PointerEvent): void => {
      const wasDragging = dragging;
      const start = origin.current;
      const moved = start ? Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_THRESHOLD : false;
      reset();
      if (!wasDragging && !moved) return;
      const under = document.elementFromPoint(event.clientX, event.clientY);
      if (under instanceof HTMLElement) onTarget(under);
    };
    const cancel = (): void => reset();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [dragging, onTarget, reset]);

  return { onPointerDown, point, dragging };
}

/**
 * The guide line from the 发动 button to the finger. It is drawn in a fixed overlay, so it can cross the whole screen
 * without being clipped by any card or zone, and it never eats a pointer event itself.
 */
export function DragLine({ from, to }: { from: HTMLElement | null; to: { x: number; y: number } | null }) {
  if (!from || !to) return null;
  const box = from.getBoundingClientRect();
  const x1 = box.left + box.width / 2;
  const y1 = box.top + box.height / 2;
  const length = Math.hypot(to.x - x1, to.y - y1);
  const angle = Math.atan2(to.y - y1, to.x - x1) * (180 / Math.PI);
  return <svg className="ua-dragline" aria-hidden="true">
    <line x1={x1} y1={y1} x2={to.x} y2={to.y} />
    <circle cx={to.x} cy={to.y} r={9} />
    {/* A dot at the start, so the line visibly comes from the button that was held. */}
    <circle cx={x1} cy={y1} r={4} className="ua-dragline-start" />
    <title>{`拖到目标卡牌（${Math.round(length)} px）`}</title>
    <style>{`line{stroke-dasharray:6 5;animation:ua-dash .6s linear infinite}`}</style>
    <g opacity="0">
      <text x={x1} y={y1} transform={`rotate(${angle} ${x1} ${y1})`}>.</text>
    </g>
  </svg>;
}
