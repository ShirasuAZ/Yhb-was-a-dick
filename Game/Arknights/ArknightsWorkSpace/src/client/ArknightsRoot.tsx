import { ArknightsApp } from "./ArknightsApp.tsx";
import { ArknightsLobby } from "./ArknightsLobby.tsx";
import { ArknightsTutorial } from "./ArknightsTutorial.tsx";
import type { Account } from "./cards.ts";

/** Routes inside /arknights-union-arena/: the game lobby, player vs. player, and the tutorial. */
export function ArknightsRoot({ account, token }: { account: Account; token: string | null }) {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/arknights-union-arena/pvp") return <ArknightsApp account={account} token={token} />;
  if (path === "/arknights-union-arena/tutorial") return <ArknightsTutorial account={account} />;
  return <ArknightsLobby account={account} />;
}
