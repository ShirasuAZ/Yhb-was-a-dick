import { useEffect, useState, type FormEvent } from "react";
import type { AuthAccount } from "@shared/protocol.ts";
import { profileConfig } from "../profileConfig.ts";

interface AboutPageProps {
  onBack: () => void;
  account?: AuthAccount | null;
  username?: string;
  busy?: boolean;
  error?: string;
  onLogout?: () => Promise<boolean>;
  onDeleteAccount?: (password: string) => Promise<boolean>;
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<boolean>;
  onSaveAvatar?: (file: File) => Promise<boolean>;
}

export function AboutPage({
  onBack,
  account = null,
  username,
  busy = false,
  error,
  onLogout,
  onDeleteAccount,
  onChangePassword,
  onSaveAvatar
}: AboutPageProps) {
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  const selectAvatar = (file?: File): void => {
    setNotice("");
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) {
      setNotice("请选择 3 MB 以内的 PNG、JPEG 或 WebP 图片。");
      return;
    }
    setAvatarFile(file);
  };

  const updatePassword = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setNotice("");
    if (newPassword !== confirmPassword) {
      setNotice("两次输入的新密码不一致。");
      return;
    }
    if (await onChangePassword?.(currentPassword, newPassword)) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("密码已更新，其他登录会话已失效。");
    }
  };

  const displayName = account?.username ?? username ?? "LayUDown 玩家";
  const avatarUrl = avatarPreview ?? account?.avatarUrl ?? null;

  return (
    <div className="about-page">
      <button className="secondary about-back" onClick={onBack}>返回大厅</button>
      <section className="panel about-panel" aria-labelledby="about-heading">
        <div className="about-heading-row">
          <div>
            <p className="eyebrow">个人资料</p>
            <h2 id="about-heading">我的</h2>
          </div>
          <span className="version-badge">LayUDown</span>
        </div>
        <div className="about-identity">
          {avatarUrl ? <img className="profile-avatar" src={avatarUrl} alt={`${displayName}的头像`} /> : <span className="profile-avatar profile-avatar-empty" aria-hidden="true">{displayName.slice(0, 1)}</span>}
          <div>
            <h3>{displayName}</h3>
            {account ? <p className="muted">账号 ID：{account.id}</p> : <p className="muted">登录后可管理头像和密码。</p>}
            {account?.email ? <p className="muted">{account.email}</p> : null}
          </div>
        </div>

        {account ? <div className="profile-settings">
          <section className="profile-setting" aria-labelledby="avatar-heading">
            <h3 id="avatar-heading">头像</h3>
            <div className="avatar-editor">
              <label className="secondary avatar-select" htmlFor="avatar-file">选择图片</label>
              <input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => selectAvatar(event.target.files?.[0])} />
              {avatarFile ? <span className="muted">{avatarFile.name}</span> : null}
              <button className="primary" disabled={!avatarFile || busy} onClick={async () => {
                if (avatarFile && await onSaveAvatar?.(avatarFile)) {
                  setAvatarFile(null);
                  setNotice("头像已保存。");
                }
              }}>保存头像</button>
            </div>
          </section>

          <section className="profile-setting" aria-labelledby="password-heading">
            <h3 id="password-heading">修改密码</h3>
            <form className="profile-form" onSubmit={(event) => void updatePassword(event)}>
              <label className="field-label" htmlFor="current-password">当前密码</label>
              <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
              <label className="field-label" htmlFor="new-password">新密码</label>
              <input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={72} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
              <label className="field-label" htmlFor="confirm-password">确认新密码</label>
              <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={72} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
              <button className="primary" disabled={busy}>更新密码</button>
            </form>
          </section>
        </div> : <a className="primary profile-login" href="/uno">前往登录</a>}

        {notice ? <p className="hint" role="status">{notice}</p> : null}
        {error ? <p className="error-text" role="alert">{error}</p> : null}

        {account && onLogout && onDeleteAccount ? <section className="about-account-actions" aria-label="账号操作">
          <button className="secondary" disabled={busy} onClick={async () => {
            if (window.confirm("确定退出登录吗？")) {
              if (await onLogout()) window.location.assign("/");
            }
          }}>退出登录</button>
          <button className="danger-button" disabled={busy} onClick={() => window.location.assign("/delete-account")}>注销账号</button>
        </section> : null}

        <details className="donation-section donation-disclosure">
          <summary id="donation-heading">向开发商赞助</summary>
          <div className="donation-list">
            <section className="donation-method" aria-labelledby="wechat-heading">
              <h4 id="wechat-heading">微信支付</h4>
              {profileConfig.wechatQr ? <img src={profileConfig.wechatQr} alt="微信支付收款码" /> : <p>尚未配置收款码</p>}
            </section>
            <section className="donation-method" aria-labelledby="alipay-heading">
              <h4 id="alipay-heading">支付宝</h4>
              {profileConfig.alipayQr ? <img src={profileConfig.alipayQr} alt="支付宝收款码" /> : <p>尚未配置收款码</p>}
            </section>
          </div>
        </details>
      </section>
    </div>
  );
}
