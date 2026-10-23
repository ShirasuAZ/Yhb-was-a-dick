import fs from "node:fs";
import path from "node:path";
import type { UnionArenaCardStats } from "../shared/protocol.ts";
import { buildUnionArenaCatalog, type UnionArenaCardRecord } from "./types.ts";

const currentDirectory = path.resolve(process.cwd());
const neighboringWorkspace = path.resolve(currentDirectory, "../../Arknights/ArknightsWorkSpace");
const detectedWorkspace = fs.existsSync(path.join(currentDirectory, "Cards", "images"))
  ? currentDirectory
  : fs.existsSync(path.join(neighboringWorkspace, "Cards", "images"))
    ? neighboringWorkspace
    : path.join(currentDirectory, "arknights");
const workspaceRoot = path.resolve(
  process.env.UNION_ARENA_WORKSPACE_DIR ?? detectedWorkspace
);

function assetRoot(): string {
  return path.resolve(process.env.UNION_ARENA_ASSET_DIR ?? path.join(workspaceRoot, "Cards", "images"));
}

function csvRows(): Array<Omit<UnionArenaCardRecord, "parallelIds" | "sourceMaterialCode" | "imageAvailable" | "stats">> {
  const indexFile = path.join(assetRoot(), "_index.csv");
  if (!fs.existsSync(indexFile)) return [];
  return fs.readFileSync(indexFile, "utf8")
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^"([^"]+)","([^"]+)","([^"]*)","([^"]*)","([^"]+)"$/);
      if (!match) return null;
      const id = match[1]!;
      const number = match[2]!;
      const name = match[3]!;
      const rarity = match[4]!;
      const file = match[5]!;
      return { id, number, name, rarity, file };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

/** Printed card data (cost, BP, energy, trigger, ability text), transcribed from the card images, keyed by card number. */
function cardStats(): Map<string, UnionArenaCardStats> {
  const file = path.resolve(process.env.UNION_ARENA_CARD_DATA ?? path.join(workspaceRoot, "Cards", "cards.json"));
  if (!fs.existsSync(file)) return new Map();
  const entries = JSON.parse(fs.readFileSync(file, "utf8")) as Array<UnionArenaCardStats & { number: string; name: string }>;
  return new Map(entries.map(({ number, name: _name, ...stats }) => [number, stats]));
}

const rows = csvRows();
const files = new Set(fs.existsSync(assetRoot()) ? fs.readdirSync(assetRoot()) : []);
export const UNION_ARENA_CATALOG = buildUnionArenaCatalog(rows, files, cardStats());
export const UNION_ARENA_ASSET_ROOT = assetRoot();
export const UNION_ARENA_BATTLE_MAP = path.join(workspaceRoot, "Map", "对战地图.png");
