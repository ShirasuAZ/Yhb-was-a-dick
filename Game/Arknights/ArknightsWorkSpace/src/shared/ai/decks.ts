/**
 * Preset decks for the vs-computer mode and for training. They only use cards the engine plays entirely by itself (no ability text beyond
 * keywords, or abilities written in abilities/cards.ts; see `isAutomated`), so the computer never meets a card it would have to resolve
 * by hand. Each deck follows the deck rules: 50 cards, one source material code, at most four copies per card number,
 * at most four 特殊 / 色彩 / 最终 triggers each.
 */
export interface PresetDeck { id: string; name: string; description: string; cards: Array<[string, number]>; }

export const PRESET_DECKS: readonly PresetDeck[] = [
  {
    id: "rhodes",
    name: "罗德岛（蓝）",
    description: "蓝色单色：芙兰卡、杜宾、Guard 提供能量，临光（登场/阻挡/退场时强化前线）、红、阿米娅收尾，Mon3tr（所需能量 7，冲击1）与事件精神爆发。",
    cards: [["7059", 4], ["7066", 4], ["7079", 4], ["7145", 2], ["7055", 4], ["7060", 2], ["7075", 3], ["9029", 2], ["7070", 3], ["9038", 3], ["7058", 2], ["7143", 3], ["7076", 3], ["7082", 2], ["7144", 3], ["7063", 2], ["7081", 2], ["7095", 2]]
  },
  {
    id: "lungmen",
    name: "龙门（红）",
    description: "红色单色：九、星熊、诗怀雅起步，《2次阻挡》的星熊和《伤害2》的陈为核心，企鹅物流的德克萨斯、能天使，事件赤霄・拔刀。",
    cards: [["7126", 4], ["7128", 4], ["7117", 4], ["7120", 2], ["7107", 4], ["7121", 3], ["9108", 3], ["7103", 3], ["7133", 3], ["7111", 2], ["7129", 1], ["7112", 2], ["7116", 2], ["7108", 3], ["7122", 3], ["7130", 3], ["7100", 2], ["7136", 2]]
  },
  {
    id: "reunion",
    name: "整合运动（黄）",
    description: "黄色单色：米莎、霜星、整合运动士兵起步，弑君者、W、碎骨、塔露拉（所需能量 6）推进，事件整合运动。",
    cards: [["7011", 4], ["7041", 4], ["7039", 4], ["7040", 2], ["7012", 4], ["7015", 4], ["7022", 3], ["7028", 3], ["9015", 3], ["7043", 3], ["7018", 2], ["7027", 3], ["9022", 2], ["7016", 3], ["7019", 2], ["7029", 2], ["7052", 2]]
  },
  {
    id: "chernobog",
    name: "切尔诺伯格（紫）",
    description: "紫色单色：阿丽娜、萨沙、陈起步，斗士塔露拉与陈为主力，不死的黑蛇 塔露拉（所需能量 7，《2次攻击》）收尾，事件赤霄＆影霄。",
    cards: [["9046", 4], ["9053", 4], ["9057", 4], ["9065", 2], ["9047", 4], ["9067", 4], ["9079", 2], ["9058", 4], ["9085", 3], ["9074", 2], ["9066", 3], ["9059", 3], ["9054", 2], ["9061", 3], ["9055", 2], ["9072", 2], ["9091", 2]]
  }
];

export function deckCards(deck: PresetDeck): string[] {
  return deck.cards.flatMap(([id, copies]) => Array<string>(copies).fill(id));
}

export function presetDeck(id: string): PresetDeck {
  return PRESET_DECKS.find((deck) => deck.id === id) ?? PRESET_DECKS[0]!;
}
