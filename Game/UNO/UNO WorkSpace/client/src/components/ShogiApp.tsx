import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { io, type Socket } from "socket.io-client";
import {
  PIECE_TYPES,
  type GameView,
  type Move,
  type Piece,
  type PieceType,
  type Side,
  pieceLabel
} from "@shogi/engine";
import { ThemeControl } from "./ThemeControl.tsx";
import { InviteDialog } from "./InviteDialog.tsx";
import type { RoomRole } from "@shared/social.ts";
import { shogiPieceFacing } from "../shogiFacing.ts";

type Identity = { username: string; roomCode: string | null; side: Side | null };
type RoomResult = { reason: "checkmate" | "resigned" | "draw"; winner: Side | null };
type OnlineState = {
  roomCode: string;
  game: GameView;
  serverNow: number;
  startedAt: number | null;
  surrenderAfterMs: number;
  result: RoomResult | null;
  endedAt: number | null;
  dissolveAt: number | null;
  started: boolean;
  ready: Side[];
  players: Partial<Record<Side, string>>;
  connected: Partial<Record<Side, boolean>>;
  yourSide: Side;
  hostSide: Side;
  spectator?: boolean;
  spectators?: Array<{ id: string; name: string; connected: boolean }>;
};
type AckResult<T = unknown> = { ok: boolean; message?: string; data?: T };

const ACCOUNT_TOKEN_KEY = "uno.accountToken";
const sideLabel: Record<Side, string> = { sente: "先手", gote: "后手" };
const assetName: Record<PieceType, string> = {
  king: "king", rook: "rook", bishop: "bishop", gold: "gold",
  silver: "silver", knight: "knight", lance: "lance", pawn: "pawn"
};

const CHECKMATE_IMAGE = "/assets/shogi/jue-sha.png";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function makeSocket(): Socket {
  return io({ path: "/shogi-socket.io", autoConnect: false, reconnection: true, reconnectionAttempts: Infinity });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<AckResult<T>> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve({ ok: false, message: "服务器响应超时，请检查连接后重试" }), 8000);
    socket.emit(event, payload, (result: AckResult<T>) => {
      window.clearTimeout(timer);
      resolve(result);
    });
  });
}

async function sendFriendInvite(targetId: string, roomCode: string, role: "player" | "spectator"): Promise<boolean> {
  const response = await fetch("/api/social/invitations", {
    method: "POST",
    headers: { Authorization: `Bearer ${localStorage.getItem(ACCOUNT_TOKEN_KEY) ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ targetId, game: "shogi", roomCode, role })
  });
  return response.ok;
}

function inviteCode(): string {
  const queryCode = new URLSearchParams(location.search).get("room") ?? "";
  const pathCode = location.pathname.match(/^\/shogi\/([A-Za-z0-9]{4})\/?$/)?.[1] ?? "";
  return (queryCode || pathCode).toUpperCase();
}

function PieceImage({ piece, yourSide, size = "board" }: { piece: Piece; yourSide: Side; size?: "board" | "hand" }) {
  const color = piece.side === "sente" ? "black" : "white";
  const suffix = piece.promoted && ["pawn", "lance", "knight", "silver"].includes(piece.type)
    ? `prom_${assetName[piece.type]}`
    : piece.promoted && piece.type === "rook" ? "dragon"
      : piece.promoted && piece.type === "bishop" ? "horse"
        : assetName[piece.type];
  const facing = shogiPieceFacing(piece.side, yourSide, size);
  const handSideClass = size === "hand" && piece.side === "gote" ? "shogi-piece-hand-side-gote" : "";
  return <img
    className={`shogi-piece shogi-piece-${size} shogi-piece-facing-${facing} ${handSideClass}`}
    data-piece-side={piece.side}
    data-facing={facing}
    data-viewer-side={yourSide}
    src={`/assets/shogi/${color}_${suffix}.png`}
    alt={`${piece.side === "sente" ? "先手" : "后手"}${piece.promoted ? "成" : ""}${pieceLabel(piece.type)}`}
    draggable={false}
  />;
}

export function ShogiApp() {
  const [socket] = useState(makeSocket);
  const [authState, setAuthState] = useState<"checking" | "required" | "ready" | "unreachable">("checking");
  const [authAttempt, setAuthAttempt] = useState(0);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [online, setOnline] = useState<OnlineState | null>(null);
  const [roomCode, setRoomCode] = useState(inviteCode());
  const [connection, setConnection] = useState(false);
  const [onlineError, setOnlineError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [dropType, setDropType] = useState<Exclude<PieceType, "king"> | null>(null);
  const [promotion, setPromotion] = useState<Extract<Move, { kind: "move" }> | null>(null);
  const invitationAttempted = useRef(false);
  // Offset between the server clock and this browser's clock, refreshed on every server snapshot.
  const clockOffset = useRef(0);
  const [tick, setTick] = useState(0);
  const [confirmingResign, setConfirmingResign] = useState(false);
  const [inviteTargets, setInviteTargets] = useState<Array<{ id: string; username: string }>>([]);
  const [inviteResult, setInviteResult] = useState("");
  const [inviteRole, setInviteRole] = useState<RoomRole | null>(null);
  const [incomingInvite, setIncomingInvite] = useState<{ id: string; game: string; roomCode: string; role: string; inviter: string } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const poll = async (): Promise<void> => {
      const token = localStorage.getItem(ACCOUNT_TOKEN_KEY);
      if (!token) return;
      try {
        const response = await fetch("/api/social/invitations", { headers: { Authorization: `Bearer ${token}` } });
        const result = await response.json() as { data?: Array<{ id: string; game: string; roomCode: string; role: string; inviter: string }> };
        setIncomingInvite(result.data?.find((entry) => entry.game === "shogi") ?? null);
      } catch { /* keep the current notification visible */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(ACCOUNT_TOKEN_KEY);
    if (!token) return;
    void fetch("/api/social", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json() as Promise<{ data?: { friends?: Array<{ id: string; username: string }> } }>)
      .then((result) => setInviteTargets(result.data?.friends ?? []))
      .catch(() => setInviteTargets([]));
  }, []);

  useEffect(() => {
    const connectWithCurrentAccount = (): void => {
      const token = localStorage.getItem(ACCOUNT_TOKEN_KEY);
      setIdentity(null);
      setOnline(null);
      setRoomCode(inviteCode());
      setOnlineError("");
      invitationAttempted.current = false;
      if (!token) {
        socket.disconnect();
        setAuthState("required");
        setConnection(false);
        return;
      }
      socket.disconnect();
      socket.auth = { token };
      setAuthState("checking");
      socket.connect();
    };

    const onConnect = (): void => { setConnection(true); setOnlineError(""); };
    const onDisconnect = (): void => { setConnection(false); };
    const onConnectError = (error: Error): void => {
      setConnection(false);
      if (error.message === "AUTH_REQUIRED") {
        localStorage.removeItem(ACCOUNT_TOKEN_KEY);
        setIdentity(null);
        setAuthState("required");
        setOnlineError("登录已过期，请重新登录");
      } else {
        // The token may be fine and the service merely unreachable: stop claiming we are still
        // verifying, and offer a retry instead of waiting forever on an identity that never comes.
        setAuthState((current) => (current === "checking" ? "unreachable" : current));
        setOnlineError("将棋联机服务暂不可用，正在尝试重连");
      }
    };
    const onIdentity = (nextIdentity: Identity): void => {
      setIdentity(nextIdentity);
      setAuthState("ready");
      if (nextIdentity.roomCode) setRoomCode(nextIdentity.roomCode);
      const invite = inviteCode();
      if (!nextIdentity.roomCode && invite && !invitationAttempted.current) {
        invitationAttempted.current = true;
        setBusy(true);
        const watch = new URLSearchParams(location.search).get("watch") === "1";
        void emitAck(socket, watch ? "shogi:spectate" : "shogi:join", { roomCode: invite }).then((result) => {
          setBusy(false);
          if (!result.ok) setOnlineError(result.message ?? "无法加入邀请房间");
        });
      }
    };
    const onState = (state: OnlineState): void => {
      clockOffset.current = state.serverNow - Date.now();
      setOnline(state);
      setRoomCode(state.roomCode);
      setBusy(false);
      setSelected(null);
      setDropType(null);
      setPromotion(null);
    };
    const onRoomClosed = (payload: { message?: string }): void => {
      setOnline(null);
      setRoomCode("");
      setBusy(false);
      setSelected(null);
      setDropType(null);
      setPromotion(null);
      setConfirmingResign(false);
      history.replaceState({}, "", "/shogi");
      if (payload.message) setNotice(payload.message);
    };
    const onStorage = (event: StorageEvent): void => {
      if (event.key === ACCOUNT_TOKEN_KEY) connectWithCurrentAccount();
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("shogi:identity", onIdentity);
    socket.on("shogi:state", onState);
    socket.on("shogi:closed", onRoomClosed);
    window.addEventListener("storage", onStorage);
    connectWithCurrentAccount();
    // A silent handshake (no connect, no error) must not leave the screen on "verifying" forever.
    const handshakeTimer = window.setTimeout(() => {
      setAuthState((current) => (current === "checking" ? "unreachable" : current));
    }, 12000);
    return () => {
      window.clearTimeout(handshakeTimer);
      window.removeEventListener("storage", onStorage);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("shogi:identity", onIdentity);
      socket.off("shogi:state", onState);
      socket.off("shogi:closed", onRoomClosed);
      socket.disconnect();
    };
  }, [socket, authAttempt]);

  const game = online?.game;
  const currentSide = game?.turn;
  void tick; // re-render on the interval so the countdowns below stay current
  const serverTime = Date.now() + clockOffset.current;
  const gameOver = Boolean(online?.result) || (game ? game.status !== "playing" : false);
  const surrenderWaitMs = online?.startedAt != null
    ? Math.max(0, online.startedAt + online.surrenderAfterMs - serverTime)
    : online?.surrenderAfterMs ?? 0;
  const canResign = Boolean(online?.started) && !gameOver && surrenderWaitMs <= 0;
  const dissolveRemainingSeconds = online?.dissolveAt != null
    ? Math.max(0, Math.ceil((online.dissolveAt - serverTime) / 1000))
    : null;
  const winnerLabel = online?.result?.winner ? `${sideLabel[online.result.winner]}${online.players[online.result.winner] ? ` · ${online.players[online.result.winner]}` : ""}获胜` : "和棋";

  useEffect(() => {
    if (!gameOver) setConfirmingResign(false);
  }, [gameOver]);
  const selectedTargets = useMemo(() => selected && game
    ? game.legalMoves.filter((move) => move.kind === "move" && move.from.row === selected.row && move.from.col === selected.col)
    : [], [game, selected]);
  const statusText = !game ? "" : game.status === "playing"
    ? `${sideLabel[game.turn]}${game.check === game.turn ? " · 将军" : " · 行棋"}`
    : game.status === "draw" && game.drawReason === "perpetual_check" && game.winner ? `${sideLabel[game.winner]}获胜 · 连续王手`
      : game.status === "draw" ? "千日手 · 和棋"
        : game.status === "resigned" ? `${sideLabel[game.winner ?? "sente"]}获胜`
          : `${sideLabel[game.winner ?? "sente"]} · 将死`;

  const sendMove = async (move: Move): Promise<void> => {
    if (!online || online.spectator || !game || !connection || busy) return;
    setBusy(true);
    const result = await emitAck(socket, "shogi:move", {
      roomCode: online.roomCode,
      expectedPly: game.history.length,
      move
    });
    setBusy(false);
    if (!result.ok) setOnlineError(result.message ?? "这一步未被接受");
    else setOnlineError("");
    setPromotion(null);
  };

  const squareClick = (row: number, col: number): void => {
    if (!online || online.spectator || !game || !currentSide || game.status !== "playing" || !connection || busy || online.yourSide !== currentSide) return;
    if (dropType) {
      void sendMove({ kind: "drop", piece: dropType, to: { row, col } });
      return;
    }
    const piece = game.board[row]?.[col];
    if (selected) {
      const matching = selectedTargets.filter((move) => move.to.row === row && move.to.col === col);
      if (matching.length > 1) {
        setPromotion(matching.find((move) => move.kind === "move" && move.promote) as Extract<Move, { kind: "move" }>);
        return;
      }
      if (matching.length === 1) {
        void sendMove(matching[0]!);
        return;
      }
    }
    if (piece?.side === online.yourSide) {
      setSelected({ row, col });
      setDropType(null);
    } else {
      setSelected(null);
    }
  };

  const createRoom = async (): Promise<void> => {
    if (!connection || busy) return;
    setBusy(true);
    setOnlineError("");
    const result = await emitAck<{ roomCode: string }>(socket, "shogi:create", {});
    setBusy(false);
    if (!result.ok) setOnlineError(result.message ?? "创建房间失败");
    else setRoomCode(result.data?.roomCode ?? "");
  };

  const joinRoom = async (): Promise<void> => {
    const code = roomCode.trim().toUpperCase();
    if (!connection || busy || !/^\d{4}$/.test(code)) return;
    setBusy(true);
    setOnlineError("");
    const result = await emitAck<{ roomCode: string }>(socket, "shogi:join", { roomCode: code });
    setBusy(false);
    if (!result.ok) setOnlineError(result.message ?? "加入房间失败");
    else setRoomCode(result.data?.roomCode ?? code);
  };

  const spectateRoom = async (): Promise<void> => {
    const code = roomCode.trim().toUpperCase();
    if (!connection || busy || !/^\d{4}$/.test(code)) return;
    setBusy(true);
    setOnlineError("");
    const result = await emitAck<{ roomCode: string }>(socket, "shogi:spectate", { roomCode: code });
    setBusy(false);
    if (!result.ok) setOnlineError(result.message ?? "进入观战席失败");
  };
  const answerIncomingInvite = async (accept: boolean): Promise<void> => {
    if (!incomingInvite) return;
    const token = localStorage.getItem(ACCOUNT_TOKEN_KEY) ?? "";
    await fetch(`/api/social/invitations/${encodeURIComponent(incomingInvite.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    const invite = incomingInvite;
    setIncomingInvite(null);
    if (accept) location.assign(`/shogi?room=${invite.roomCode}${invite.role === "spectator" ? "&watch=1" : ""}`);
  };

  const resign = async (): Promise<void> => {
    if (!online || busy || !connection) return;
    setBusy(true);
    const result = await emitAck(socket, "shogi:resign", { roomCode: online.roomCode });
    setBusy(false);
    setConfirmingResign(false);
    if (!result.ok) setOnlineError(result.message ?? "投降未被服务器接受");
    else setOnlineError("");
  };

  const leaveRoom = async (): Promise<void> => {
    if (!online || busy) return;
    if (!online.spectator && online.started && game?.status === "playing" && !window.confirm("退出后将判定对手获胜，并释放你的座位。确定退出房间吗？")) return;
    setBusy(true);
    const result = await emitAck(socket, "shogi:leave", {});
    setBusy(false);
    if (!result.ok) setOnlineError(result.message ?? "退出房间失败");
  };

  const markReady = async (): Promise<void> => {
    if (!online || online.spectator || busy || online.started || !connection) return;
    setBusy(true);
    const ready = !online.ready.includes(online.yourSide);
    const result = await emitAck(socket, "shogi:ready", { ready });
    setBusy(false);
    if (!result.ok) setOnlineError(result.message ?? "更新准备状态失败");
    else setOnlineError("");
  };

  const startGame = async (): Promise<void> => {
    if (!online || online.spectator || busy || online.started || !connection || online.hostSide !== online.yourSide) return;
    setBusy(true);
    const result = await emitAck(socket, "shogi:start", {});
    setBusy(false);
    if (!result.ok) setOnlineError(result.message ?? "开始对局失败");
    else setOnlineError("");
  };

  const renderHand = (side: Side): ReactElement => {
    const hand = game!.hands[side];
    const count = Object.entries(hand).filter(([type]) => type !== "king").reduce((total, [, amount]) => total + Number(amount), 0);
    return <section className={`shogi-hand shogi-hand-${side}`} aria-label={`${sideLabel[side]}持驹`}>
      <div className="shogi-hand-heading"><strong>{sideLabel[side]}持驹</strong><span>{online?.players[side] ?? "等待玩家"}{online?.connected[side] === false ? " · 已断线" : ""}</span></div>
      <div className="shogi-hand-pieces">
        {PIECE_TYPES.filter((type): type is Exclude<PieceType, "king"> => type !== "king")
          .filter((type) => hand[type] > 0)
          .map((type) => {
            const amount = hand[type];
            return <button key={type}
              className={`shogi-hand-piece ${dropType === type && online?.yourSide === side ? "is-selected" : ""}`}
              disabled={!connection || busy || online?.spectator === true || game!.status !== "playing" || online?.yourSide !== currentSide || online?.yourSide !== side || amount === 0}
              onClick={() => { setDropType(dropType === type ? null : type); setSelected(null); }}
              aria-label={`${pieceLabel(type)} ${amount}枚打入`} title={`${pieceLabel(type)} ${amount}枚`}>
              <PieceImage piece={{ type, side, promoted: false }} yourSide={online!.yourSide} size="hand" />
              {amount > 1 ? <span>{amount}</span> : null}
            </button>;
          })}
        {count === 0 ? <span className="muted">空</span> : null}
      </div>
    </section>;
  };

  const opponentSide: Side = online?.yourSide === "sente" ? "gote" : "sente";
  const opponentReady = Boolean(online?.ready.includes(opponentSide));
  const playersConnected = Boolean(online?.connected.sente && online?.connected.gote);
  const playingLabel = game?.status === "playing"
    ? game.turn === online?.yourSide
      ? `轮到你行棋 · ${identity?.username ?? online?.players[game.turn] ?? sideLabel[game.turn]}`
      : `轮到对手行棋 · ${online?.players[game.turn] ?? sideLabel[game.turn]}`
    : statusText;
  const invitePanel = online && !online.spectator ? <div className="shogi-friend-invites"><strong>邀请好友</strong><button type="button" className="secondary" onClick={() => setInviteRole("player")}>邀请对战席</button><button type="button" className="secondary" onClick={() => setInviteRole("spectator")}>邀请观战席</button>{inviteResult ? <small>{inviteResult}</small> : null}</div> : null;
  const spectatorsPanel = online ? <div className="spectator-list"><strong>观战席（{online.spectators?.length ?? 0}）</strong>{online.spectators?.length ? online.spectators.map((person) => <span key={person.id}>{person.name}</span>) : <small>暂无观战者</small>}</div> : null;

  return <main className={`shogi-app ${online?.started ? "shogi-playing" : ""}`}>
    {inviteRole && online ? <InviteDialog game="shogi" roomCode={online.roomCode} role={inviteRole} onClose={() => setInviteRole(null)} /> : null}
    {incomingInvite ? <aside className="invite-toast"><strong>{incomingInvite.inviter} 邀请你{incomingInvite.role === "spectator" ? "观战" : "加入房间"}</strong><span>日本将棋 · {incomingInvite.roomCode}</span><button className="primary" onClick={() => void answerIncomingInvite(true)}>{incomingInvite.role === "spectator" ? "前往观战" : "接受邀请"}</button><button className="text-button" onClick={() => void answerIncomingInvite(false)}>忽略</button></aside> : null}
    <header className="shogi-topbar">
      <button className="secondary shogi-back" onClick={() => location.assign("/")}>返回大厅</button>
      <div className="shogi-brand"><p className="eyebrow">LayUDown · 在线对局</p><h1>日本将棋</h1></div>
      <ThemeControl />
    </header>

    {authState !== "ready" ? <section className="panel shogi-login-panel">
      <strong>{authState === "checking" ? "正在验证登录状态" : authState === "unreachable" ? "将棋联机服务暂不可用" : "请先登录 LayUDown 账号"}</strong>
      <p className="muted">将棋房间使用当前登录账号身份，切换账号不会继承其他账号的座位。</p>
      {authState === "required" ? <a className="primary shogi-login-link" href="/">前往登录</a>
        : authState === "unreachable" ? <>
          <span className="muted">连接状态：{connection ? "已连接" : "连接中断"}</span>
          <button type="button" className="secondary" onClick={() => { setOnlineError(""); setAuthState("checking"); setAuthAttempt((value) => value + 1); }}>重新连接</button>
        </>
          : <span className="muted">连接状态：{connection ? "已连接" : "正在连接"}</span>}
      {onlineError ? <p className="muted" role="status">{onlineError}</p> : null}
    </section> : !online ? <>
      <section className="panel shogi-room-lobby" aria-labelledby="shogi-room-title">
        <div className="shogi-room-lobby-heading">
          <div><p className="eyebrow">已登录：{identity?.username}</p><h2 id="shogi-room-title">在线联机</h2></div>
          <span className={`shogi-connection ${connection ? "is-connected" : ""}`}><i />{connection ? "连接正常" : "连接中断"}</span>
        </div>
        <div className="shogi-room-actions">
          <button className="primary" disabled={!connection || busy} onClick={() => void createRoom()}>创建房间</button>
          <label htmlFor="shogi-room-code">加入房间</label>
          <input id="shogi-room-code" value={roomCode} maxLength={4} placeholder="4 位房间号" autoComplete="off"
            onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, "").slice(0, 4))}
            onKeyDown={(event) => { if (event.key === "Enter") void joinRoom(); }} />
          <button className="secondary" disabled={!connection || busy || !/^\d{4}$/.test(roomCode)} onClick={() => void joinRoom()}>加入房间</button>
          <button className="secondary" disabled={!connection || busy || !/^\d{4}$/.test(roomCode)} onClick={() => void spectateRoom()}>进入观战席</button>
        </div>
        <p className="shogi-hint">将房间号分享给对手加入；每个账号只能在同一房间占用一个座位。</p>
      </section>
    </> : <>
      {!online.started ? <section className="shogi-room-bar" aria-label="房间信息">
        <div className="shogi-room-identity"><span className="muted">房间号</span><strong>{online.roomCode}</strong><span className="shogi-seat-tag">{online.spectator ? "观战席" : `${sideLabel[online.yourSide]} · ${identity?.username}`}</span></div>
        <div className="shogi-player-line">
          <span className={`${online.yourSide === "sente" ? "is-self " : ""}${online.started && game?.turn === "sente" ? "is-current" : ""}`}>{online.players.sente ?? "等待先手玩家"}</span>
          <b>对局</b>
          <span className={`${online.yourSide === "gote" ? "is-self " : ""}${online.started && game?.turn === "gote" ? "is-current" : ""}`}>{online.players.gote ?? "等待后手玩家"}</span>
        </div>
        <div className="shogi-room-controls">
          <button className="secondary" disabled={busy} onClick={() => void leaveRoom()}>退出房间</button>
        </div>
      </section> : null}
      {online && !online.started ? <>{invitePanel}{spectatorsPanel}</> : null}

      {!online.started ? <section className="panel shogi-waiting-panel" aria-live="polite">
        <strong>{online.players[opponentSide] ? `${online.players[opponentSide]} · ${opponentReady ? "已准备" : "已加入房间"}` : "等待玩家加入房间"}</strong>
        {!online.spectator && online.hostSide === online.yourSide ? <>
          <button className="primary" disabled={busy || !connection || !playersConnected || !opponentReady} onClick={() => void startGame()}>开始游戏</button>
          {!opponentReady ? <span className="muted">对手准备后即可开始</span> : null}
        </> : !online.spectator ? <button className={online.ready.includes(online.yourSide) ? "secondary" : "primary"}
          disabled={busy || !connection || !online.players[opponentSide]}
          onClick={() => void markReady()}>
          {online.ready.includes(online.yourSide) ? "取消准备" : "准备"}
        </button> : <span className="muted">你正在观战，只能查看棋局。</span>}
        {onlineError ? <p className="shogi-message" role="status">{onlineError}</p> : null}
      </section> : game ? <>
        <section className={`shogi-active-bar ${game.status === "playing" && game.turn === online.yourSide ? "is-your-turn" : ""}`} aria-live="polite">
          <strong>{playingLabel}</strong>
          <span className="shogi-active-actions">
            <button className="secondary shogi-resign" disabled={online.spectator || busy || !connection || !canResign}
              title={canResign ? "投降" : gameOver ? "对局已结束" : "开局满 3 分钟后才能投降"}
              onClick={() => setConfirmingResign(true)}>
              {gameOver || canResign ? "投降" : `投降（${formatClock(surrenderWaitMs)}）`}
            </button>
            <button className="secondary" disabled={busy} onClick={() => void leaveRoom()}>退出房间</button>
          </span>
        </section>
        {invitePanel}{spectatorsPanel}
        {gameOver && dissolveRemainingSeconds !== null ? <p className="shogi-message shogi-dissolve-notice" role="status" aria-live="polite">房间将在 {dissolveRemainingSeconds} 秒后自动解散</p> : null}
        {onlineError ? <p className="shogi-message" role="status">{onlineError}</p> : null}
        {notice ? <p className="shogi-message" role="status">{notice}</p> : null}
        <div className={`shogi-play-area shogi-view-${online.yourSide}`}>
          {renderHand(online.yourSide === "sente" ? "gote" : "sente")}
          <div className="shogi-board-wrap">
            <div className="shogi-files" aria-hidden="true">{(online.yourSide === "sente" ? [9,8,7,6,5,4,3,2,1] : [1,2,3,4,5,6,7,8,9]).map((n) => <span key={n}>{n}</span>)}</div>
            <div className="shogi-board" role="grid" aria-label="9乘9日本将棋棋盘">
              {Array.from({ length: 9 }, (_, viewRow) => {
                const rowIndex = online.yourSide === "sente" ? viewRow : 8 - viewRow;
                const row = game.board[rowIndex]!;
                return Array.from({ length: 9 }, (_, viewCol) => {
                const colIndex = online.yourSide === "sente" ? viewCol : 8 - viewCol;
                const piece = row[colIndex]!;
                const canLand = selectedTargets.some((move) => move.to.row === rowIndex && move.to.col === colIndex) ||
                  (!!dropType && game.legalMoves.some((move) => move.kind === "drop" && move.piece === dropType && move.to.row === rowIndex && move.to.col === colIndex));
                const selectedHere = selected?.row === rowIndex && selected.col === colIndex;
                return <button key={`${rowIndex}-${colIndex}`} role="gridcell"
                  aria-label={`${9 - colIndex}筋${rowIndex + 1}段${piece ? ` ${sideLabel[piece.side]}${pieceLabel(piece.type)}` : " 空"}`}
                  data-board-row={rowIndex}
                  data-board-col={colIndex}
                  className={`shogi-square ${(rowIndex + colIndex) % 2 ? "shade" : ""} ${canLand ? "legal-target" : ""} ${selectedHere ? "is-selected" : ""} ${game.lastMove?.to.row === rowIndex && game.lastMove.to.col === colIndex ? "last-move" : ""}`}
                  onClick={() => squareClick(rowIndex, colIndex)}
                  disabled={!connection || busy || online.spectator === true || gameOver || game.status !== "playing" || online.yourSide !== game.turn}>
                  {piece ? <PieceImage piece={piece} yourSide={online.yourSide} /> : null}
                </button>;
                });
              })}
            </div>
            <div className="shogi-ranks" aria-hidden="true">{(online.yourSide === "sente"
              ? ["一","二","三","四","五","六","七","八","九"]
              : ["九","八","七","六","五","四","三","二","一"]
            ).map((n) => <span key={n}>{n}</span>)}</div>
          </div>
          {renderHand(online.yourSide === "sente" ? "sente" : "gote")}
        </div>
      </> : <p className="muted">正在恢复房间状态…</p>}
    </>}

    {onlineError && !online ? <p className="shogi-message" role="status">{onlineError}</p> : null}
    {notice && !online ? <p className="shogi-message" role="status">{notice}</p> : null}
    {online && gameOver ? <div className="shogi-result-overlay" role="dialog" aria-modal="false" aria-label="对局结果" data-result-reason={online.result?.reason ?? game?.status}>
      {online.result?.reason === "checkmate" ? <img className="shogi-checkmate-art" src={CHECKMATE_IMAGE} alt="绝杀" draggable={false} /> : null}
      <div className="shogi-result-card">
        <strong>{winnerLabel}</strong>
        <span>对局已结束</span>
        {dissolveRemainingSeconds !== null ? <span>房间将在 {dissolveRemainingSeconds} 秒后自动解散</span> : null}
      </div>
    </div> : null}
    {confirmingResign && online && !gameOver ? <div className="shogi-modal-backdrop"><section className="panel shogi-promotion" role="dialog" aria-modal="true" aria-labelledby="resign-title">
      <h2 id="resign-title">确定要投降吗？投降后本局判负。</h2><div className="button-row">
        <button className="primary" disabled={busy || !canResign} onClick={() => void resign()}>确认投降</button>
        <button className="text-button" onClick={() => setConfirmingResign(false)}>取消</button>
      </div>
    </section></div> : null}
    {promotion ? <div className="shogi-modal-backdrop"><section className="panel shogi-promotion" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
      <h2 id="promotion-title">升变棋子？</h2><div className="button-row">
        <button className="primary" disabled={busy} onClick={() => void sendMove({ ...promotion, promote: true })}>升变</button>
        <button className="secondary" disabled={busy} onClick={() => void sendMove({ ...promotion, promote: false })}>不升变</button>
        <button className="text-button" onClick={() => setPromotion(null)}>取消</button>
      </div>
    </section></div> : null}
  </main>;
}
