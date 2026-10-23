import { useState } from "react";
import type {
  ClientToServerEvents,
  LanStatusView,
  RoomState
} from "@shared/protocol.ts";
import { ConnectionBadge } from "./ConnectionBadge.tsx";
import { LanAccessPanel } from "./LanAccessPanel.tsx";
import { VersionBadge } from "./VersionBadge.tsx";
import { ThemeControl } from "./ThemeControl.tsx";
import { createActionId } from "../actionId.ts";
import { copyText } from "../clipboard.ts";
import type { ConnectionStatus } from "../types.ts";

interface WaitingRoomProps {
  room: RoomState;
  connection: ConnectionStatus;
  busy: boolean;
  error: string;
  lanStatus: LanStatusView | null;
  perform: (
    event: keyof ClientToServerEvents,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
  leaveRoom: () => Promise<void>;
  onToggleLan: (enabled: boolean) => Promise<boolean>;
  onRefreshLan: () => Promise<void>;
  setError: (message: string) => void;
}

export function WaitingRoom({
  room,
  connection,
  busy,
  error,
  lanStatus,
  perform,
  leaveRoom,
  onToggleLan,
  onRefreshLan,
  setError
}: WaitingRoomProps) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [readyAction, setReadyAction] = useState<
    "ready" | "unready" | null
  >(null);
  const [starting, setStarting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const readyPending = readyAction !== null;

  const activePlayers = room.players.filter((player) => player.active);
  const allConnected = activePlayers.every((player) => player.connected);
  const allReady = activePlayers
    .filter((player) => player.id !== room.hostId)
    .every((player) => player.ready);
  const canStart =
    room.you.isHost &&
    activePlayers.length >= 2 &&
    activePlayers.length <= 6 &&
    allConnected &&
    allReady;
  const connected = connection === "connected";
  const disabled = busy || !connected;
  const copy = async (value: string, kind: "code" | "link"): Promise<void> => {
    if (await copyText(value)) {
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1800);
    } else {
      setError("复制失败，请手动选择房间号或链接");
    }
  };

  const toggleReady = async (): Promise<void> => {
    if (readyAction || !connected) {
      return;
    }
    const next = !room.you.ready;
    setReadyAction(next ? "ready" : "unready");
    try {
      await perform("set_ready", {
        ready: next,
        actionId: createActionId()
      });
    } finally {
      setReadyAction(null);
    }
  };

  const start = async (): Promise<void> => {
    if (starting || !connected) {
      return;
    }
    setStarting(true);
    const ok = await perform("start_game", {
      actionId: createActionId()
    });
    if (!ok) {
      setStarting(false);
    }
  };

  const leave = async (): Promise<void> => {
    if (leaving) {
      return;
    }
    setLeaving(true);
    await leaveRoom();
    setLeaving(false);
  };

  const refresh = async (): Promise<void> => {
    if (refreshing || !connected) {
      return;
    }
    setRefreshing(true);
    try {
      await perform("sync_room", {});
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="app-shell room-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">房间号</p>
          <div className="room-code-line">
            <strong className="room-code">{room.roomCode}</strong>
            <button
              className="text-button"
              onClick={() => void copy(room.roomCode, "code")}
            >
              {copied === "code" ? "已复制" : "复制房间号"}
            </button>
          </div>
        </div>
        <div className="header-status">
          <ConnectionBadge status={connection} />
          <button
            className="text-button"
            onClick={() => void refresh()}
            disabled={!connected || refreshing}
          >
            {refreshing ? "刷新中…" : "刷新"}
          </button>
          <VersionBadge />
          <ThemeControl />
        </div>
      </header>

      <main className="room-main">
        <section className="panel room-list-panel" aria-labelledby="players-heading">
          <div className="section-heading">
            <h2 id="players-heading">玩家</h2>
            <span className="count-label">
              {activePlayers.length} / 6
            </span>
          </div>
          <ul className="player-list">
            {room.players
              .filter((player) => player.active)
              .sort((left, right) => left.seat - right.seat)
              .map((player) => (
                <li className="player-row" key={player.id}>
                  <div className="player-name-line">
                    <span>{player.name}</span>
                    {player.id === room.you.id ? (
                      <span className="tag">你</span>
                    ) : null}
                  </div>
                  <div className="player-status-line">
                    <span
                      className={
                        player.connected ? "status-ok" : "status-offline"
                      }
                    >
                      {player.connected ? "在线" : "离线"}
                    </span>
                    <span>
                      {player.isHost
                        ? "房主"
                        : player.ready
                          ? "已准备"
                          : "未准备"}
                    </span>
                  </div>
                </li>
              ))}
          </ul>
        </section>

        <section className="panel room-actions-panel">
          <h2>准备与开局</h2>
          <p className="muted">
            至少需要 2 名在线玩家。非房主玩家全部准备后，房主可以开始。
          </p>
          <p className="hint">
            邀请其他设备时，请使用下方局域网面板里对应网卡的“复制房间链接”。
          </p>
          <div className="button-row">
            {!room.you.isHost ? (
              <button
                className={room.you.ready ? "secondary" : "primary"}
                onClick={() => void toggleReady()}
                disabled={!connected || readyPending}
              >
                {readyAction === "ready"
                  ? "准备中…"
                  : readyAction === "unready"
                    ? "取消中…"
                    : room.you.ready
                      ? "取消准备"
                      : "准备"}
              </button>
            ) : null}
            {room.you.isHost ? (
              <button
                className="primary"
                onClick={() => void start()}
                disabled={disabled || !canStart || starting}
                title={
                  !allConnected
                    ? "等待所有玩家在线"
                    : !allReady
                      ? "等待其他玩家准备"
                      : activePlayers.length < 2
                        ? "至少需要 2 名玩家"
                        : undefined
                }
              >
                {starting ? "正在开始…" : "开始游戏"}
              </button>
            ) : null}
            <button
              className="danger-quiet"
              onClick={() => void leave()}
              disabled={!connected || leaving}
            >
              {leaving ? "正在离开…" : "离开房间"}
            </button>
          </div>
          {room.you.isHost && !canStart ? (
            <p className="hint">
              {activePlayers.length < 2
                ? "等待至少一名其他玩家加入。"
                : !allConnected
                  ? "等待离线玩家重新连接。"
                  : !allReady
                    ? "等待其他玩家准备。"
                    : ""}
            </p>
          ) : null}
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        {lanStatus ? (
          <LanAccessPanel
            status={lanStatus}
            busy={busy}
            roomCode={room.roomCode}
            disabled={!connected}
            onToggle={onToggleLan}
            onRefresh={onRefreshLan}
            onError={setError}
          />
        ) : null}
      </main>
    </div>
  );
}
