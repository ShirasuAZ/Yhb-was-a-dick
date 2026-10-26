import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AuthAccount } from "@shared/protocol.ts";
import { profileConfig } from "../profileConfig.ts";
import { AvatarCropper } from "./AvatarCropper.tsx";
import { ThemeControl } from "./ThemeControl.tsx";

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

/**
 * Settings opened from inside a game keep a way back to that game instead of the site's home. The list is an allowlist of
 * the pages that may be returned to, so the query string can never send a player somewhere arbitrary.
 */
const RETURN_TARGETS: Record<string, { label: string; path: string }> = {
  "arknights-pvp": { label: "返回对局", path: "/arknights-union-arena/pvp" },
  "arknights-ai": { label: "返回对局", path: "/arknights-union-arena/ai" },
  "arknights-tutorial": { label: "返回教程", path: "/arknights-union-arena/tutorial" },
  "uno-lobby": { label: "返回游戏", path: "/uno" },
  "uno-room": { label: "返回房间", path: "/uno" },
  shogi: { label: "返回对局", path: "/shogi" }
};

/** The way back this page offers: the game it was opened from, else the site's home. */
function returnTarget(): { label: string; path: string } {
  const from = new URLSearchParams(window.location.search).get("from") ?? "";
  return RETURN_TARGETS[from] ?? { label: "返回主页", path: "/" };
}

/** What the avatar editor takes, and how big the file may be before cropping. */
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"];
const ACCEPTED_EXTENSIONS = /\.(png|jpe?g|webp|gif|avif|heic|heif)$/i;
/** Phones may report no type at all, or a type the browser cannot decode; the server decodes and re-encodes to WebP anyway. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/** Whether a picked file may be used as an avatar source, judged by MIME type *and* by extension. */
function isImageFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (!type) return ACCEPTED_EXTENSIONS.test(file.name);
  if (ACCEPTED_TYPES.includes(type)) return true;
  // Some Android pickers report "application/octet-stream" for a real PNG: fall back to the extension.
  return (type === "application/octet-stream" || type.startsWith("image/")) && ACCEPTED_EXTENSIONS.test(file.name);
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
  /** The picked picture, before cropping. */
  const [cropSource, setCropSource] = useState<{ file: File; url: string } | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  // The source file's URL lives as long as the cropper does.
  useEffect(() => {
    if (!cropSource) return undefined;
    return () => URL.revokeObjectURL(cropSource.url);
  }, [cropSource]);

  const resetPicker = (): void => {
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /**
   * A picked picture goes to the cropper first — never straight to the server — so the saved avatar is a square
   * the player chose rather than a 512×512 crop taken from the middle of a photo.
   */
  const selectAvatar = (file?: File): void => {
    setNotice("");
    if (!file) return;
    if (!isImageFile(file)) {
      setNotice("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片（iPhone 的 HEIC 请先在相册里导出为 JPEG）。");
      resetPicker();
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setNotice(`图片为 ${(file.size / 1024 / 1024).toFixed(0)} MB，超过 20 MB，请先压缩后再试。`);
      resetPicker();
      return;
    }
    setCropSource({ file, url: URL.createObjectURL(file) });
    resetPicker();
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

  const back = returnTarget();
  const displayName = account?.username ?? username ?? "LayUDown 玩家";
  const avatarUrl = avatarPreview ?? account?.avatarUrl ?? null;

  return (
    <div className="about-page">
      {/* Opened from a game, this returns to that game (never to the home page or an old room); otherwise to the home page. */}
      {back.label === "返回主页"
        ? <a className="secondary about-back" href={back.path} onClick={(event) => { event.preventDefault(); onBack(); }}>{back.label}</a>
        : <a className="secondary about-back" href={back.path}>{back.label}</a>}
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
            {account ? <p className="muted">账号 ID：{account.id}</p> : <p className="muted">还没有登录。登录后即可设置头像、修改密码。</p>}
            {account?.email ? <p className="muted">{account.email}</p> : null}
          </div>
        </div>

        {/* Appearance: the one place the site's light and dark themes are switched. The choice is stored the same way
            it always was, so the homepage, every game, the lobby and the rooms all follow it. */}
        <div className="profile-settings">
          <section className="profile-setting" aria-labelledby="theme-heading">
            <h3 id="theme-heading">外观</h3>
            <div className="theme-setting">
              <ThemeControl />
              <span className="muted">跟随系统、浅色或深色，全站同时生效。</span>
            </div>
          </section>
        </div>

        {account ? <div className="profile-settings">
          <section className="profile-setting" aria-labelledby="avatar-heading">
            <h3 id="avatar-heading">头像</h3>
            <div className="avatar-editor">
              {/* A real button that opens the picker directly: on some mobile browsers a label pointing
                  at a display-hidden input does not open the photo library. */}
              <button type="button" className="secondary avatar-select" onClick={() => fileInputRef.current?.click()}>选择图片</button>
              <input ref={fileInputRef} id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,.png,.jpg,.jpeg,.webp,.gif,.avif" onChange={(event) => selectAvatar(event.target.files?.[0])} />
              {avatarFile ? <span className="muted">{avatarFile.name}</span> : null}
              <button className="primary" disabled={!avatarFile || busy} onClick={async () => {
                if (avatarFile && await onSaveAvatar?.(avatarFile)) {
                  setAvatarFile(null);
                  setNotice("头像已保存。");
                }
              }}>{busy ? "保存中…" : "保存头像"}</button>
            </div>
            <p className="muted">支持 PNG、JPEG、WebP 等常见格式，20 MB 以内；手机上会打开相册或拍照。选好图片后可以先裁剪。</p>
            {notice ? <p className="hint" role="status">{notice}</p> : null}
            {error ? <p className="error-text" role="alert">{error}</p> : null}
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
      {cropSource ? <AvatarCropper file={cropSource.file} sourceUrl={cropSource.url}
        onCancel={() => setCropSource(null)}
        onDone={(cropped) => {
          // The cropped square replaces the picked file; saving then uploads exactly what the player saw.
          setCropSource(null);
          setAvatarFile(cropped);
          setNotice("已裁剪，确认后点『保存头像』。");
        }} /> : null}
    </div>
  );
}
