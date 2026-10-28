/**
 * Abilities of the AOT cards, batch 5: the UEPR/AOT-1-0xx promo prints of cards from UE10BT/AOT-1 (see cards.ts for the conventions).
 * Each entry follows the card's printed text, shown above it. The keyword lines that start a line and the life-card trigger are read from the card data.
 *
 * Almost every card here prints exactly the same text as its UE10BT/AOT-1 original (checked against Cards/cards.json), which batches 1 and 2 already
 * encoded; those entries are taken from there by `reuse` so the two prints can never drift apart. 070 and 071 have no UE10BT entry yet, so they are
 * encoded here. Cards printing "-" (042, 043, 045, 058) have no text and need no entry.
 */
import type { Ability } from "./types.ts";
import { and, activateMain, chooseOwn, chosen, discard, draw, energyCostAtMost, ifThen, notSelf, onPlay, restSelf, sidelineSelf, toHand, youHaveNamed } from "./dsl.ts";
import { AOT_1_ABILITIES } from "./cards-aot-1.ts";
import { AOT_2_ABILITIES } from "./cards-aot-2.ts";

/** The abilities of the original (UE10BT) print of the same card. */
const reuse = (original: string): readonly Ability[] => AOT_1_ABILITIES[original] ?? AOT_2_ABILITIES[original] ?? [];

export const AOT_5_ABILITIES: Readonly<Record<string, readonly Ability[]>> = {
  // Mikasa Ackermann:
  // This character gains all abilities listed below if you have the required number of event cards in your sideline.
  // ・Two or more: This character gains 《Blue》 energy generation.
  // ・Four or more: This character gains 1000 BP.
  "UEPR/AOT-1-024": reuse("UE10BT/AOT-1-024"),

  // Eren Jaeger: If this character is active, it gains 《Blue》 energy generation.
  "UEPR/AOT-1-026": reuse("UE10BT/AOT-1-026"),

  // Former Headquarters of the Scout Regiment: 《Activate: Main》 《Switch to Resting》 Reveal the top card of your deck. If the revealed card is a blue character card with 3 or less required energy, add it to your hand. If you do not add it to your hand, place it on the top of your deck.
  "UEPR/AOT-1-028": reuse("UE10BT/AOT-1-028"),

  // Memory: Draw a card, then place one card from your hand into your sideline. Choose up to one of your AP cards and switch it to active.
  "UEPR/AOT-1-029": reuse("UE10BT/AOT-1-029"),

  // You Call That Clean?! Do It All Again.: Choose up to two of your AP cards and switch them to active.
  "UEPR/AOT-1-030": reuse("UE10BT/AOT-1-030"),

  // Cleanup: Look at the top two cards of your deck. Place any number of them on the top of your deck in any order, then place any remaining cards into your sideline. Draw two cards.
  "UEPR/AOT-1-031": reuse("UE10BT/AOT-1-031"),

  // Bombs: Choose up to one character with 3500 or less BP on your opponent's front line and return it to their hand.
  "UEPR/AOT-1-032": reuse("UE10BT/AOT-1-032"),

  // Historia's Resolve: Choose one character with {2000} or less BP on your opponent's front line and sideline it. If <Historia Reiss> is on your field, add 1000 to the BP range of the character you may choose with this ability for each event card in your sideline.
  "UEPR/AOT-1-033": reuse("UE10BT/AOT-1-033"),

  // Kenny Ackermann: If there is a blue or red card on your opponent's field, reduce this card's required energy by 《Green×1》 while in your hand.
  "UEPR/AOT-1-035": reuse("UE10BT/AOT-1-035"),

  // Rod Reiss: 《When Played》 Choose up to one other character on your field. It gains 1000 BP until the end of the turn.
  "UEPR/AOT-1-037": reuse("UE10BT/AOT-1-037"),

  // Cart Titan: 《When Played》 Return one other character on your field with 1 or less required energy to your hand. If you cannot, return this character to your hand.
  "UEPR/AOT-1-039": reuse("UE10BT/AOT-1-039"),

  // Pure Titan (Small Titan): 《When Played》 Draw a card.
  "UEPR/AOT-1-040": reuse("UE10BT/AOT-1-040"),

  // Pure Titans (Zeke's Titans): 《When Played》 Draw a card, then place one card from your hand into your sideline.
  "UEPR/AOT-1-041": reuse("UE10BT/AOT-1-041"),

  // Zeke Jaeger: 《Activate: Main》 《Switch to Resting》 Choose one [Pure Titan] affinity card on your field. It gains 1000 BP until the end of the turn.
  "UEPR/AOT-1-046": reuse("UE10BT/AOT-1-046"),

  // Pure Titan (Relaxing Titan): 《When Sidelined》 Play up to one card with 2 or less required energy, 1 AP cost, and [Pure Titan] affinity from your hand set to resting onto your field.
  "UEPR/AOT-1-049": reuse("UE10BT/AOT-1-049"),

  // Annie Leonhart: 《When Played》 Draw a card, then place one card from your hand into your sideline.
  "UEPR/AOT-1-050": reuse("UE10BT/AOT-1-050"),

  // Annie Leonhart: 《When Played》 Look at the top three cards of your deck. Reveal up to one [Marleyan Warrior] or [Pure Titan] affinity card among them and add it to your hand. Place the remaining cards on the bottom of your deck in any order. If you added a card to your hand, place one card from your hand into your sideline.
  "UEPR/AOT-1-051": reuse("UE10BT/AOT-1-051"),

  // Annie Leonhart: If this character is active, it gains 《Green》 energy generation.
  "UEPR/AOT-1-052": reuse("UE10BT/AOT-1-052"),

  // Bertholdt Hoover: 《Activate: Main》 《Switch to Resting》 《Once Per Turn》 This character gains 《Green》 energy generation until the end of the turn. At the end of the main phase, sideline this character.
  "UEPR/AOT-1-054": reuse("UE10BT/AOT-1-054"),

  // Bertholdt Hoover: 《When Played》 If you have 6 or more energy generation, draw a card.
  "UEPR/AOT-1-055": reuse("UE10BT/AOT-1-055"),

  // Reiner Braun: If you have 6 or more energy generation, this character gains 1000 BP.
  "UEPR/AOT-1-059": reuse("UE10BT/AOT-1-059"),

  // Titan Forest: 《Activate: Main》 《Switch to Resting》 《Place 1 Card From Hand Into Sideline》 《Once Per Turn》 This site gains 《Green》 energy generation until the end of the turn.
  "UEPR/AOT-1-062": reuse("UE10BT/AOT-1-062"),

  // Titan Injection: Look at the top four cards of your deck. Reveal one card among them and add it to your hand. Place the remaining cards on the bottom of your deck in any order. If the card you revealed has [Pure Titan] affinity or "Rod Reiss" or "Zeke Jaeger" in its card name, choose up to one of your AP cards and switch it to active.
  "UEPR/AOT-1-063": reuse("UE10BT/AOT-1-063"),

  // Marleyan Warriors: Choose up to two of your AP cards and switch them to active.
  "UEPR/AOT-1-065": reuse("UE10BT/AOT-1-065"),

  // I'm Going For a Perfect Game.: Choose one character with {3000 or less BP} on your opponent's front line and sideline it. If there is a character with "Zeke Jaeger" in its card name on your field, {5000 or less BP} instead.
  "UEPR/AOT-1-066": reuse("UE10BT/AOT-1-066"),

  // Are We Doing It?! Now...?! Here?!:
  // You can only use one <Are We Doing It?! Now...?! Here?!> card per turn.
  // Choose one card on your field. It gains "This card gains 《Green》《Green》 energy generation" until the end of the turn. If there is a character with "Bertholdt Hoover" in its card name on your field, choose up to one of your AP cards and switch it to active.
  "UEPR/AOT-1-067": reuse("UE10BT/AOT-1-067"),

  // Carla Jaeger: 《Activate: Main》 《Switch to Resting》 《Once Per Turn》 This character gains 《Red》 energy generation until the end of the turn. At the end of the main phase, sideline this character.
  "UEPR/AOT-1-068": reuse("UE10BT/AOT-1-068"),

  // Hannes: 《When Played》 Return one other character on your field with 1 or less required energy to your hand. If you cannot, return this character to your hand.
  "UEPR/AOT-1-070": [onPlay(
    chooseOwn("target", { min: 1, max: 1, filter: and(notSelf, energyCostAtMost(1)), prompt: "选择我方场上 1 张所需能量不高于 1 的其他角色放回手牌" }),
    toHand(chosen("target")),
    ifThen((env) => (env.vars.target ?? []).length === 0, [toHand("self")])
  )],

  // Eren Kruger: 《Activate: Main》 《Switch to Resting》 《Sideline This Card》 You can only activate this ability if <Grisha Jaeger> is on your field. Draw two cards, then place one card from your hand into your sideline.
  "UEPR/AOT-1-071": [activateMain({ costs: [restSelf, sidelineSelf], condition: youHaveNamed("Grisha Jaeger") }, draw(2), discard(1))]
};
