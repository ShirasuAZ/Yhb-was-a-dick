import {
  createServer,
  type RequestListener,
  type Server
} from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConnectTargetError,
  directLanNavigationUrl,
  joinUrl,
  parseHostAddress,
  resolveHost,
  targetBaseUrl
} from "../../client/src/connectTarget.ts";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

async function startProbeServer(
  handler: RequestListener
): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start probe test server");
  }
  return address.port;
}

describe("connect target parsing", () => {
  it("accepts a bare IP and remembers that no port was supplied", () => {
    const target = parseHostAddress(" 192.168.1.10 ");
    expect(target).toEqual({
      protocol: "http:",
      host: "192.168.1.10",
      port: null,
      explicitPort: false,
      roomCode: null
    });
  });

  it("keeps an explicit port and extracts a room code from a full link", () => {
    const target = parseHostAddress(
      "http://26.209.70.144:3001/room/A7K9Q2/"
    );
    expect(target.port).toBe(3001);
    expect(target.explicitPort).toBe(true);
    expect(target.roomCode).toBe("A7K9Q2");
    expect(joinUrl(targetBaseUrl(target, 3001), target.roomCode)).toBe(
      "http://26.209.70.144:3001/room/A7K9Q2"
    );
  });

  it("uses 443 for an HTTPS address without a port", () => {
    const target = parseHostAddress("https://uno.example.com");
    expect(target.port).toBe(443);
    expect(target.explicitPort).toBe(true);
  });

  it("accepts any syntactically valid IPv4 range, including virtual network IPs", () => {
    expect(parseHostAddress("26.209.70.144").host).toBe("26.209.70.144");
    expect(parseHostAddress("172.31.250.7").host).toBe("172.31.250.7");
    expect(() => parseHostAddress("300.1.2.3")).toThrow("IPv4 地址格式无效");
  });

  it("navigates from HTTPS directly to LAN HTTP without blocked fetch probing", () => {
    expect(directLanNavigationUrl("https:", parseHostAddress("26.209.70.144"))).toBe(
      "http://26.209.70.144:3000/join"
    );
    expect(directLanNavigationUrl("https:", parseHostAddress("26.209.70.144:3007"))).toBe(
      "http://26.209.70.144:3007/join"
    );
    expect(directLanNavigationUrl("http:", parseHostAddress("26.209.70.144"))).toBeNull();
  });

  it("rejects an empty address and an invalid room code", () => {
    expect(() => parseHostAddress("  ")).toThrow(ConnectTargetError);
    expect(() => parseHostAddress("127.0.0.1", "ABC")).toThrow(
      ConnectTargetError
    );
  });
});

describe("host probing", () => {
  it("recognizes a reachable UNO host without a page navigation", async () => {
    const port = await startProbeServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          ok: true,
          app: "uno",
          lanEnabled: true
        })
      );
    });
    const target = parseHostAddress(`127.0.0.1:${port}`, "A7K9Q2");
    const host = await resolveHost(target);
    expect(host.baseUrl).toBe(`http://127.0.0.1:${port}`);
    expect(host.port).toBe(port);
    expect(host.info.app).toBe("uno");
    expect(joinUrl(host.baseUrl, target.roomCode)).toBe(
      `http://127.0.0.1:${port}/room/A7K9Q2`
    );
  });

  it("reports the host's closed LAN switch instead of a generic timeout", async () => {
    const port = await startProbeServer((_request, response) => {
      response.statusCode = 403;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          ok: false,
          code: "LAN_CLOSED",
          message: "closed"
        })
      );
    });
    const target = parseHostAddress(`127.0.0.1:${port}`);
    await expect(resolveHost(target)).rejects.toMatchObject({
      code: "LAN_CLOSED"
    });
  });

  it("reports the actual target and port when the host cannot be reached", async () => {
    const target = parseHostAddress("127.0.0.1:1");
    await expect(resolveHost(target, 50)).rejects.toThrow(
      "无法连接 127.0.0.1:1"
    );
  });
});
