/** Abilities of the blue-b cards (see cards.ts for the conventions). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import { abilitiesOf, bpOf, sidelineByEffect, type EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step, Target } from "./types.ts";
import {
  activate, activateAp, activateMain, all, and, bp, bpAtMost, chooseAp, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent, chooseOwn, chosen,
  chosenCount, discard, draw, duringOpponentTurn, duringYourTurn, energyCostAtMost, energyThisTurn, givenOnly, grantAbility, ifThen, isCharacterCard, look,
  lookedToBottom, may, moveChosen, named, noneChosen, notNamed, notSelf, onAttack, onBlock, onPlay, onSidelined, onUse, rest, restSelf, run, selfActive,
  selfOnFront, sideline, staticAura, staticSelf, toHand, when, withAffinity, withCondition, youHaveNamed
} from "./dsl.ts";

// ---- Helpers for the blue-b cards ----
const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const isCharacter = (env: AbilityEnv, card: UnionArenaFieldCard): boolean => env.ctx.card(card.cardId)?.type === "character";

/**
 * A character's BP right now, adding up the continuous abilities on the field directly. The engine recomputes continuous abilities in field
 * order, so while one of them is being checked another card's `staticBp` may not be up to date yet (e.g. 〈阿米娅〉 1-101's BP+1000).
 */
function currentBp(env: AbilityEnv, card: UnionArenaFieldCard): number {
  const cardOwner = env.players.find((player) => fieldOf(player).includes(card));
  let total = (env.ctx.card(card.cardId)?.bp ?? 0) + card.bpMod + (card.lasting ?? []).reduce((sum, entry) => sum + entry.bp, 0);
  for (const owner of env.players) {
    const opponent = env.players.find((player) => player !== owner) ?? owner;
    for (const source of fieldOf(owner)) {
      for (const ability of abilitiesOf(env.ctx, source.cardId)) {
        if (ability.kind !== "static" || ability.bp === undefined) continue;
        const sourceEnv: AbilityEnv = { ...env, owner, opponent, self: source, selfCardId: source.cardId, vars: {}, cause: null };
        if (ability.condition && !ability.condition(sourceEnv)) continue;
        if (ability.affects ? !cardOwner || !ability.affects(sourceEnv, card, cardOwner) : source !== card) continue;
        total += typeof ability.bp === "function" ? ability.bp(sourceEnv) : ability.bp;
      }
    }
  }
  return total;
}
/** 我方的前线 / 能量线中存在BP4000或更高的（其他）角色 */
const lineHasBp = (line: "front" | "energy", atLeast: number, excludeSelf = false): Condition => (env) =>
  env.owner[line].some((card) => isCharacter(env, card) && (!excludeSelf || card.uid !== env.self?.uid) && currentBp(env, card) >= atLeast);
/** Options picked by a "从下列选择最多N项" choice. */
const pickedMode = (index: number): Condition => (env) => (env.vars.mode ?? []).includes(`m:${index}`);
/** 从下列选择最多N项 */
const chooseModesUpTo = (max: number, modes: string[]): Step => ({ do: "choose", as: "mode", from: "mode", side: "you", modes, min: 0, max, prompt: `从下列选择最多 ${max} 项`, good: true });
const energyCostAtLeast = (limit: number) => (env: AbilityEnv, cardId: string): boolean => (env.ctx.card(cardId)?.energyCost ?? 0) >= limit;
const handNotEmpty: Condition = (env) => env.owner.hand.length > 0;
const hasActiveAp: Condition = (env) => env.owner.ap.some((card) => !card.rested);
/** Our field characters with an affinity. */
const ownWithAffinity = (affinity: string): Target => (env) => fieldOf(env.owner).filter((card) => isCharacter(env, card) && (env.ctx.card(card.cardId)?.affinities.includes(affinity) ?? false));
/** 该角色下一次转为活跃状态无效 (the chosen field cards, or this card). */
const skipNextActivate = (name: string | null) => (env: AbilityEnv): void => {
  const uids = name ? env.vars[name] ?? [] : env.self ? [env.self.uid] : [];
  for (const card of env.players.flatMap(fieldOf)) if (uids.includes(card.uid)) card.skipNextActivate = true;
};
/** 剩余的卡牌自选顺序置于我方卡组的最上方 (the first card picked ends up on top). */
const lookedToTop = (): Step[] => [
  { do: "choose", as: "top", from: "looked", side: "you", all: true, min: 0, max: 99, prompt: "依次点选剩余的卡，按点选顺序放到卡组最上方（先点的在最上面）", good: true },
  run("剩余的卡牌按选择的顺序置于卡组最上方", (env) => {
    const looking = env.game.looking;
    if (!looking) return;
    const keys = env.vars.top ?? [];
    const cards = keys.map((key) => looking.cards[Number(key.slice(2))]).filter((cardId): cardId is string => !!cardId);
    looking.cards = looking.cards.filter((_, index) => !keys.includes(`l:${index}`));
    env.owner.library.unshift(...cards);
  })
];
/** "<name>的此效果1回合只能发动1次": marks on the game for this turn, per player. */
const turnMark = (env: AbilityEnv, text: string): string => `${env.game.turn}:${env.owner.accountId}:${text}`;
const notMarkedThisTurn = (text: string): Condition => (env) => !(env.game.turnMarks ?? []).includes(turnMark(env, text));
const markThisTurn = (text: string) => (env: AbilityEnv): void => {
  env.game.turnMarks = [...(env.game.turnMarks ?? []).filter((mark) => mark.startsWith(`${env.game.turn}:`)), turnMark(env, text)];
};
/** Moves this card from the sideline to the life area, face up (it was just sidelined). */
const sidelinedSelfToLife = (env: AbilityEnv): void => {
  const index = env.owner.sideline.lastIndexOf(env.selfCardId);
  if (index < 0) return;
  env.owner.sideline.splice(index, 1);
  env.game.seq += 1;
  env.owner.life.push({ id: `${env.owner.accountId}:life:r${env.game.seq}`, cardId: env.selfCardId, faceUp: true });
};
/** "当主要阶段结束时，将此角色退场", given for the turn. */
const sidelineAtMainEnd = givenOnly(when(["onMainEnd"], sideline("self")));

export const BLUE_B_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 芙兰卡：【启动主要】「每回合1次」此角色在本回合中，获得BP+1500和“当攻击阶段结束时，将此角色退场”。
  "UC01ST/ARK-1-035": [
    activateMain({ once: true }, bp("self", 1500), grantAbility("self", 1)),
    givenOnly(when(["onAttackPhaseEnd"], sideline("self")))
  ],

  // 雷蛇：【阻挡时】选择我方场上的最多1张角色，本回合中，BP+500。
  "UC01ST/ARK-1-036": [onBlock(chooseOwn("target", { max: 1, prompt: "选择我方场上最多 1 张角色（本回合 BP+500）" }), bp(chosen("target"), 500))],

  // 凯尔希：此角色处于活跃状态的场合，此角色的产生能量+(蓝)。
  "UC01ST/ARK-1-046": [staticSelf({ energy: 1 }, selfActive)],

  // 杜宾：【登场时】将我方场上的1张所需能量不高于1的其他角色放回手牌。没有其他角色放回手牌的场合，将此角色放回手牌。
  "UC01ST/ARK-1-049": [onPlay(chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }), toHand(chosen("target")), ifThen(noneChosen("target"), [toHand("self")]))],

  // 杜宾：「前线中存在的场合」我方场上〈杜宾〉以外的所有所需能量为3的角色，BP+1000。
  "UC01ST/ARK-1-050": [staticAura((env, card, cardOwner) => cardOwner === env.owner && isCharacter(env, card) && env.ctx.card(card.cardId)?.name !== "杜宾" && env.ctx.card(card.cardId)?.energyCost === 3, { bp: 1000 }, selfOnFront)],

  // 博士：此卡牌无法在前线中登场，无法移动至前线。
  //      【启动主要】〔转为休息状态〕「每回合1次」此角色在本回合中，获得产生能量+(蓝)和“当主要阶段结束时，将此角色退场”。
  "UC01ST/ARK-1-051": [
    staticSelf({ flags: ["energyLineOnly", "cannotMove"] }),
    activateMain({ costs: [restSelf], once: true }, energyThisTurn("self", 1), grantAbility("self", 2)),
    sidelineAtMainEnd
  ],

  // 应急理智加强剂（事件）：选择我方的最多2张AP卡牌，转为活跃状态。
  "UC01ST/ARK-1-062": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 精神爆发（事件）：选择对方前线中的1张『BP不高于3000』的角色退场。我方的场上存在〈阿米娅〉的场合，改为『BP不高于5000』。
  "UC01ST/ARK-1-064": [
    onUse(chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (youHaveNamed("阿米娅")(env) ? 5000 : 3000)), prompt: "选择对方前线中 1 张 BP 不高于 3000（我方有〈阿米娅〉时为 5000）的角色退场" }), sideline(chosen("target")))
  ],

  // 阿米娅：【我方的回合中】此角色BP+1000。
  "UC01ST/ARK-1-101": [staticSelf({ bp: 1000 }, duringYourTurn)],

  // 阿米娅：【登场时】从下列选择最多2项。
  //        •我方的前线中存在BP4000或更高的角色的场合，选择对方前线中的最多1张BP2000或更高的角色，本回合中，BP-1500。
  //        •我方的能量线中存在BP4000或更高的角色的场合，选择对方前线中的最多1张BP不高于2000的角色退场。
  "UC01ST/ARK-1-102": [onPlay(
    chooseModesUpTo(2, ["我方的前线中存在BP4000或更高的角色的场合，选择对方前线中的最多1张BP2000或更高的角色，本回合中，BP-1500。", "我方的能量线中存在BP4000或更高的角色的场合，选择对方前线中的最多1张BP不高于2000的角色退场。"]),
    ifThen(all(pickedMode(0), lineHasBp("front", 4000)), [
      chooseOpponent("minus", { line: "front", max: 1, filter: (env, _cardId, card) => !!card && bpOf(env.ctx, card) >= 2000, prompt: "选择对方前线中最多 1 张 BP 2000 或更高的角色（本回合 BP-1500）" }),
      bp(chosen("minus"), -1500)
    ]),
    ifThen(all(pickedMode(1), lineHasBp("energy", 4000)), [
      chooseOpponent("out", { line: "front", max: 1, filter: bpAtMost(2000), prompt: "选择对方前线中最多 1 张 BP 不高于 2000 的角色退场" }),
      sideline(chosen("out"))
    ])
  )],

  // 煌：【我方的回合中】我方的前线中存在BP4000或更高的其他角色的场合，此角色获得《冲击1》。
  //    【对方的回合中】我方的能量线中存在BP4000或更高的其他角色的场合，此角色获得《2次阻挡》。
  "UC01ST/ARK-1-107": [
    staticSelf({ keywords: ["冲击1"] }, all(duringYourTurn, lineHasBp("front", 4000, true))),
    staticSelf({ keywords: ["2次阻挡"] }, all(duringOpponentTurn, lineHasBp("energy", 4000, true)))
  ],

  // Ace：「前线中存在的场合」我方场上〈Ace〉以外的角色通过BP变为0或更低以外的方式退场的场合，可以改为将此角色退场。
  "UC01ST/ARK-1-106": [{
    kind: "replaceSideline",
    condition: (env, target) => !!env.self && env.owner.front.includes(env.self) && target !== env.self && env.ctx.card(target.cardId)?.type === "character" && env.ctx.card(target.cardId)?.name !== "Ace",
    prompt: "可以改为将「Ace」退场。",
    apply: (env) => sidelineByEffect(env.game, env.ctx, env.owner, env.self!.uid, env.owner.accountId)
  }],

  // 罗德岛制药公司（场地）：此场地以活跃状态登场。
  //                       【启动主要】〔转为休息状态〕我方场上的所有“特征：罗德岛制药公司”，本回合中，BP+500。
  "UC01ST/ARK-1-108": [
    onPlay(run("此场地以活跃状态登场", (env) => { if (env.self) env.self.rested = false; })),
    activateMain({ costs: [restSelf] }, bp(ownWithAffinity("罗德岛制药公司"), 500))
  ],

  // 开始行动（事件）：从下列选择最多3项。
  //   •选择我方场上的最多1张角色，本回合中，BP+2000。 •我方的前线中存在BP4000或更高的角色的场合，抽取1张卡牌。
  //   •我方的能量线中存在BP4000或更高的角色的场合，抽取1张卡牌。
  "UC01ST/ARK-1-109": [onUse(
    chooseModesUpTo(3, ["选择我方场上的最多1张角色，本回合中，BP+2000。", "我方的前线中存在BP4000或更高的角色的场合，抽取1张卡牌。", "我方的能量线中存在BP4000或更高的角色的场合，抽取1张卡牌。"]),
    ifThen(pickedMode(0), [chooseOwn("target", { max: 1, prompt: "选择我方场上最多 1 张角色（本回合 BP+2000）" }), bp(chosen("target"), 2000)]),
    ifThen(all(pickedMode(1), lineHasBp("front", 4000)), [draw(1)]),
    ifThen(all(pickedMode(2), lineHasBp("energy", 4000)), [draw(1)])
  )],

  // 盾卫：【登场时】确认我方卡组最上方的4张卡牌。公开其中最多1张〈迷迭香〉并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UCEX01BT/ARK-2-013": [onPlay(look(4), chooseLooked("pick", { max: 1, filter: named("迷迭香"), prompt: "公开最多 1 张〈迷迭香〉并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom(), ifThen(chosenCount("pick"), [discard(1)]))],

  // 阿米娅：此角色必须尽可能的进行攻击。
  //        【登场时】我方的能量线中存在BP4000或更高的角色的场合，将此角色转为活跃状态。
  //        【攻击时】从下列选择1项。 •此角色下一次转为活跃状态无效。 •选择我方场上的1张角色退场。
  "UCEX01BT/ARK-2-014": [
    staticSelf({ flags: ["mustAttack"] }),
    withCondition(onPlay(activate("self")), lineHasBp("energy", 4000)),
    onAttack(
      chooseMode("mode", ["此角色下一次转为活跃状态无效。", "选择我方场上的1张角色退场。"]),
      ifThen(pickedMode(0), [run("此角色下一次转为活跃状态无效", skipNextActivate(null))], [
        { do: "choose", as: "out", from: "field", side: "you", min: 1, max: 1, prompt: "选择我方场上的 1 张角色退场", good: false },
        sideline(chosen("out"))
      ])
    )
  ],

  // 极境：【启动主要】〔转为休息状态〕确认我方卡组最上方的3张卡牌。公开其中最多1张“特征：罗德岛制药公司”并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  //      此角色在本回合中，获得“当主要阶段结束时，将此角色退场”。〈极境〉的此效果1回合只能发动1次。
  "UCEX01BT/ARK-2-015": [
    activateMain({ costs: [restSelf], condition: notMarkedThisTurn("极境") },
      run("〈极境〉的此效果本回合已发动", markThisTurn("极境")),
      look(3), chooseLooked("pick", { max: 1, filter: withAffinity("罗德岛制药公司"), prompt: "公开最多 1 张“特征：罗德岛制药公司”并加入手牌" }), moveChosen("pick", "hand"), lookedToBottom(),
      grantAbility("self", 1)),
    sidelineAtMainEnd
  ],

  // 凯尔希：【登场时】确认我方卡组最上方的3张卡牌。从中将最多1张置于场外，剩余的卡牌自选顺序置于我方卡组的最上方。
  "UCEX01BT/ARK-2-016": [onPlay(look(3), chooseLooked("out", { max: 1, prompt: "选择最多 1 张置于场外" }), moveChosen("out", "sideline"), ...lookedToTop())],

  // 凯尔希：【登场时】从我方的场外将最多1张〈凯尔希〉以外的所需能量『不高于3』的角色卡牌加入手牌。可以支付1AP。这样做的场合，改为『4或更高』。
  "UCEX01BT/ARK-2-017": [onPlay(
    ifThen(hasActiveAp, [may("支付 1 AP，改为从场外选择所需能量 4 或更高的角色卡？", run("支付 1 AP", (env) => {
      const card = env.owner.ap.find((entry) => !entry.rested);
      if (!card) return;
      card.rested = true;
      env.vars.paid = ["yes"];
    }))]),
    ifThen(chosenCount("paid"),
      [chooseFromSideline("card", { max: 1, filter: and(isCharacterCard, notNamed("凯尔希"), energyCostAtLeast(4)), prompt: "从场外选择最多 1 张〈凯尔希〉以外所需能量 4 或更高的角色卡加入手牌" })],
      [chooseFromSideline("card", { max: 1, filter: and(isCharacterCard, notNamed("凯尔希"), energyCostAtMost(3)), prompt: "从场外选择最多 1 张〈凯尔希〉以外所需能量不高于 3 的角色卡加入手牌" })]),
    moveChosen("card", "hand")
  )],

  // 临光：《冲击无效》【退场时】我方的生命不高于6的场合，可以将我方的1张手牌置于场外。这样做的场合，将此卡牌正面朝上置于我方的生命区。
  "UCEX01BT/ARK-2-018": [withCondition(onSidelined(may("将 1 张手牌置于场外，把「临光」正面朝上置于生命区？", discard(1), run("「临光」正面朝上置于生命区", sidelinedSelfToLife))), all((env) => env.owner.life.length <= 6, handNotEmpty))],

  // 华法琳：【启动主要】〔转为休息状态〕「每回合1次」选择我方场上的最多1张其他角色，本回合中，BP+2000。此角色在本回合中，获得BP+2000和“当主要阶段结束时，将此角色退场”。
  "UCEX01BT/ARK-2-019": [
    activateMain({ costs: [restSelf], once: true }, chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+2000）" }), bp(chosen("target"), 2000), bp("self", 2000), grantAbility("self", 1)),
    sidelineAtMainEnd
  ],

  // 煌：【攻击时】可以将我方的1张手牌置于场外。这样做的场合，选择对方前线中的最多1张BP不高于1000的角色退场。
  "UCEX01BT/ARK-2-020": [withCondition(onAttack(may("将 1 张手牌置于场外，选择对方前线中最多 1 张 BP 不高于 1000 的角色退场？", discard(1),
    chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(1000), prompt: "选择对方前线中最多 1 张 BP 不高于 1000 的角色退场" }), sideline(chosen("target")))), handNotEmpty)],

  // 迷迭香：【攻击时】选择对方前线中的最多1张BP不高于1500的角色，转为休息状态。
  "UCEX01BT/ARK-2-022": [onAttack(chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(1500), prompt: "选择对方前线中最多 1 张 BP 不高于 1500 的角色转为休息状态" }), rest(chosen("target")))],

  // 迷迭香：【登场时】选择对方前线中的最多1张角色，转为休息状态。该角色下一次转为活跃状态无效。
  //        【启动主要】〔前线中存在的场合〕「每回合1次」抽取1张卡牌。对方前线中所有的BP2500或更高的角色，本回合中，BP-2000。
  "UCEX01BT/ARK-2-023": [
    onPlay(chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色转为休息状态（下一次转为活跃状态无效）" }), rest(chosen("target")), run("该角色下一次转为活跃状态无效", skipNextActivate("target"))),
    activateMain({ condition: selfOnFront, once: true }, draw(1), bp((env) => env.opponent.front.filter((card) => isCharacter(env, card) && bpOf(env.ctx, card) >= 2500), -2000))
  ],

  // 如你所愿（事件）：选择对方前线中的最多1张BP不高于5000的角色，『放回手牌』。我方的场上存在〈迷迭香〉的场合，改为『退场』。
  "UCEX01BT/ARK-2-024": [onUse(
    chooseOpponent("target", { line: "front", max: 1, filter: bpAtMost(5000), prompt: "选择对方前线中最多 1 张 BP 不高于 5000 的角色（我方有〈迷迭香〉时退场，否则放回手牌）" }),
    ifThen(youHaveNamed("迷迭香"), [sideline(chosen("target"))], [toHand(chosen("target"))])
  )]
};
