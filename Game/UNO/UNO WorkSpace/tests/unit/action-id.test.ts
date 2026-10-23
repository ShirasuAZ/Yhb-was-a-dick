import { afterEach, describe, expect, it, vi } from "vitest";
import { createActionId } from "../../client/src/actionId.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("action ids", () => {
  it("still produces valid ids when randomUUID is unavailable", () => {
    let counter = 0;
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        for (let index = 0; index < bytes.length; index += 1) {
          counter += 1;
          bytes[index] = (counter * 37 + index * 11) & 0xff;
        }
        return bytes;
      }
    });

    const first = createActionId();
    const second = createActionId();
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(first).toHaveLength(36);
    expect(second).not.toBe(first);
  });
});
