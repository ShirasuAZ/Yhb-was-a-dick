/**
 * The tutorial game: fixed decks in a fixed order (no shuffling, no random draws), the real rules engine, and an opponent played by the
 * test account "test" that follows a script. Each step says what to do; only the action the step asks for is accepted, and the step moves
 * on when it is done. Every step that needs a player action also has `demo`, the action that does it (used by the tests to play the whole
 * tutorial through).
 */
import type { UnionArenaAction } from "../shared/protocol.ts";
import { actingPlayerId, beginFirstTurn, newEngineGame, type EngineGame, type EnginePlayer, type LifeSlot } from "../shared/engine.ts";

export const TUTORIAL_OPPONENT = { id: "test", username: "test" } as const;

// Card ids from Cards/images/_index.csv. Your deck is red (Lungmen), test's is yellow (Reunion).
const C = {
  chen: "7120", // 陈 0/1 BP1500
  angelina: "7102", // 能天使 0/1 BP500
  nine: "7126", // 九 0/1 BP2000
  texasStep: "7107", // 德克萨斯 1/1 BP2500 撤步
  chenDamage: "7122", // 陈 4/2 BP4000 伤害2
  barrage: "7137", // 弹幕！ event 3/1
  hoshiguma: "7128", // 星熊 0/1 BP2000 2次阻挡
  texas: "7106", // 德克萨斯 0/1 BP1500
  angelinaRaid: "7104", // 能天使 4/1 BP2500 突进〈能天使〉
  lungmen: "7135", // 龙门 site 3/1, 2 red energy
  meteor: "7115", // 陨星, trigger 激活
  kingslayer: "7014", // 弑君者 0/1 BP1500
  w: "7021", // W 0/1 BP2000
  mischa: "7011", // 米莎 0/1 BP1000
  mephisto: "7036", // 梅菲斯特 0/1 BP1000
  soldier: "7039", // 整合运动士兵 0/1 BP1000
  frostnova: "7040" // 雪怪小队 0/1 BP1500
} as const;

export interface TutorialSetup {
  game: EngineGame;
  me: EnginePlayer;
  test: EnginePlayer;
  players: EnginePlayer[];
  /** The life areas, dealt after the mulligan (rule manual, Preparing to Play step 5). */
  lifeToDeal: Record<string, string[]>;
  /** Cards test has played in each of its turns, for its script. */
  testPlays: Record<number, number>;
}

function lifeSlots(owner: string, cards: readonly string[]): LifeSlot[] {
  return cards.map((cardId, index) => ({ id: `${owner}:life:${index}`, cardId, faceUp: false }));
}

export function createTutorial(meId: string, meName: string): TutorialSetup {
  const player = (accountId: string, username: string, hand: string[], library: string[]): EnginePlayer =>
    ({ accountId, username, hand, library, life: [], apCount: 3, ap: [], front: [], energy: [], sideline: [], removal: [] });
  const me = player(meId, meName,
    [C.chen, C.angelina, C.nine, C.texasStep, C.chenDamage, C.barrage, C.hoshiguma],
    [C.texas, C.angelinaRaid, C.lungmen, C.nine, C.nine, C.nine, C.nine, C.nine, C.nine, C.nine]);
  const test = player(TUTORIAL_OPPONENT.id, TUTORIAL_OPPONENT.username,
    [C.kingslayer, C.w, C.mischa, C.mephisto, C.kingslayer, C.soldier, C.soldier],
    Array<string>(12).fill(C.soldier));
  const game = newEngineGame(meId, [meId, TUTORIAL_OPPONENT.id]);
  return {
    game, me, test, players: [me, test],
    lifeToDeal: { [meId]: [C.meteor, C.nine, C.nine, C.nine, C.nine, C.nine, C.nine], [TUTORIAL_OPPONENT.id]: [C.soldier, C.soldier, C.frostnova, C.soldier, C.frostnova, C.soldier, C.frostnova] },
    testPlays: {}
  };
}

/** Both players keep their hands; then the life areas are dealt and your first turn begins. */
export function finishMulligan(s: TutorialSetup): void {
  s.game.mulliganQueue = [];
  for (const player of s.players) player.life = lifeSlots(player.accountId, s.lifeToDeal[player.accountId]!);
  beginFirstTurn(s.game, s.players);
}

/** What test plays in its nth turn, in order, and which of its characters attack. */
const TEST_PLAYS: Record<number, Array<[string, "front" | "energy"]>> = {
  1: [[C.kingslayer, "front"], [C.w, "front"]],
  2: [[C.mischa, "energy"], [C.mephisto, "energy"]],
  3: [[C.kingslayer, "front"]]
};
const TEST_ATTACKS: Record<number, string[]> = { 2: [C.w], 3: [C.mischa, C.mephisto] };

/** test's next move, or null when it is not test's move. */
export function testAction(s: TutorialSetup): UnionArenaAction | null {
  const { game, me, test } = s;
  if (game.step !== "turn" || actingPlayerId(game) !== test.accountId) return null;
  const pending = game.pending;
  if (pending) {
    switch (pending.kind) {
      case "block": {
        // test blocks twice in the tutorial, to show a battle: your first attack (turn 3) and Angelina's attack after Raid (turn 5).
        const attacker = me.front.find((card) => card.uid === pending.attackerUid);
        const wanted = game.turn === 3 ? C.kingslayer : game.turn === 5 && attacker?.cardId === C.angelinaRaid ? C.w : null;
        const blocker = wanted ? test.front.find((card) => card.cardId === wanted && !card.rested) : undefined;
        return { type: "block", blockerUid: blocker?.uid ?? null };
      }
      case "damage": return { type: "damage", lifeIds: me.life.slice(0, pending.amount).map((slot) => slot.id) };
      case "triggers": return { type: "trigger", lifeId: pending.revealed[0]!.id, activate: false };
      case "discard": return { type: "discard", keep: [0, 1, 2, 3, 4, 5, 6, 7] };
    }
  }
  const nth = game.turnsTaken[test.accountId] ?? 0;
  switch (game.phase) {
    case "movement": {
      const movers = nth === 3 ? test.energy.filter((card) => card.cardId === C.mischa || card.cardId === C.mephisto) : [];
      return movers.length ? { type: "move", toFront: movers.map((card) => card.uid), toEnergy: [], remove: [] } : { type: "next_phase" };
    }
    case "main": {
      const played = s.testPlays[nth] ?? 0;
      const next = TEST_PLAYS[nth]?.[played];
      const handIndex = next ? test.hand.indexOf(next[0]) : -1;
      if (next && handIndex >= 0 && test.ap.some((card) => !card.rested)) {
        s.testPlays[nth] = played + 1;
        return { type: "play", handIndex, line: next[1] };
      }
      return { type: "next_phase" };
    }
    case "attack": {
      const attacker = (TEST_ATTACKS[nth] ?? []).map((cardId) => test.front.find((card) => card.cardId === cardId && !card.rested && card.attacks === 0)).find(Boolean);
      return attacker ? { type: "attack", attackerUid: attacker.uid } : { type: "end_turn" };
    }
    default:
      return { type: "next_phase" };
  }
}

export interface TutorialStep {
  text: string;
  /** CSS selector of what the step talks about; it is outlined on the table. */
  highlight?: string;
  /** An explanation only: a "下一步" button moves on. */
  next?: true;
  /** The mulligan decision (keep). */
  mulligan?: true;
  /** The player actions this step accepts. */
  expect?: (action: UnionArenaAction, s: TutorialSetup) => boolean;
  /** The step is done when this holds (checked after every change, and for a step with `expect` only after its action). Without it, one accepted action finishes the step. */
  until?: (s: TutorialSetup) => boolean;
  /** An action that does the step, for the automated walkthrough. */
  demo?: (s: TutorialSetup) => UnionArenaAction;
}

/** Whether a step is finished; `acted` says whether the player has made the step's action. */
export function stepDone(step: TutorialStep, s: TutorialSetup, acted: boolean): boolean {
  if (step.expect) return acted && (!step.until || step.until(s));
  return step.until?.(s) ?? false;
}

const SELF = '.ua-half[data-side="self"]';
const OPP = '.ua-half[data-side="opponent"]';
const handIndex = (s: TutorialSetup, cardId: string): number => s.me.hand.indexOf(cardId);
const isPlay = (cardId: string, line: "front" | "energy") => (action: UnionArenaAction, s: TutorialSetup): boolean => action.type === "play" && s.me.hand[action.handIndex] === cardId && action.line === line;
const play = (cardId: string, line: "front" | "energy") => (s: TutorialSetup): UnionArenaAction => ({ type: "play", handIndex: handIndex(s, cardId), line });
const isNext = (action: UnionArenaAction): boolean => action.type === "next_phase";
const next = (): UnionArenaAction => ({ type: "next_phase" });
const field = (s: TutorialSetup, cardId: string) => [...s.me.front, ...s.me.energy].find((card) => card.cardId === cardId);
const myTurnStart = (turn: number) => (s: TutorialSetup): boolean => s.game.turn === turn && s.game.turnPlayerId === s.me.accountId && s.game.phase === "start";
const myPending = (kind: string) => (s: TutorialSetup): boolean => s.game.pending?.kind === kind && s.game.pending.playerId === s.me.accountId;
const settled = (s: TutorialSetup): boolean => s.game.pending === null;
/** Attacks with any of your active front characters, the damage picks after them, and answers to card abilities on the way. */
const isAttackOrDamage = (action: UnionArenaAction, s: TutorialSetup): boolean =>
  (action.type === "attack" && !action.targetUid && s.me.front.some((card) => card.uid === action.attackerUid)) || action.type === "damage" || action.type === "choose";
const nextAttackOrDamage = (s: TutorialSetup): UnionArenaAction => {
  const pending = s.game.pending;
  if (pending?.kind === "damage") return { type: "damage", lifeIds: s.test.life.slice(0, pending.amount).map((slot) => slot.id) };
  if (pending?.kind === "choose") return { type: "choose", picks: pending.purpose === "confirm" ? ["no"] : pending.options.slice(0, pending.min) };
  const attacker = s.me.front.find((card) => !card.rested)!;
  return { type: "attack", attackerUid: attacker.uid };
};

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { next: true, text: "欢迎来到明日方舟 UNION ARENA 新手教程！本局使用固定的牌组和出牌顺序，对手是测试账号 test。跟着提示一步步操作，就能打完一整局。" },
  { next: true, highlight: `${SELF} .ua-z-front`, text: "这是你的前线：最多放 4 张角色。只有前线中活跃（竖放）的角色能攻击和阻挡。" },
  { next: true, highlight: `${SELF} .ua-z-energy`, text: "这是能量线：最多放 4 张角色或场地。只有能量线上的卡会产生能量（卡牌右下角的圆点），用来满足卡牌左上角的『所需能量』（颜色要相同）。前线的卡不产生能量。" },
  { next: true, highlight: `${SELF} .ua-z-ap`, text: "这是行动点区（AP 区）：放 AP 卡。使用卡牌时，要把与卡牌左上角『ACTION』数字相同数量的活跃 AP 卡转为休息（横放）。" },
  { next: true, highlight: `${SELF} .ua-z-life`, text: "这是生命区：开局放 7 张背面朝下的生命卡。被攻击受到伤害时会翻开生命卡；生命区没有卡时就输了。" },
  { next: true, highlight: `${SELF} :is(.ua-z-deck, .ua-z-discard, .ua-z-removal)`, text: "卡组放置处放你的牌库；场外放用过的事件和退场的卡；移除区放被移除的卡，它们不会再回到游戏中。" },
  { next: true, highlight: `${SELF} .ua-phases`, text: "阶段栏：每个回合依次是 ① 起始 ② 移动 ③ 主要 ④ 攻击 ⑤ 结束，然后轮到对手。你的手牌在牌桌下方。点击任何一张卡都能放大查看，放大后可以用左右的 < > 按钮翻看同一区域的其他卡。" },
  { mulligan: true, highlight: ".ua-handstrip", text: "起手 7 张已经发好。规则允许重抽一次（手牌放到牌库底，抽 7 张新牌，再洗牌）。这次手牌很好，点击操作栏的『保留起手牌』。之后双方各从牌库顶拿 7 张盖着放进生命区。" },
  { expect: isNext, demo: next, highlight: `${SELF} .ua-z-ap`, text: "第 1 回合，你是先手。起始阶段：场上卡牌与 AP 卡转为活跃，AP 卡补到规定张数——先手第 1 回合 1 张，第 2 回合 2 张，第 3 回合起 3 张（后手第 1 回合就有 2 张）。先手第 1 回合不抽卡。点击『进入移动阶段』。" },
  { expect: isNext, demo: next, text: "移动阶段：可以把能量线的角色移到前线。现在场上还没有卡，点击『不移动，进入主要阶段』。" },
  { expect: isPlay(C.chen, "energy"), demo: play(C.chen, "energy"), highlight: ".ua-handstrip", text: "主要阶段：点击手牌中的『陈』，在放大图里选择『登场到能量线』。它所需能量为 0，花费 1 AP。登场的卡都是休息（横放）状态。" },
  { expect: isNext, demo: next, text: "AP 用完了。点击『进入攻击阶段』。" },
  { expect: (action) => action.type === "end_turn", demo: () => ({ type: "end_turn" }), text: "前线没有角色，不能攻击。点击『结束回合』：结束阶段会把场上休息的角色和场地转为活跃（AP 卡保持休息），然后轮到对手。" },
  { until: myTurnStart(3), highlight: OPP, text: "test 的回合：它是后手，第 1 回合就有 2 张 AP，并抽 1 张卡。看它把两张角色放到前线……" },
  { expect: isNext, demo: next, highlight: `${SELF} .ua-z-ap`, text: "第 3 回合：你抽了 1 张卡，AP 变为 2 张，横放的卡都转为活跃。起始阶段可以支付 1 AP 额外抽 1 张（每回合 1 次），但这回合 AP 要用来出牌。点击『进入移动阶段』。" },
  { expect: (action, s) => action.type === "move" && action.toFront.length === 1 && action.toFront[0] === field(s, C.chen)?.uid && !action.toEnergy.length,
    demo: (s) => ({ type: "move", toFront: [field(s, C.chen)!.uid], toEnergy: [], remove: [] }), highlight: `${SELF} .ua-z-energy`,
    text: "点击能量线上高亮的『陈』，再点操作栏的『确认移动』，把它移到前线准备攻击。" },
  { expect: isPlay(C.nine, "energy"), demo: play(C.nine, "energy"), highlight: ".ua-handstrip", text: "能量线空了，需要新的能量来源。把手牌里的『九』（所需能量 0）登场到能量线。" },
  { expect: isPlay(C.angelina, "energy"), demo: play(C.angelina, "energy"), highlight: ".ua-handstrip", text: "再把『能天使』登场到能量线。现在能量线可以产生 2 点红色能量。" },
  { expect: isNext, demo: next, text: "AP 用完了，点击『进入攻击阶段』。" },
  { expect: (action, s) => action.type === "attack" && action.attackerUid === field(s, C.chen)?.uid, demo: (s) => ({ type: "attack", attackerUid: field(s, C.chen)!.uid }), until: settled, highlight: `${SELF} .ua-z-front`,
    text: "攻击阶段：点击前线的『陈』，在放大图里选择『攻击 test』。攻击的角色会转为休息，攻击不消耗 AP。" },
  { expect: (action) => action.type === "end_turn", demo: () => ({ type: "end_turn" }), highlight: `${OPP} .ua-z-discard`,
    text: "test 用『弑君者』阻挡，发生战斗。双方 BP 都是 1500：攻击方 BP 大于或等于被攻击方就获胜，『弑君者』退场进入场外。（攻击方输了也不会退场。）点击『结束回合』。" },
  { until: myPending("block"), highlight: OPP, text: "test 的回合：它把 2 张角色登场到能量线，然后用前线的『W』攻击你……" },
  { expect: (action) => action.type === "block" && action.blockerUid === null, demo: () => ({ type: "block", blockerUid: null }), until: myPending("triggers"),
    text: "『W』（BP 2000）攻击你！可以点击你前线中活跃的角色阻挡。这次点击『不阻挡』，体验受到伤害和触发。" },
  { expect: (action) => action.type === "trigger" && action.activate, demo: (s) => ({ type: "trigger", lifeId: (s.game.pending as { revealed: LifeSlot[] }).revealed[0]!.id, activate: true, targetUid: field(s, C.chen)!.uid }),
    highlight: `${SELF} .ua-z-life`,
    text: "受到 1 点伤害：攻击方选了你的 1 张生命卡翻开。『陨星』有触发【激活】！点击『发动』，再选择你的『陈』：它转为活跃，本回合 BP+3000。触发处理完后，这张卡进入场外。" },
  { until: myTurnStart(5), text: "test 的回合结束……" },
  { expect: isNext, demo: next, text: "第 5 回合：AP 补到 3 张，你抽到了带《突进》的『能天使』。点击『进入移动阶段』。" },
  { expect: isNext, demo: next, text: "这回合不移动，点击『不移动，进入主要阶段』。" },
  { expect: (action, s) => isPlay(C.texas, "energy")(action, s) || isPlay(C.texasStep, "energy")(action, s),
    demo: (s) => play(s.me.hand.includes(C.texas) ? C.texas : C.texasStep, "energy")(s), until: (s) => !s.me.hand.includes(C.texas) && !s.me.hand.includes(C.texasStep), highlight: ".ua-handstrip",
    text: "把手牌里的两张『德克萨斯』都登场到能量线。一张所需能量 0；另一张需要 1 点红色能量（能量线已经足够），它有《撤步》，以后可以在移动阶段从前线退回能量线。" },
  { expect: (action, s) => action.type === "raid" && s.me.hand[action.handIndex] === C.angelinaRaid && action.toFront === true,
    demo: (s) => ({ type: "raid", handIndex: handIndex(s, C.angelinaRaid), targetUid: field(s, C.angelina)!.uid, toFront: true }), highlight: ".ua-handstrip",
    text: "能量线现在产生 4 点红色能量。点击手牌中的突进『能天使』，选择『突进…』，目标点能量线上的『能天使』，然后选『移动至前线』。突进的卡叠在目标上，转为活跃，还能直接移到前线！" },
  { expect: isNext, demo: next, text: "AP 用完了，点击『进入攻击阶段』。" },
  { expect: (action, s) => action.type === "attack" && action.attackerUid === field(s, C.angelinaRaid)?.uid, demo: (s) => ({ type: "attack", attackerUid: field(s, C.angelinaRaid)!.uid }), until: settled,
    highlight: `${SELF} .ua-z-front`, text: "先用突进后的『能天使』（BP 2500）攻击。" },
  { expect: (action, s) => action.type === "attack" && action.attackerUid === field(s, C.chen)?.uid, demo: (s) => ({ type: "attack", attackerUid: field(s, C.chen)!.uid }), until: myPending("damage"),
    highlight: `${SELF} .ua-z-front`, text: "test 用『W』（BP 2000）阻挡，被『能天使』击败退场。现在用『陈』攻击。" },
  { expect: (action) => action.type === "damage", demo: (s) => ({ type: "damage", lifeIds: [s.test.life[0]!.id] }), until: settled, highlight: `${OPP} .ua-z-life`,
    text: "test 前线已经没有活跃角色可以阻挡，攻击直接命中！点击 test 生命区里的 1 张生命卡，再点『确认』（也可以『随机选择』）。" },
  { expect: (action) => action.type === "end_turn", demo: () => ({ type: "end_turn" }), text: "test 受到 1 点伤害，翻开的生命卡没有触发，进入它的场外。点击『结束回合』。" },
  { until: myPending("block"), highlight: OPP, text: "test 的回合：它把能量线的 2 张角色移到前线，又登场了 1 张角色，然后发起攻击……" },
  { expect: (action, s) => action.type === "block" && action.blockerUid === field(s, C.chen)?.uid, demo: (s) => ({ type: "block", blockerUid: field(s, C.chen)!.uid }),
    until: (s) => myPending("block")(s) || myTurnStart(7)(s), highlight: `${SELF} .ua-z-front`,
    text: "『米莎』（BP 1000）攻击你。点击你前线高亮的『陈』（BP 1500）阻挡！" },
  { expect: (action, s) => action.type === "block" && action.blockerUid === field(s, C.angelinaRaid)?.uid, demo: (s) => ({ type: "block", blockerUid: field(s, C.angelinaRaid)!.uid }),
    until: myTurnStart(7), highlight: `${SELF} .ua-z-front`,
    text: "『米莎』输了战斗，但攻击方输了不会退场。现在『梅菲斯特』攻击你，点击『能天使』阻挡。" },
  { expect: isNext, demo: next, text: "第 7 回合：你抽到了场地『龙门』。点击『进入移动阶段』。" },
  { expect: isNext, demo: next, text: "点击『不移动，进入主要阶段』。" },
  { expect: isPlay(C.lungmen, "energy"), demo: play(C.lungmen, "energy"), highlight: ".ua-handstrip", text: "场地卡只能放在能量线，『龙门』能产生 2 点红色能量。把它登场到能量线。" },
  { expect: isPlay(C.chenDamage, "front"), demo: play(C.chenDamage, "front"), highlight: ".ua-handstrip",
    text: "把带《伤害2》的『陈』登场到前线：需要 4 点红色能量、2 AP。《伤害2》的角色攻击未被阻挡时造成 2 点伤害。新登场的卡是休息状态，下回合才能攻击。" },
  { expect: isNext, demo: next, text: "点击『进入攻击阶段』。" },
  { expect: isAttackOrDamage, demo: nextAttackOrDamage, until: (s) => s.test.life.length === 4 && settled(s), highlight: `${SELF} .ua-z-front`,
    text: "用前线的『陈』和『能天使』各攻击一次。test 选择不阻挡，每次攻击后点击 test 的 1 张生命卡并确认。『能天使』攻击结束时，它的卡面能力会问你是否发动（可以让它再次转为活跃），这里选『否』即可。" },
  { expect: (action) => action.type === "end_turn", demo: () => ({ type: "end_turn" }), text: "test 还剩 4 张生命。点击『结束回合』。" },
  { until: myTurnStart(9), text: "test 的回合……" },
  { expect: (action) => action.type === "extra_draw", demo: () => ({ type: "extra_draw" }), text: "第 9 回合。试试额外抽卡：点击『额外抽卡（1 AP）』。每回合只能用 1 次。" },
  { expect: isNext, demo: next, until: (s) => s.game.phase === "main", text: "点击『进入移动阶段』，再点『不移动，进入主要阶段』。" },
  { expect: (action, s) => action.type === "event" && s.me.hand[action.handIndex] === C.barrage, demo: (s) => ({ type: "event", handIndex: handIndex(s, C.barrage) }), until: myPending("choose"), highlight: ".ua-handstrip",
    text: "使用事件『弹幕！』：点击手牌中的它，选择『使用事件』（所需能量 3，1 AP）。事件结算后进入场外。" },
  { expect: (action, s) => action.type === "choose" && action.picks.length === 1 && s.test.front.some((card) => card.uid === action.picks[0] && card.cardId === C.kingslayer),
    demo: (s) => ({ type: "choose", picks: [s.test.front.find((card) => card.cardId === C.kingslayer)!.uid] }), highlight: `${OPP} .ua-z-front`,
    text: "卡面效果由游戏自动结算：『选择对方前线中 1 张 BP 不高于 2000 的角色退场；我方每有 1 张原本 BP 为 2500 的角色，范围 +1000』。点击 test 前线高亮的『弑君者』。（还没有自动化的卡，可以在放大图的「卡牌效果」里手动结算。）" },
  { expect: isPlay(C.hoshiguma, "front"), demo: play(C.hoshiguma, "front"), highlight: ".ua-handstrip", text: "把『星熊』登场到前线。它有《2次阻挡》：每回合第一次阻挡后会转回活跃，可以再挡一次。" },
  { expect: isNext, demo: next, text: "点击『进入攻击阶段』。" },
  { expect: isAttackOrDamage, demo: nextAttackOrDamage, until: (s) => s.game.step === "over", highlight: `${OPP} .ua-z-life`,
    text: "用『陈』『能天使』和《伤害2》的『陈』依次攻击，打光 test 剩下的 4 张生命！" },
  { text: "恭喜，你赢下了教程对局！胜利条件有两个：对手生命区没有卡；或对手在起始阶段牌库为空无法抽卡。另外，结束阶段手牌超过 8 张时要选 8 张保留，其余置于移除区。现在可以去『玩家对战』和朋友一决胜负了！" }
];
