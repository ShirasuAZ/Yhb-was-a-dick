import { useEffect, useMemo, useState } from "react";
import type { ActionAck, UnionArenaCardStats } from "../shared/protocol.ts";
import type { IpId } from "../shared/ips.ts";
import type { EngineContext } from "../shared/engine.ts";
import { cardContext } from "../shared/abilities/registry.ts";

export interface Account { id: string; username: string; avatarUrl: string | null; }
export interface CardRecord {
  id: string;
  number: string;
  name: string;
  rarity: string;
  file: string;
  sourceMaterialCode: string;
  /** The title this card belongs to, worked out by the server from the card number. */
  ipId: IpId | null;
  parallelIds: string[];
  imageAvailable: boolean;
  imageUrl: string | null;
  stats: UnionArenaCardStats | null;
}

/** The card catalog from the site's API, with a lookup by id and the rules engine's view of it. */
export function useCatalog(onError: (message: string) => void): { cards: CardRecord[]; cardsById: ReadonlyMap<string, CardRecord>; ctx: EngineContext } {
  const [cards, setCards] = useState<CardRecord[]>([]);
  useEffect(() => {
    let active = true;
    void fetch("/api/arknights/catalog").then((response) => response.json()).then((data: { cards?: CardRecord[] }) => {
      if (active) setCards(data.cards ?? []);
    }).catch(() => { if (active) onError("卡牌目录暂时无法加载。"); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const ctx = useMemo<EngineContext>(() => cardContext((cardId) => cardsById.get(cardId)), [cardsById]);
  return { cards, cardsById, ctx };
}

/** Server and engine error codes (the ack's `code`) in plain words. */
export const ERROR_TEXT: Readonly<Record<string, string>> = {
  ALREADY_IN_ROOM: "你已经在一个房间里了。",
  ROOM_NOT_FOUND: "找不到这个房间。",
  ROOM_FULL: "房间已满。",
  GAME_IN_PROGRESS: "这个房间的对局已经开始。",
  NO_ACTIVE_ROOM: "没有可恢复的房间。",
  NOT_IN_ROOM: "你不在房间里。",
  GAME_ALREADY_STARTED: "对局已经开始。",
  INVALID_DECK: "牌组数据无效。",
  INVALID_AP_COUNT: "AP 卡数量无效。",
  DECK_INCOMPLETE: "请先提交合法的牌组。",
  HOST_ONLY: "只有房主可以开始游戏。",
  NOT_ENOUGH_PLAYERS: "需要两名在线玩家才能开始。",
  DECKS_NOT_READY: "双方都要提交合法牌组并准备好。",
  NOT_MULLIGAN_STEP: "现在不是换牌阶段。",
  NOT_YOUR_MULLIGAN: "还没轮到你决定是否换牌。",
  AUTH_REQUIRED: "登录状态已失效，请返回重新登录。",
  NOT_PLAYING: "对局还没有开始。",
  GAME_OVER: "对局已经结束。",
  GAME_NOT_OVER: "对局还没有结束。",
  NOT_YOUR_TURN: "现在不是你的回合。",
  WAITING_FOR_OPPONENT: "正在等待对手做出选择。",
  NOT_NOW: "现在不能这样做。",
  INVALID_ACTION: "操作无效。",
  INVALID_CARD: "这张卡不在手牌里。",
  CARD_DATA_MISSING: "缺少这张卡的卡面数据。",
  NOT_ENOUGH_ENERGY: "能量线产生的同色能量不足。",
  NOT_ENOUGH_AP: "活跃的 AP 卡不足。",
  LINE_FULL: "这条线已有 4 张卡，请先选择 1 张置于移除区。",
  INVALID_LINE: "请选择前线或能量线。",
  SITE_ENERGY_LINE_ONLY: "场地卡只能放到能量线。",
  ENERGY_LINE_ONLY: "这张卡无法在前线登场，只能放到能量线。",
  MUST_ATTACK: "还有必须尽可能进行攻击的角色，现在不能结束攻击。",
  EVENT_CONDITION: "现在不满足这张事件卡的使用条件。",
  USE_EVENT_INSTEAD: "事件卡请直接使用。",
  NOT_AN_EVENT: "这不是事件卡。",
  NO_RAID: "这张卡没有突进。",
  RAID_TARGET_INVALID: "不能突进到这张卡上。",
  INVALID_MOVE: "移动无效。",
  SITE_CANNOT_MOVE: "场地卡不能移动。",
  STEP_REQUIRED: "只有拥有《撤步》的角色可以从前线移回能量线。",
  INVALID_ATTACKER: "只有前线中活跃状态的角色可以攻击。",
  SNIPE_REQUIRED: "只有拥有《瞄准攻击》的角色可以指定角色攻击。",
  INVALID_TARGET: "攻击目标无效。",
  INVALID_BLOCKER: "只有前线中活跃状态的角色可以阻挡。",
  INVALID_LIFE_CHOICE: "生命卡选择无效。",
  TRIGGER_TARGET_REQUIRED: "发动这个触发需要选择目标。",
  TRIGGER_TARGET_INVALID: "这个目标不符合触发的条件。",
  INVALID_DISCARD: "请恰好选择 8 张要保留的手牌。",
  DECK_EMPTY: "牌库没有卡了。",
  CARD_NOT_ON_FIELD: "这张卡已经不在场上。",
  INVALID_MANUAL: "卡牌效果操作无效。"
};
export const errorText = (result: ActionAck<unknown> | null, fallback: string): string => (result?.code && ERROR_TEXT[result.code]) || result?.message || fallback;

export const COLOR_NAME: Readonly<Record<string, string>> = { yellow: "黄", red: "红", blue: "蓝", purple: "紫", green: "绿" };
export const TYPE_NAME: Readonly<Record<string, string>> = { character: "角色", site: "场地", event: "事件" };
