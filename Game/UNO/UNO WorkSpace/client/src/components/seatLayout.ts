import type { PublicPlayer } from "@shared/protocol.ts";

export type SeatSlot =
  | "top-center"
  | "top-left"
  | "top-right"
  | "left-middle"
  | "right-middle"
  | "bottom-left"
  | "bottom-right";

const SLOTS_BY_PLAYER_COUNT: Record<number, SeatSlot[]> = {
  2: ["top-center"],
  3: ["top-center", "left-middle"],
  4: ["top-center", "left-middle", "right-middle"],
  5: ["top-center", "left-middle", "right-middle", "bottom-left"],
  6: [
    "top-left",
    "top-right",
    "left-middle",
    "right-middle",
    "bottom-left"
  ]
};

export function opponentSlotsFor(totalPlayers: number): SeatSlot[] {
  return SLOTS_BY_PLAYER_COUNT[totalPlayers] ?? [];
}

export function playersRelativeToSelf(
  players: PublicPlayer[],
  selfId: string
): PublicPlayer[] {
  const ordered = [...players].sort((left, right) => left.seat - right.seat);
  const selfIndex = ordered.findIndex((player) => player.id === selfId);
  if (selfIndex < 0) {
    return ordered;
  }
  return [...ordered.slice(selfIndex + 1), ...ordered.slice(0, selfIndex)];
}

export interface SeatedOpponent {
  player: PublicPlayer;
  slot: SeatSlot;
}

export function seatedOpponents(
  players: PublicPlayer[],
  selfId: string
): SeatedOpponent[] {
  const activePlayers = players.filter((player) => player.active);
  const relative = playersRelativeToSelf(activePlayers, selfId).filter(
    (player) => player.id !== selfId
  );
  const slots = opponentSlotsFor(activePlayers.length);
  return relative.map((player, index) => ({
    player,
    slot: slots[index] ?? "top-center"
  }));
}
