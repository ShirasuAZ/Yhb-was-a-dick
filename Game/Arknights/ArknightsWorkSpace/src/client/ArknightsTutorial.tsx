import { useEffect, useRef, useState } from "react";
import type { UnionArenaAction, UnionArenaPlayer, UnionArenaRoomState } from "../shared/protocol.ts";
import { actingPlayerId, applyAction, gameStateView, lifeView } from "../shared/engine.ts";
import { ARKNIGHTS_HOME, toLifeEntries, useCompactLayout, useViewportVars } from "./ArknightsApp.tsx";
import { HalfBoard, Seat } from "./board.tsx";
import { ERROR_TEXT, useCatalog, type Account } from "./cards.ts";
import { useGameController } from "./game.tsx";
import { createTutorial, finishMulligan, stepDone, testAction, TUTORIAL_OPPONENT, TUTORIAL_STEPS } from "./tutorial.ts";
import "./arknights.css";

/** How long test takes for each of its moves, so the player can follow them. */
const TEST_DELAY_MS = 750;

/**
 * The tutorial: a whole game against the test account, run in the browser by the same rules engine as online games, with fixed cards and a
 * scripted opponent. The coach bar says what to do; the table only accepts the action the current step asks for.
 */
export function ArknightsTutorial({ account }: { account: Account }) {
  const [error, setError] = useState("");
  const { cardsById, ctx } = useCatalog(setError);
  useViewportVars();
  const compact = useCompactLayout();
  const setupRef = useRef(createTutorial(account.id, account.username));
  const [version, setVersion] = useState(0);
  const bump = (): void => setVersion((value) => value + 1);
  const [stepIndex, setStepIndex] = useState(0);
  const actedRef = useRef(false);
  const [coachNotice, setCoachNotice] = useState("");
  const s = setupRef.current;
  const step = TUTORIAL_STEPS[stepIndex]!;
  const last = stepIndex === TUTORIAL_STEPS.length - 1;

  const advance = (): void => { actedRef.current = false; setCoachNotice(""); setStepIndex((index) => Math.min(index + 1, TUTORIAL_STEPS.length - 1)); };
  const restart = (): void => { setupRef.current = createTutorial(account.id, account.username); actedRef.current = false; setStepIndex(0); setCoachNotice(""); bump(); };

  // A step finishes as soon as its condition holds: after your action, or after test's moves.
  useEffect(() => { if (stepDone(step, s, actedRef.current)) advance(); }, [version, stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // test plays its moves one at a time while the game waits for it.
  useEffect(() => {
    if (!cardsById.size || s.game.step !== "turn" || actingPlayerId(s.game) !== TUTORIAL_OPPONENT.id) return undefined;
    const timer = window.setTimeout(() => {
      const move = testAction(s);
      if (move) {
        try { applyAction(s.game, s.players, ctx, TUTORIAL_OPPONENT.id, move); }
        catch (failure) { console.error("tutorial opponent move failed", failure); }
      }
      bump();
    }, TEST_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [version, cardsById.size]); // eslint-disable-line react-hooks/exhaustive-deps

  // Outline what the current step talks about.
  useEffect(() => {
    if (!step.highlight) return undefined;
    const targets = [...document.querySelectorAll<HTMLElement>(step.highlight)];
    targets.forEach((element) => element.classList.add("ua-coach-target"));
    return () => targets.forEach((element) => element.classList.remove("ua-coach-target"));
  }, [stepIndex, version, step.highlight]);

  const send = async (action: UnionArenaAction): Promise<string | null> => {
    if (!step.expect) return step.until ? "请稍等，test 正在行动。" : step.mulligan ? "请先在操作栏选择『保留起手牌』。" : "请先看完说明，点击『下一步』。";
    if (!step.expect(action, s)) return "教程中请按照上方提示操作。";
    try { applyAction(s.game, s.players, ctx, account.id, action); }
    catch (failure) { const code = failure instanceof Error ? failure.message : ""; return ERROR_TEXT[code] ?? "操作失败"; }
    actedRef.current = true;
    bump();
    return null;
  };
  const onMulligan = (redraw: boolean): void => {
    if (!step.mulligan) { setCoachNotice("请先看完说明，点击『下一步』。"); return; }
    if (redraw) { setCoachNotice("这次请保留起手牌：教程使用固定的手牌。"); return; }
    finishMulligan(s);
    bump();
    advance();
  };

  const me: UnionArenaPlayer = { id: account.id, username: account.username, avatarUrl: account.avatarUrl, seat: 0, connected: true, isHost: true, ready: true };
  const test: UnionArenaPlayer = { id: TUTORIAL_OPPONENT.id, username: TUTORIAL_OPPONENT.username, avatarUrl: null, seat: 1, connected: true, isHost: false, ready: true };
  const state: UnionArenaRoomState = {
    roomCode: "教程", phase: "playing", players: [me, test], you: me,
    life: { you: lifeView(s.me), opponent: lifeView(s.test) },
    game: gameStateView(s.game, s.me, s.test),
    hand: [...s.me.hand], playerCount: 2, requiredPlayers: 2, startAllowed: false, spectators: [], youAreSpectator: false
  };
  void version;
  const controller = useGameController({ state, meId: account.id, cardsById, ctx, compact, busy: false, send, onMulligan: step.mulligan ? onMulligan : undefined, overButton: { label: "返回大厅", run: () => window.location.assign(ARKNIGHTS_HOME) } });
  const game = state.game!;

  return <div className="ua-app ua-tutorial" data-compact={compact} data-in-game="true">
    <header className="ua-header" inert={controller.lightboxOpen}>
      <button className="ua-back" onClick={() => window.location.assign(ARKNIGHTS_HOME)}>返回大厅</button>
      <div className="ua-roominfo"><span className="ua-roominfo-main">新手教程 · 第 {game.turn || 0} 回合{error ? ` · ${error}` : ""}</span></div>
      <div className="ua-header-end">
        <button type="button" className="ua-toggle" onClick={restart}>重新开始</button>
        <div className="ua-account" title={account.username}>{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : null}<span>{account.username}</span></div>
      </div>
    </header>
    <section className="ua-coach" aria-label="教程提示" inert={controller.lightboxOpen}>
      <span className="ua-coach-progress">{stepIndex + 1} / {TUTORIAL_STEPS.length}</span>
      <p className="ua-coach-text" aria-live="polite">{step.text}</p>
      {coachNotice ? <p className="ua-coach-notice" role="alert">{coachNotice}</p> : null}
      <div className="ua-coach-buttons">
        {step.next ? <button type="button" className="ua-primary" onClick={advance}>下一步</button> : null}
        {last ? <><button type="button" className="ua-primary" onClick={() => window.location.assign(ARKNIGHTS_HOME)}>返回大厅</button><button type="button" className="ua-secondary" onClick={restart}>再玩一次</button></> : null}
      </div>
    </section>
    {controller.actionBar ? <div className="ua-actionbar-row" inert={controller.lightboxOpen}>{controller.actionBar}</div> : null}
    <main className="ua-main" inert={controller.lightboxOpen}>
      <div className="ua-stage">
        <div className="ua-table-wrapper">
          <section className="ua-table" aria-label="明日方舟 UNION ARENA 教程牌桌">
            <span className="ua-centerline" aria-hidden="true" />
            <div className="ua-seatbar" data-side="opponent"><Seat player={test} self={false} status="测试账号 · 教程对手" />{controller.opponentHand}</div>
            <HalfBoard side="opponent" life={toLifeEntries(state.life.opponent, cardsById)} board={game.board.opponent} deckCount={game.deckCount.opponent} cardsById={cardsById} ctx={ctx} interaction={controller.interaction} activePhase={controller.activePhase("opponent")} />
            <HalfBoard side="self" life={toLifeEntries(state.life.you, cardsById)} board={game.board.you} deckCount={game.deckCount.you} cardsById={cardsById} ctx={ctx} interaction={controller.interaction} activePhase={controller.activePhase("self")} />
            <div className="ua-seatbar" data-side="self"><Seat player={me} self status="你" />{controller.handStrip}</div>
          </section>
        </div>
      </div>
    </main>
    {controller.lightbox}
  </div>;
}
