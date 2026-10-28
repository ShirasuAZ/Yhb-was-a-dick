/**
 * Printed triggers, normalized for the rules engine (the sibling of keywords.ts).
 *
 * The engine dispatches a revealed life card's trigger on its Chinese label (激活, 特殊, 色彩, …) and reads a few phrases out of its
 * text (退场, 放回手牌, BP不高于N, …). The Chinese-printed titles already use that vocabulary; the English-only title (AOT) prints
 * `Active` / `SPECIAL` / … and English sentences. Each English trigger sentence is a fixed template, so a small explicit table maps
 * it onto the Chinese sentence the engine reads. The ability text a player reads is left exactly as printed.
 */

const LABELS: Readonly<Record<string, string>> = {
  active: "激活", draw: "抽卡", get: "获得", raid: "突进", special: "特殊", color: "色彩", final: "最终"
};

/** The English trigger sentences, by their text with the leading 《label》 and trailing space removed. */
const TEXTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Choose one character on your field and switch it to active\. It gains (\d+) BP until the end of the turn\.?$/i, "选择我方场上的1张角色，转为活跃状态，本回合中，BP+$1。"],
  [/^Draw a card\.?$/i, "抽取1张卡牌。"],
  [/^Add this card to your hand\.?$/i, "此卡牌加入手牌。"],
  [/^Add this card to your hand, or if you have the required energy, perform Raid with it\.?$/i, "此卡牌加入手牌，或在满足所需能量的场合进行突进。"],
  [/^Choose one character on your opponent's front line and sideline it\.?$/i, "选择对方前线中的1张角色退场。"],
  [/^If you have 0 life, place the top card of your deck into your life area\.?$/i, "我方没有生命卡牌的场合，将我方卡组最上方的1张卡牌置于我方生命区中。"],
  [/^Choose one character with (\d+) or less BP on your opponent's front line and sideline it\.?$/i, "选择对方前线中的1张BP不高于$1的角色退场。"],
  [/^Choose one character with (\d+) or less BP on your opponent's front line and return it to their hand\.?$/i, "选择对方前线中的1张BP不高于$1的角色，放回手牌。"],
  [/^Choose one character on your opponent's front line and switch it to resting\. It will remain set to resting the next time it would be switched to active\.?$/i, "选择对方前线中的1张角色，转为休息状态。该角色下一次转为活跃状态无效。"],
  [/^Play one (\w+) character card with (\d+) or less required energy and (\d+) AP cost from your (hand|sideline) set to active onto your (?:field|front line)\.?$/i, ""]
];

const COLOR_CHARACTER: Readonly<Record<string, string>> = { yellow: "黄", red: "红", blue: "蓝", purple: "紫", green: "绿" };

export interface PrintedTrigger { label: string; text: string }
export interface PrintedRaid { targets: string[]; text: string }

/** The trigger in the engine's vocabulary; a trigger already in it is returned as it is. */
export function normalizeTrigger(trigger: PrintedTrigger | null): PrintedTrigger | null {
  if (!trigger || !trigger.label) return trigger;
  const label = LABELS[trigger.label.trim().toLowerCase()] ?? trigger.label;
  let text = trigger.text;
  const bare = text.replace(/^《[^》]*》\s*/, "").trim();
  for (const [pattern, chinese] of TEXTS) {
    const match = bare.match(pattern);
    if (!match) continue;
    if (chinese) text = chinese.replace("$1", match[1] ?? "");
    else {
      // 从我方手牌 / 场外将1张所需能量不高于N且消费AP M的X色角色卡牌在我方场上以活跃状态登场
      const [, color, energy, ap, from] = match;
      text = `从我方${from!.toLowerCase() === "hand" ? "手牌" : "场外"}将1张所需能量不高于${energy}且消费AP${ap}的${COLOR_CHARACTER[color!.toLowerCase()] ?? "?"}色角色卡牌在我方的前线中以活跃状态登场。`;
    }
    break;
  }
  // The Chinese titles print the Raid trigger under the label 获得 ("此卡牌加入手牌，或在满足所需能量的场合进行突进。").
  const finalLabel = label === "获得" && /进行突进/.test(text) ? "突进" : label;
  return { label: finalLabel, text };
}

/** The Raid description in the engine's vocabulary (it is only shown, but kept the same across titles). */
export function normalizeRaid(raid: PrintedRaid | null): PrintedRaid | null {
  if (!raid) return raid;
  if (/^switch to active\. may move to the front line\.?$/i.test(raid.text.trim())) return { ...raid, text: "转为活跃状态，并可以移动至前线" };
  return raid;
}
