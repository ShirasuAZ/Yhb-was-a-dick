# Arknights UNION ARENA Workspace

This directory owns the Arknights UNION ARENA game source and its original assets. Game UI, card catalog and room service live under `src/`; card images and `_index.csv` remain under `Cards/images/`. `rule_manual.pdf` is the official English rule manual (Ver 1.1) the game flow follows.

棋盘由 CSS 绘制，不再使用 `Map/` 下的图片。

The LayUDown site provides the shared account service and website origin. Its server integration only mounts this workspace's room service, catalog and assets. In the combined local workspace, start the site from `D:\MyGame\GameWorkSapce\Game\UNO\UNO WorkSpace` with `npm run dev`; the production update archive contains this source separately from the website overlay.

The supplied image index has 254 card records and 252 available image files (cards 7071 and 7084 have no image and cannot be put in a deck).

## What works

- Two-seat rooms over the shared account service: create, join by code, resume after a dropped connection (30 s grace), leave, third player refused.
- Deck builder in the side panel: pick cards from the catalog (+ / −) or use quick fill, then submit. The server checks the rule manual's deck rules: exactly 50 cards plus 3 AP cards, one source material code, at most 4 copies per card number.
- Ready, then the host starts the game. The server runs the opening from "Preparing to Play": shuffle, random Player One, 7-card starting hands, mulligan (Player One decides first: the hand goes to the bottom of the deck, 7 new cards are drawn, the deck is reshuffled), then 7 face-down life cards each, and Player One's first turn begins.
- Hidden information stays on the server: a face-down life card's `cardId` is `null` in every client's state, the opponent's hand and both libraries are only ever sent as counts.
- Card preview in the catalog opens a full-screen lightbox.

## Not built yet

Playing cards, energy and AP payment, movement, attacks and blocks, damage and trigger resolution, the turn phases beyond showing whose turn it is, win conditions, and a hand area on the table (the hand is listed in the side panel). The card type, cost, trigger and effect fields are not part of the card catalog data, so none of the card effects can be run yet.
