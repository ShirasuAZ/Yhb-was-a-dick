/**
 * Where a game sends a player who opens the account settings: the same page, with a note of where to come back to. The
 * settings page turns that into "返回对局" — a short allowlist, so a query string can never send anyone somewhere arbitrary.
 */
export type SettingsOrigin = "arknights-pvp" | "arknights-ai" | "arknights-tutorial" | "uno-lobby" | "uno-room" | "shogi";

export function settingsHref(from: SettingsOrigin): string {
  return `/about?from=${from}`;
}
