import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const realWorkspace = path.resolve(process.cwd(), "../../unionarena/UnionArenaWorkSpace");
let workspace = "";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = "";
});

describe("Arknights card catalog", () => {
  it("has printed card data even when the deployed workspace directory has no Cards/cards.json", async () => {
    // A workspace deployed before cards.json existed: the index and the pictures only. Laid out the way a deployment is
    // (one folder per title), and copied rather than symlinked, because creating a symlink needs a privilege Windows
    // does not grant by default — this test is about the catalog, not about links.
    workspace = mkdtempSync(path.join(os.tmpdir(), "arknights-old-workspace-"));
    mkdirSync(path.join(workspace, "Arknights", "Cards"), { recursive: true });
    cpSync(path.join(realWorkspace, "Arknights", "Cards", "images"), path.join(workspace, "Arknights", "Cards", "images"), { recursive: true });
    expect(existsSync(path.join(workspace, "Arknights", "Cards", "cards.json"))).toBe(false);

    vi.stubEnv("UNION_ARENA_WORKSPACE_DIR", path.join(workspace, "Arknights"));
    vi.stubEnv("UNION_ARENA_TITLES_DIR", workspace);
    // The Arknights images come from this copied folder, so the count below is that folder's, not the real one's.
    vi.stubEnv("UNION_ARENA_ASSET_DIR", path.join(workspace, "Arknights", "Cards", "images"));
    vi.resetModules();
    const { UNION_ARENA_CATALOG } = await import("../../../../unionarena/UnionArenaWorkSpace/Arknights/src/server/catalog.ts");
    const usable = UNION_ARENA_CATALOG.filter((card) => card.ipId === "ark" && card.imageAvailable);
    expect(usable).toHaveLength(252);
    // The card data came from the bundled copy, not from the workspace: every usable card still has its printed stats.
    expect(usable.filter((card) => !card.stats)).toEqual([]);
  });
});
