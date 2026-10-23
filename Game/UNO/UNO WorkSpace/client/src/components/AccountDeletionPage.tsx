import { useState } from "react";

export function AccountDeletionPage({ username, error, busy, onDelete }: {
  username: string;
  error: string;
  busy: boolean;
  onDelete: (password: string) => Promise<boolean>;
}) {
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  return <main className="app-shell account-deletion-shell">
    <button className="secondary" onClick={() => window.location.assign("/about")}>返回关于我</button>
    <section className="panel account-deletion-panel" aria-labelledby="delete-account-heading">
      <p className="eyebrow">账号安全</p>
      <h1 id="delete-account-heading">注销账号</h1>
      <p>将永久删除账号 <strong>{username}</strong> 及其登录凭据。此操作无法撤销。</p>
      <label className="field-label" htmlFor="delete-account-password">输入当前密码</label>
      <input id="delete-account-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <label className="delete-confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我了解注销后无法恢复账号</label>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <button className="danger-button" disabled={busy || password.length < 8 || !confirmed} onClick={() => {
        if (window.confirm("最后确认：永久注销此账号？")) void onDelete(password);
      }}>{busy ? "正在注销…" : "确认注销账号"}</button>
    </section>
  </main>;
}
