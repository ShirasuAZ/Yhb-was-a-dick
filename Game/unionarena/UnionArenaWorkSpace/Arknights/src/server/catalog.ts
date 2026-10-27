import fs from "node:fs";
import path from "node:path";
import type { UnionArenaCardStats } from "../shared/protocol.ts";
import { IPS, ipOfNumber, type IpId } from "../shared/ips.ts";
import { assembleCatalog, type UnionArenaCardRecord, type UnionArenaTitleSource } from "./types.ts";
import bundledArknightsCardData from "../../Cards/cards.json";

/**
 * The card catalog: every title in this workspace, merged into one list.
 *
 * Each title lives in its own folder (`Arknights`, `AttackOnTitan`, …) with `Cards/cards.json` (the printed data) and
 * `Cards/images/_index.csv` (one row per print, next to the pictures). A title's cards are read from its own folder, and
 * the title of each card comes from its card number — never from which folder it was found in, and never from its name.
 */

const currentDirectory = path.resolve(process.cwd());
const neighboringWorkspace = path.resolve(currentDirectory, "../../unionarena/UnionArenaWorkSpace/Arknights");
const detectedWorkspace = fs.existsSync(path.join(currentDirectory, "Cards", "images"))
  ? currentDirectory
  : fs.existsSync(path.join(neighboringWorkspace, "Cards", "images"))
    ? neighboringWorkspace
    : path.join(currentDirectory, "arknights");
const workspaceRoot = path.resolve(
  process.env.UNION_ARENA_WORKSPACE_DIR ?? detectedWorkspace
);

/** The folder holding every title: the Arknights folder's parent (`UnionArenaWorkSpace`). */
const titlesRoot = path.resolve(
  process.env.UNION_ARENA_TITLES_DIR ?? path.dirname(workspaceRoot)
);

function assetRoot(): string {
  return path.resolve(process.env.UNION_ARENA_ASSET_DIR ?? path.join(workspaceRoot, "Cards", "images"));
}

type IndexRow = Omit<UnionArenaCardRecord, "parallelIds" | "sourceMaterialCode" | "ipId" | "imageAvailable" | "stats">;

/** One `_index.csv`, as rows. A file that is missing or has a malformed line is reported, not guessed at. */
function csvRows(directory: string): IndexRow[] {
  const indexFile = path.join(directory, "Cards", "images", "_index.csv");
  if (!fs.existsSync(indexFile)) return [];
  const rows: IndexRow[] = [];
  for (const line of fs.readFileSync(indexFile, "utf8").split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const match = line.match(/^"([^"]+)","([^"]+)","([^"]*)","([^"]*)","([^"]+)"$/);
    if (!match) continue;
    rows.push({ id: match[1]!, number: match[2]!, name: match[3]!, rarity: match[4]!, file: match[5]! });
  }
  return rows;
}

/**
 * A title's printed card data, keyed by card number. Arknights' copy is imported, so a deployment that only replaces
 * `dist/` still has it; every other title is read from its folder. UNION_ARENA_CARD_DATA can point Arknights at another
 * file instead.
 *
 * The files carry a few fields the engine has no use for (`name`, `works`, the source ids the downloader recorded);
 * they are dropped so a card's stats are exactly the printed data.
 */
type CardDataEntry = UnionArenaCardStats & Record<string, unknown> & { number: string };

function cardStats(directory: string, bundled: boolean): Map<string, UnionArenaCardStats> {
  const override = process.env.UNION_ARENA_CARD_DATA;
  let entries: CardDataEntry[];
  if (bundled) {
    entries = (override
      ? JSON.parse(fs.readFileSync(path.resolve(override), "utf8"))
      : bundledArknightsCardData) as CardDataEntry[];
  } else {
    const ownFile = path.join(directory, "Cards", "cards.json");
    if (!fs.existsSync(ownFile)) return new Map();
    entries = JSON.parse(fs.readFileSync(ownFile, "utf8")) as CardDataEntry[];
  }
  return new Map(entries.map(({ number, name: _name, works: _works, _goodsId, _image, ...stats }) => [number, stats as unknown as UnionArenaCardStats]));
}

/** Everything one title contributes, or null when its folder is not present (a deployment may carry only some titles). */
function titleSource(directory: string, bundled: boolean): UnionArenaTitleSource | null {
  if (!fs.existsSync(path.join(directory, "Cards", "images"))) return null;
  const images = path.join(directory, "Cards", "images");
  return {
    rows: csvRows(directory),
    statsByNumber: cardStats(directory, bundled),
    availableFiles: new Set(fs.existsSync(images) ? fs.readdirSync(images) : [])
  };
}

/** The folders to read: every title of `IPS`. UNION_ARENA_ASSET_DIR overrides Arknights' image folder only (the one
 * deployment knob that existed before the other titles, so a deployment that sets it keeps working). */
function sources(): UnionArenaTitleSource[] {
  const out: UnionArenaTitleSource[] = [];
  for (const ip of IPS) {
    const directory = path.join(titlesRoot, ip.directory);
    if (!fs.existsSync(path.join(directory, "Cards", "images"))) continue;
    const source = titleSource(directory, ip.id === "ark");
    if (!source) continue;
    if (ip.id === "ark" && process.env.UNION_ARENA_ASSET_DIR) {
      const override = assetRoot();
      source.availableFiles = new Set(fs.existsSync(override) ? fs.readdirSync(override) : []);
    }
    out.push(source);
  }
  return out;
}

const collected = sources();
export const UNION_ARENA_CATALOG: UnionArenaCardRecord[] = assembleCatalog(collected);
/** The asset root per title: card images are served from the title's own folder. */
export const UNION_ARENA_TITLE_ASSET_ROOTS: ReadonlyMap<IpId, string> = new Map(
  IPS.map((ip) => [ip.id, path.join(titlesRoot, ip.directory, "Cards", "images")])
);
export const UNION_ARENA_ASSET_ROOT = assetRoot();
/** Each title's `Cards/translations.json`, when it has one. */
export const UNION_ARENA_TITLE_TRANSLATIONS: ReadonlyMap<IpId, string> = new Map(
  IPS.map((ip) => [ip.id, path.join(titlesRoot, ip.directory, "Cards", "translations.json")])
);
export const UNION_ARENA_BATTLE_MAP = path.join(workspaceRoot, "Map", "对战地图.png");
/** Cards whose number carries a work code no title claims. Reported at startup, and refused in decks. */
export const UNION_ARENA_UNKNOWN_TITLE_CARDS: readonly UnionArenaCardRecord[] =
  UNION_ARENA_CATALOG.filter((card) => card.ipId === null);
/** Every card id that can go into a deck, by title. */
export const UNION_ARENA_AVAILABLE_IDS: ReadonlySet<string> =
  new Set(UNION_ARENA_CATALOG.filter((card) => card.imageAvailable).map((card) => card.id));

/** How many card records each title contributes, for the startup log and the report. */
export function catalogCounts(): Array<{ ip: IpId; prints: number; numbers: number; withData: number }> {
  return IPS.map((ip) => {
    const cards = UNION_ARENA_CATALOG.filter((card) => card.ipId === ip.id);
    return {
      ip: ip.id,
      prints: cards.length,
      numbers: new Set(cards.map((card) => card.number)).size,
      withData: cards.filter((card) => card.stats).length
    };
  });
}

/** The title's folder, for diagnostics. */
export function titleDirectory(ip: IpId): string | null {
  const title = IPS.find((entry) => entry.id === ip);
  return title ? path.join(titlesRoot, title.directory) : null;
}

export { ipOfNumber };
