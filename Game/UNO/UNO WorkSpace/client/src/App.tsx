import { useEffect, useState } from "react";
import { useUnoSession } from "./session.ts";
import { AuthScreen } from "./components/AuthScreen.tsx";
import { GameScreen } from "./components/GameScreen.tsx";
import { Lobby } from "./components/Lobby.tsx";
import { WaitingRoom } from "./components/WaitingRoom.tsx";
import { ShogiApp } from "./components/ShogiApp.tsx";
import { AccountDeletionPage } from "./components/AccountDeletionPage.tsx";
import { ArknightsRoot } from "@arknights/ArknightsRoot.tsx";
import { LobbyProfile } from "./components/LobbyProfile.tsx";
import { ThemeControl } from "./components/ThemeControl.tsx";
import { VersionBadge } from "./components/VersionBadge.tsx";
import { ConnectionBadge } from "./components/ConnectionBadge.tsx";
import { socket } from "./socket.ts";
import type { ConnectionStatus } from "./types.ts";

export function App() {
  if (window.location.pathname === "/shogi" || window.location.pathname.startsWith("/shogi/")) {
    return <ShogiApp />;
  }
  if (window.location.pathname === "/arknights-union-arena" || window.location.pathname.startsWith("/arknights-union-arena/")) {
    return <ArknightsEntry />;
  }
  if (window.location.pathname === "/" && !localStorage.getItem("uno.accountToken")) {
    return <PublicHome />;
  }
  return <UnoApp />;
}

function PublicHome() {
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  useEffect(() => {
    const onConnect = (): void => setConnection("connected");
    const onDisconnect = (): void => setConnection("disconnected");
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (!socket.connected) socket.connect();
    else onConnect();
    return () => { socket.off("connect", onConnect); socket.off("disconnect", onDisconnect); };
  }, []);
  return <div className="app-shell lobby-shell">
    <header className="lobby-header">
      <div><h1>LayUDown</h1><p className="eyebrow">游戏大厅</p></div>
      <nav className="lobby-account" aria-label="主导航">
        <a className="my-link" href="/about"><span className="my-avatar-placeholder" aria-hidden="true">?</span><strong>我的</strong></a>
        <ConnectionBadge status={connection} />
        <ThemeControl /><VersionBadge />
      </nav>
    </header>
    <main className="lobby-main"><LobbyProfile onEnterGame={() => window.location.assign("/uno")} /></main>
  </div>;
}

function ArknightsEntry() {
  const session = useUnoSession();
  if (session.booting) return <div className="app-shell loading-shell"><p className="muted">正在连接明日方舟对战服务</p></div>;
  if (!session.account) {
    return <AuthScreen connection={session.connection} busy={session.busy} error={session.error} inviteCode={null}
      onLogin={session.login} onRegister={session.register} onResetPassword={session.resetPassword} clearError={() => session.setError("")} />;
  }
  return <ArknightsRoot account={session.account} token={session.accountToken} />;
}

function UnoApp() {
  const session = useUnoSession();

  if (session.booting) {
    return (
      <div className="app-shell loading-shell">
        <p className="muted">正在连接房间服务器</p>
      </div>
    );
  }

  if (!session.account) {
    return (
      <AuthScreen
        connection={session.connection}
        busy={session.busy}
        error={session.error}
        inviteCode={session.inviteCode}
        onLogin={async (username, password) => {
          const loggedIn = await session.login(username, password);
          if (loggedIn && window.location.pathname === "/uno") {
            window.location.assign("/");
          }
          return loggedIn;
        }}
        onRegister={async (username, email, password) => {
          const registered = await session.register(username, email, password);
          if (registered && window.location.pathname === "/uno") {
            window.location.assign("/");
          }
          return registered;
        }}
        onResetPassword={session.resetPassword}
        clearError={() => session.setError("")}
      />
    );
  }

  if (window.location.pathname === "/delete-account") {
    return <AccountDeletionPage username={session.account.username} error={session.error} busy={session.busy} onDelete={session.deleteAccount} />;
  }

  if (!session.room) {
    return (
      <Lobby
        account={session.account}
        connection={session.connection}
        busy={session.busy}
        error={session.error}
        inviteCode={session.inviteCode}
        onCreate={session.createRoom}
        onJoin={session.joinRoom}
        onLogout={session.logout}
        onDeleteAccount={session.deleteAccount}
        onChangePassword={session.changePassword}
        onSaveAvatar={session.saveAvatar}
        clearError={() => session.setError("")}
        gameMode={window.location.pathname === "/uno" || window.location.pathname.startsWith("/room/")}
        onBack={() => window.location.assign("/")}
      />
    );
  }

  if (session.room.phase === "lobby") {
    return (
      <WaitingRoom
        room={session.room}
        connection={session.connection}
        busy={session.busy}
        error={session.error}
        lanStatus={session.lanStatus}
        perform={session.perform}
        leaveRoom={session.leaveRoom}
        onToggleLan={session.setLanAccess}
        onRefreshLan={session.refreshLanStatus}
        setError={session.setError}
      />
    );
  }

  return (
    <GameScreen
      room={session.room}
      connection={session.connection}
      busy={session.busy}
      error={session.error}
      emotes={session.emotes}
      perform={session.perform}
      sendEmote={session.sendEmote}
      leaveRoom={session.leaveRoom}
    />
  );
}
