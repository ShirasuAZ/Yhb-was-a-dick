import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const realImages = path.resolve(process.cwd(), "../../Arknights/ArknightsWorkSpace/Cards/images");
let workspace = "";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = "";
});

describe("Arknights card catalog", () => {
  it("has printed card data even when the deployed workspace directory has no Cards/cards.json", async () => {
    // A workspace deployed before cards.json existed: card images and index only.
    workspace = mkdtempSync(path.join(os.tmpdir(), "arknights-old-workspace-"));
    mkdirSync(path.join(workspace, "Cards"));
    symlinkSync(realImages, path.join(workspace, "Cards", "images"));
    vi.stubEnv("UNION_ARENA_WORKSPACE_DIR", workspace);
    vi.resetModules();
    const { UNION_ARENA_CATALOG } = await import("../../../../Arknights/ArknightsWorkSpace/src/server/catalog.ts");
    const usable = UNION_ARENA_CATALOG.filter((card) => card.imageAvailable);
    expect(usable).toHaveLength(252);
    expect(usable.filter((card) => !card.stats)).toEqual([]);
  });
});
