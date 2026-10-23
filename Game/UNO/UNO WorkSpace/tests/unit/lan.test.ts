import { describe, expect, it } from "vitest";
import { LanAccessController } from "../../server/lan.ts";

const fakeInterfaces = {
  WLAN: [
    {
      address: "192.168.1.10",
      netmask: "255.255.255.0",
      family: "IPv4",
      mac: "00:11:22:33:44:55",
      internal: false,
      cidr: "192.168.1.10/24"
    }
  ],
  "Radmin VPN": [
    {
      address: "26.1.2.3",
      netmask: "255.0.0.0",
      family: "IPv4",
      mac: "00:11:22:33:44:56",
      internal: false,
      cidr: "26.1.2.3/8"
    }
  ],
  UUGameBooster: [
    {
      address: "10.20.30.40",
      netmask: "255.255.0.0",
      family: "IPv4",
      mac: "00:11:22:33:44:57",
      internal: false,
      cidr: "10.20.30.40/16"
    }
  ],
  "小蓝盾虚拟网卡": [
    {
      address: "172.20.0.8",
      netmask: "255.255.0.0",
      family: "IPv4",
      mac: "00:11:22:33:44:58",
      internal: false,
      cidr: "172.20.0.8/16"
    }
  ],
  loopback: [
    {
      address: "127.0.0.1",
      netmask: "255.0.0.0",
      family: "IPv4",
      mac: "00:00:00:00:00:00",
      internal: true,
      cidr: "127.0.0.1/8"
    }
  ]
} as unknown as NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>;

function controller(enabled: boolean): LanAccessController {
  const instance = new LanAccessController({
    enabled,
    hostName: "UNO-HOST",
    interfaces: fakeInterfaces
  });
  instance.setPort(3000);
  return instance;
}

describe("LAN access controller", () => {
  it("lists physical and virtual adapters with usable URLs", () => {
    const status = controller(true).status();
    expect(status.hostName).toBe("UNO-HOST");
    expect(status.localUrl).toBe("http://127.0.0.1:3000");
    expect(status.addresses).toHaveLength(4);
    expect(status.addresses.map((address) => address.kind)).toEqual([
      "wlan",
      "radmin",
      "uu",
      "blue-shield"
    ]);
    expect(status.addresses.map((address) => address.url)).toEqual([
      "http://192.168.1.10:3000",
      "http://26.1.2.3:3000",
      "http://10.20.30.40:3000",
      "http://172.20.0.8:3000"
    ]);
  });

  it("recognizes loopback and local interface addresses as host-local", () => {
    const lan = controller(true);
    expect(lan.isLocalAddress("127.0.0.1")).toBe(true);
    expect(lan.isLocalAddress("::1")).toBe(true);
    expect(lan.isLocalAddress("::ffff:192.168.1.10")).toBe(true);
    expect(lan.isLocalAddress("26.1.2.3")).toBe(true);
    expect(lan.isLocalAddress("192.168.1.99")).toBe(false);
  });

  it("blocks remote connections when closed while preserving local access", () => {
    const lan = controller(true);
    expect(lan.allowsConnection("192.168.1.99")).toBe(true);
    lan.setEnabled(false);
    expect(lan.isEnabled()).toBe(false);
    expect(lan.allowsConnection("192.168.1.99")).toBe(false);
    expect(lan.allowsConnection("127.0.0.1")).toBe(true);
    expect(lan.allowsConnection("192.168.1.10")).toBe(true);
    lan.setEnabled(true);
    expect(lan.allowsConnection("192.168.1.99")).toBe(true);
  });
});
