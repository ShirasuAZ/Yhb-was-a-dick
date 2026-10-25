import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Card,
  CardColor,
  ClientToServerEvents,
  EmoteMessage,
  QuickEmoji,
  RoomState
} from "@shared/protocol.ts";
import { QUICK_EMOJIS } from "@shared/protocol.ts";
import { ConnectionBadge } from "./ConnectionBadge.tsx";
import { HandDock } from "./HandDock.tsx";
import { PublicTable } from "./PublicTable.tsx";
import { TableSeat } from "./TableSeat.tsx";
import { VersionBadge } from "./VersionBadge.tsx";
import { ThemeControl } from "./ThemeControl.tsx";
import { seatedOpponents } from "./seatLayout.ts";
import { InviteDialog } from "./InviteDialog.tsx";
import { SpectatorSeats } from "./SpectatorSeats.tsx";
import type { RoomRole } from "@shared/social.ts";
import { createActionId } from "../actionId.ts";
import { copyText } from "../clipboard.ts";
import type { ConnectionStatus } from "../types.ts";

const COLORS: Array<{ value: CardColor; label: string }> = [
  { value: "red", label: "红色" },
  { value: "yellow", label: "黄色" },
  { value: "green", label: "绿色" },
  { value: "blue", label: "蓝色" }
];

const COLOR_ORDER: Record<CardColor, number> = {
  red: 1,
  yellow: 2,
  green: 3,
  blue: 4
};

const EMOTE_VISIBLE_MS = 2600;

function sortValue(card: Card): number {
  if (card.kind === "number") {
    return 10 + (card.value ?? 0);
  }
  return (
    {
      skip: 30,
      reverse: 31,
      draw2: 32,
      wild: 40,
      wild4: 41,
      wild10: 42
    }[card.kind] ?? 50
  );
}

interface GameScreenProps {
  room: RoomState;
  connection: ConnectionStatus;
  busy: boolean;
  error: string;
  emotes: Record<string, EmoteMessage>;
  perform: (
    event: keyof ClientToServerEvents,
    payload: Record<string, unknown>
  ) => Promise<boolean>;
  sendEmote: (emoji: QuickEmoji) => Promise<boolean>;
  leaveRoom: () => Promise<void>;
}

export function GameScreen({
  room,
  connection,
  busy,
  error,
  emotes,
  perform,
  sendEmote,
  leaveRoom
}: GameScreenProps) {
  const game = room.game!;
  const [colorCard, setColorCard] = useState<Card | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [inviteTargets, setInviteTargets] = useState<Array<{ id: string; username: string }>>([]);
  const [inviteResult, setInviteResult] = useState("");
  const [inviteRole, setInviteRole] = useState<RoomRole | null>(null);
  const [visibleEmotes, setVisibleEmotes] = useState<
    Record<string, EmoteMessage>
  >({});
  const emojiControlRef = useRef<HTMLDivElement | null>(null);
  const seenEmoteIdsRef = useRef<Set<string>>(new Set());
  const emoteTimersRef = useRef<Map<string, number>>(new Map());
  const lastTurnNumberRef = useRef(game.turnNumber);
  const lastGameEventSeqRef = useRef(game.lastEvent?.seq ?? 0);
  const playSoundRef = useRef<HTMLAudioElement | null>(null);
  const connected = connection === "connected";
  const spectator = room.youAreSpectator;
  const disabled = spectator || busy || !connected || game.status === "finished";
  useEffect(() => {
    void fetch("/api/social", { headers: { Authorization: `Bearer ${localStorage.getItem("uno.accountToken") ?? ""}` } })
      .then((response) => response.json() as Promise<{ data?: { friends?: Array<{ id: string; username: string }> } }>)
      .then((result) => setInviteTargets(result.data?.friends ?? []))
      .catch(() => setInviteTargets([]));
  }, []);
  const inviteFriend = async (targetId: string, role: "player" | "spectator"): Promise<void> => {
    const response = await fetch("/api/social/invitations", { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("uno.accountToken") ?? ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ targetId, game: "uno", roomCode: room.roomCode, role }) });
    setInviteResult(response.ok ? "邀请已发送" : "邀请失败，请确认好友关系和房间状态");
  };
  const myTurn = game.currentPlayerId === room.you.id;
  const currentPlayer = room.players.find(
    (player) => player.id === game.currentPlayerId
  );
  const seated = useMemo(
    () => seatedOpponents(room.players, room.you.id),
    [room.players, room.you.id]
  );
  const turnOrder = useMemo(() => {
    const activePlayers = room.players
      .filter((player) => player.active)
      .sort((left, right) => left.seat - right.seat);
    const currentIndex = activePlayers.findIndex(
      (player) => player.id === game.currentPlayerId
    );
    if (currentIndex < 0 || activePlayers.length < 2) {
      return activePlayers;
    }
    return Array.from({ length: activePlayers.length }, (_, index) => {
      const offset = game.direction === 1 ? index : -index;
      return activePlayers[
        (currentIndex + offset + activePlayers.length) % activePlayers.length
      ]!;
    });
  }, [game.currentPlayerId, game.direction, room.players]);
  const playable = useMemo(
    () => new Set(game.playableCardIds),
    [game.playableCardIds]
  );
  const hand = useMemo(
    () =>
      [...room.you.hand].sort((left, right) => {
        const leftColor = left.color ? COLOR_ORDER[left.color] : 5;
        const rightColor = right.color ? COLOR_ORDER[right.color] : 5;
        return leftColor - rightColor || sortValue(left) - sortValue(right);
      }),
    [room.you.hand]
  );
  const winner = room.players.find((player) => player.id === game.winnerId);
  const pendingUnoTarget = room.players.find(
    (player) => player.id === game.pendingUno?.playerId
  );
  const pendingPenaltyTarget = room.players.find(
    (player) => player.id === game.pendingPenalty?.targetId
  );
  const canDraw =
    myTurn &&
    !game.pendingPenalty &&
    !game.drawnCardId &&
    !disabled &&
    game.status === "playing";
  const canEndTurn =
    myTurn &&
    Boolean(game.drawnCardId) &&
    !game.pendingPenalty &&
    !disabled &&
    game.status === "playing";
  const allActiveConnected = room.players
    .filter((player) => player.active)
    .every((player) => player.connected);
  const activePlayerCount = room.players.filter((player) => player.active).length;
  const canRestart = activePlayerCount >= 2 && allActiveConnected;
  const wild4Risk =
    colorCard?.kind === "wild4" &&
    hand.some((card) => card.color === game.currentColor);
  const selectedCard = selectedCardId
    ? hand.find((card) => card.id === selectedCardId) ?? null
    : null;
  const canSelectCards =
    myTurn && !disabled && game.status === "playing";
  const canConfirmPlay =
    Boolean(selectedCard) &&
    myTurn &&
    !disabled &&
    game.status === "playing" &&
    playable.has(selectedCard!.id);

  useEffect(() => {
    if (!colorCard) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setColorCard(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [colorCard]);

  useEffect(() => {
    if (!emojiOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setEmojiOpen(false);
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!emojiControlRef.current?.contains(event.target as Node)) {
        setEmojiOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [emojiOpen]);

  useEffect(() => {
    for (const message of Object.values(emotes)) {
      if (seenEmoteIdsRef.current.has(message.id)) {
        continue;
      }
      seenEmoteIdsRef.current.add(message.id);
      setVisibleEmotes((current) => ({
        ...current,
        [message.playerId]: message
      }));
      const previousTimer = emoteTimersRef.current.get(message.playerId);
      if (previousTimer !== undefined) {
        window.clearTimeout(previousTimer);
      }
      const timer = window.setTimeout(() => {
        setVisibleEmotes((current) => {
          if (current[message.playerId]?.id !== message.id) {
            return current;
          }
          const next = { ...current };
          delete next[message.playerId];
          return next;
        });
        emoteTimersRef.current.delete(message.playerId);
      }, EMOTE_VISIBLE_MS);
      emoteTimersRef.current.set(message.playerId, timer);
    }
  }, [emotes]);

  useEffect(() => {
    const activeIds = new Set(
      room.players.filter((player) => player.active).map((player) => player.id)
    );
    setVisibleEmotes((current) => {
      let changed = false;
      const next = { ...current };
      for (const playerId of Object.keys(next)) {
        if (activeIds.has(playerId)) {
          continue;
        }
        delete next[playerId];
        const timer = emoteTimersRef.current.get(playerId);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          emoteTimersRef.current.delete(playerId);
        }
        changed = true;
      }
      return changed ? next : current;
    });
  }, [room.players]);

  useEffect(
    () => () => {
      for (const timer of emoteTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      emoteTimersRef.current.clear();
    },
    []
  );

  useEffect(() => {
    if (lastTurnNumberRef.current !== game.turnNumber) {
      lastTurnNumberRef.current = game.turnNumber;
      setSelectedCardId(null);
    }
  }, [game.turnNumber]);

  useEffect(() => {
    const audio = new Audio("/sounds/card-play.mp3");
    audio.preload = "auto";
    playSoundRef.current = audio;
    const unlockAudio = new Audio("/sounds/card-play.mp3");
    unlockAudio.preload = "auto";
    unlockAudio.muted = true;
    let unlocked = false;
    function cleanup(): void {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    }
    function unlock(): void {
      if (unlocked) {
        return;
      }
      const playback = unlockAudio.play();
      if (!playback) {
        return;
      }
      void playback
        .then(() => {
          unlocked = true;
          unlockAudio.pause();
          unlockAudio.currentTime = 0;
          cleanup();
        })
        .catch(() => undefined);
    }
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return cleanup;
  }, []);

  useEffect(() => {
    const event = game.lastEvent;
    if (!event) {
      return;
    }
    if (event.type === "game_started") {
      lastGameEventSeqRef.current = event.seq;
      return;
    }
    if (event.seq <= lastGameEventSeqRef.current) {
      return;
    }
    lastGameEventSeqRef.current = event.seq;
    if (event.type !== "card_played" && event.type !== "penalty_stacked") {
      return;
    }

    const audio = playSoundRef.current ?? new Audio("/sounds/card-play.mp3");
    playSoundRef.current = audio;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  }, [game.lastEvent]);

  useEffect(() => {
    setSelectedCardId((current) => {
      if (!current) {
        return null;
      }
      const stillInHand = room.you.hand.some((card) => card.id === current);
      if (
        !stillInHand ||
        !myTurn ||
        disabled ||
        game.status !== "playing"
      ) {
        return null;
      }
      return current;
    });
  }, [
    disabled,
    game.status,
    myTurn,
    room.you.hand
  ]);

  const playCard = async (card: Card, color?: CardColor): Promise<void> => {
    const ok = await perform("play_card", {
      cardId: card.id,
      ...(color ? { color } : {}),
      turnNumber: game.turnNumber,
      actionId: createActionId()
    });
    if (ok) {
      setColorCard(null);
      setSelectedCardId(null);
    } else if (color) {
      setColorCard(null);
    }
  };

  const selectCard = (card: Card): void => {
    if (!canSelectCards) {
      return;
    }
    setSelectedCardId((current) => (current === card.id ? null : card.id));
  };

  const confirmPlay = (): void => {
    if (!selectedCard || !canConfirmPlay) {
      return;
    }
    if (selectedCard.kind === "wild" || selectedCard.kind === "wild4") {
      setColorCard(selectedCard);
      return;
    }
    void playCard(selectedCard);
  };

  const draw = async (): Promise<void> => {
    setSelectedCardId(null);
    await perform("draw_card", {
      turnNumber: game.turnNumber,
      actionId: createActionId()
    });
  };

  const endTurn = async (): Promise<void> => {
    const ok = await perform("end_turn", {
      turnNumber: game.turnNumber,
      actionId: createActionId()
    });
    if (ok) {
      setSelectedCardId(null);
    }
  };

  const declareUno = async (): Promise<void> => {
    await perform("declare_uno", { actionId: createActionId() });
  };

  const catchUno = async (targetId: string): Promise<void> => {
    await perform("catch_uno", {
      targetId,
      actionId: createActionId()
    });
  };

  const respondPenalty = async (
    decision: "accept" | "challenge"
  ): Promise<void> => {
    await perform("respond_penalty", {
      decision,
      turnNumber: game.turnNumber,
      actionId: createActionId()
    });
  };

  const restart = async (): Promise<void> => {
    await perform("restart_game", { actionId: createActionId() });
  };

  const copyRoomCode = async (): Promise<void> => {
    await copyText(room.roomCode);
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

  const notices = (
    <>
      {game.pendingPenalty ? (
        <div className="table-notice">
          <div>
            <strong>叠加 +{game.pendingPenalty.total}</strong>
            <span>
              {game.pendingPenalty.canRespond
                ? `可出 +2/+4 继续叠加，或接受摸 ${game.pendingPenalty.total} 张。${
                    game.pendingPenalty.canChallenge
                      ? "也可以质疑这次 +4。"
                      : ""
                  }`
                : `等待 ${pendingPenaltyTarget?.name ?? "下家"} 响应。超时将自动接受。`}
            </span>
          </div>
          {game.pendingPenalty.canRespond ? (
            <div className="notice-actions">
              <button
                className="primary"
                onClick={() => void respondPenalty("accept")}
                disabled={disabled}
              >
                接受摸 {game.pendingPenalty.total} 张
              </button>
              {game.pendingPenalty.canChallenge ? (
                <button
                  className="secondary"
                  onClick={() => void respondPenalty("challenge")}
                  disabled={disabled}
                >
                  质疑
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {game.pendingUno?.canDeclare ? (
        <div className="table-notice notice-uno">
          <div>
            <strong>只剩一张牌</strong>
            <span>在下一位玩家行动前宣告 UNO。</span>
          </div>
          <button
            className="primary uno-button"
            onClick={() => void declareUno()}
            disabled={disabled}
          >
            宣告 UNO
          </button>
        </div>
      ) : null}

      {game.pendingUno?.canCatch ? (
        <div className="table-notice notice-catch">
          <div>
            <strong>{pendingUnoTarget?.name} 尚未宣告 UNO</strong>
            <span>抓住后，对方摸 2 张牌。</span>
          </div>
          <button
            className="secondary"
            onClick={() => void catchUno(game.pendingUno!.playerId)}
            disabled={disabled}
          >
            抓 UNO
          </button>
        </div>
      ) : null}
    </>
  );

  const selectedIsPlayable = Boolean(
    selectedCard && playable.has(selectedCard.id)
  );
  const selectionHint = game.pendingPenalty
    ? myTurn
      ? selectedCard
        ? selectedIsPlayable
          ? "已选中，点击出牌继续叠加"
          : "只能出 +2/+4 继续叠加"
        : `可出 +2/+4 继续叠加，或接受摸 ${game.pendingPenalty.total} 张`
      : `等待 ${pendingPenaltyTarget?.name ?? "下家"} 响应 +${game.pendingPenalty.total}`
    : !myTurn
      ? `等待 ${currentPlayer?.name ?? "其他玩家"} 行动`
      : selectedCard
        ? selectedIsPlayable
          ? game.drawnCardId
            ? "已选中刚摸到的牌"
            : "已选中，点击出牌确认"
          : "此牌不可打出"
        : game.drawnCardId
          ? "选择刚摸到的牌再出牌"
          : "先选择一张手牌";
  const actions =
    game.status === "playing" ? (
      <>
        <button
          className="primary confirm-play-button"
          onClick={confirmPlay}
          disabled={!canConfirmPlay}
          data-action="confirm-play"
        >
          {game.pendingPenalty ? "叠加" : "出牌"}
        </button>
        {canEndTurn ? (
          <button
            className="secondary"
            onClick={() => void endTurn()}
            disabled={!canEndTurn}
          >
            结束回合
          </button>
        ) : null}
        <span
          className={`hint selection-hint ${
            selectedCard && !selectedIsPlayable ? "hint-warn" : ""
          }`}
        >
          {selectionHint}
        </span>
      </>
    ) : null;

  return (
    <div className="table-screen">
      {inviteRole ? <InviteDialog game="uno" roomCode={room.roomCode} role={inviteRole} onClose={() => setInviteRole(null)} /> : null}
      <header className="table-topbar">
        <div className="table-heading">
          <div>
            <p className="eyebrow">房间号</p>
            <button
              className="room-code-button"
              onClick={() => void copyRoomCode()}
              title="复制房间号"
            >
              {room.roomCode}
            </button>
          </div>
        </div>
        <div className="topbar-actions">
          <ConnectionBadge status={connection} />
          <button
            className="text-button"
            onClick={() => void refresh()}
            disabled={!connected || refreshing}
          >
            {refreshing ? "刷新中…" : "刷新"}
          </button>
          <button
            className="danger-quiet"
            onClick={() => void leaveRoom()}
            disabled={!connected}
          >
            退出
          </button>
          <VersionBadge />
          <ThemeControl />
        </div>
      </header>

      <section className="turn-order-strip" aria-label="出牌顺序">
        <div className="turn-order-copy">
          <span className="eyebrow">出牌顺序</span>
          <strong>
            {game.status === "finished"
              ? "对局结束"
              : myTurn
                ? "轮到你"
                : `轮到 ${currentPlayer?.name ?? "玩家"}`}
          </strong>
          <span className="turn-direction">
            {game.direction === 1 ? "顺时针" : "逆时针"}
          </span>
        </div>
        <div className="turn-order-path" role="list">
          {turnOrder.map((player, index) => (
            <span className="turn-order-entry" role="listitem" key={player.id}>
              {index > 0 ? (
                <span className="turn-order-arrow" aria-hidden="true">
                  &gt;
                </span>
              ) : null}
              <span
                className={`turn-order-player ${
                  player.id === game.currentPlayerId ? "is-current" : ""
                }`}
              >
                <span className="turn-order-number">{index + 1}</span>
                <span className="turn-order-name">
                  {player.id === room.you.id ? "你" : player.name}
                </span>
                {player.id === game.currentPlayerId ? (
                  <span className="turn-order-tag">当前</span>
                ) : null}
              </span>
            </span>
          ))}
        </div>
      </section>
      <section className="room-friend-invites" aria-label="房间好友邀请">
        <strong>邀请好友</strong>
        <button type="button" className="secondary" disabled={spectator} onClick={() => setInviteRole("player")}>邀请对战席</button>
        <button type="button" className="secondary" disabled={spectator} onClick={() => setInviteRole("spectator")}>邀请观战席</button>
        {inviteResult ? <small>{inviteResult}</small> : null}
      </section>
      <section className="spectator-block" aria-label="观战席"><strong>观战席（{room.spectators.length}）</strong><SpectatorSeats spectators={room.spectators} canInvite={!spectator} onInvite={() => setInviteRole("spectator")} /></section>

      <main className="table-stage">
        <div className="table-surface">
          <div className="emoji-control" ref={emojiControlRef}>
            <button
              type="button"
              className="text-button emoji-toggle"
              onClick={() => setEmojiOpen((open) => !open)}
              disabled={!connected}
              aria-expanded={emojiOpen}
              aria-haspopup="menu"
              aria-label="发送表情"
              title="发送快捷表情"
            >
              😊
            </button>
            {emojiOpen ? (
              <div
                className="emoji-panel"
                role="menu"
                aria-label="快捷表情"
              >
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="emoji-choice"
                    role="menuitem"
                    onClick={() => {
                      setEmojiOpen(false);
                      void sendEmote(emoji);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {seated.map(({ player, slot }) => (
            <TableSeat
              key={player.id}
              player={player}
              slot={slot}
              isCurrent={player.id === game.currentPlayerId}
              emote={visibleEmotes[player.id]}
            />
          ))}
          <PublicTable
            game={game}
            canDraw={canDraw}
            disabled={busy || !connected}
            onDraw={() => void draw()}
          />
        </div>
      </main>

      <HandDock
        you={room.you}
        hand={hand}
        selectedCardId={selectedCardId}
        playable={playable}
        myTurn={myTurn}
        selectableCards={canSelectCards}
        disabled={disabled}
        emote={visibleEmotes[room.you.id]}
        notices={notices}
        actions={actions}
        error={error}
        onSelectCard={selectCard}
      />

      {colorCard ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setColorCard(null);
            }
          }}
        >
          <section
            className="color-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="color-heading"
          >
            <h2 id="color-heading">选择下一种颜色</h2>
            <p className="muted">该颜色会立即成为所有玩家看到的有效颜色。</p>
            {wild4Risk ? (
              <p className="warn-text">
                你手中仍有当前颜色的牌。若下家质疑，服务器会判定你摸 4 张。
              </p>
            ) : null}
            <div className="color-grid">
              {COLORS.map((color) => (
                <button
                  key={color.value}
                  className={`color-choice color-${color.value}`}
                  onClick={() => void playCard(colorCard, color.value)}
                  disabled={busy}
                >
                  <span
                    className={`color-swatch color-${color.value}`}
                    aria-hidden="true"
                  />
                  {color.label}
                </button>
              ))}
            </div>
            <button
              className="secondary"
              onClick={() => setColorCard(null)}
              disabled={busy}
            >
              取消
            </button>
          </section>
        </div>
      ) : null}

      {game.status === "finished" ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="end-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-heading"
          >
            <p className="eyebrow">本局结束</p>
            <h2 id="end-heading">
              {winner ? `${winner.name} 获胜` : "对局结束"}
            </h2>
            <ul className="final-list">
              {room.players
                .filter((player) => player.active)
                .sort((left, right) => left.seat - right.seat)
                .map((player) => (
                  <li key={player.id}>
                    <span>
                      {player.name}
                      {player.id === room.you.id ? "（你）" : ""}
                    </span>
                    <strong>{player.handCount} 张</strong>
                  </li>
                ))}
            </ul>
            <div className="button-row">
              {room.you.isHost ? (
                <button
                  className="primary"
                  onClick={() => void restart()}
                  disabled={busy || !connected || !canRestart}
                  title={
                    activePlayerCount < 2
                      ? "至少需要 2 名玩家"
                      : !allActiveConnected
                        ? "等待所有玩家在线"
                        : undefined
                  }
                >
                  再来一局
                </button>
              ) : (
                <span className="muted">等待房主开始新一局</span>
              )}
              <button
                className="danger-quiet"
                onClick={() => void leaveRoom()}
                disabled={!connected}
              >
                离开房间
              </button>
            </div>
            {room.you.isHost && !canRestart ? (
              <p className="hint">
                {activePlayerCount < 2
                  ? "至少需要 2 名玩家才能开始新一局。"
                  : "所有玩家重新连接后才能开始新一局。"}
              </p>
            ) : null}
            {error ? (
              <p className="error-text" role="alert">
                {error}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
