/** Abilities of the EVA cards, batch 4 (see cards.ts for the conventions). Each entry follows the card's printed text, shown above it. */
import type { UnionArenaFieldCard } from "../protocol.ts";
import type { EnginePlayer } from "../engine.ts";
import type { Ability, AbilityEnv, Condition, Step, TriggeredAbility } from "./types.ts";
import {
  activate, activateAp, activateMain, activeCard, all, and, bp, bpAtMost, chooseAp, chooseFromSideline, chooseLooked, chooseMode, chooseOpponent,
  chooseOwn, chosen, chosenCount, costChange, discard, draw, duringOpponentTurn, either, grant, ifThen, isCharacterCard, look, lookedToBottom, may, moveChosen,
  named, notSelf, ofColor, onPlay, onSidelined, onUse, ownFieldEmpty, put, rest, restSelf, run, selfActive, sidelineSelf, staticSelf, sideline, when, withCondition
} from "./dsl.ts";

// ---- Helpers for these cards ----

type CardFilter = (env: AbilityEnv, cardId: string, card: UnionArenaFieldCard | null) => boolean;
const fieldOf = (player: EnginePlayer): UnionArenaFieldCard[] => [...player.front, ...player.energy];
const handNotEmpty: Condition = (env) => env.owner.hand.length > 0;
const modeIs = (name: string, index: number): Condition => (env) => env.vars[name]?.[0] === `m:${index}`;

const SHINJI = "碇 真嗣";
const AYANAMI = "绫波 零";
const EVA13 = "新世纪福音战士13号机";

/** 没有【触发】的卡牌 */
const noTrigger: CardFilter = (env, cardId) => !env.ctx.card(cardId)?.trigger;
/** 卡牌名包含“text” */
const nameIncludes = (text: string): CardFilter => (env, cardId) => env.ctx.card(cardId)?.name.includes(text) ?? false;
/** 我方的场上没有【触发】的卡牌的张数 */
const ownNoTriggerCount = (env: AbilityEnv): number => fieldOf(env.owner).filter((card) => noTrigger(env, card.cardId, card)).length;
/** 我方的场上存在N张或更多没有【触发】的卡牌 */
const ownNoTriggerAtLeast = (count: number): Condition => (env) => ownNoTriggerCount(env) >= count;

/** 〈碇 真嗣〉或卡牌名包含“初号机”的角色 */
const shinjiOrUnit01: CardFilter = (env, cardId) => {
  const stats = env.ctx.card(cardId);
  return stats?.type === "character" && (stats.name === SHINJI || stats.name.includes("初号机"));
};
/** 我方的场上存在〈碇 真嗣〉或卡牌名包含“初号机”的角色 */
const youHaveShinjiOrUnit01: Condition = (env) => fieldOf(env.owner).some((card) => shinjiOrUnit01(env, card.cardId, card));
/** 〈碇 真嗣〉 whose underside holds no face-down card */
const shinjiWithoutFaceDown: CardFilter = (env, cardId, card) => env.ctx.card(cardId)?.name === SHINJI && !!card && (card.faceDown?.length ?? 0) === 0;

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

/** "<text>的此效果1回合只能发动1次": a mark on the game for this turn, per player. */
const turnMark = (env: AbilityEnv, text: string): string => `${env.game.turn}:${env.owner.accountId}:${text}`;
const notMarkedThisTurn = (text: string): Condition => (env) => !(env.game.turnMarks ?? []).includes(turnMark(env, text));
const markThisTurn = (text: string) => (env: AbilityEnv): void => { env.game.turnMarks = [...(env.game.turnMarks ?? []), turnMark(env, text)]; };

/** 真希波·真理·伊拉丝多莉亚斯 092's own 【对方的回合中】 effect: heard when a life card without a 【触发】 goes to the sideline. */
const MARI_MARK = "真希波·真理·伊拉丝多莉亚斯:生命区置于场外";
const mariLifeToSideline: TriggeredAbility = {
  ...withCondition(
    when(["onOwnLifeToSideline"],
      may("将此角色转为休息状态，将置于场外的该卡牌加入手牌？",
        rest("self"),
        run("〈真希波·真理·伊拉丝多莉亚斯〉的此效果本回合已发动", markThisTurn(MARI_MARK)),
        run("将置于场外的该卡牌加入手牌", (env) => {
          const index = env.owner.sideline.lastIndexOf(env.cause?.sourceCardId ?? "");
          if (index >= 0) env.owner.hand.push(...env.owner.sideline.splice(index, 1));
        }))),
    all(duringOpponentTurn, selfActive, ownNoTriggerAtLeast(4), notMarkedThisTurn(MARI_MARK))
  ),
  heardIf: (ctx, cause) => !ctx.card(cause?.sourceCardId ?? "")?.trigger
};

/** 确认我方卡组最上方的N张卡牌。公开其中最多1张(filter)并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。 */
const lookPick = (count: number, filter: CardFilter, prompt: string): Step[] => [
  look(count), chooseLooked("pick", { max: 1, filter, prompt }), moveChosen("pick", "hand"), lookedToBottom()
];

/** 初号机 104's 【攻击时】: the total required energy of the energy-line cards rested by it. */
const restedCostTotal = (env: AbilityEnv): number =>
  (env.vars.rested ?? []).reduce((sum, uid) => sum + (env.ctx.card(env.owner.energy.find((card) => card.uid === uid)?.cardId ?? "")?.energyCost ?? 0), 0);

/** 〈渚 薰〉112: puts this card face down under the chosen 13号机 (it leaves the field without being sidelined). */
const tuckUnder13: Step = run("将此卡牌背面朝上置于〈新世纪福音战士13号机〉的下方", (env) => {
  const host = fieldOf(env.owner).find((card) => card.uid === env.vars.host?.[0]);
  const self = env.self;
  if (!host || !self) return;
  env.owner.front = env.owner.front.filter((card) => card.uid !== self.uid);
  env.owner.energy = env.owner.energy.filter((card) => card.uid !== self.uid);
  host.faceDown = [...(host.faceDown ?? []), self.cardId];
  env.owner.sideline.push(...self.under, ...(self.faceDown ?? []));
  env.vars.tucked = ["1"];
});

export const EVA_4_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // 片片：【登场时】选择我方场上的最多1张其他角色，本回合中，BP+1000。
  "UC03BT/EVA-1-089": [onPlay(chooseOwn("target", { max: 1, filter: notSelf, prompt: "选择我方场上最多 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))],

  // 真希波·真理·伊拉丝多莉亚斯：【登场时】确认我方卡组最上方的2张卡牌。将其中最多1张没有【触发】的红色的卡牌置于场外。剩余的卡牌自选顺序置于我方卡组的最上方。
  "UC03BT/EVA-1-090": [onPlay(
    look(2),
    chooseLooked("out", { max: 1, filter: and(ofColor("red"), noTrigger), prompt: "选择最多 1 张没有【触发】的红色卡牌置于场外" }),
    moveChosen("out", "sideline"),
    ...lookedToTop()
  )],

  // 真希波·真理·伊拉丝多莉亚斯：【登场时】确认我方卡组最上方的3张卡牌。公开其中最多1张卡牌名包含“2号机”的角色卡牌或没有【触发】的角色卡牌并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。加入手牌的场合，将我方的1张手牌置于场外。
  "UC03BT/EVA-1-091": [onPlay(
    ...lookPick(3, and(isCharacterCard, either(nameIncludes("2号机"), noTrigger)), "公开最多 1 张卡牌名包含“2号机”或没有【触发】的角色卡牌并加入手牌"),
    ifThen(chosenCount("pick"), [discard(1)])
  )],

  // 真希波·真理·伊拉丝多莉亚斯：【对方的回合中】当没有【触发】的卡牌从我方的生命区中置于场外时，我方的场上存在4张或更多没有【触发】的卡牌的场合，可以将活跃状态的此角色转为休息状态。这样做的场合，将最多1张置于场外的该卡牌加入手牌。〈真希波·真理·伊拉丝多莉亚斯〉的此效果1回合只能发动1次。
  //                          【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  "UC03BT/EVA-1-092": [mariLifeToSideline, onPlay(draw(1), discard(1))],

  // 作战室（屋岛作战）：【登场时】确认我方卡组最上方的5张卡牌。公开其中最多1张卡牌名包含“零号机”或“初号机”的角色卡牌并加入手牌。剩余的卡牌自选顺序置于我方卡组的最下方。
  //                  【启动主要】[每回合1次]选择我方能量线中的1张卡牌，转为活跃状态。
  "UC03BT/EVA-1-093": [
    onPlay(...lookPick(5, and(isCharacterCard, either(nameIncludes("零号机"), nameIncludes("初号机"))), "公开最多 1 张卡牌名包含“零号机”或“初号机”的角色卡牌并加入手牌")),
    activateMain({ once: true },
      { do: "choose", as: "target", from: "field", side: "you", line: "energy", characters: false, min: 1, max: 1, prompt: "选择我方能量线中的 1 张卡牌转为活跃状态", good: true },
      activate(chosen("target")))
  ],

  // 绫波！把手给我・・・过来！！：此卡牌只有在我方的场上存在〈碇 真嗣〉或卡牌名包含“初号机”的角色的场合才能使用。
  //                          选择对方前线中的1张BP不高于5000的角色退场。从我方的场外将最多1张〈绫波 零〉，背面朝上置于我方场上的下方没有背面朝上的卡牌的〈碇 真嗣〉的下方。
  "UC03BT/EVA-1-094": [{
    ...onUse(
      chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost(5000), prompt: "选择对方前线中 1 张 BP 不高于 5000 的角色退场" }),
      sideline(chosen("target")),
      ifThen((env) => fieldOf(env.owner).some((card) => shinjiWithoutFaceDown(env, card.cardId, card)), [
        chooseFromSideline("rei", { max: 1, filter: and(isCharacterCard, named(AYANAMI)), prompt: "从场外选择最多 1 张〈绫波 零〉，背面朝上置于下方没有背面朝上卡牌的〈碇 真嗣〉的下方" }),
        ifThen(chosenCount("rei"), [
          chooseOwn("shinji", { min: 1, max: 1, filter: shinjiWithoutFaceDown, prompt: "选择下方没有背面朝上卡牌的〈碇 真嗣〉" }),
          run("将〈绫波 零〉背面朝上置于〈碇 真嗣〉的下方", (env) => {
            const host = fieldOf(env.owner).find((card) => card.uid === env.vars.shinji?.[0]);
            const index = Number((env.vars.rei?.[0] ?? "").slice(2));
            if (!host || !Number.isInteger(index) || index >= env.owner.sideline.length) return;
            host.faceDown = [...(host.faceDown ?? []), ...env.owner.sideline.splice(index, 1)];
          })
        ])
      ])
    ),
    useCondition: youHaveShinjiOrUnit01
  }],

  // 超大输出功率第2次试作自走460mm阳电子炮：选择对方前线中的1张『BP不高于3000』的角色退场。我方的场上存在〈碇 真嗣〉或卡牌名包含“初号机”的角色的场合，改为『BP不高于5000』。
  "UC03BT/EVA-1-095": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => (youHaveShinjiOrUnit01(env) ? 5000 : 3000)), prompt: "选择对方前线中 1 张 BP 不高于 3000 的角色退场（我方有〈碇 真嗣〉或“初号机”时：5000）" }),
    sideline(chosen("target"))
  )],

  // 傀儡系统启动：选择我方场上的1张拥有【突进】，且非突进状态的角色，转为活跃状态，本回合中，给予BP+1000和【瞄准攻击】（可以指定攻击对方前线中的角色，指定的场合，对方不能阻挡）。
  "UC03BT/EVA-1-096": [onUse(
    chooseOwn("target", { min: 1, max: 1, filter: (env, cardId, card) => !!env.ctx.card(cardId)?.raid && !!card && card.under.length === 0, prompt: "选择我方场上 1 张拥有【突进】且非突进状态的角色" }),
    activate(chosen("target")), bp(chosen("target"), 1000), grant(chosen("target"), "瞄准攻击")
  )],

  // 和别人说说心里话还挺愉快的：选择我方的最多2张AP卡牌，转为活跃状态。
  "UC03BT/EVA-1-097": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 超电磁洋弓铳：选择对方前线中的1张『BP不高于2000』的角色退场。我方场上的没有【触发】的卡牌每有1张，通过此效果可选择的角色的BP范围+1000。
  "UC03BT/EVA-1-098": [onUse(
    chooseOpponent("target", { line: "front", min: 1, max: 1, filter: bpAtMost((env) => 2000 + 1000 * ownNoTriggerCount(env)), prompt: "选择对方前线中 1 张 BP 不高于 2000（我方场上每有 1 张没有【触发】的卡牌 +1000）的角色退场" }),
    sideline(chosen("target"))
  )],

  // 不…入…虎穴…焉…得…虎子！：抽取2张卡牌。我方的场上存在4张或更多没有【触发】的卡牌的场合，追加抽取1张卡牌。
  "UC03BT/EVA-1-099": [onUse(draw(2), ifThen(ownNoTriggerAtLeast(4), [draw(1)]))],

  // 微笑就可以了：选择我方的最多2张AP卡牌，转为活跃状态。
  "UC03BT/EVA-1-100": [onUse(chooseAp("ap", 2), activateAp("ap"))],

  // 绫波 零：【登场时】确认我方卡组最上方的2张卡牌。将其中任意张数自选顺序置于我方卡组的最上方，剩余的卡牌置于场外。
  "UC03ST/EVA-1-102": [onPlay(
    look(2),
    chooseLooked("keep", { min: 0, max: 2, prompt: "选择任意张数置于卡组最上方（其余置于场外）" }),
    ifThen(chosenCount("keep", 2), lookedToTop(), [
      ifThen(chosenCount("keep", 1), [run("将选择的卡牌置于卡组最上方", (env) => {
        const looking = env.game.looking;
        const index = Number((env.vars.keep?.[0] ?? "").slice(2));
        if (!looking || !looking.cards[index]) return;
        env.owner.library.unshift(...looking.cards.splice(index, 1));
      })])
    ]),
    run("剩余的卡牌置于场外", (env) => {
      const looking = env.game.looking;
      if (!looking) return;
      env.owner.sideline.push(...looking.cards);
      looking.cards = [];
    })
  )],

  // 新世纪福音战士初号机：【突进】〈碇 真嗣〉转为活跃状态，并可以移动至前线
  //   【冲击①】（当在进行攻击的战斗中胜利时，给予对方玩家1点伤害）
  //   【攻击时】将我方能量线中任意张数的活跃状态的卡牌转为休息状态。根据通过此效果转为休息状态的卡牌的合计所需能量，此角色在本回合中，获得下列所有效果。
  //   ・4或更高：BP+3000。
  //   ・8或更高：【伤害②】（当通过此角色的攻击给予对方直接伤害时，改为给予2点伤害）
  "UC03ST/EVA-1-104": [when(["onAttack"],
    { do: "choose", as: "rested", from: "field", side: "you", line: "energy", characters: false, filter: activeCard, min: 0, max: 99, prompt: "选择我方能量线中任意张数的活跃状态的卡牌转为休息状态", good: false },
    rest(chosen("rested")),
    ifThen((env) => restedCostTotal(env) >= 4, [bp("self", 3000)]),
    ifThen((env) => restedCostTotal(env) >= 8, [grant("self", "伤害2")])
  )],

  // 新世纪福音战士零号机：【突进】〈绫波 零〉转为活跃状态，并可以移动至前线
  //   【2次阻挡】（当此角色在本回合中首次进行阻挡时，转为活跃状态）
  //   【退场时】抽取2张卡牌。之后，可以将我方的1张手牌置于场外。这样做的场合，从我方的场外将最多1张所需能量不高于1的红色的〈绫波 零〉在我方的场上以休息状态登场。
  "UC03ST/EVA-1-105": [onSidelined(
    draw(2),
    ifThen(handNotEmpty, [may("将 1 张手牌置于场外，从场外将红色〈绫波 零〉以休息状态登场？",
      discard(1),
      chooseFromSideline("card", { max: 1, filter: and(isCharacterCard, ofColor("red"), named(AYANAMI), (env, cardId) => (env.ctx.card(cardId)?.energyCost ?? 99) <= 1), prompt: "从场外选择最多 1 张所需能量不高于 1 的红色〈绫波 零〉以休息状态登场" }),
      ifThen(chosenCount("card"), [put("card", "choose", true)]))])
  )],

  // 式波·明日香·兰格雷：【冲击无效】（与此角色进行战斗的角色在本次战斗中，失去【冲击】）
  //   我方的场上存在4张或更多没有【触发】的卡牌的场合，此角色获得【冲击①】（当在进行攻击的战斗中胜利时，给予对方玩家1点伤害）。
  "UC03ST/EVA-1-106": [staticSelf({ keywords: ["冲击1"] }, ownNoTriggerAtLeast(4))],

  // 特务机关 NERV：【登场时】可以将我方的1张手牌置于场外。这样做的场合，抽取2张卡牌。
  //             【启动主要】[转为休息状态] ＃将此卡牌退场＃抽取1张卡牌。
  "UC03ST/EVA-1-108": [
    withCondition(onPlay(may("将 1 张手牌置于场外，抽取 2 张卡牌？", discard(1), draw(2))), handNotEmpty),
    activateMain({ costs: [restSelf, sidelineSelf] }, draw(1))
  ],

  // 你不会死的。我会保护你的：选择我方场上的最多1张〈碇 真嗣〉或卡牌名包含“初号机”的角色，直到我方的下一个回合开始时为止，BP+3000。可以将我方场上的1张活跃状态的〈绫波 零〉转为休息状态。这样做的场合，抽取1张卡牌。
  "UC03ST/EVA-1-109": [onUse(
    chooseOwn("target", { max: 1, filter: shinjiOrUnit01, prompt: "选择我方场上最多 1 张〈碇 真嗣〉或卡牌名包含“初号机”的角色（直到我方的下一个回合开始时 BP+3000）" }),
    bp(chosen("target"), 3000, "untilYourNextTurn"),
    ifThen((env) => fieldOf(env.owner).some((card) => !card.rested && env.ctx.card(card.cardId)?.name === AYANAMI), [
      may("将我方场上的 1 张活跃状态的〈绫波 零〉转为休息状态，抽取 1 张卡牌？",
        chooseOwn("rei", { min: 1, max: 1, filter: and(named(AYANAMI), activeCard), prompt: "选择我方场上 1 张活跃状态的〈绫波 零〉转为休息状态" }),
        rest(chosen("rei")),
        draw(1))
    ])
  )],

  // 绫波 零：【退场时】抽取1张卡牌。
  "UC03ST/EVA-1-110": [onSidelined(draw(1))],

  // 真希波·真理·伊拉丝多莉亚斯：【登场时】抽取1张卡牌，将我方的1张手牌置于场外。
  //                          【启动主要】[转为休息状态]选择我方场上的1张其他角色，本回合中，BP+1000。
  "UC03ST/EVA-1-111": [
    onPlay(draw(1), discard(1)),
    activateMain({ costs: [restSelf] }, chooseOwn("target", { min: 1, max: 1, filter: notSelf, prompt: "选择我方场上 1 张其他角色（本回合 BP+1000）" }), bp(chosen("target"), 1000))
  ],

  // 渚 薰：我方的场上1张卡牌都没有的场合，手牌中此卡牌的所需能量减少[紫×2]。
  //       【启动主要】[转为休息状态]将此卡牌背面朝上置于我方场上的〈新世纪福音战士13号机〉的下方。这样做的场合，抽取2张卡牌，将我方的1张手牌置于场外。
  "UC03ST/EVA-1-112": [
    costChange({ energy: 2 }, ownFieldEmpty),
    activateMain({ costs: [restSelf] },
      chooseOwn("host", { min: 1, max: 1, filter: named(EVA13), prompt: "选择我方场上 1 张〈新世纪福音战士13号机〉（将此卡牌背面朝上置于其下方）" }),
      tuckUnder13,
      ifThen(chosenCount("tucked"), [draw(2), discard(1)]))
  ],

  // 式波·明日香·兰格雷：当此角色被突进时，从下列选择1项。（进行突进角色的【登场时】效果与此效果自选顺序处理）
  //                    ・抽取1张卡牌。
  //                    ・选择对方前线中的最多1张角色，本回合中，BP-1000。
  "UC03ST/EVA-1-113": [when(["onBeingRaided"],
    chooseMode("mode", ["抽取1张卡牌。", "选择对方前线中的最多1张角色，本回合中，BP-1000。"]),
    ifThen(modeIs("mode", 0), [draw(1)], [
      chooseOpponent("target", { line: "front", max: 1, prompt: "选择对方前线中最多 1 张角色（本回合 BP-1000）" }),
      bp(chosen("target"), -1000)
    ])
  )]
};
