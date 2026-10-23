import os from "node:os";

export type LanAdapterKind =
  | "wlan"
  | "ethernet"
  | "radmin"
  | "uu"
  | "blue-shield"
  | "virtual"
  | "other";

export interface LanAddress {
  name: string;
  address: string;
  url: string;
  kind: LanAdapterKind;
  isVirtual: boolean;
}

export interface LanStatus {
  enabled: boolean;
  hostName: string;
  port: number;
  localUrl: string;
  addresses: LanAddress[];
  updatedAt: number;
}

interface LanControllerOptions {
  enabled?: boolean;
  hostName?: string;
  interfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
}

const VIRTUAL_ADAPTER_PATTERN =
  /vpn|virtual|tap|tun|radmin|uu|gamebooster|小蓝盾|蓝盾|landun|blue.?shield|oray|astral|tailscale|zerotier|vmware|virtualbox|hyper-v/i;

function normalizeAddress(address: string): string {
  return address
    .replace(/^\[|\]$/g, "")
    .replace(/^::ffff:/i, "")
    .split("%")[0]!;
}

function classifyAdapter(name: string): {
  kind: LanAdapterKind;
  isVirtual: boolean;
} {
  if (/radmin/i.test(name)) {
    return { kind: "radmin", isVirtual: true };
  }
  if (/\buu\b|uu加速|uu云|gamebooster/i.test(name)) {
    return { kind: "uu", isVirtual: true };
  }
  if (/小蓝盾|蓝盾|landun|blue.?shield|xld/i.test(name)) {
    return { kind: "blue-shield", isVirtual: true };
  }
  if (/wlan|wi-?fi|wireless|无线/i.test(name)) {
    return { kind: "wlan", isVirtual: false };
  }
  if (/ethernet|以太网/i.test(name)) {
    return { kind: "ethernet", isVirtual: false };
  }
  if (VIRTUAL_ADAPTER_PATTERN.test(name)) {
    return { kind: "virtual", isVirtual: true };
  }
  return { kind: "other", isVirtual: false };
}

const KIND_ORDER: Record<LanAdapterKind, number> = {
  ethernet: 0,
  wlan: 1,
  radmin: 2,
  uu: 3,
  "blue-shield": 4,
  virtual: 5,
  other: 6
};

export class LanAccessController {
  private enabled: boolean;
  private port = 0;
  private updatedAt = Date.now();
  private readonly hostName: string;
  private readonly interfaces: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;

  constructor(options: LanControllerOptions = {}) {
    this.enabled =
      options.enabled ?? process.env.UNO_LAN_OPEN === "1";
    this.hostName = options.hostName ?? os.hostname();
    this.interfaces = () => options.interfaces ?? os.networkInterfaces();
  }

  setPort(port: number): void {
    this.port = port;
    this.updatedAt = Date.now();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): LanStatus {
    this.enabled = enabled;
    this.updatedAt = Date.now();
    return this.status();
  }

  isLocalAddress(rawAddress: string | undefined): boolean {
    if (!rawAddress) {
      return false;
    }
    const address = normalizeAddress(rawAddress);
    if (address === "127.0.0.1" || address === "::1") {
      return true;
    }
    return this.allInterfaceAddresses().has(address);
  }

  allowsConnection(rawAddress: string | undefined): boolean {
    return this.enabled || this.isLocalAddress(rawAddress);
  }

  addresses(): LanAddress[] {
    const result: LanAddress[] = [];
    const interfaces = this.interfaces();
    for (const [name, entries] of Object.entries(interfaces)) {
      for (const entry of entries ?? []) {
        if (
          entry.family !== "IPv4" ||
          entry.internal ||
          entry.address.startsWith("169.254.")
        ) {
          continue;
        }
        const classification = classifyAdapter(name);
        result.push({
          name,
          address: entry.address,
          url: this.port > 0 ? `http://${entry.address}:${this.port}` : "",
          kind: classification.kind,
          isVirtual: classification.isVirtual
        });
      }
    }
    result.sort(
      (left, right) =>
        KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
        left.name.localeCompare(right.name) ||
        left.address.localeCompare(right.address)
    );
    return result;
  }

  status(): LanStatus {
    return {
      enabled: this.enabled,
      hostName: this.hostName,
      port: this.port,
      localUrl: this.port > 0 ? `http://127.0.0.1:${this.port}` : "",
      addresses: this.addresses(),
      updatedAt: this.updatedAt
    };
  }

  private allInterfaceAddresses(): Set<string> {
    const result = new Set<string>();
    for (const entries of Object.values(this.interfaces())) {
      for (const entry of entries ?? []) {
        result.add(normalizeAddress(entry.address));
      }
    }
    return result;
  }
}
