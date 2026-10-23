import { describe, expect, it } from "vitest";
import { LanAccessController } from "../../server/lan.ts";
import { clientAddress } from "../../server/requestAddress.ts";

describe("clientAddress", () => {
  const lan = new LanAccessController({ enabled: false });

  it("uses the forwarded address only for a local proxy", () => {
    expect(clientAddress(lan, "127.0.0.1", "203.0.113.20")).toBe("203.0.113.20");
    expect(clientAddress(lan, "203.0.113.20", "127.0.0.1")).toBe("203.0.113.20");
  });

  it("keeps direct local and unforwarded connections unchanged", () => {
    expect(clientAddress(lan, "127.0.0.1", undefined)).toBe("127.0.0.1");
    expect(clientAddress(lan, "10.0.0.12", undefined)).toBe("10.0.0.12");
  });
});
