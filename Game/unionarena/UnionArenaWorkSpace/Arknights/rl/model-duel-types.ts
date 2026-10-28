import type { UnionArenaRoomState } from "../src/shared/protocol.ts";

export interface DuelMove {
  number: number; seat: string; label: string; turn: number; phase: string;
  action: string; reason: string; elapsedMs: number; attempts: number; model: string;
}
export interface DuelSnapshot {
  state: UnionArenaRoomState;
  opponentHand: string[];
  labels: Record<string, string>;
  decks: Record<string, string>;
  status: "ready" | "thinking" | "playing" | "finished" | "error";
  thinkingSeat: string | null;
  thinkingSince: number | null;
  error: string | null;
  startedAt: number;
  moves: DuelMove[];
  usage: Record<string, { prompt_tokens: number; completion_tokens: number }>;
}
