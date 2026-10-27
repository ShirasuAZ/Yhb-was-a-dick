import { describe, expect, it } from "vitest";
import {
  DEFAULT_IP_ID,
  IPS,
  directoryOf,
  ipById,
  ipName,
  ipOfNumber,
  isIpId,
  workCodeOf
} from "../../../../unionarena/UnionArenaWorkSpace/Arknights/src/shared/ips.ts";

describe("IP classification", () => {
  it("covers the five titles, Arknights first", () => {
    expect(IPS.map((ip) => ip.id)).toEqual(["ark", "aot", "jjk", "kmy", "eva"]);
    expect(IPS.map((ip) => ip.code)).toEqual(["ARK", "AOT", "JJK", "KMY", "EVA"]);
    expect(DEFAULT_IP_ID).toBe("ark");
  });

  it("reads the work code out of a card number", () => {
    expect(workCodeOf("UC01BT/ARK-1-001")).toBe("ARK");
    expect(workCodeOf("UE10BT/AOT-1-001")).toBe("AOT");
    expect(workCodeOf("EX04BT/JJK-1-040")).toBe("JJK");
    expect(workCodeOf("EX05BT/KMY-3-002")).toBe("KMY");
    expect(workCodeOf("UC03BT/EVA-1-002")).toBe("EVA");
  });

  it("identifies a card's title by its number, for every title", () => {
    expect(ipOfNumber("UC01BT/ARK-1-001")).toBe("ark");
    expect(ipOfNumber("UE10BT/AOT-1-001")).toBe("aot");
    expect(ipOfNumber("EX04BT/JJK-1-040")).toBe("jjk");
    expect(ipOfNumber("EX05BT/KMY-3-002")).toBe("kmy");
    expect(ipOfNumber("UC03BT/EVA-1-002")).toBe("eva");
  });

  it("does not fold an unknown or malformed code into Arknights", () => {
    // The old code took whatever came before the first dash as the work; anything unknown must stay unknown.
    expect(ipOfNumber("XX99BT/ZZZ-1-001")).toBeNull();
    expect(ipOfNumber("XXXX/UNKNOWN-1-1")).toBeNull();
    expect(ipOfNumber("no-slash-at-all")).toBeNull();
    expect(ipOfNumber("")).toBeNull();
    expect(ipOfNumber("UC01BT/")).toBeNull();
  });

  it("matches whole codes, not prefixes of them", () => {
    // "ARKX" and "AO" must not be read as ARK / AOT.
    expect(ipOfNumber("UC01BT/ARKX-1-001")).toBeNull();
    expect(ipOfNumber("UE10BT/AO-1-001")).toBeNull();
    expect(ipOfNumber("UE10BT/AOTX-1-001")).toBeNull();
    // The code is what sits before the first dash after the slash.
    expect(ipOfNumber("UC01BT/ARK-9-999")).toBe("ark");
  });

  it("is case-insensitive about the code, as printed numbers vary", () => {
    expect(ipOfNumber("uc01bt/ark-1-001")).toBe("ark");
  });

  it("names and locates each title, and refuses ids it does not know", () => {
    expect(ipName("jjk")).toBe("咒术回战");
    expect(ipName("kmy")).toBe("鬼灭之刃");
    expect(ipName("aot")).toBe("进击的巨人");
    expect(ipName("eva")).toBe("新世纪福音战士");
    expect(ipName("nope")).toBe("未知作品");
    expect(directoryOf("aot")).toBe("AttackOnTitan");
    expect(directoryOf("nope")).toBeNull();
    expect(ipById("ark")?.code).toBe("ARK");
    expect(ipById(null)).toBeNull();
  });

  it("validates ids coming from a client", () => {
    expect(isIpId("ark")).toBe(true);
    expect(isIpId("matrix")).toBe(false);
    expect(isIpId(null)).toBe(false);
    expect(isIpId(7)).toBe(false);
  });
});
