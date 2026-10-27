/**
 * The five titles UNION ARENA ships in this workspace, and the one place that decides which title a card belongs to.
 *
 * Every title is the same game — same rules, same deck construction, same keywords — so this file only carries
 * naming and identity. It is shared by the catalog (server), the deck builder and the card pages (client), so a
 * title is never identified two different ways.
 *
 * A card belongs to a title by its printed card number, never by its name: the number is `UC01BT/ARK-1-001`, and the
 * code between the slash and the first dash (`ARK`) is the title. Names are localized (埃尔文·史密斯 / Erwin Smith)
 * and repeat across titles, so they cannot be used for this.
 */

export type IpId = "ark" | "aot" | "jjk" | "kmy" | "eva";

export interface IpDefinition {
  id: IpId;
  /** The title's name, as the site shows it. */
  name: string;
  /** The code in the card number (`UC01BT/ARK-1-001`). The same code is printed on the cards as the deck's single "work". */
  code: string;
  /** The folder under UnionArenaWorkSpace. */
  directory: string;
  /** Also accepted in a card number, if a title ever prints an extra code. */
  aliases?: readonly string[];
}

/** In the order the catalog, the IP pickers and the deck lists show them. Arknights first: it is the title the game grew from. */
export const IPS: readonly IpDefinition[] = [
  { id: "ark", name: "明日方舟", code: "ARK", directory: "Arknights" },
  { id: "aot", name: "进击的巨人", code: "AOT", directory: "AttackOnTitan" },
  { id: "jjk", name: "咒术回战", code: "JJK", directory: "Jujutsu Kaisen" },
  { id: "kmy", name: "鬼灭之刃", code: "KMY", directory: "Demon Slayer Kimetsu no Yaiba" },
  { id: "eva", name: "新世纪福音战士", code: "EVA", directory: "Neon Genesis Evangelion" }
];

/** The title new decks and the card catalog start on, which is also the one existing players already know. */
export const DEFAULT_IP_ID: IpId = "ark";

const BY_ID = new Map<IpId, IpDefinition>(IPS.map((ip) => [ip.id, ip]));

/** Every code a card number may carry, mapped to its title. Built once so a lookup cannot drift from `IPS`. */
const BY_CODE = new Map<string, IpDefinition>();
for (const ip of IPS) {
  BY_CODE.set(ip.code.toUpperCase(), ip);
  for (const alias of ip.aliases ?? []) BY_CODE.set(alias.toUpperCase(), ip);
}

export function ipById(id: string | null | undefined): IpDefinition | null {
  return (id && BY_ID.get(id as IpId)) || null;
}

export function ipName(id: string | null | undefined): string {
  return ipById(id)?.name ?? "未知作品";
}

export function isIpId(value: unknown): value is IpId {
  return typeof value === "string" && BY_ID.has(value as IpId);
}

/** The work code of a card number: `UC01BT/ARK-1-001` -> `ARK`. Null when the number has no code at all. */
export function workCodeOf(number: string): string | null {
  const slash = number.indexOf("/");
  if (slash < 0) return null;
  const rest = number.slice(slash + 1);
  const dash = rest.indexOf("-");
  const code = (dash < 0 ? rest : rest.slice(0, dash)).trim();
  return code ? code.toUpperCase() : null;
}

/**
 * The title a card number belongs to, or null when the code is not one of ours. An unknown code is never folded into
 * Arknights (or any other title): the catalog reports it, and a deck that contains such a card is refused.
 */
export function ipOfNumber(number: string): IpId | null {
  const code = workCodeOf(number);
  return code ? BY_CODE.get(code)?.id ?? null : null;
}

/** The title's folder under UnionArenaWorkSpace, or null for an unknown id. */
export function directoryOf(id: string | null | undefined): string | null {
  return ipById(id)?.directory ?? null;
}
