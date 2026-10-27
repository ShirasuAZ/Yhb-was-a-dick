import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UnionArenaAction, UnionArenaPlayer, UnionArenaRoomState } from "../shared/protocol.ts";
import { actingPlayerId, applyAction, gameStateView, lifeView } from "../shared/engine.ts";
import { ARKNIGHTS_HOME, settingsUrl, toLifeEntries, useCompactLayout, useViewportVars } from "./ArknightsApp.tsx";
import { HalfBoard, Seat } from "./board.tsx";
import { ERROR_TEXT, useCatalog, type Account } from "./cards.ts";
import { useGameController } from "./game.tsx";
import { SpotlightRings, SpotlightScrim, useSpotTargets, useTipPlacement } from "./Spotlight.tsx";
import { createTutorial, finishMulligan, stepDone, testAction, TUTORIAL_OPPONENT, TUTORIAL_STEPS, type TutorialStep } from "./tutorial.ts";
import "./arknights.css";

/** How long test takes for each of its moves, so the player can follow them. */
const TEST_DELAY_MS = 750;
/** How long a step's text stays up before it fades out and the player is left to act. */
const READ_MS = 2_600;
/** The tooltip's fade duration; every timer starts only once the previous fade has finished. */
const FADE_MS = 260;
/** How long a step waits for the player's own action before the text comes back as a reminder. */
const WAIT_MS = 9_000;

/**
 * What the guide is doing now.
 * `explain`: the text is on screen. `acting`: the text has faded out and the target is highlighted while the player acts.
 * `remind`: the player took too long, so the text is back — once, and it then stays until the step is done.
 */
type TourPhase = "explain" | "acting" | "remind";

/** A step the player has to carry out, as opposed to one that only explains or waits for the opponent. */
function needsPlayerAction(step: TutorialStep): boolean {
  return Boolean(step.expect || step.mulligan);
}

/**
 * The tutorial: a whole game against the test account, run in the browser by the same rules engine as online games, with fixed cards
 * and a scripted opponent. A spotlight tour walks the player through it — everything but the step's target is dimmed, the text floats
 * next to the target and fades in and out, and during the steps the player carries out the text steps aside so it never covers the board.
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
  /** The step whose text is on screen; it lags behind `stepIndex` so the old text can fade out before the next one appears. */
  const [shownIndex, setShownIndex] = useState(0);
  const [phase, setPhase] = useState<TourPhase>("explain");
  /** True while the tooltip is at opacity 0 (on its way out, or hidden on purpose). */
  const [tipHidden, setTipHidden] = useState(false);
  /** True while the whole tour is fading away after the player closed it. */
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false);
  const [coachNotice, setCoachNotice] = useState("");
  /** Bumped by "重新开始", so the per-step timers start again even when the tour is already on step 1. */
  const [runToken, setRunToken] = useState(0);
  const actedRef = useRef(false);
  const s = setupRef.current;
  const step = TUTORIAL_STEPS[stepIndex]!;
  const shownStep = TUTORIAL_STEPS[shownIndex] ?? step;
  const last = stepIndex === TUTORIAL_STEPS.length - 1;
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipHeight, setTipHeight] = useState(0);
  /** Every timer this step owns, so a step change (or leaving the page) can clear all of them at once. */
  const timersRef = useRef<number[]>([]);
  /** The fade-out when the guide is closed. It is deliberately NOT in `timersRef`: a step change must never cancel it. */
  const closeTimerRef = useRef<number | null>(null);
  /** Set while an advance is being applied, so one finished step cannot push the tour forward twice. */
  const advancingRef = useRef(false);

  const clearTimers = useCallback((): void => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
  }, []);
  const later = useCallback((run: () => void, delay: number): void => {
    timersRef.current.push(window.setTimeout(run, delay));
  }, []);

  const advance = useCallback((): void => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    actedRef.current = false;
    setCoachNotice("");
    setStepIndex((index) => Math.min(index + 1, TUTORIAL_STEPS.length - 1));
    window.setTimeout(() => { advancingRef.current = false; }, 0);
  }, []);

  const restart = (): void => {
    clearTimers();
    setupRef.current = createTutorial(account.id, account.username);
    actedRef.current = false;
    setStepIndex(0);
    setShownIndex(0);
    setPhase("explain");
    setTipHidden(false);
    setClosing(false);
    setClosed(false);
    if (closeTimerRef.current !== null) { window.clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setCoachNotice("");
    setRunToken((value) => value + 1);
    bump();
  };

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

  // A step change fades the old text out, swaps the content, then fades the new text in. Timers are cleared first, so nothing
  // from the previous step (a pending reminder, a fade) can reach the new one.
  useEffect(() => {
    clearTimers();
    setCoachNotice("");
    setPhase("explain");
    if (shownIndex === stepIndex) { setTipHidden(false); return undefined; }
    setTipHidden(true);
    const swap = window.setTimeout(() => { setShownIndex(stepIndex); setTipHidden(false); }, FADE_MS);
    return () => window.clearTimeout(swap);
  }, [stepIndex, runToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // A step the player has to carry out: the text stays for READ_MS, fades out, and the target is left highlighted. If the
  // action has not arrived WAIT_MS after the fade finished, the text comes back once and then stays until the step is done
  // (a finished step cancels its own timers, so a stale reminder can never appear).
  //
  // It must not touch `tipHidden` on the way in: the effect above owns the fade, and forcing the panel visible here cancelled
  // its hide in the same commit — which is why every step from the mulligan on swapped its text with no fade at all.
  useEffect(() => {
    if (!needsPlayerAction(step)) return undefined;
    clearTimers();
    setPhase("explain");
    later(() => setTipHidden(true), READ_MS);
    later(() => setPhase("acting"), READ_MS + FADE_MS);
    later(() => { setPhase("remind"); setTipHidden(false); }, READ_MS + FADE_MS + WAIT_MS);
    return () => clearTimers();
  }, [stepIndex, runToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimers(), [clearTimers]);

  // Measure the tooltip so it can be placed above or below the target without covering it.
  useEffect(() => {
    const measure = (): void => setTipHeight(tipRef.current?.offsetHeight ?? 0);
    measure();
    const element = tipRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shownIndex, tipHidden, phase, compact]);

  const tourOpen = !closed;
  /** The step's targets, measured from the live DOM: an explanation points at the zones it talks about, an action step at everything to use. */
  const spotSelector = tourOpen ? shownStep.highlight ?? null : null;
  const spot = useSpotTargets(spotSelector, [shownIndex, version, compact]);
  /** The text follows the first thing the step names, and keeps the side of it it first picked (see useTipPlacement). */
  const tipPlacement = useTipPlacement(spot.anchor, tipHeight, shownIndex);

  const send = async (action: UnionArenaAction): Promise<string | null> => {
    if (!step.expect) return step.until ? "请稍等，test 正在行动。" : step.mulligan ? "请先在操作栏选择『保留起手牌』。" : "请先看完说明。";
    if (!step.expect(action, s)) return "教程中请按照上方提示操作。";
    try { applyAction(s.game, s.players, ctx, account.id, action); }
    catch (failure) { const code = failure instanceof Error ? failure.message : ""; return ERROR_TEXT[code] ?? "操作失败"; }
    actedRef.current = true;
    bump();
    return null;
  };
  const onMulligan = (redraw: boolean): void => {
    if (!step.mulligan) { setCoachNotice("请先看完说明。"); return; }
    if (redraw) { setCoachNotice("这次请保留起手牌：教程使用固定的手牌。"); return; }
    finishMulligan(s);
    bump();
    advance();
  };

  const me: UnionArenaPlayer = { id: account.id, username: account.username, avatarUrl: account.avatarUrl, seat: 0, connected: true, isHost: true, ready: true };
  const test: UnionArenaPlayer = { id: TUTORIAL_OPPONENT.id, username: TUTORIAL_OPPONENT.username, avatarUrl: null, seat: 1, connected: true, isHost: false, ready: true };
  // Rebuilt whenever the game moved on (`bump`), which is every change the tutorial makes.
  const state: UnionArenaRoomState = useMemo(() => ({
    roomCode: "教程", phase: "playing", players: [me, test], you: me,
    life: { you: lifeView(s.me), opponent: lifeView(s.test) },
    game: gameStateView(s.game, s.me, s.test, ctx),
    hand: [...s.me.hand], playerCount: 2, requiredPlayers: 2, startAllowed: false, spectators: [], youAreSpectator: false
  }), [version, cardsById.size, account.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const controller = useGameController({ state, meId: account.id, cardsById, ctx, compact, busy: false, send, onMulligan: step.mulligan ? onMulligan : undefined, overButton: { label: "返回大厅", run: () => window.location.assign(ARKNIGHTS_HOME) } });
  const game = state.game!;

  /**
   * Closing the guide: the dimming, the ring and the text fade out together, then leave. The game stays playable, and the
   * header's "显示提示" brings the guide back.
   *
   * The fade-out runs on its own timer. If it were one of the step's timers, a step finishing in the same moment would clear
   * it and leave `closing` true for good — an invisible tooltip over a board that `inert` had made unclickable.
   */
  const closeTour = (): void => {
    clearTimers();
    setClosing(true);
    setTipHidden(true);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => { closeTimerRef.current = null; setClosed(true); }, FADE_MS);
  };
  const reopenTour = (): void => {
    if (closeTimerRef.current !== null) { window.clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setClosed(false);
    setClosing(false);
    setTipHidden(false);
    setPhase("explain");
  };

  // Leaving the page (or restarting) must not leave the close timer behind.
  useEffect(() => () => { if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current); }, []);

  // An explanation step leaves the board dead to misclicks, since there is nothing to do on it yet; a step the player carries out
  // leaves the board fully usable, and so does a closed tour.
  const boardInert = controller.lightboxOpen || controller.revealOpen || (tourOpen && !closing && !needsPlayerAction(step));
  const tipShown = tourOpen && !closing && !tipHidden;

  return <div className="ua-app ua-tutorial" data-compact={compact} data-in-game="true">
    <header className="ua-header" inert={controller.lightboxOpen}>
      <button className="ua-back" onClick={() => window.location.assign(ARKNIGHTS_HOME)}>返回大厅</button>
      <div className="ua-roominfo"><span className="ua-roominfo-main">新手教程 · 第 {game.turn || 0} 回合{error ? ` · ${error}` : ""}</span></div>
      <div className="ua-header-end">
        <button type="button" className="ua-toggle" onClick={restart}>重新开始</button>
        {tourOpen && !closing ? <button type="button" className="ua-toggle" onClick={closeTour}>关闭教程</button>
          : <button type="button" className="ua-toggle" onClick={reopenTour}>显示提示</button>}
        <a className="ua-room-page-settings" href={settingsUrl("arknights-tutorial")}>账号设置</a>
        <div className="ua-account" title={account.username}>{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : null}<span>{account.username}</span></div>
      </div>
    </header>
    {controller.actionBar ? <div className="ua-actionbar-row" inert={controller.lightboxOpen}>{controller.actionBar}</div> : null}
    <main className="ua-main" inert={boardInert}>
      <div className="ua-stage">
        <div className="ua-table-wrapper">
          <section className="ua-table" aria-label="UNION ARENA 教程牌桌">
            <span className="ua-centerline" aria-hidden="true" />
            <div className="ua-seatbar" data-side="opponent"><Seat player={test} self={false} status="测试账号 · 教程对手" />{controller.opponentHand}</div>
            <HalfBoard side="opponent" life={toLifeEntries(state.life.opponent, cardsById)} board={game.board.opponent} deckCount={game.deckCount.opponent} cardsById={cardsById} ctx={ctx} interaction={controller.interaction} activePhase={controller.activePhase("opponent")} />
            <HalfBoard side="self" life={toLifeEntries(state.life.you, cardsById)} board={game.board.you} deckCount={game.deckCount.you} cardsById={cardsById} ctx={ctx} interaction={controller.interaction} activePhase={controller.activePhase("self")} />
            <div className="ua-seatbar" data-side="self"><Seat player={me} self status="你" />{controller.handStrip}</div>
          </section>
        </div>
      </div>
    </main>
    {/* Spotlight tour: the dimming layer with its hole over the target, the ring around it, and the floating text.
        The dimming panels never take clicks: misclicks are stopped by `inert` on the board instead, so the header and the
        tooltip's own buttons stay reachable. */}
    {tourOpen ? <>
      <SpotlightScrim rects={spot.rects} visible={!closing} />
      <SpotlightRings rects={spot.rects} visible={!closing} />
    </> : null}
    {tourOpen ? <div ref={tipRef} className="ua-spot-tip" role="dialog" aria-label="教程提示" aria-live="polite"
      inert={!tipShown} data-fading={tipShown ? undefined : "true"}
      style={{ ...tipPlacement, pointerEvents: tipShown ? "auto" : "none" }}>
      <div className="ua-spot-tip-head">
        <span className="ua-spot-progress">{shownIndex + 1} / {TUTORIAL_STEPS.length}</span>
        <span className="ua-spot-tip-title">新手教程</span>
      </div>
      <p className="ua-spot-text">{shownStep.text}</p>
      {coachNotice ? <p className="ua-spot-notice" role="alert">{coachNotice}</p> : null}
      <div className="ua-spot-tip-buttons">
        {shownStep.next ? <button type="button" className="ua-primary" onClick={advance}>下一步</button> : null}
        {last ? <><button type="button" className="ua-primary" onClick={() => window.location.assign(ARKNIGHTS_HOME)}>返回大厅</button><button type="button" className="ua-secondary" onClick={restart}>再玩一次</button></> : null}
      </div>
    </div> : null}
    {controller.lightbox}
  </div>;
}
