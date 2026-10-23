import type { EmoteMessage, PublicPlayer } from "@shared/protocol.ts";
import type { SeatSlot } from "./seatLayout.ts";
import { UNO_CARD_BACK_IMAGE } from "./cardSprite.ts";

interface TableSeatProps {
  player: PublicPlayer;
  slot: SeatSlot;
  isCurrent: boolean;
  emote?: EmoteMessage;
}

export function TableSeat({
  player,
  slot,
  isCurrent,
  emote
}: TableSeatProps) {
  const stateLabel = !player.active
    ? "已退出"
    : player.connected
      ? "在线"
      : "离线";
  return (
    <article
      className={`table-seat seat-${slot} ${isCurrent ? "is-current" : ""} ${
        player.active ? "" : "is-inactive"
      }`}
      data-seat-slot={slot}
      aria-label={`${player.name}，手牌 ${player.handCount} 张，${stateLabel}`}
    >
      {emote ? (
        <span
          key={emote.id}
          className="emote-bubble"
          role="status"
          aria-label={`${player.name} 发送了 ${emote.emoji}`}
        >
          {emote.emoji}
        </span>
      ) : null}
      <div className="seat-title">
        <span className="seat-identity">
          <span className="seat-avatar" aria-hidden="true">
            {Array.from(player.name)[0] ?? "?"}
          </span>
          <span className="seat-name">{player.name}</span>
        </span>
        {isCurrent ? <span className="seat-turn-tag">行动中</span> : null}
      </div>
      <div className="seat-meta">
        <span className="seat-card-count">
          <img
            className="mini-card-back"
            src={UNO_CARD_BACK_IMAGE}
            alt=""
            draggable={false}
            aria-hidden="true"
          />
          手牌 <strong>{player.handCount}</strong>
        </span>
        {player.unoDeclared ? (
          <span className="uno-tag">UNO</span>
        ) : player.handCount === 1 ? (
          <span className="warn-tag">剩 1 张</span>
        ) : null}
      </div>
      <div className="seat-connection">
        <span
          className={`presence-dot ${
            player.active && player.connected ? "is-online" : "is-offline"
          }`}
          aria-hidden="true"
        />
        {stateLabel}
      </div>
    </article>
  );
}
