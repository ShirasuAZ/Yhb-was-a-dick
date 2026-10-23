export const DEFAULT_HOST_PORT = 3000;
export const HOST_PORT_COUNT = 12;
export const DEFAULT_PROBE_TIMEOUT_MS = 2000;

export type ConnectErrorCode =
  | "EMPTY_ADDRESS"
  | "INVALID_ADDRESS"
  | "INVALID_ROOM"
  | "LAN_CLOSED"
  | "NOT_UNO"
  | "UNREACHABLE";

export class ConnectTargetError extends Error {
  readonly code: ConnectErrorCode;

  constructor(code: ConnectErrorCode, message: string) {
    super(message);
    this.name = "ConnectTargetError";
    this.code = code;
  }
}

export interface HostTarget {
  protocol: "http:" | "https:";
  host: string;
  port: number | null;
  explicitPort: boolean;
  roomCode: string | null;
}

export interface HostInfo {
  ok: boolean;
  app?: string;
  lanEnabled?: boolean;
  port?: number;
  hostName?: string;
  code?: string;
  message?: string;
}

export interface ReachableHost {
  baseUrl: string;
  port: number;
  info: HostInfo;
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

export function targetBaseUrl(target: HostTarget, port: number): string {
  return `${target.protocol}//${formatHost(target.host)}:${port}`;
}

export function parseHostAddress(
  rawAddress: string,
  rawRoomCode = ""
): HostTarget {
  const trimmed = rawAddress.trim();
  if (!trimmed) {
    throw new ConnectTargetError("EMPTY_ADDRESS", "请输入主机 IP 地址");
  }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    const numericHost = candidate.match(
      /^[a-z][a-z0-9+.-]*:\/\/([0-9.]+)(?::\d+)?(?:\/|$)/i
    )?.[1];
    if (numericHost) {
      const octets = numericHost.split(".");
      if (
        octets.length !== 4 ||
        octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)
      ) {
        throw new ConnectTargetError("INVALID_ADDRESS", "IPv4 地址格式无效");
      }
    }
    throw new ConnectTargetError("INVALID_ADDRESS", "主机地址格式无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConnectTargetError("INVALID_ADDRESS", "主机地址只支持 HTTP 或 HTTPS");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) {
    throw new ConnectTargetError("INVALID_ADDRESS", "主机地址格式无效");
  }
  if (/^[0-9.]+$/.test(host)) {
    const octets = host.split(".");
    if (
      octets.length !== 4 ||
      octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)
    ) {
      throw new ConnectTargetError("INVALID_ADDRESS", "IPv4 地址格式无效");
    }
  }
  const roomCode = rawRoomCode.trim().toUpperCase();
  if (roomCode && !/^[A-Z2-9]{6}$/.test(roomCode)) {
    throw new ConnectTargetError("INVALID_ROOM", "请输入 6 位房间号");
  }
  const linkedRoom =
    url.pathname.match(/^\/room\/([A-Z2-9]{6})\/?$/i)?.[1]?.toUpperCase() ??
    null;
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : null;
  return {
    protocol: url.protocol as "http:" | "https:",
    host,
    port,
    explicitPort: Boolean(url.port) || url.protocol === "https:",
    roomCode: roomCode || linkedRoom
  };
}

async function readJson(response: Response): Promise<HostInfo | null> {
  try {
    const value = (await response.json()) as unknown;
    return typeof value === "object" && value !== null
      ? (value as HostInfo)
      : null;
  } catch {
    return null;
  }
}

export async function probeHost(
  baseUrl: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS
): Promise<HostInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/join-info`, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const body = await readJson(response);
    if (response.status === 403 && body?.code === "LAN_CLOSED") {
      throw new ConnectTargetError(
        "LAN_CLOSED",
        `请先开启局域网访问：已找到主机 ${baseUrl}，但主机当前拒绝了远程连接。请在主机等待页点击“开放局域网访问”后重试。`
      );
    }
    if (response.ok && body?.ok && body.app === "uno") {
      return body;
    }
    if (body?.app && body.app !== "uno") {
      throw new ConnectTargetError(
        "NOT_UNO",
        "该地址上运行的不是 UNO 游戏服务，请检查 IP 和端口。"
      );
    }
    throw new ConnectTargetError(
      "UNREACHABLE",
      `主机返回了无法识别的响应（HTTP ${response.status}）。请确认地址和端口。`
    );
  } catch (error) {
    if (error instanceof ConnectTargetError) {
      throw error;
    }
    const timedOut =
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError";
    throw new ConnectTargetError(
      "UNREACHABLE",
      timedOut
        ? `连接 ${baseUrl} 超时。请确认主机已启动、已开放局域网访问，并检查网络可达性和防火墙。`
        : `无法连接 ${baseUrl}。请确认 IP/端口正确、主机已启动并开放局域网访问，且网络和防火墙允许连接。`
    );
  } finally {
    clearTimeout(timer);
  }
}

function portsToProbe(target: HostTarget): number[] {
  if (target.explicitPort && target.port) {
    return [target.port];
  }
  return [
    ...(target.protocol === "http:" ? [80] : []),
    ...Array.from(
      { length: HOST_PORT_COUNT },
      (_value, index) => DEFAULT_HOST_PORT + index
    )
  ];
}

export async function resolveHost(
  target: HostTarget,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS
): Promise<ReachableHost> {
  const ports = portsToProbe(target);
  return new Promise<ReachableHost>((resolve, reject) => {
    let pending = ports.length;
    let settled = false;
    let closedError: ConnectTargetError | null = null;
    let notUnoCount = 0;
    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      action();
    };
    for (const port of ports) {
      void probeHost(targetBaseUrl(target, port), timeoutMs)
        .then((info) => {
          finish(() =>
            resolve({
              baseUrl: targetBaseUrl(target, port),
              port,
              info
            })
          );
        })
        .catch((error: unknown) => {
          const targetError =
            error instanceof ConnectTargetError
              ? error
              : new ConnectTargetError("UNREACHABLE", "无法连接主机");
          if (targetError.code === "LAN_CLOSED" && !closedError) {
            closedError = targetError;
          }
          if (targetError.code === "NOT_UNO") {
            notUnoCount += 1;
          }
        })
        .finally(() => {
          pending -= 1;
          if (pending > 0) {
            return;
          }
          finish(() => {
            if (closedError) {
              reject(closedError);
              return;
            }
            if (notUnoCount === ports.length) {
              reject(
                new ConnectTargetError(
                  "NOT_UNO",
                  `在 ${target.host} 上找到了网页服务，但不是 UNO 游戏主机。请检查端口。`
                )
              );
              return;
            }
            reject(
              new ConnectTargetError(
                "UNREACHABLE",
                target.explicitPort
                  ? `无法连接 ${target.host}:${target.port}。请确认主机已启动、端口正确且防火墙允许 TCP 连接。`
                  : `无法连接 ${target.host}。已检查 80、3000–3011 端口；请确认主机已启动、开放局域网访问，或输入完整的“IP:端口”。`
              )
            );
          });
        });
    }
  });
}

export function joinUrl(baseUrl: string, roomCode: string | null): string {
  return roomCode ? `${baseUrl}/room/${roomCode}` : `${baseUrl}/`;
}

/** Secure pages cannot fetch a private HTTP host, but top-level navigation can reach it. */
export function directLanNavigationUrl(
  currentProtocol: string,
  target: HostTarget
): string | null {
  if (currentProtocol !== "https:" || target.protocol !== "http:") return null;
  const port = target.port ?? DEFAULT_HOST_PORT;
  return `${targetBaseUrl(target, port)}/join`;
}
