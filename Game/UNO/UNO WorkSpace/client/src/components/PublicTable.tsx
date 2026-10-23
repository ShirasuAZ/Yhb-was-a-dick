import {
  COLOR_NAMES,
  type PublicGameView
} from "@shared/protocol.ts";
import { PlayingCard } from "./PlayingCard.tsx";

interface PublicTableProps {
  game: PublicGameView;
  canDraw: boolean;
  disabled: boolean;
  onDraw: () => void;
}

export function PublicTable({
  game,
  canDraw,
  disabled,
  onDraw
}: PublicTableProps) {
  return (
    <section className="public-table" aria-label="公共牌区">
      <div className="public-piles">
        <div className="public-pile">
          <span className="public-label">摸牌堆</span>
          <button
            type="button"
            className="draw-pile"
            onClick={onDraw}
            disabled={!canDraw || disabled}
            aria-label={`摸一张牌，牌库剩余 ${game.deckCount} 张`}
          >
            <span className="draw-pile-mark" aria-hidden="true" />
            <strong>{game.deckCount}</strong>
          </button>
        </div>
        <div className="public-pile">
          <span className="public-label">弃牌堆</span>
          <PlayingCard card={game.discardTop} compact />
        </div>
      </div>

      <div className="public-meta">
        <span className="public-meta-item">
          <span className="public-label">当前颜色</span>
          <span className="public-value">
            <span
              className={`color-swatch color-${game.currentColor}`}
              aria-hidden="true"
            />
            {COLOR_NAMES[game.currentColor]}
          </span>
        </span>
        <span className="public-meta-item">
          <span className="public-label">出牌方向</span>
          <strong>{game.direction === 1 ? "顺时针" : "逆时针"}</strong>
        </span>
        <span className="public-meta-item">
          <span className="public-label">牌库剩余</span>
          <strong>{game.deckCount} 张</strong>
        </span>
        <span className="public-meta-item">
          <span className="public-label">弃牌数量</span>
          <strong>{game.discardCount} 张</strong>
        </span>
      </div>

      <p className="public-message" aria-live="polite">
        {game.lastEvent?.message ?? "对局进行中"}
      </p>
    </section>
  );
}
