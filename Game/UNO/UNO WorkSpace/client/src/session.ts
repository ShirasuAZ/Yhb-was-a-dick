import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActionAck,
  AuthAccount,
  AuthResult,
  ClientToServerEvents,
  CreateRoomResult,
  EmoteMessage,
  JoinRoomResult,
  LanStatusView,
  QuickEmoji,
  RoomState
} from "@shared/protocol.ts";
import { socket } from "./socket.ts";
import { createActionId } from "./actionId.ts";
import type { ConnectionStatus } from "./types.ts";

const LAST_SESSION_KEY = "uno.lastSession";
const SESSION_PREFIX = "uno.session.";
const ACCOUNT_TOKEN_KEY = "uno.accountToken";
const ACK_TIMEOUT_MS = 5000;

export interface StoredSession {
  roomCode: string;
  token: string;
}

function readStoredSession(roomCode: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(`${SESSION_PREFIX}${roomCode}`);
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof value.token !== "string" || value.token.length < 20) {
      return null;
    }
    return { roomCode, token: value.token };
  } catch {
    return null;
  }
}

function storeSession(session: StoredSession): void {
  localStorage.setItem(
    `${SESSION_PREFIX}${session.roomCode}`,
    JSON.stringify(session)
  );
  localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(session));
}

function clearSession(roomCode: string): void {
  localStorage.removeItem(`${SESSION_PREFIX}${roomCode}`);
  try {
    const last = JSON.parse(
      localStorage.getItem(LAST_SESSION_KEY) ?? "null"
    ) as StoredSession | null;
    if (last?.roomCode === roomCode) {
      localStorage.removeItem(LAST_SESSION_KEY);
    }
  } catch {
    localStorage.removeItem(LAST_SESSION_KEY);
  }
}

function roomCodeFromPath(): string | null {
  const match = window.location.pathname.match(/^\/room\/([A-Za-z2-9]{6})\/?$/);
  return match?.[1]?.toUpperCase() ?? null;
}

function readAccountToken(): string | null {
  const token = localStorage.getItem(ACCOUNT_TOKEN_KEY);
  return token && token.length >= 20 ? token : null;
}

function storeAccountToken(token: string): void {
  localStorage.setItem(ACCOUNT_TOKEN_KEY, token);
}

function clearAccountToken(): void {
  localStorage.removeItem(ACCOUNT_TOKEN_KEY);
}

function emitAck<TResult = unknown>(
  event: keyof ClientToServerEvents,
  payload: unknown
): Promise<ActionAck<TResult>> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      resolve({
        ok: false,
        code: "TIMEOUT",
        message: "服务器响应超时，请重试"
      });
    }, ACK_TIMEOUT_MS);
    (
      socket as unknown as {
        emit: (
          name: string,
          body: unknown,
          callback: (result: ActionAck<TResult>) => void
        ) => void;
      }
    ).emit(event, payload, (result) => {
      window.clearTimeout(timer);
      resolve(result);
    });
  });
}

export function useUnoSession() {
  const pathCodeRef = useRef<string | null>(roomCodeFromPath());
  const [connection, setConnection] =
    useState<ConnectionStatus>("connecting");
  const [account, setAccountState] = useState<AuthAccount | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [lanStatus, setLanStatus] = useState<LanStatusView | null>(null);
  const [emotes, setEmotes] = useState<Record<string, EmoteMessage>>({});
  const [inviteCode, setInviteCode] = useState<string | null>(
    pathCodeRef.current
  );
  const sessionRef = useRef<StoredSession | null>(
    pathCodeRef.current ? readStoredSession(pathCodeRef.current) : null
  );
  const accountRef = useRef<AuthAccount | null>(null);
  const accountTokenRef = useRef<string | null>(readAccountToken());
  const resumedSocketIdRef = useRef<string | null>(null);
  const resumeInFlightRef = useRef(false);
  const exitedRoomCodesRef = useRef<Set<string>>(new Set());

  const showError = useCallback((message: string) => {
    setError(message);
  }, []);

  const setAccount = useCallback((nextAccount: AuthAccount | null): void => {
    accountRef.current = nextAccount;
    setAccountState(nextAccount);
  }, []);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = window.setTimeout(() => setError(""), 5500);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    setEmotes({});
  }, [room?.roomCode]);

  const resumeRoom = useCallback(async (): Promise<boolean> => {
    const stored = sessionRef.current;
    if (!stored || !accountRef.current) {
      return false;
    }
    if (socket.id && resumedSocketIdRef.current === socket.id) {
      return true;
    }
    if (resumeInFlightRef.current) {
      return false;
    }
    resumeInFlightRef.current = true;
    const result = await emitAck<JoinRoomResult>("resume_session", stored);
    resumeInFlightRef.current = false;
    if (!result.ok) {
      if (result.code === "TIMEOUT") {
        showError(result.message ?? "恢复房间超时");
        return false;
      }
      sessionRef.current = null;
      clearSession(stored.roomCode);
      setRoom(null);
      showError(result.message ?? "无法恢复房间");
      return false;
    }
    resumedSocketIdRef.current = socket.id ?? null;
    storeSession(stored);
    return true;
  }, [showError]);

  useEffect(() => {
    let mounted = true;

    const initialize = async (): Promise<void> => {
      try {
        setConnection("connected");
        let currentAccount: AuthAccount | null = null;
        const token = accountTokenRef.current;
        if (token) {
          const result = await emitAck<{ account: AuthAccount }>("auth_me", {});
          if (result.ok && result.data) {
            currentAccount = result.data.account;
            setAccount(currentAccount);
            socket.auth = { token };
          } else if (result.code === "TIMEOUT") {
            showError(result.message ?? "账号验证超时");
          } else {
            accountTokenRef.current = null;
            clearAccountToken();
            socket.auth = {};
            setAccount(null);
          }
        } else {
          setAccount(null);
        }

        if (currentAccount) {
          await resumeRoom();
        }

        const lanResult = await emitAck<LanStatusView>(
          "host_get_lan_status",
          {}
        );
        if (mounted) {
          setLanStatus(
            lanResult.ok && lanResult.data ? lanResult.data : null
          );
        }
      } finally {
        setBooting(false);
      }
    };

    const onConnect = (): void => {
      void initialize();
    };
    const onDisconnect = (): void => {
      setConnection("disconnected");
      setLanStatus(null);
    };
    const onRoomState = (state: RoomState): void => {
      if (exitedRoomCodesRef.current.has(state.roomCode)) {
        return;
      }
      setRoom(state);
      setBooting(false);
      resumedSocketIdRef.current = socket.id ?? null;
      if (sessionRef.current?.roomCode === state.roomCode) {
        storeSession(sessionRef.current);
      }
    };
    const onRoomClosed = (payload: { message: string }): void => {
      const code = sessionRef.current?.roomCode;
      if (code) {
        exitedRoomCodesRef.current.add(code);
        clearSession(code);
      }
      sessionRef.current = null;
      setRoom(null);
      setInviteCode(null);
      showError(payload.message);
      window.history.pushState({}, "", "/");
    };
    const onSessionReplaced = (payload: { message: string }): void => {
      const code = sessionRef.current?.roomCode;
      if (code) {
        exitedRoomCodesRef.current.add(code);
        clearSession(code);
      }
      sessionRef.current = null;
      setRoom(null);
      setInviteCode(null);
      showError(payload.message);
      window.history.pushState({}, "", "/");
    };
    const onLanStatus = (status: LanStatusView): void => {
      setLanStatus(status);
    };
    const onEmote = (message: EmoteMessage): void => {
      setEmotes((current) => ({
        ...current,
        [message.playerId]: message
      }));
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room_state", onRoomState);
    socket.on("room_closed", onRoomClosed);
    socket.on("session_replaced", onSessionReplaced);
    socket.on("lan_status", onLanStatus);
    socket.on("emote", onEmote);
    socket.auth = accountTokenRef.current
      ? { token: accountTokenRef.current }
      : {};
    if (socket.connected) {
      void initialize();
    } else {
      socket.connect();
    }

    return () => {
      mounted = false;
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room_state", onRoomState);
      socket.off("room_closed", onRoomClosed);
      socket.off("session_replaced", onSessionReplaced);
      socket.off("lan_status", onLanStatus);
      socket.off("emote", onEmote);
    };
  }, [resumeRoom, setAccount, showError]);

  const enterRoom = useCallback((result: StoredSession): void => {
    exitedRoomCodesRef.current.delete(result.roomCode);
    sessionRef.current = result;
    storeSession(result);
    setInviteCode(result.roomCode);
    window.history.pushState({}, "", `/room/${result.roomCode}`);
  }, []);

  const joinInviteRoom = useCallback(async (): Promise<void> => {
    const roomCode = pathCodeRef.current;
    const currentAccount = accountRef.current;
    if (!roomCode || sessionRef.current || !currentAccount || !socket.connected) {
      return;
    }
    const result = await emitAck<JoinRoomResult>("join_room", {
      roomCode,
      name: currentAccount.username
    });
    if (!result.ok || !result.data) {
      showError(result.message ?? "加入房间失败");
      return;
    }
    enterRoom({
      roomCode: result.data.roomCode,
      token: result.data.token
    });
  }, [enterRoom, showError]);

  const register = useCallback(
    async (username: string, email: string, password: string): Promise<boolean> => {
      if (!socket.connected) {
        showError("尚未连接服务器");
        return false;
      }
      setBusy(true);
      setError("");
      try {
        const result = await emitAck<AuthResult>("auth_register", {
          username,
          email,
          password
        });
        if (!result.ok || !result.data) {
          showError(result.message ?? "注册失败");
          return false;
        }
        accountTokenRef.current = result.data.token;
        storeAccountToken(result.data.token);
        socket.auth = { token: result.data.token };
        setAccount(result.data.account);
        const resumed = await resumeRoom();
        if (!resumed && !sessionRef.current) {
          await joinInviteRoom();
        }
        return true;
      } finally {
        setBusy(false);
      }
    },
    [joinInviteRoom, resumeRoom, setAccount, showError]
  );

  const login = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      if (!socket.connected) {
        showError("尚未连接服务器");
        return false;
      }
      setBusy(true);
      setError("");
      try {
        const result = await emitAck<AuthResult>("auth_login", {
          username,
          password
        });
        if (!result.ok || !result.data) {
          showError(result.message ?? "登录失败");
          return false;
        }
        accountTokenRef.current = result.data.token;
        storeAccountToken(result.data.token);
        socket.auth = { token: result.data.token };
        setAccount(result.data.account);
        const resumed = await resumeRoom();
        if (!resumed && !sessionRef.current) {
          await joinInviteRoom();
        }
        return true;
      } finally {
        setBusy(false);
      }
    },
    [joinInviteRoom, resumeRoom, setAccount, showError]
  );

  const resetPassword = useCallback(async (username: string, email: string, password: string): Promise<boolean> => {
    if (!socket.connected) {
      showError("尚未连接服务器");
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const result = await emitAck("auth_reset_password", { username, email, password });
      if (!result.ok) {
        showError(result.message ?? "重设密码失败");
        return false;
      }
      showError("密码已更新，请使用新密码登录");
      return true;
    } finally {
      setBusy(false);
    }
  }, [setError, showError]);

  const logout = useCallback(async (): Promise<boolean> => {
    if (room) {
      showError("请先离开当前房间再退出登录");
      return false;
    }
    if (socket.connected) {
      await emitAck("auth_logout", { actionId: createActionId() });
    }
    if (sessionRef.current) {
      clearSession(sessionRef.current.roomCode);
      sessionRef.current = null;
    }
    accountTokenRef.current = null;
    clearAccountToken();
    socket.auth = {};
    setAccount(null);
    setRoom(null);
    setLanStatus(null);
    socket.disconnect();
    socket.connect();
    return true;
  }, [room, setAccount, showError]);

  const deleteAccount = useCallback(async (password: string): Promise<boolean> => {
    if (room) {
      showError("请先离开当前房间再注销账号");
      return false;
    }
    const result = await emitAck("auth_delete_account", { password });
    if (!result.ok) {
      showError(result.message ?? "注销账号失败");
      return false;
    }
    accountTokenRef.current = null;
    clearAccountToken();
    socket.auth = {};
    setAccount(null);
    setRoom(null);
    socket.disconnect();
    socket.connect();
    window.location.assign("/");
    return true;
  }, [room, setAccount, showError]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string): Promise<boolean> => {
    const result = await emitAck<AuthResult>("auth_change_password", { currentPassword, newPassword });
    if (!result.ok || !result.data) {
      showError(result.message ?? "修改密码失败");
      return false;
    }
    accountTokenRef.current = result.data.token;
    storeAccountToken(result.data.token);
    socket.auth = { token: result.data.token };
    setAccount(result.data.account);
    socket.disconnect();
    socket.connect();
    return true;
  }, [setAccount, showError]);

  const beginEmailChange = useCallback(async (currentPassword: string, email: string): Promise<boolean> => {
    const result = await emitAck("auth_begin_email_change", { currentPassword, email });
    if (!result.ok) {
      showError(result.message ?? "发送邮箱验证码失败");
      return false;
    }
    return true;
  }, [showError]);

  const verifyEmailChange = useCallback(async (code: string): Promise<boolean> => {
    const result = await emitAck<{ account: AuthAccount }>("auth_verify_email_change", { code });
    if (!result.ok || !result.data) {
      showError(result.message ?? "邮箱验证失败");
      return false;
    }
    setAccount(result.data.account);
    return true;
  }, [setAccount, showError]);

  const saveAvatar = useCallback(async (file: File): Promise<boolean> => {
    const token = accountTokenRef.current;
    if (!token) {
      showError("请先登录");
      return false;
    }
    setBusy(true);
    try {
      const result = await fetch("/api/profile/avatar", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "X-Image-Type": file.type
        },
        body: file
      });
      const payload = await result.json() as { ok?: boolean; account?: AuthAccount; message?: string };
      if (!result.ok || !payload.ok || !payload.account) {
        showError(payload.message ?? "保存头像失败");
        return false;
      }
      setAccount(payload.account);
      return true;
    } catch {
      showError("保存头像失败，请检查网络连接");
      return false;
    } finally {
      setBusy(false);
    }
  }, [setAccount, showError]);

  const createRoom = useCallback(async (): Promise<void> => {
    const currentAccount = accountRef.current;
    if (!currentAccount) {
      showError("请先登录");
      return;
    }
    if (!socket.connected) {
      showError("尚未连接服务器");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await emitAck<CreateRoomResult>("create_room", {
        name: currentAccount.username
      });
      if (!result.ok || !result.data) {
        showError(result.message ?? "创建房间失败");
        return;
      }
      enterRoom({
        roomCode: result.data.roomCode,
        token: result.data.token
      });
    } finally {
      setBusy(false);
    }
  }, [enterRoom, showError]);

  const joinRoom = useCallback(
    async (roomCode: string): Promise<void> => {
      const currentAccount = accountRef.current;
      if (!currentAccount) {
        showError("请先登录");
        return;
      }
      if (!socket.connected) {
        showError("尚未连接服务器");
        return;
      }
      setBusy(true);
      setError("");
      const normalizedRoomCode = roomCode.trim().toUpperCase();
      exitedRoomCodesRef.current.delete(normalizedRoomCode);
      try {
        const result = await emitAck<JoinRoomResult>("join_room", {
          roomCode: normalizedRoomCode,
          name: currentAccount.username
        });
        if (!result.ok || !result.data) {
          showError(result.message ?? "加入房间失败");
          return;
        }
        enterRoom({
          roomCode: result.data.roomCode,
          token: result.data.token
        });
      } finally {
        setBusy(false);
      }
    },
    [enterRoom, showError]
  );

  const perform = useCallback(
    async (
      event: keyof ClientToServerEvents,
      payload: Record<string, unknown>
    ): Promise<boolean> => {
      if (!socket.connected) {
        showError("连接已断开，正在重连");
        return false;
      }
      setBusy(true);
      setError("");
      try {
        const result = await emitAck(event, payload);
        if (!result.ok) {
          showError(result.message ?? "操作失败");
          return false;
        }
        return true;
      } finally {
        setBusy(false);
      }
    },
    [showError]
  );

  const sendEmote = useCallback(
    async (emoji: QuickEmoji): Promise<boolean> => {
      if (!socket.connected) {
        showError("连接已断开，正在重连");
        return false;
      }
      const result = await emitAck("send_emote", {
        emoji,
        actionId: createActionId()
      });
      if (!result.ok) {
        showError(result.message ?? "表情发送失败");
        return false;
      }
      return true;
    },
    [showError]
  );

  const leaveRoom = useCallback(async (): Promise<void> => {
    const currentRoom = room;
    if (!currentRoom) {
      return;
    }
    if (
      currentRoom.phase === "playing" &&
      !window.confirm("对局中退出将视为弃权，确定退出吗？")
    ) {
      return;
    }
    exitedRoomCodesRef.current.add(currentRoom.roomCode);
    // Clear the local room immediately so leaving always feels instant.
    // The server still receives the leave request and cleans up the seat.
    clearSession(currentRoom.roomCode);
    sessionRef.current = null;
    setRoom(null);
    setInviteCode(null);
    window.history.pushState({}, "", "/");
    const result = await perform("leave_room", {
      actionId: createActionId()
    });
    if (!result) {
      showError(
        "已退出本地房间，但服务器未确认离开。若房间中仍显示你在座，请重新进入房间后再退出。"
      );
    }
  }, [perform, room, showError]);

  const refreshLanStatus = useCallback(async (): Promise<void> => {
    if (!socket.connected) {
      return;
    }
    const result = await emitAck<LanStatusView>("host_get_lan_status", {});
    setLanStatus(result.ok && result.data ? result.data : null);
  }, []);

  const setLanAccess = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      if (!socket.connected) {
        showError("连接已断开，无法更改局域网开放状态");
        return false;
      }
      setBusy(true);
      setError("");
      try {
        const result = await emitAck<LanStatusView>("host_set_lan_access", {
          enabled,
          actionId: createActionId()
        });
        if (!result.ok || !result.data) {
          showError(result.message ?? "更改局域网开放状态失败");
          return false;
        }
        setLanStatus(result.data);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [showError]
  );

  return {
    connection,
    account,
    accountToken: accountTokenRef.current,
    room,
    error,
    busy,
    booting,
    inviteCode,
    lanStatus,
    emotes,
    register,
    login,
    resetPassword,
    logout,
    deleteAccount,
    changePassword,
    beginEmailChange,
    verifyEmailChange,
    saveAvatar,
    createRoom,
    joinRoom,
    perform,
    sendEmote,
    leaveRoom,
    refreshLanStatus,
    setLanAccess,
    setError: showError
  };
}
