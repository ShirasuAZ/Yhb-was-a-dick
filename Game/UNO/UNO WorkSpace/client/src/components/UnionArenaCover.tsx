/**
 * The cover of the UNION ARENA entry on the home page.
 *
 * It is built from the five official product banners already in the workspace (one per title) rather than from any single
 * title's art, so the entry reads as one card game that several anime titles appear in — not as an Arknights game. Each
 * banner carries the UNION ARENA logo at its left and its characters at its right; the strip shows the character area of
 * each, cropped by CSS (`object-position`), so the logos are not repeated five times and no character is cut in half.
 *
 * Every tile is a plain <img> with a local file, so there is no extra request, no runtime dependency and no external URL;
 * if a file is missing the tile falls back to the panel's own background instead of showing a broken image.
 */
import { useState } from "react";

interface CoverTile {
  /** The title, used as alt text so the banner is not purely decorative to a screen reader. */
  name: string;
  src: string;
  /** Which part of the banner holds the characters, as `object-position`. */
  position: string;
}

const TILES: readonly CoverTile[] = [
  { name: "明日方舟", src: "/assets/union-arena/ark.jpg", position: "72% 34%" },
  { name: "进击的巨人", src: "/assets/union-arena/aot.png", position: "58% 42%" },
  { name: "咒术回战", src: "/assets/union-arena/jjk.png", position: "58% 40%" },
  { name: "鬼灭之刃", src: "/assets/union-arena/kmy.png", position: "56% 42%" },
  { name: "新世纪福音战士", src: "/assets/union-arena/eva.png", position: "62% 40%" }
];

export function UnionArenaCover() {
  /** The files that did not load, so a missing banner shows the panel background rather than a broken-image icon. */
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  return <div className="ua-brand-cover" aria-hidden="true">
    {TILES.map((tile) => <div key={tile.src} className="ua-brand-tile" data-missing={failed.has(tile.src) ? "true" : undefined}>
      {failed.has(tile.src)
        ? null
        : <img src={tile.src} alt="" draggable={false} style={{ objectPosition: tile.position }}
            onError={() => setFailed((current) => new Set(current).add(tile.src))} />}
    </div>)}
  </div>;
}
