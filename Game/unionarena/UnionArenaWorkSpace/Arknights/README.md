# Arknights UNION ARENA Workspace

This directory owns the Arknights UNION ARENA game source and its original assets. Game UI, card catalog and room service live under `src/`; card images and `_index.csv` remain under `Cards/images/`. `rule_manual.pdf` is the official English rule manual (Ver 1.1) the game flow follows.

棋盘由 CSS 绘制，不再使用 `Map/` 下的图片。

The LayUDown site provides the shared account service and website origin. Its server integration only mounts this workspace's room service, catalog and assets. In the combined local workspace, start the site from `D:\MyGame\GameWorkSapce\Game\UNO\UNO WorkSpace` with `npm run dev`; the production update archive contains this source separately from the website overlay.

The supplied image index has 254 card records and 252 available image files (cards 7071 and 7084 have no image and cannot be put in a deck).

## What works

- `/arknights-union-arena/` is the game lobby with three entries: player vs. player (`/pvp`), vs. computer (`/ai`), and the tutorial (`/tutorial`).
- Two-seat rooms over the shared account service: create, join by code, resume after a dropped connection (30 s grace), leave, third player refused.
- Deck builder in the side panel: pick cards from the catalog (+ / −) or use quick fill, then submit. The server checks the rule manual's deck rules: exactly 50 cards plus 3 AP cards, one source material code, at most 4 copies per card number, at most 4 cards each with a 特殊 / 色彩 / 最终 trigger.
- Ready, then the host starts the game. The server runs the opening from "Preparing to Play": shuffle, random Player One, 7-card starting hands, mulligan (Player One decides first), then 7 face-down life cards each.
- The game proper runs in `src/shared/engine.ts`, following the rule manual: the five phases; the AP table (Player One 1 / 2 / 3 cards, Player Two 2 / 2 / 3); the draw (none on Player One's first turn) and the once-per-turn extra draw for 1 AP; required energy from the energy line only, in the card's colour; AP payment; characters and sites played resting, sites on the energy line only, events to the sideline; four cards per line, with a full line giving one card to the removal area first; Raid; simultaneous movement and 撤步; attacks, blocks, battles (equal BP: attacker wins; a losing attacker is not sidelined); 瞄准攻击, 2次攻击, 2次阻挡, 冲击N / 冲击+N, 伤害2 / 伤害+N, 冲击无效; damage with the attacker picking life cards; trigger checks for all seven printed trigger types (抽卡, 获得, 激活, 特殊, 色彩, 最终, 突进); the end phase (resting characters and sites back to active, AP cards stay resting, hand kept to 8); a character at 0 BP or less is sidelined; both ways to win, and conceding.
- Printed card data (type, colour, required energy, AP cost, BP, energy generation, affinities, Raid targets, keywords, ability text, trigger) is in `Cards/cards.json`, keyed by card number. It was transcribed from the card images.
- Card abilities written in `src/shared/abilities/cards.ts` are run by the engine (timings, a resolve queue with order choices, target and yes/no choices, continuous effects, cost changes, Activate: Main with costs and once-per-turn); see `src/shared/abilities/README.md`. So far 9 cards are written there as examples. Any other card's own ability text (When Played, Activate: Main, conditional keywords, cost changes, …) is not interpreted: players apply it with the "卡牌效果" tools in the card lightbox and the action bar's 效果 menu: rest / activate, BP ±1000 for the turn, energy generation ±1, give a keyword for the turn, sideline / return to hand / remove, draw, AP rest / activate, sideline to hand. Every manual operation goes into the public log.
- Hidden information stays on the server: face-down life cards are `null`, the opponent's hand and both libraries are only ever sent as counts.
- Every card on the table, in the hand and in the side panel's hand list opens a full-screen lightbox; its round "<" and ">" buttons (and the arrow keys) browse the rest of that zone.
- The tutorial plays a whole game in the browser with the same engine: fixed decks in a fixed order, the test account "test" as a scripted opponent, and step-by-step guidance that only accepts the action each step asks for.

- Vs. computer runs in the browser with the same engine, at four levels: easy and normal (rule-of-thumb play), hard (determinized Monte Carlo search that only uses what it can see) and master (a neural network trained with PPO in `rl/`). It uses preset decks made only of the 20 cards the engine can play by itself. See `rl/README.md`.

## Not built yet

Abilities for the remaining ~165 cards with ability text (see `src/shared/abilities/README.md` for how to add them); until a card is added, it is applied by hand and the computer players cannot use it.
