import type { Card, EmoteMessage, OwnPlayer } from "@shared/protocol.ts";
import type { CSSProperties, ReactNode } from "react";
import { PlayingCard } from "./PlayingCard.tsx";

interface HandDockProps {
  you: OwnPlayer;
  hand: Card[];
  selectedCardId: string | null;
  playable: Set<string>;
  myTurn: boolean;
  selectableCards: boolean;
  disabled: boolean;
  emote?: EmoteMessage;
  notices: ReactNode;
  actions: ReactNode;
  error: string;
  onSelectCard: (card: Card) => void;
}

export function HandDock({
  you,
  hand,
  selectedCardId,
  playable,
  myTurn,
  selectableCards,
  disabled,
  emote,
  notices,
  actions,
  error,
  onSelectCard
}: HandDockProps) {
  return (
    <section className="hand-dock" aria-labelledby="your-hand-heading">
      {notices}
      <div className="hand-dock-head self-heading">
        <div className="self-identity">
          <span className="seat-avatar self-avatar" aria-hidden="true">
            {Array.from(you.name)[0] ?? "?"}
          </span>
          <h2 id="your-hand-heading">{you.name}</h2>
          {emote ? (
            <span
              key={emote.id}
              className="emote-bubble is-inline"
              role="status"
              aria-label={`你发送了 ${emote.emoji}`}
            >
              {emote.emoji}
            </span>
          ) : null}
          <span className="muted">
            手牌 {you.handCount} 张
            {you.unoDeclared ? " · 已宣告 UNO" : ""}
          </span>
          {myTurn ? <span className="tag active-tag">你的回合</span> : null}
        </div>
        <div className="hand-actions">{actions}</div>
      </div>
      <div
        className="hand"
        style={{ "--hand-count": Math.max(hand.length, 1) } as CSSProperties}
      >
        {hand.map((card) => (
          <PlayingCard
            key={card.id}
            card={card}
            selected={selectedCardId === card.id}
            selectable={selectableCards}
            playable={myTurn && playable.has(card.id) && !disabled}
            onSelect={() => onSelectCard(card)}
          />
        ))}
        {hand.length === 0 ? (
          <p className="muted empty-hand">没有手牌</p>
        ) : null}
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
