import { useEffect, useRef, useState } from "react";
import type { UnionArenaAction, UnionArenaPlayer, UnionArenaRoomState } from "../shared/protocol.ts";
import { actingPlayerId, applyAction, gameStateView, lifeView } from "../shared/engine.ts";
import { deckCards, PRESET_DECKS, presetDeck } from "../shared/ai/decks.ts";
import { chooseHeuristic } from "../shared/ai/heuristic.ts";
import { dealMatch, decideMulligan, makeRng, wantsMulligan, type Match } from "../shared/ai/match.ts";
import { chooseByPolicy, loadPolicy, type Policy, type PolicyWeightsJson } from "../shared/ai/policy.ts";
import { estimateWinRate, loadWinRate, type WinRateModel, type WinRateWeightsJson } from "../shared/ai/winrate.ts";
import { chooseBySearch } from "../shared/ai/search.ts";
import { ARKNIGHTS_HOME, toLifeEntries, useCompactLayout, useViewportVars } from "./ArknightsApp.tsx";
import { HalfBoard, Seat } from "./board.tsx";
import { ERROR_TEXT, useCatalog, type Account } from "./cards.ts";
import { useGameController } from "./game.tsx";
import { DECK_SIZE, MAX_COPIES, useDeck } from "./deck.ts";
import { ACCOUNT_SETTINGS, settingsUrl } from "./ArknightsApp.tsx";
import "./arknights.css";

type Level = "easy" | "normal" | "hard" | "master";
const LEVELS: ReadonlyArray<{ id: Level; name: string; text: string }> = [
  { id: "easy", name: "简单", text: "" },
  { id: "normal", name: "普通", text: "常识出牌" },
  { id: "hard", name: "困难", text: "蒙特卡洛搜索" },
  { id: "master", name: "大师", text: "神经网络" }
];
const CPU_ID = "cpu";
/** How long the computer waits before each move, so the player can follow it. */
const CPU_DELAY_MS = 650;
const SEARCH_BUDGET_MS = 350;

/** The vs-computer mode: a whole game in the browser with the rules engine, against a computer player of the chosen level. */
export function ArknightsVsAI({ account }: { account: Account }) {
  const [error, setError] = useState("");
  const { cards, cardsById, ctx } = useCatalog(setError);
  useViewportVars();
  const compact = useCompactLayout();
  const [level, setLevel] = useState<Level>("normal");
  const [myDeck, setMyDeck] = useState(PRESET_DECKS[1]!.id);
  const [cpuDeck, setCpuDeck] = useState(PRESET_DECKS[0]!.id);
  /** The player's own deck ("mine" in the deck list), the same one Players vs Players uses, kept in this browser. */
  const ownDeck = useDeck(cards, cardsById, account.id);
  const [deckSearch, setDeckSearch] = useState("");
  const [onlyInDeck, setOnlyInDeck] = useState(false);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [policyState, setPolicyState] = useState<"idle" | "loading" | "ready" | "missing">("idle");
  const [winRateModel, setWinRateModel] = useState<WinRateModel | null>(null);
  const matchRef = useRef<Match | null>(null);
  const [version, setVersion] = useState(0);
  /** The table bar folds away during play (and while the setup panel is open); this re-opens it on demand. */
  const [barExpanded, setBarExpanded] = useState(false);
  const bump = (): void => setVersion((value) => value + 1);
  const rngRef = useRef(makeRng(Date.now() >>> 0));

  // The trained network is only downloaded when the master level is picked.
  useEffect(() => {
    if (level !== "master" || policyState !== "idle") return;
    setPolicyState("loading");
    import("../shared/ai/policy-weights.json")
      .then((module) => { setPolicy(loadPolicy((module.default ?? module) as unknown as PolicyWeightsJson)); setPolicyState("ready"); })
      .catch(() => setPolicyState("missing"));
  }, [level, policyState]);

  // The win-rate network is downloaded once a game has started.
  useEffect(() => {
    if (!matchRef.current || winRateModel) return;
    import("../shared/ai/winrate-weights.json")
      .then((module) => setWinRateModel(loadWinRate((module.default ?? module) as unknown as WinRateWeightsJson)))
      .catch(() => undefined);
  }, [version, winRateModel]);

  const start = (): void => {
    const match = dealMatch([
      { id: account.id, name: account.username, deck: myDeck === "mine" ? ownDeck.cardIds : deckCards(presetDeck(myDeck)) },
      { id: CPU_ID, name: `电脑（${LEVELS.find((entry) => entry.id === level)!.name}）`, deck: cpuDeck === "mine" ? ownDeck.cardIds : deckCards(presetDeck(cpuDeck)) }
    ], Math.floor(Math.random() * 2 ** 31));
    matchRef.current = match;
    bump();
  };
  const match = matchRef.current;

  // The computer's moves: its mulligan, and every decision while it is the one to act.
  useEffect(() => {
    if (!match || !cardsById.size) return undefined;
    const { game } = match;
    const cpuToAct = game.step === "mulligan" ? game.mulliganQueue[0] === CPU_ID : game.step === "turn" && actingPlayerId(game) === CPU_ID;
    if (!cpuToAct) return undefined;
    const timer = window.setTimeout(() => {
      try {
        if (game.step === "mulligan") {
          decideMulligan(match, CPU_ID, wantsMulligan(ctx, match.players.find((player) => player.accountId === CPU_ID)!.hand));
        } else {
          const action = level === "hard" ? chooseBySearch(match, ctx, CPU_ID, { budgetMs: SEARCH_BUDGET_MS })
            : level === "master" && policy ? chooseByPolicy(policy, game, match.players, ctx, CPU_ID)
            : chooseHeuristic(match, ctx, CPU_ID, level === "easy" ? "easy" : "normal", rngRef.current);
          if (action) applyAction(game, match.players, ctx, CPU_ID, action);
        }
      } catch (failure) { console.error("computer move failed", failure); }
      bump();
    }, CPU_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [match, version, cardsById.size, level, policy, ctx]);

  const send = async (action: UnionArenaAction): Promise<string | null> => {
    if (!match) return "对局还没有开始。";
    try { applyAction(match.game, match.players, ctx, account.id, action); }
    catch (failure) { const code = failure instanceof Error ? failure.message : ""; return ERROR_TEXT[code] ?? "操作失败"; }
    bump();
    return null;
  };
  const onMulligan = (redraw: boolean): void => {
    if (!match) return;
    try { decideMulligan(match, account.id, redraw); } catch { return; }
    bump();
  };

  const me: UnionArenaPlayer = { id: account.id, username: account.username, avatarUrl: account.avatarUrl, seat: 0, connected: true, isHost: true, ready: true };
  const cpu: UnionArenaPlayer = { id: CPU_ID, username: match?.players[1].username ?? "电脑", avatarUrl: null, seat: 1, connected: true, isHost: false, ready: true };
  const state: UnionArenaRoomState | null = match ? {
    roomCode: "人机", phase: "playing", players: [me, cpu], you: me,
    life: { you: lifeView(match.players[0]), opponent: lifeView(match.players[1]) },
    game: { ...gameStateView(match.game, match.players[0], match.players[1], ctx), winRate: winRateModel ? estimateWinRate(winRateModel, match.game, match.players, ctx, account.id) : null },
    hand: [...match.players[0].hand], playerCount: 2, requiredPlayers: 2, startAllowed: false, spectators: [], youAreSpectator: false
  } : null;
  const controller = useGameController({
    state, meId: account.id, cardsById, ctx, compact, busy: false, send, onMulligan,
    overButton: { label: "再来一局", run: () => { matchRef.current = null; bump(); } }
  });
  const game = state?.game ?? null;
  const ready = cardsById.size > 0 && (level !== "master" || policyState === "ready") && ((myDeck !== "mine" && cpuDeck !== "mine") || ownDeck.complete);
  const search = deckSearch.trim().toLocaleLowerCase();
  const listed = cards.filter((card) => card.imageAvailable && (!onlyInDeck || (ownDeck.deck.get(card.id) ?? 0) > 0) && `${card.number} ${card.name}`.toLocaleLowerCase().includes(search));

  if (!match || !state || !game) {
    return <div className="ua-lobby">
      <header className="ua-lobby-header">
        <button type="button" className="ua-back" onClick={() => window.location.assign(ARKNIGHTS_HOME)}>返回大厅</button>
        <h1>人机对战</h1>
        <a className="ua-room-page-settings" href={ACCOUNT_SETTINGS}>账号设置</a>
        <div className="ua-account" title={account.username}>{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : null}<span>{account.username}</span></div>
      </header>
      <main className="ua-ai-setup">
        <section aria-labelledby="ua-ai-level">
          <h2 id="ua-ai-level">难度</h2>
          <div className="ua-ai-options" role="radiogroup" aria-labelledby="ua-ai-level">
            {LEVELS.map((entry) => [
              // The trained network stands apart from the three rule-based levels.
              entry.id === "master" ? <span key="divider" className="ua-ai-divider" aria-hidden="true" /> : null,
              <button key={entry.id} type="button" role="radio" aria-checked={level === entry.id} className="ua-ai-option" data-level={entry.id} onClick={() => setLevel(entry.id)}>
                <strong>{entry.name}</strong>{entry.text ? <span>{entry.text}</span> : null}
              </button>
            ])}
          </div>
          {level === "master" && policyState === "loading" ? <p className="ua-hint">正在加载神经网络…</p> : null}
          {level === "master" && policyState === "missing" ? <p className="ua-error">还没有训练好的模型（rl/train.py）。</p> : null}
        </section>
        <section aria-labelledby="ua-ai-decks">
          <h2 id="ua-ai-decks">牌组</h2>
          <div className="ua-ai-decks">
            <label>你的牌组<select value={myDeck} onChange={(event) => setMyDeck(event.target.value)}>
              <option value="mine">我的牌组（{ownDeck.total}/{DECK_SIZE}）</option>
              {PRESET_DECKS.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
            </select></label>
            <label>电脑的牌组<select value={cpuDeck} onChange={(event) => setCpuDeck(event.target.value)}>
              <option value="mine">我的牌组（{ownDeck.total}/{DECK_SIZE}，镜像对局）</option>
              {PRESET_DECKS.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
            </select></label>
          </div>
        </section>
        {myDeck === "mine" || cpuDeck === "mine" ? <section className="ua-ai-builder" aria-labelledby="ua-ai-builder-heading">
          <div className="ua-deck-head"><h2 id="ua-ai-builder-heading">我的牌组</h2><span>{ownDeck.total}/{DECK_SIZE} 张 · {ownDeck.source ?? "作品未定"}</span></div>
          <p className="ua-hint">主牌组 {DECK_SIZE} 张，同卡号最多 {MAX_COPIES} 张，只能用同一作品的卡，【特殊】【色彩】【最终】触发的卡每种最多 {MAX_COPIES} 张。</p>
          <div className="ua-deck-actions">
            <select className="ua-deck-preset" aria-label="以预设牌组为基础" value="" onChange={(event) => { const preset = PRESET_DECKS.find((entry) => entry.id === event.target.value); if (preset) ownDeck.fromPreset(preset); }}>
              <option value="">以预设牌组为基础…</option>
              {PRESET_DECKS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
            <button type="button" className="ua-secondary" disabled={ownDeck.total >= DECK_SIZE || !cards.length} onClick={() => ownDeck.quickFill()}>快速组牌</button>
            <button type="button" className="ua-secondary" disabled={ownDeck.total === 0} onClick={ownDeck.clear}>清空</button>
          </div>
          {ownDeck.complete ? <p className="ua-deck-ok" role="status">牌组符合规则，可以开始对战。</p> : <p className="ua-hint" role="status">还差 {Math.max(0, DECK_SIZE - ownDeck.total)} 张{ownDeck.total > DECK_SIZE ? `（多了 ${ownDeck.total - DECK_SIZE} 张）` : ""}。</p>}
          <div className="ua-ai-builder-filter">
            <input aria-label="搜索卡牌" value={deckSearch} onChange={(event) => setDeckSearch(event.target.value)} placeholder="搜索卡名或卡号" />
            <label><input type="checkbox" checked={onlyInDeck} onChange={(event) => setOnlyInDeck(event.target.checked)} />只看牌组里的卡</label>
          </div>
          <div className="ua-card-list ua-ai-builder-list" role="list" aria-label="卡牌">
            {listed.map((card) => {
              const copies = ownDeck.deck.get(card.id) ?? 0;
              return <div key={card.id} role="listitem" className={`ua-card-row ${copies ? "is-selected" : ""}`}>
                <span className="ua-card-pick">
                  {card.imageUrl ? <img src={card.imageUrl} alt="" loading="lazy" /> : <span className="ua-card-missing">?</span>}
                  <span><strong>{card.name}</strong><small>{card.number} · {card.rarity}</small></span>
                </span>
                <span className="ua-stepper">
                  <button type="button" aria-label={`从牌组移出 ${card.name} ${card.number}`} disabled={copies === 0} onClick={() => ownDeck.setCopies(card, copies - 1)}>－</button>
                  <output aria-label={`${card.name} 已选 ${copies} 张`}>{copies}</output>
                  <button type="button" aria-label={`加入牌组 ${card.name} ${card.number}`} disabled={!ownDeck.canAdd(card)} onClick={() => ownDeck.setCopies(card, copies + 1)}>＋</button>
                </span>
              </div>;
            })}
          </div>
        </section> : null}
        {error ? <p className="ua-error" role="alert">{error}</p> : null}
        <button type="button" className="ua-primary ua-ai-start" disabled={!ready} onClick={start}>开始对战</button>
      </main>
    </div>;
  }

  // The same shape as the player-vs-player table: no top bar, and the navigation lives in the board's top-right corner.
  const status = game.step === "turn" ? `第 ${game.turn} 回合 · ${game.turnPlayerId === account.id ? "你的回合" : "电脑的回合"}` : "";
  return <div className="ua-app" data-compact={compact} data-bare="true" data-in-game="true">
    {controller.actionBar ? <div className="ua-actionbar-row" inert={controller.lightboxOpen}>{controller.actionBar}</div> : null}
    <main className="ua-main" inert={controller.lightboxOpen || controller.revealOpen}>
      <div className="ua-stage">
        <div className="ua-table-wrapper">
          <section className="ua-table" aria-label="明日方舟 UNION ARENA 人机对战牌桌">
            <span className="ua-centerline" aria-hidden="true" />
            <div className="ua-seatbar" data-side="opponent"><Seat player={cpu} self={false} status="电脑" />{controller.opponentHand}</div>
            <HalfBoard side="opponent" life={toLifeEntries(state.life.opponent, cardsById)} board={game.board.opponent} deckCount={game.deckCount.opponent} cardsById={cardsById} ctx={ctx} interaction={controller.interaction} activePhase={controller.activePhase("opponent")} />
            <HalfBoard side="self" life={toLifeEntries(state.life.you, cardsById)} board={game.board.you} deckCount={game.deckCount.you} cardsById={cardsById} ctx={ctx} interaction={controller.interaction} activePhase={controller.activePhase("self")} />
            <div className="ua-seatbar" data-side="self"><Seat player={me} self status="你" />{controller.handStrip}</div>
          </section>
        </div>
      </div>
      {/* During play the bar folds to one small key, exactly like the PvP table, so the board keeps the space. */}
      {barExpanded ? <div className="ua-tablebar" inert={controller.lightboxOpen}>
        <span className="ua-roomchip" title={`人机对战 · ${cpu.username}`}>
          <span className="ua-roomchip-label">人机</span>
          <strong>{LEVELS.find((entry) => entry.id === level)!.name}</strong>
          {status ? <span className="ua-roomchip-status">{status}</span> : null}
        </span>
        <button type="button" className="ua-toggle" onClick={() => { setBarExpanded(false); matchRef.current = null; bump(); }}>重新选择</button>
        <a className="ua-room-page-settings" href={settingsUrl("arknights-ai")}>账号设置</a>
        <button type="button" className="ua-hamburger" aria-label="收起房间栏" title="收起房间栏" onClick={() => setBarExpanded(false)}>
          <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
        </button>
      </div> : <div className="ua-minibar" inert={controller.lightboxOpen}>
        <button type="button" className="ua-hamburger ua-hamburger-mini" aria-label="展开房间栏" title="对局信息与设置"
          onClick={() => setBarExpanded(true)}><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /></button>
      </div>}
    </main>
    {controller.lightbox}
  </div>;
}
