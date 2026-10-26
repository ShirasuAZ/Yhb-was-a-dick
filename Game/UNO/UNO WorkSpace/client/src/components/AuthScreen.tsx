import { useState } from "react";
import { ConnectionBadge } from "./ConnectionBadge.tsx";
import { VersionBadge } from "./VersionBadge.tsx";
import type { ConnectionStatus } from "../types.ts";
import { AboutPage } from "./AboutPage.tsx";

interface AuthScreenProps {
  connection: ConnectionStatus;
  busy: boolean;
  error: string;
  inviteCode: string | null;
  onLogin: (username: string, password: string) => Promise<boolean>;
  onRegister: (username: string, email: string, password: string) => Promise<boolean>;
  onResetPassword: (username: string, email: string, password: string) => Promise<boolean>;
  clearError: () => void;
}

export function AuthScreen({
  connection,
  busy,
  error,
  inviteCode,
  onLogin,
  onRegister,
  onResetPassword,
  clearError
}: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const connected = connection === "connected";
  const disabled = busy || !connected;

  const changeMode = (nextMode: "login" | "register" | "forgot"): void => {
    setMode(nextMode);
    setLocalError("");
    setPassword("");
    setConfirmPassword("");
    clearError();
  };

  const submit = async (): Promise<void> => {
    setLocalError("");
    clearError();
    if (!username.trim()) {
      setLocalError("请输入用户名");
      return;
    }
    if (mode !== "login" && !email.trim()) {
      setLocalError("请输入邮箱");
      return;
    }
    if (mode !== "login" && password !== confirmPassword) {
      setLocalError("两次输入的密码不一致");
      return;
    }
    if (mode === "login") {
      await onLogin(username.trim(), password);
    } else if (mode === "register") {
      await onRegister(username.trim(), email.trim(), password);
    } else {
      await onResetPassword(username.trim(), email.trim(), password);
    }
  };

  return (
    <div className="app-shell auth-shell">
      <header className="lobby-header">
        <div>
          {/* [DO NOT MODIFY - WEBSITE BRAND TITLE] The global website h1 must remain exactly "LayUDown". */}
          <h1>LayUDown</h1>
        </div>
        <div className="header-status">
          <ConnectionBadge status={connection} />
          <VersionBadge />
        </div>
      </header>

      <main className="auth-main">
        {window.location.pathname === "/about" ? <AboutPage onBack={() => window.location.assign("/")} /> : (
        <section className="panel auth-panel" aria-labelledby="auth-heading">
          <p className="eyebrow">玩家账号</p>
          <h2 id="auth-heading">
            {mode === "login" ? "登录" : mode === "register" ? "注册新账号" : "重设密码"}
          </h2>
          {inviteCode ? (
            <p className="hint">登录后将加入邀请房间 {inviteCode}。</p>
          ) : null}

          <div className="auth-tabs" role="tablist" aria-label="登录或注册">
            <button
              type="button"
              className={mode === "login" ? "auth-tab-active" : "auth-tab"}
              onClick={() => changeMode("login")}
              hidden={mode === "forgot"}
            >
              登录
            </button>
            <button
              type="button"
              className={mode === "register" ? "auth-tab-active" : "auth-tab"}
              onClick={() => changeMode("register")}
              hidden={mode === "forgot"}
            >
              注册
            </button>
          </div>

          <div className="auth-fields">
            <label className="field-label" htmlFor="auth-username">
              用户名
            </label>
            <input
              id="auth-username"
              value={username}
              maxLength={16}
              autoComplete="username"
              placeholder="2 至 16 个字符"
              onChange={(event) => setUsername(event.target.value)}
            />

            {mode !== "login" ? (
              <>
                <label className="field-label" htmlFor="auth-email">邮箱</label>
                <input id="auth-email" type="email" value={email} maxLength={254}
                  autoComplete="email" placeholder="name@example.com"
                  onChange={(event) => setEmail(event.target.value)} />
              </>
            ) : null}

            <label className="field-label" htmlFor="auth-password">
              密码
            </label>
            <input
              id="auth-password"
              type="password"
              value={password}
              maxLength={72}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              placeholder="至少 8 个字符"
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  mode === "login"
                ) {
                  void submit();
                }
              }}
            />

            {mode !== "login" ? (
              <>
                <label className="field-label" htmlFor="auth-confirm-password">
                  确认密码
                </label>
                <input
                  id="auth-confirm-password"
                  type="password"
                  value={confirmPassword}
                  maxLength={72}
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void submit();
                    }
                  }}
                />
              </>
            ) : null}
          </div>

          <button
            className="primary full-width auth-submit"
            onClick={() => void submit()}
            disabled={disabled}
          >
            {busy
              ? "请稍候"
              : mode === "login"
                ? "登录"
                : mode === "register" ? "注册并登录" : "重设密码"}
          </button>
          {mode === "login" ? <button className="text-button auth-forgot" type="button" onClick={() => changeMode("forgot")}>忘记密码？</button>
            : mode === "forgot" ? <button className="text-button auth-forgot" type="button" onClick={() => changeMode("login")}>返回登录</button> : null}
          {localError || error ? (
            <p className="error-text" role="alert">
              {localError || error}
            </p>
          ) : null}
        </section>
        )}
      </main>
    </div>
  );
}
