import type { CSSProperties } from "react";
import type { Card, CardColor } from "@shared/protocol.ts";
import { cardSpritePosition } from "./cardSprite.ts";

const COLOR_LABELS: Record<CardColor, string> = {
  red: "红",
  yellow: "黄",
  green: "绿",
  blue: "蓝"
};

function face(card: Card): string {
  if (card.kind === "number") {
    return String(card.value);
  }
  if (card.kind === "skip") {
    return "跳过";
  }
  if (card.kind === "reverse") {
    return "反转";
  }
  if (card.kind === "draw2") {
    return "+2";
  }
  if (card.kind === "wild") {
    return "万能";
  }
  if (card.kind === "wild4") {
    return "+4";
  }
  return "+10";
}

interface PlayingCardProps {
  card: Card;
  selected?: boolean;
  selectable?: boolean;
  playable?: boolean;
  onSelect?: () => void;
  compact?: boolean;
}

export function PlayingCard({
  card,
  selected = false,
  selectable = false,
  playable = false,
  onSelect,
  compact = false
}: PlayingCardProps) {
  const label = face(card);
  const accessibleColor = card.color
    ? `${COLOR_LABELS[card.color]}色`
    : "黑色万能";
  const accessibleName =
    card.kind === "wild10"
      ? "加十随机颜色万能牌"
      : `${accessibleColor}${label}`;
  const sprite = cardSpritePosition(card);
  const spriteStyle = {
    "--sprite-col": sprite.col,
    "--sprite-row": sprite.row,
    "--sprite-cols": sprite.cols,
    "--sprite-rows": sprite.rows
  } as CSSProperties;
  const className = `playing-card ${compact ? "compact" : ""} ${
    selected ? "is-selected" : ""
  } ${selectable ? "is-selectable" : ""}`;
  const art = (
    <span className="card-art">
      <img
        className="card-sprite"
        src={sprite.src}
        alt=""
        draggable={false}
        style={spriteStyle}
      />
    </span>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        className={className}
        onClick={onSelect}
        disabled={!selectable}
        aria-label={`${accessibleName}${
          selected
            ? "，已选中"
            : playable
              ? "，当前可打出"
              : "，当前不可打出"
        }`}
        aria-pressed={selected}
        data-card-id={card.id}
        data-playable={playable ? "true" : "false"}
        data-selected={selected ? "true" : "false"}
        data-card-kind={card.kind}
      >
        {art}
      </button>
    );
  }

  return (
    <div
      className={className}
      aria-label={accessibleName}
      data-card-id={card.id}
      data-card-kind={card.kind}
    >
      {art}
    </div>
  );
}
