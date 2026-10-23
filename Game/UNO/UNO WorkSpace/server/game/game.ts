import {
  GAME_CARD_COUNT,
  HAND_SIZE,
  createDeck,
  isCardPlayable,
  randomColor,
  secureRandom,
  shuffle,
  type RandomSource
} from "./deck.ts";
import type {
  Card,
  CardColor,
  CardKind,
  PublicGameEvent,
  PublicGameView,
  TurnDirection
} from "../../shared/protocol.ts";

export class GameError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}

export interface GamePlayer {
  id: string;
  name: string;
  seat: number;
  active: boolean;
  hand: Card[];
  unoDeclared: boolean;
}

interface PendingUno {
  playerId: string;
  turnNumber: number;
  declared: boolean;
}

interface PendingPenalty {
  attackerId: string;
  targetId: string;
  total: number;
  lastKind: "draw2" | "wild4";
  color: CardColor;
  matchingColorAtPlay: boolean;
}

function penaltyValue(kind: CardKind): number {
  return kind === "draw2" ? 2 : kind === "wild4" ? 4 : kind === "wild10" ? 10 : 0;
}

export interface GameOptions {
  gameKey?: string;
  random?: RandomSource;
  createId?: () => string;
  deck?: Card[];
  plus10CardId?: string;
  allCardIds?: ReadonlySet<string>;
}

export interface DrawResult {
  card: Card | null;
  shortage: number;
  recycled: number;
}

export class UnoGame {
  readonly id: string;
  readonly plus10CardId: string;
  readonly players: GamePlayer[];
  deck: Card[];
  discard: Card[];
  currentColor: CardColor;
  direction: TurnDirection;
  currentIndex: number;
  turnNumber: number;
  status: "playing" | "finished";
  winnerId: string | null;
  drawnCardId: string | null;
  pendingUno: PendingUno | null;
  pendingPenalty: PendingPenalty | null;
  lastEvent: PublicGameEvent | null;

  private readonly random: RandomSource;
  private readonly allCardIds: ReadonlySet<string>;
  private eventSeq = 0;
  private recycledCards = 0;

  constructor(players: Array<{ id: string; name: string }>, options: GameOptions = {}) {
    if (players.length < 2 || players.length > 6) {
      throw new GameError("INVALID_PLAYER_COUNT", "游戏需要 2 至 6 名玩家");
    }

    this.id = options.gameKey ?? `game-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.random = options.random ?? secureRandom;
    const built = createDeck(this.id, options.createId);
    this.plus10CardId = options.plus10CardId ?? built.plus10CardId;
    this.allCardIds = options.allCardIds ?? built.allCardIds;
    this.deck = shuffle(options.deck ?? built.cards, this.random);
    this.discard = [];
    this.currentColor = "red";
    this.direction = 1;
    this.currentIndex = 0;
    this.turnNumber = 1;
    this.status = "playing";
    this.winnerId = null;
    this.drawnCardId = null;
    this.pendingUno = null;
    this.pendingPenalty = null;
    this.lastEvent = null;

    this.players = players.map((player, index) => ({
      id: player.id,
      name: player.name,
      seat: index,
      active: true,
      hand: [],
      unoDeclared: false
    }));

    this.deal();
    this.flipOpeningCard();
    this.recordEvent("game_started", "对局开始", {
      message: `对局开始，由 ${this.currentPlayer.name} 先行动`
    });
    this.verify();
  }

  get currentPlayer(): GamePlayer {
    const player = this.players[this.currentIndex];
    if (!player) {
      throw new GameError("INVALID_TURN", "当前玩家不存在");
    }
    return player;
  }

  get currentPlayerId(): string {
    return this.currentPlayer.id;
  }

  private deal(): void {
    for (let round = 0; round < HAND_SIZE; round += 1) {
      for (const player of this.players) {
        const card = this.deck.pop();
        if (!card) {
          throw new Error("Cannot deal from incomplete deck");
        }
        player.hand.push(card);
      }
    }
  }

  private flipOpeningCard(): void {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const card = this.deck.pop();
      if (!card) {
        throw new Error("Cannot flip opening card");
      }
      if (card.kind === "wild" || card.kind === "wild4" || card.kind === "wild10") {
        this.deck.unshift(card);
        continue;
      }

      this.discard.push(card);
      this.currentColor = card.color ?? "red";

      if (card.kind === "reverse") {
        this.direction = -1;
        this.currentIndex = this.nextActiveIndex(0, this.direction, 1);
      } else if (card.kind === "skip") {
        this.currentIndex = this.nextActiveIndex(0, this.direction, 1);
      } else if (card.kind === "draw2") {
        this.drawInto(this.players[0]!, 2);
        this.currentIndex = this.nextActiveIndex(0, this.direction, 1);
      } else {
        this.currentIndex = 0;
      }
      return;
    }
    throw new Error("Opening card search exceeded safe bound");
  }

  private nextActiveIndex(
    fromIndex: number,
    direction: TurnDirection,
    steps: number
  ): number {
    let index = fromIndex;
    let remaining = steps;
    const size = this.players.length;
    let guard = 0;

    while (remaining > 0) {
      index = (index + direction + size) % size;
      const player = this.players[index];
      if (player?.active) {
        remaining -= 1;
      }
      guard += 1;
      if (guard > size * (steps + 2)) {
        throw new GameError("NO_ACTIVE_PLAYER", "没有可行动的玩家");
      }
    }
    return index;
  }

  private activePlayerCount(): number {
    return this.players.filter((player) => player.active).length;
  }

  private advanceTurn(steps = 1): void {
    this.currentIndex = this.nextActiveIndex(this.currentIndex, this.direction, steps);
    this.turnNumber += 1;
    this.drawnCardId = null;
  }

  private requirePlaying(): void {
    if (this.status !== "playing") {
      throw new GameError("GAME_FINISHED", "对局已经结束");
    }
  }

  private getPlayer(playerId: string): GamePlayer {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player || !player.active) {
      throw new GameError("PLAYER_NOT_FOUND", "玩家不在当前对局中");
    }
    return player;
  }

  private requireTurn(playerId: string): GamePlayer {
    this.requirePlaying();
    const player = this.getPlayer(playerId);
    if (this.currentPlayerId !== playerId) {
      throw new GameError("NOT_YOUR_TURN", "还没有轮到你行动");
    }
    return player;
  }

  private closeUnoBeforeAction(): void {
    if (this.pendingUno) {
      this.pendingUno = null;
    }
  }

  private recordEvent(
    type: PublicGameEvent["type"],
    _shortLabel: string,
    details: Omit<PublicGameEvent, "seq" | "type">
  ): void {
    this.eventSeq += 1;
    this.lastEvent = { seq: this.eventSeq, type, ...details };
  }

  private resetUnoIfHandChanged(player: GamePlayer): void {
    if (player.hand.length !== 1) {
      player.unoDeclared = false;
    }
  }

  private recycleDiscard(): number {
    if (this.deck.length > 0 || this.discard.length <= 1) {
      return 0;
    }

    const top = this.discard[this.discard.length - 1];
    if (!top) {
      return 0;
    }
    const belowTop = this.discard.slice(0, -1);
    const permanentlyDiscarded = belowTop.filter((card) => card.kind === "wild10");
    const recyclable = belowTop.filter((card) => card.kind !== "wild10");
    if (recyclable.length === 0) {
      this.discard = [...permanentlyDiscarded, top];
      return 0;
    }

    this.deck = shuffle(recyclable, this.random);
    this.discard = [...permanentlyDiscarded, top];
    this.recycledCards += recyclable.length;
    return recyclable.length;
  }

  private takeFromDeck(): { card: Card | null; recycled: number } {
    let recycled = this.recycleDiscard();
    let card = this.deck.pop();
    if (!card) {
      recycled += this.recycleDiscard();
      card = this.deck.pop();
    }
    return { card: card ?? null, recycled };
  }

  drawInto(player: GamePlayer, count: number): DrawResult {
    let shortage = 0;
    let recycled = 0;
    for (let index = 0; index < count; index += 1) {
      const result = this.takeFromDeck();
      recycled += result.recycled;
      if (!result.card) {
        shortage = count - index;
        break;
      }
      player.hand.push(result.card);
    }
    this.resetUnoIfHandChanged(player);
    return {
      card: player.hand[player.hand.length - 1] ?? null,
      shortage,
      recycled
    };
  }

  playableCardIdsFor(playerId: string): string[] {
    if (this.status !== "playing") {
      return [];
    }
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player || !player.active || player.id !== this.currentPlayerId) {
      return [];
    }
    if (this.pendingPenalty) {
      return player.hand
        .filter((card) => card.kind === "draw2" || card.kind === "wild4")
        .map((card) => card.id);
    }
    const top = this.discard[this.discard.length - 1];
    if (!top) {
      return [];
    }
    return player.hand
      .filter((card) => {
        if (this.drawnCardId && card.id !== this.drawnCardId) {
          return false;
        }
        return isCardPlayable(card, top, this.currentColor, player.hand);
      })
      .map((card) => card.id);
  }

  playCard(
    playerId: string,
    cardId: string,
    chosenColor?: CardColor
  ): void {
    const player = this.requireTurn(playerId);
    const pending = this.pendingPenalty;

    const cardIndex = player.hand.findIndex((card) => card.id === cardId);
    if (cardIndex < 0) {
      throw new GameError("CARD_NOT_IN_HAND", "这张牌不在你的手牌中");
    }
    const card = player.hand[cardIndex];
    if (!card) {
      throw new GameError("CARD_NOT_IN_HAND", "这张牌不在你的手牌中");
    }
    if (this.drawnCardId && card.id !== this.drawnCardId) {
      throw new GameError("MUST_PLAY_DRAWN_CARD", "摸牌后只能打出刚摸到的牌");
    }

    const top = this.discard[this.discard.length - 1];
    if (!top) {
      throw new GameError("NO_DISCARD_TOP", "弃牌堆状态异常");
    }

    const isStack = pending !== null;
    if (
      isStack &&
      card.kind !== "draw2" &&
      card.kind !== "wild4"
    ) {
      throw new GameError(
        "STACK_REQUIRED",
        "当前只能出 +2/+4 继续叠加，或接受摸牌"
      );
    }
    if (
      !isStack &&
      !isCardPlayable(card, top, this.currentColor, player.hand)
    ) {
      throw new GameError("ILLEGAL_PLAY", "这张牌不能按当前牌面打出");
    }

    const needsColor =
      card.kind === "wild" || card.kind === "wild4";
    if (needsColor && !chosenColor) {
      throw new GameError("COLOR_REQUIRED", "请选择下一种颜色");
    }

    this.closeUnoBeforeAction();
    const matchingColorAtPlay = player.hand.some(
      (candidate) => candidate.id !== card.id && candidate.color === this.currentColor
    );

    player.hand.splice(cardIndex, 1);
    this.discard.push(card);
    this.drawnCardId = null;

    let resultingColor: CardColor;
    if (card.kind === "wild10") {
      resultingColor = randomColor(this.random);
    } else if (card.kind === "wild" || card.kind === "wild4") {
      resultingColor = chosenColor as CardColor;
    } else {
      resultingColor = card.color as CardColor;
    }
    this.currentColor = resultingColor;

    const target = this.players[
      this.nextActiveIndex(this.currentIndex, this.direction, 1)
    ];

    const stackedTotal = isStack
      ? (pending?.total ?? 0) + penaltyValue(card.kind)
      : penaltyValue(card.kind);
    this.recordEvent(isStack ? "penalty_stacked" : "card_played", "", {
      playerId,
      ...(target ? { targetId: target.id } : {}),
      card,
      color: resultingColor,
      ...(isStack ? { requestedCount: stackedTotal } : {}),
      message: isStack
        ? `${player.name} 叠加 ${this.describeCard(card)}，累计 +${stackedTotal}`
        : card.kind === "wild10"
          ? `${player.name} 打出 +10，服务器随机指定${this.colorName(resultingColor)}色`
          : `${player.name} 打出 ${this.describeCard(card)}`
    });

    if (player.hand.length === 1) {
      this.pendingUno = {
        playerId,
        turnNumber: this.turnNumber,
        declared: false
      };
    } else if (player.hand.length !== 1) {
      player.unoDeclared = false;
      this.pendingUno = null;
    }

    if (player.hand.length === 0) {
      this.applyFinalPenaltyAndFinish(
        player,
        card,
        target,
        pending?.total ?? 0
      );
      this.verify();
      return;
    }

    if (isStack) {
      if (target) {
        this.beginPenalty(
          playerId,
          target,
          stackedTotal,
          card.kind as "draw2" | "wild4",
          resultingColor,
          card.kind === "wild4" ? matchingColorAtPlay : false
        );
      }
      this.verify();
      return;
    }

    switch (card.kind) {
      case "number":
        this.advanceTurn(1);
        break;
      case "reverse": {
        this.direction = this.direction === 1 ? -1 : 1;
        this.advanceTurn(this.players.length === 2 ? 2 : 1);
        break;
      }
      case "skip":
        this.advanceTurn(2);
        break;
      case "draw2": {
        if (target) {
          this.beginPenalty(
            playerId,
            target,
            2,
            "draw2",
            resultingColor,
            false
          );
        }
        break;
      }
      case "wild":
        this.advanceTurn(1);
        break;
      case "wild4": {
        if (target) {
          this.beginPenalty(
            playerId,
            target,
            4,
            "wild4",
            resultingColor,
            matchingColorAtPlay
          );
        }
        break;
      }
      case "wild10": {
        if (target) {
          const result = this.drawInto(target, 10);
          this.recordEvent(
            result.shortage > 0 ? "deck_shortage" : "card_played",
            "",
            {
              playerId,
              targetId: target.id,
              card,
              color: resultingColor,
              drawnCount: 10 - result.shortage,
              requestedCount: 10,
              shortage: result.shortage,
              message:
                result.shortage > 0
                  ? `${target.name} 摸取 ${10 - result.shortage} 张（牌库已尽且弃牌堆无法补足 10 张），跳过回合`
                  : `${target.name} 摸 10 张牌并跳过回合`
            }
          );
        }
        this.advanceTurn(2);
        break;
      }
    }

    this.verify();
  }

  private applyFinalPenaltyAndFinish(
    winner: GamePlayer,
    card: Card,
    target: GamePlayer | undefined,
    pendingTotal = 0
  ): void {
    const total = pendingTotal + penaltyValue(card.kind);
    if (target && total > 0) {
      const result = this.drawInto(target, total);
      const shortageMessage =
        result.shortage > 0
          ? `${winner.name} 打出最后一张 ${this.describeCard(card)}；牌库不足，${target.name} 实际摸取 ${total - result.shortage} 张后游戏结束`
          : `${winner.name} 打出最后一张 ${this.describeCard(card)}；${target.name} 摸 ${total} 张后游戏结束`;
      this.recordEvent(
        result.shortage > 0 ? "deck_shortage" : "penalty_accepted",
        "",
        {
          playerId: winner.id,
          targetId: target.id,
          card,
          color: this.currentColor,
          drawnCount: total - result.shortage,
          requestedCount: total,
          shortage: result.shortage,
          message: shortageMessage
        }
      );
    }
    this.status = "finished";
    this.winnerId = winner.id;
    this.pendingUno = null;
    this.pendingPenalty = null;
    this.drawnCardId = null;
    winner.unoDeclared = false;

    if (
      this.lastEvent?.type !== "deck_shortage" &&
      this.lastEvent?.type !== "penalty_accepted"
    ) {
      this.recordEvent("game_finished", "", {
        playerId: winner.id,
        message: `${winner.name} 获胜`
      });
    } else {
      this.lastEvent = {
        ...this.lastEvent,
        type: "game_finished",
        playerId: winner.id
      };
    }
  }

  private beginPenalty(
    attackerId: string,
    target: GamePlayer,
    total: number,
    lastKind: "draw2" | "wild4",
    color: CardColor,
    matchingColorAtPlay: boolean
  ): void {
    this.pendingPenalty = {
      attackerId,
      targetId: target.id,
      total,
      lastKind,
      color,
      matchingColorAtPlay
    };
    this.currentIndex = target.seat;
    this.turnNumber += 1;
    this.drawnCardId = null;
  }

  drawCard(playerId: string): { card: Card | null; playable: boolean } {
    const player = this.requireTurn(playerId);
    if (this.pendingPenalty) {
      throw new GameError(
        "PENALTY_RESPONSE_REQUIRED",
        "请先叠加 +2/+4 或接受摸牌"
      );
    }
    if (this.drawnCardId) {
      throw new GameError("ALREADY_DRAWN", "本回合已经摸过牌");
    }
    this.closeUnoBeforeAction();

    const result = this.takeFromDeck();
    if (!result.card) {
      this.recordEvent("deck_shortage", "", {
        playerId,
        message: `${player.name} 无牌可摸，回合结束`
      });
      this.advanceTurn(1);
      this.verify();
      return { card: null, playable: false };
    }

    player.hand.push(result.card);
    this.resetUnoIfHandChanged(player);
    const top = this.discard[this.discard.length - 1]!;
    const playable = isCardPlayable(
      result.card,
      top,
      this.currentColor,
      player.hand
    );

    if (playable) {
      this.drawnCardId = result.card.id;
      this.recordEvent("card_drawn", "", {
        playerId,
        message: `${player.name} 摸了一张牌，可以选择打出或结束回合`
      });
    } else {
      this.recordEvent("card_drawn", "", {
        playerId,
        message: `${player.name} 摸了一张牌，无法打出，回合结束`
      });
      this.advanceTurn(1);
    }
    this.verify();
    return { card: result.card, playable };
  }

  endTurn(playerId: string): void {
    const player = this.requireTurn(playerId);
    if (this.pendingPenalty) {
      throw new GameError(
        "PENALTY_RESPONSE_REQUIRED",
        "请先叠加 +2/+4 或接受摸牌"
      );
    }
    if (!this.drawnCardId) {
      throw new GameError("NOTHING_DRAWN", "只有摸牌后未打出时才可结束回合");
    }
    this.closeUnoBeforeAction();
    this.drawnCardId = null;
    this.recordEvent("turn_ended", "", {
      playerId,
      message: `${player.name} 结束回合`
    });
    this.advanceTurn(1);
    this.verify();
  }

  declareUno(playerId: string): void {
    this.requirePlaying();
    if (!this.pendingUno || this.pendingUno.playerId !== playerId) {
      throw new GameError("UNO_NOT_PENDING", "当前没有待宣告的 UNO");
    }
    if (this.pendingUno.declared) {
      throw new GameError("UNO_ALREADY_DECLARED", "已经宣告过 UNO");
    }
    const player = this.getPlayer(playerId);
    if (player.hand.length !== 1) {
      throw new GameError("UNO_INVALID_HAND", "只有剩一张牌时才能宣告 UNO");
    }
    this.pendingUno.declared = true;
    player.unoDeclared = true;
    const pendingPlayerId = this.pendingUno.playerId;
    this.pendingUno = null;
    this.recordEvent("uno_declared", "", {
      playerId: pendingPlayerId,
      message: `${player.name} 宣告 UNO`
    });
    this.verify();
  }

  catchUno(actorId: string, targetId: string): void {
    this.requirePlaying();
    if (actorId === targetId) {
      throw new GameError("CANNOT_CATCH_SELF", "不能抓自己的 UNO");
    }
    this.getPlayer(actorId);
    const target = this.getPlayer(targetId);
    if (
      !this.pendingUno ||
      this.pendingUno.playerId !== targetId ||
      this.pendingUno.declared
    ) {
      throw new GameError("UNO_NOT_CATCHABLE", "该玩家的 UNO 窗口已经关闭");
    }
    if (target.hand.length !== 1) {
      throw new GameError("UNO_INVALID_HAND", "该玩家已不是一张手牌");
    }
    const result = this.drawInto(target, 2);
    target.unoDeclared = false;
    this.pendingUno = null;
    this.recordEvent("uno_caught", "", {
      playerId: actorId,
      targetId,
      drawnCount: 2 - result.shortage,
      requestedCount: 2,
      shortage: result.shortage,
      message: `${this.getPlayer(actorId).name} 抓住 ${target.name} 未宣告 UNO，${target.name} 摸 2 张`
    });
    this.verify();
  }

  respondPenalty(
    playerId: string,
    decision: "accept" | "challenge"
  ): { challengeSucceeded: boolean | null } {
    this.requirePlaying();
    const pending = this.pendingPenalty;
    if (!pending || pending.targetId !== playerId) {
      throw new GameError("NO_PENALTY_RESPONSE", "当前没有需要响应的叠加惩罚");
    }
    const target = this.getPlayer(playerId);
    const attacker = this.getPlayer(pending.attackerId);
    this.closeUnoBeforeAction();

    if (decision === "challenge") {
      if (pending.lastKind !== "wild4") {
        throw new GameError("CANNOT_CHALLENGE", "只有 +4 可以质疑");
      }
      this.pendingPenalty = null;
      if (pending.matchingColorAtPlay) {
        const result = this.drawInto(attacker, pending.total);
        this.recordEvent("wild4_challenge_won", "", {
          playerId: target.id,
          targetId: attacker.id,
          drawnCount: pending.total - result.shortage,
          requestedCount: pending.total,
          shortage: result.shortage,
          message: `质疑成立：${attacker.name} 摸 ${pending.total} 张，${target.name} 继续行动`
        });
        this.currentIndex = target.seat;
        this.turnNumber += 1;
        this.drawnCardId = null;
        this.verify();
        return { challengeSucceeded: true };
      }

      const total = pending.total + 2;
      const result = this.drawInto(target, total);
      this.recordEvent("wild4_challenge_lost", "", {
        playerId: target.id,
        targetId: attacker.id,
        drawnCount: total - result.shortage,
        requestedCount: total,
        shortage: result.shortage,
        message: `质疑不成立：${target.name} 摸 ${total} 张并跳过回合`
      });
      this.advanceTurn(1);
      this.verify();
      return { challengeSucceeded: false };
    }

    this.pendingPenalty = null;
    const result = this.drawInto(target, pending.total);
    this.recordEvent("penalty_accepted", "", {
      playerId: target.id,
      targetId: attacker.id,
      drawnCount: pending.total - result.shortage,
      requestedCount: pending.total,
      shortage: result.shortage,
      message: `${target.name} 接受叠加，摸 ${pending.total} 张并跳过回合`
    });
    this.advanceTurn(1);
    this.verify();
    return { challengeSucceeded: null };
  }

  forfeit(playerId: string): void {
    if (this.status !== "playing") {
      return;
    }
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player || !player.active) {
      return;
    }

    const wasCurrent = this.currentPlayerId === playerId;
    const top = this.discard[this.discard.length - 1];
    const hand = player.hand.splice(0);
    if (top) {
      this.discard.splice(this.discard.length - 1, 0, ...hand);
    } else {
      this.discard.push(...hand);
    }
    player.active = false;
    player.unoDeclared = false;

    if (this.pendingUno?.playerId === playerId) {
      this.pendingUno = null;
    }
    const pendingAttackerId =
      this.pendingPenalty?.attackerId === playerId ||
      this.pendingPenalty?.targetId === playerId
        ? this.pendingPenalty.attackerId
        : null;
    const clearedPenalty = pendingAttackerId !== null;
    if (clearedPenalty) {
      this.pendingPenalty = null;
    }

    this.recordEvent("player_forfeited", "", {
      playerId,
      message: `${player.name} 退出对局，手牌已移入弃牌堆`
    });

    const active = this.players.filter((candidate) => candidate.active);
    if (active.length <= 1) {
      this.status = "finished";
      this.winnerId = active[0]?.id ?? null;
      this.pendingUno = null;
      this.pendingPenalty = null;
      this.recordEvent("game_finished", "", {
        playerId: this.winnerId ?? undefined,
        message: active[0] ? `${active[0].name} 获胜` : "对局结束"
      });
      this.verify();
      return;
    }

    if (wasCurrent || clearedPenalty) {
      const baseIndex = clearedPenalty
        ? this.players.findIndex((candidate) => candidate.id === pendingAttackerId)
        : player.seat;
      this.currentIndex = this.nextActiveIndex(
        baseIndex >= 0 ? baseIndex : player.seat,
        this.direction,
        1
      );
      this.turnNumber += 1;
      this.drawnCardId = null;
    }
    this.verify();
  }

  publicView(viewerId: string): PublicGameView {
    const top = this.discard[this.discard.length - 1];
    if (!top) {
      throw new Error("Game has no discard top");
    }
    const pendingUno = this.pendingUno
      ? {
          playerId: this.pendingUno.playerId,
          canDeclare:
            this.pendingUno.playerId === viewerId && !this.pendingUno.declared,
          canCatch:
            this.pendingUno.playerId !== viewerId && !this.pendingUno.declared
        }
      : null;
    const pendingPenalty = this.pendingPenalty
      ? {
          attackerId: this.pendingPenalty.attackerId,
          targetId: this.pendingPenalty.targetId,
          total: this.pendingPenalty.total,
          lastKind: this.pendingPenalty.lastKind,
          canRespond: this.pendingPenalty.targetId === viewerId,
          canChallenge:
            this.pendingPenalty.targetId === viewerId &&
            this.pendingPenalty.lastKind === "wild4"
        }
      : null;

    return {
      status: this.status,
      currentPlayerId: this.currentPlayerId,
      currentColor: this.currentColor,
      direction: this.direction,
      turnNumber: this.turnNumber,
      deckCount: this.deck.length,
      discardCount: this.discard.length,
      discardTop: top,
      winnerId: this.winnerId,
      playableCardIds: this.playableCardIdsFor(viewerId),
      drawnCardId: viewerId === this.currentPlayerId ? this.drawnCardId : null,
      pendingUno,
      pendingPenalty,
      lastEvent: this.lastEvent
    };
  }

  verify(): void {
    const allCards = [
      ...this.deck,
      ...this.discard,
      ...this.players.flatMap((player) => player.hand)
    ];
    const ids = new Set(allCards.map((card) => card.id));
    if (allCards.length !== GAME_CARD_COUNT || ids.size !== GAME_CARD_COUNT) {
      throw new Error(
        `Card integrity failed: count=${allCards.length}, unique=${ids.size}`
      );
    }
    for (const id of ids) {
      if (!this.allCardIds.has(id)) {
        throw new Error(`Unknown card id entered game: ${id}`);
      }
    }
    for (const id of this.allCardIds) {
      if (!ids.has(id)) {
        throw new Error(`Card disappeared from game: ${id}`);
      }
    }
    const plus10Count = allCards.filter((card) => card.kind === "wild10").length;
    if (plus10Count !== 1) {
      throw new Error(`+10 uniqueness failed: ${plus10Count}`);
    }
    const plus10 = allCards.find((card) => card.kind === "wild10");
    if (plus10?.id !== this.plus10CardId) {
      throw new Error("+10 identity changed");
    }
  }

  private describeCard(card: Card): string {
    const colorPrefix = card.color ? `${this.colorName(card.color)}色` : "";
    if (card.kind === "number") {
      return `${colorPrefix}${card.value}`;
    }
    if (card.kind === "wild") {
      return "万能牌";
    }
    if (card.kind === "wild4") {
      return "+4";
    }
    if (card.kind === "wild10") {
      return "+10";
    }
    return `${colorPrefix}${
      card.kind === "skip" ? "跳过" : card.kind === "reverse" ? "反转" : "+2"
    }`;
  }

  private colorName(color: CardColor): string {
    return { red: "红", yellow: "黄", green: "绿", blue: "蓝" }[color];
  }
}
