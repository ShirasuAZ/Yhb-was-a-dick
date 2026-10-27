/** How long the card takes to travel from the field to its pile. */
const FLY_MS = 300;
/** How long the arriving pile card takes to settle in. */
const LAND_MS = 280;

/**
 * A card that has just left the field (beaten as a blocker, or sent off by an effect) flies from where it stood to the
 * pile it went into, shrinking and fading on the way, and the pile's new top card settles in as it lands. Purely
 * cosmetic: it reads nothing from the game state and writes nothing back — it draws one element for the length of the
 * animation and then removes it.
 *
 * The start box is the card element's own `getBoundingClientRect`, so the opponent's rotated half needs no special
 * handling: screen coordinates are already what the animation needs.
 */
export function flyCardToPile(source: HTMLElement): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Which half the card stood in decides which pile it lands in.
  const half = source.closest(".ua-half");
  const side = half?.getAttribute("data-side") === "opponent" ? "opp" : "you";
  const pile = document.querySelector<HTMLElement>(`[data-drop="${side}:sideline"]`);
  const from = source.getBoundingClientRect();
  if (!pile || from.width <= 0) return;
  const to = pile.getBoundingClientRect();
  if (to.width <= 0) return;

  const ghost = document.createElement("div");
  ghost.className = "ua-flycard";
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  ghost.style.width = `${from.width}px`;
  ghost.style.height = `${from.height}px`;
  // The card's own artwork, so the flying card looks like the one that left.
  const art = source.querySelector("img");
  if (art instanceof HTMLImageElement) {
    const image = document.createElement("img");
    image.src = art.currentSrc || art.src;
    image.alt = "";
    ghost.appendChild(image);
  }
  document.body.appendChild(ghost);

  // Where the pile sits relative to where the card was, and how far it has to shrink to match the pile's card size.
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const scale = Math.max(0.18, Math.min(1, to.width / from.width));
  let removed = false;
  const remove = (): void => {
    if (removed) return;
    removed = true;
    ghost.remove();
  };

  // One frame at rest, then move, so the browser has a starting point to interpolate from.
  requestAnimationFrame(() => {
    ghost.style.transition = `transform ${FLY_MS}ms cubic-bezier(.4, .1, .3, 1), opacity ${FLY_MS}ms ease-in`;
    ghost.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    ghost.style.opacity = "0";
  });
  ghost.addEventListener("transitionend", remove, { once: true });
  // A backgrounded tab can stall transitions; the ghost must never be left behind.
  window.setTimeout(remove, FLY_MS + 400);

  // Let the pile's top card settle in as the flight lands.
  const top = pile.querySelector<HTMLElement>(".ua-slot");
  if (top) {
    window.setTimeout(() => {
      top.classList.remove("is-landing");
      void top.offsetWidth; // restart the animation even when the class was just removed
      top.classList.add("is-landing");
      window.setTimeout(() => top.classList.remove("is-landing"), LAND_MS);
    }, Math.max(0, FLY_MS - 60));
  }
}
