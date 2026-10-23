import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isNewerVersion
} from "../../shared/version.ts";

describe("version comparison", () => {
  it("compares numeric version segments", () => {
    expect(compareVersions("1.1.0", "1.0.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
    expect(isNewerVersion("v2.0.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
  });
});
