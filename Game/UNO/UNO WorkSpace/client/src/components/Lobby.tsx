import { useState } from "react";
import type { AuthAccount } from "@shared/protocol.ts";
import { ConnectionBadge } from "./ConnectionBadge.tsx";
import { ConnectHostPanel } from "./ConnectHostPanel.tsx";
import { VersionBadge } from "./VersionBadge.tsx";
import { ThemeControl } from "./ThemeControl.tsx";
import { LobbyProfile } from "./LobbyProfile.tsx";
import { AboutPage } from "./AboutPage.tsx";
import { FriendsPage } from "./FriendsPage.tsx";
import type { ConnectionStatus } from "../types.ts";

interface LobbyProps {
  account: AuthAccount;
  connection: ConnectionStatus;
  busy: boolean;
  error: string;
  inviteCode: string | null;
  onCreate: () => Promise<void>;
  onJoin: (roomCode: string) => Promise<void>;
  onLogout: () => Promise<boolean>;
  onDeleteAccount: (password: string) => Promise<boolean>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  onSaveAvatar: (file: File) => Promise<boolean>;
  clearError: () => void;
  gameMode: boolean;
  onBack: () => void;
}

export function Lobby({
  account,
  connection,
  busy,
  error,
  inviteCode,
  onCreate,
  onJoin,
  onLogout,
  onDeleteAccount,
  onChangePassword,
  onSaveAvatar,
  clearError,
  gameMode,
  onBack
}: LobbyProps) {
  const [roomCode, setRoomCode] = useState(inviteCode ?? "");
  const [myMenuOpen, setMyMenuOpen] = useState(false);

  const connected = connection === "connected";
  const disabled = busy || !connected;

  const create = async (): Promise<void> => {
    if (disabled) {
      return;
    }
    clearError();
    await onCreate();
  };

  const join = async (): Promise<void> => {
    if (disabled || roomCode.trim().length === 0) {
      return;
    }
    clearError();
    await onJoin(roomCode.trim().toUpperCase());
  };

  const aboutMode = window.location.pathname === "/about";

  return (
    <div className="app-shell lobby-shell">
      <header className="lobby-header">
        <div>
          <div className="my-menu-anchor">
            <button className="my-link" onClick={() => setMyMenuOpen((open) => !open)} aria-expanded={myMenuOpen} aria-haspopup="menu">
              {account.avatarUrl ? <img className="my-avatar-placeholder" src={account.avatarUrl} alt="" /> : <span className="my-avatar-placeholder" aria-hidden="true">{account.username.slice(0, 1)}</span>}
              <strong>我的</strong>
            </button>
            {myMenuOpen ? <div className="my-menu" role="menu"><a role="menuitem" href="/">主页</a><a role="menuitem" href="/friends">我的好友</a><a role="menuitem" href="/about">账号设置</a></div> : null}
          </div>
          {/* Keep LayUDown on the homepage and label the UNO route as UNO. */}
          <h1>{gameMode ? "UNO" : "LayUDown"}</h1>
        </div>
        <div className="lobby-account">
          <ConnectionBadge status={connection} />
          <span className="muted">
            已登录：<strong>{account.username}</strong>
          </span>
          <VersionBadge />
          <ThemeControl />
        </div>
      </header>

      <main className="lobby-main">
        {window.location.pathname === "/friends" ? <FriendsPage onBack={() => window.location.assign("/")} /> : aboutMode ? (
          <AboutPage onBack={() => window.location.assign("/")} account={account} onLogout={onLogout} onDeleteAccount={onDeleteAccount} onChangePassword={onChangePassword} onSaveAvatar={onSaveAvatar} error={error} busy={busy} />
        ) : gameMode ? (
          <div className="game-lobby-nav">
            <button className="secondary" onClick={onBack}>返回大厅</button>
          </div>
        ) : <LobbyProfile onEnterGame={() => window.location.assign("/uno")} />}

        {gameMode ? <ConnectHostPanel defaultOpen /> : null}

        {!aboutMode && gameMode && inviteCode ? (
          <section className="panel invite-panel" id="room-actions" aria-labelledby="invite-heading">
            <h2 id="invite-heading">加入房间 {inviteCode}</h2>
            <p className="muted">
              使用当前登录账号加入这个服务器房间。
            </p>
            <div className="button-row">
              <button className="primary" onClick={join} disabled={disabled}>
                加入房间
              </button>
              <button
                className="secondary"
                onClick={create}
                disabled={disabled}
              >
                创建新房间
              </button>
            </div>
          </section>
        ) : !aboutMode && gameMode ? (
          <div className="lobby-actions-grid" id="room-actions">
            <section className="panel" aria-labelledby="create-heading">
              <h2 id="create-heading">创建房间</h2>
              <p className="muted">生成唯一房间号，邀请 2 至 6 名玩家。</p>
              <button className="primary full-width" onClick={create} disabled={disabled}>
                创建房间
              </button>
            </section>

            <section className="panel" aria-labelledby="join-heading">
              <h2 id="join-heading">加入房间</h2>
              <label className="field-label" htmlFor="room-code">
                6 位房间号
              </label>
              <input
                id="room-code"
                value={roomCode}
                maxLength={6}
                autoCapitalize="characters"
                placeholder="例如 A7K9Q2"
                onChange={(event) =>
                  setRoomCode(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z2-9]/g, "")
                      .slice(0, 6)
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void join();
                  }
                }}
              />
              <button
                className="primary full-width"
                onClick={join}
                disabled={disabled || roomCode.length !== 6}
              >
                加入房间
              </button>
            </section>
          </div>
        ) : null}

        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
      </main>
    </div>
  );
}
