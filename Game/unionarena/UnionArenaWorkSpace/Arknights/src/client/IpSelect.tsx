import { IPS, ipById, type IpId } from "../shared/ips.ts";

/**
 * The title a card list, a deck or an opponent plays as. It is one control, used in the same shape everywhere: the card
 * catalog, the deck panel and both sides of the vs-computer page. "全部 IP" is only ever offered where browsing several
 * titles at once is the point (the card catalog), never where a single deck has to be chosen.
 */
export function IpSelect({ value, onChange, label, allowAll = false, disabled = false, id }: {
  value: IpId | "all";
  onChange: (value: IpId | "all") => void;
  label: string;
  /** Offers "全部 IP" on top of the five titles. Browsing only — a deck still belongs to one title. */
  allowAll?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  return <label className="ua-ip-select">{label}
    <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as IpId | "all")}>
      {allowAll ? <option value="all">全部 IP</option> : null}
      {IPS.map((ip) => <option key={ip.id} value={ip.id}>{ip.name}</option>)}
    </select>
  </label>;
}

/** The titles plus "全部 IP", for a catalog filter. */
export const ALL_IPS = "all" as const;

/** A card list's filter: a title, or every title. */
export function matchesIp(cardIpId: IpId | null, filter: IpId | "all"): boolean {
  return filter === ALL_IPS || cardIpId === filter;
}

/** "明日方舟" or "全部 IP" — the filter, said the way the picker shows it. */
export function ipFilterName(filter: IpId | "all"): string {
  return filter === ALL_IPS ? "全部 IP" : (ipById(filter)?.name ?? "未知作品");
}
