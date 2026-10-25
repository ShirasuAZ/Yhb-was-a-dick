import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import type { FriendProfile, FriendState, GameKind, InvitationView, RoomInvitation, RoomRole } from "../shared/social.ts";

export interface PublicAccount {
  id: string;
  username: string;
  createdAt: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface AuthResult {
  account: PublicAccount;
  token: string;
}

interface StoredAccount extends Omit<PublicAccount, "avatarUrl"> {
  email: string | null;
  passwordHash: string;
  passwordSalt: string;
  tokenVersion?: number;
  avatarKey?: string | null;
  pendingEmail?: { email: string; codeHash: string; expiresAt: number; attempts: number } | null;
}

interface AuthStore {
  version: 1;
  secret: string;
  accounts: StoredAccount[];
  friendships?: Record<string, string[]>;
  friendRequests?: Record<string, string[]>;
  roomInvitations?: RoomInvitation[];
}

interface AttemptBucket {
  count: number;
  resetAt: number;
}

export class AuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USERNAME_PATTERN = /^[\p{L}\p{N}_-]{2,16}$/u;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 72;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_FAILURES = 6;

function normalizeUsername(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new AuthError("INVALID_USERNAME", "请输入用户名");
  }
  const username = raw.normalize("NFC").trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new AuthError(
      "INVALID_USERNAME",
      "用户名需为 2 至 16 个字符，可使用文字、数字、下划线或短横线"
    );
  }
  return username;
}

function validatePassword(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new AuthError("INVALID_PASSWORD", "请输入密码");
  }
  if (
    raw.length < PASSWORD_MIN_LENGTH ||
    raw.length > PASSWORD_MAX_LENGTH
  ) {
    throw new AuthError(
      "INVALID_PASSWORD",
      `密码长度需为 ${PASSWORD_MIN_LENGTH} 至 ${PASSWORD_MAX_LENGTH} 个字符`
    );
  }
  return raw;
}

function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") throw new AuthError("INVALID_EMAIL", "请输入有效邮箱");
  const email = raw.trim().toLocaleLowerCase("en-US");
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new AuthError("INVALID_EMAIL", "请输入有效邮箱");
  }
  return email;
}

function publicAccount(account: StoredAccount): PublicAccount {
  return {
    id: account.id,
    username: account.username,
    createdAt: account.createdAt,
    email: account.email ?? null,
    avatarUrl: account.avatarKey ? `/api/avatars/${account.id}?v=${account.tokenVersion ?? 0}-${account.avatarKey.slice(-8)}` : null
  };
}

function emptyStore(): AuthStore {
  return {
    version: 1,
    secret: randomBytes(32).toString("base64url"),
    accounts: []
  };
}

export class AuthService {
  readonly dataDir: string;
  readonly dataFile: string;
  private readonly store: AuthStore;
  private readonly loginAttempts = new Map<string, AttemptBucket>();
  private lastStoreSignature = "";

  constructor(dataDir = process.env.UNO_DATA_DIR ?? path.resolve(process.cwd(), "data")) {
    this.dataDir = path.resolve(dataDir);
    this.dataFile = path.join(this.dataDir, "accounts.json");
    this.store = this.load();
    this.lastStoreSignature = this.storeSignature();
  }

  private ensureSocialStore(): { friendships: Record<string, string[]>; friendRequests: Record<string, string[]> } {
    this.reloadStoreIfChanged();
    this.store.friendships ??= {};
    this.store.friendRequests ??= {};
    return { friendships: this.store.friendships, friendRequests: this.store.friendRequests };
  }

  searchAccounts(query: unknown, excludeId?: string): PublicAccount[] {
    const text = typeof query === "string" ? query.trim().toLocaleLowerCase("en-US") : "";
    if (text.length < 1) return [];
    return this.store.accounts.filter((account) => account.id !== excludeId &&
      (account.id.toLocaleLowerCase("en-US") === text || account.username.toLocaleLowerCase("en-US").includes(text))).slice(0, 20).map(publicAccount);
  }

  socialState(accountId: string): FriendState {
    const { friendships, friendRequests } = this.ensureSocialStore();
    const ids = (friendships[accountId] ?? []).map((id) => this.findAccount(id)).filter((a): a is PublicAccount => !!a);
    const incoming = Object.entries(friendRequests).filter(([, list]) => list.includes(accountId)).map(([id]) => this.findAccount(id)).filter((a): a is PublicAccount => !!a);
    const outgoing = (friendRequests[accountId] ?? []).map((id) => this.findAccount(id)).filter((a): a is PublicAccount => !!a);
    const safe = (account: PublicAccount): FriendProfile => ({ id: account.id, username: account.username, avatarUrl: account.avatarUrl });
    return { friends: ids.map(safe), incoming: incoming.map(safe), outgoing: outgoing.map(safe) };
  }

  sendFriendRequest(fromId: string, target: unknown): void {
    const { friendships, friendRequests } = this.ensureSocialStore();
    const raw = typeof target === "string" ? target.trim() : "";
    const account = this.store.accounts.find((candidate) => candidate.id === raw || candidate.username.toLocaleLowerCase("en-US") === raw.toLocaleLowerCase("en-US"));
    if (!account) throw new AuthError("ACCOUNT_NOT_FOUND", "用户不存在");
    if (account.id === fromId) throw new AuthError("INVALID_TARGET", "不能添加自己");
    if ((friendships[fromId] ?? []).includes(account.id)) throw new AuthError("ALREADY_FRIEND", "你们已经是好友");
    const list = friendRequests[fromId] ?? (friendRequests[fromId] = []);
    if (list.includes(account.id)) throw new AuthError("REQUEST_EXISTS", "好友申请已发送");
    const reverse = friendRequests[account.id] ?? [];
    if (reverse.includes(fromId)) { this.acceptFriendRequest(fromId, account.id); return; }
    list.push(account.id); this.persist();
  }

  acceptFriendRequest(accountId: string, requesterId: unknown): void {
    const { friendships, friendRequests } = this.ensureSocialStore();
    const other = typeof requesterId === "string" ? requesterId : "";
    if (!this.store.accounts.some((a) => a.id === other)) throw new AuthError("ACCOUNT_NOT_FOUND", "用户不存在");
    const pending = friendRequests[other] ?? [];
    if (!pending.includes(accountId)) throw new AuthError("REQUEST_NOT_FOUND", "好友申请不存在");
    friendRequests[other] = pending.filter((id) => id !== accountId);
    friendships[accountId] = Array.from(new Set([...(friendships[accountId] ?? []), other]));
    friendships[other] = Array.from(new Set([...(friendships[other] ?? []), accountId]));
    this.persist();
  }

  rejectFriendRequest(accountId: string, requesterId: unknown): void {
    const { friendRequests } = this.ensureSocialStore();
    const other = typeof requesterId === "string" ? requesterId : "";
    friendRequests[other] = (friendRequests[other] ?? []).filter((id) => id !== accountId);
    this.persist();
  }

  areFriends(left: string, right: string): boolean {
    const { friendships } = this.ensureSocialStore();
    return (friendships[left] ?? []).includes(right);
  }

  inviteFriend(fromId: string, toId: string, game: GameKind, roomCode: string, role: RoomRole): void {
    if (!this.areFriends(fromId, toId)) throw new AuthError("NOT_FRIENDS", "只能邀请已添加的好友");
    if (!this.findAccount(toId)) throw new AuthError("ACCOUNT_NOT_FOUND", "好友账号已不存在");
    const now = Date.now();
    const invitations = (this.store.roomInvitations ?? []).filter((invite) => invite.expiresAt > now);
    if (invitations.some((invite) => invite.fromId === fromId && invite.toId === toId && now - invite.createdAt < 10000)) throw new AuthError("INVITE_TOO_FREQUENT", "刚刚已发送邀请，请稍后再试");
    this.store.roomInvitations = invitations.filter((invite) => !(invite.fromId === fromId && invite.toId === toId && invite.game === game && invite.roomCode === roomCode));
    this.store.roomInvitations.push({ id: randomUUID(), fromId, toId, game, roomCode, role, createdAt: now, expiresAt: now + 15 * 60 * 1000 });
    this.persist();
  }

  invitationsFor(accountId: string): InvitationView[] {
    this.reloadStoreIfChanged();
    return (this.store.roomInvitations ?? []).filter((invite) => invite.toId === accountId && invite.expiresAt > Date.now()).slice(-30).map((invite) => ({ ...invite, inviter: this.findAccount(invite.fromId)?.username ?? "好友" }));
  }

  dismissInvitation(accountId: string, invitationId: string): void {
    this.reloadStoreIfChanged();
    this.store.roomInvitations = (this.store.roomInvitations ?? []).filter((invite) => !(invite.toId === accountId && invite.id === invitationId));
    this.persist();
  }

  register(
    rawUsername: unknown,
    rawPassword: unknown,
    rawEmail: unknown = `legacy-${String(rawUsername)}@invalid.local`,
    clientKey = "unknown"
  ): AuthResult {
    const username = normalizeUsername(rawUsername);
    const password = validatePassword(rawPassword);
    const email = normalizeEmail(rawEmail);
    if (
      this.store.accounts.some(
        (account) =>
          account.username.toLocaleLowerCase("en-US") ===
          username.toLocaleLowerCase("en-US")
      )
    ) {
      throw new AuthError("USERNAME_TAKEN", "该用户名已被注册");
    }
    if (this.store.accounts.some((account) => account.email?.toLocaleLowerCase("en-US") === email)) {
      throw new AuthError("EMAIL_TAKEN", "该邮箱已被注册");
    }

    const passwordSalt = randomBytes(16).toString("base64url");
    const account: StoredAccount = {
      id: randomUUID(),
      username,
      email,
      createdAt: new Date().toISOString(),
      passwordSalt,
      passwordHash: this.hashPassword(password, passwordSalt)
    };
    this.store.accounts.push(account);
    try {
      this.persist();
    } catch (error) {
      this.store.accounts.pop();
      throw error;
    }
    this.loginAttempts.delete(this.attemptKey(clientKey, username));
    return {
      account: publicAccount(account),
      token: this.issueToken(account)
    };
  }

  changePassword(accountId: string, rawCurrentPassword: unknown, rawNewPassword: unknown): AuthResult {
    const currentPassword = validatePassword(rawCurrentPassword);
    const newPassword = validatePassword(rawNewPassword);
    const account = this.requireAccount(accountId);
    if (!this.verifyPassword(currentPassword, account)) throw new AuthError("INVALID_PASSWORD", "当前密码错误");
    const previous = { passwordSalt: account.passwordSalt, passwordHash: account.passwordHash, tokenVersion: account.tokenVersion };
    account.passwordSalt = randomBytes(16).toString("base64url");
    account.passwordHash = this.hashPassword(newPassword, account.passwordSalt);
    account.tokenVersion = (account.tokenVersion ?? 0) + 1;
    try {
      this.persist();
    } catch (error) {
      Object.assign(account, previous);
      throw error;
    }
    return { account: publicAccount(account), token: this.issueToken(account) };
  }

  async beginEmailChange(accountId: string, rawCurrentPassword: unknown, rawEmail: unknown): Promise<void> {
    const account = this.requireAccount(accountId);
    const currentPassword = validatePassword(rawCurrentPassword);
    const email = normalizeEmail(rawEmail);
    if (!this.verifyPassword(currentPassword, account)) throw new AuthError("INVALID_PASSWORD", "当前密码错误");
    if (email === account.email) throw new AuthError("EMAIL_UNCHANGED", "新邮箱与当前邮箱相同");
    if (this.store.accounts.some((candidate) => candidate.id !== accountId && candidate.email === email)) {
      throw new AuthError("EMAIL_TAKEN", "该邮箱已被其他账号使用");
    }

    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASSWORD;
    const from = process.env.SMTP_FROM?.trim();
    if (!host || !user || !pass || !from) throw new AuthError("EMAIL_SERVICE_UNAVAILABLE", "服务器尚未配置邮件发送服务，邮箱未修改");
    const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
    const codeHash = createHmac("sha256", this.secret()).update(`${accountId}:${email}:${code}`).digest("hex");
    const previous = account.pendingEmail;
    account.pendingEmail = { email, codeHash, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 };
    try {
      await this.persist();
      const port = Number(process.env.SMTP_PORT ?? 587);
      const transport = nodemailer.createTransport({ host, port, secure: process.env.SMTP_SECURE === "true", auth: { user, pass } });
      await transport.sendMail({ from, to: email, subject: "LayUDown 邮箱验证码", text: `你的 LayUDown 邮箱修改验证码是 ${code}，10 分钟内有效。` });
    } catch (error) {
      account.pendingEmail = previous ?? null;
      this.persist();
      if (error instanceof AuthError) throw error;
      throw new AuthError("EMAIL_DELIVERY_FAILED", "验证码邮件发送失败，邮箱未修改");
    }
  }

  verifyEmailChange(accountId: string, rawCode: unknown): PublicAccount {
    const account = this.requireAccount(accountId);
    const pending = account.pendingEmail;
    if (!pending || pending.expiresAt <= Date.now()) {
      account.pendingEmail = null;
      this.persist();
      throw new AuthError("EMAIL_CODE_EXPIRED", "验证码不存在或已过期");
    }
    if (typeof rawCode !== "string" || !/^\d{6}$/.test(rawCode) || pending.attempts >= 5) {
      throw new AuthError("INVALID_EMAIL_CODE", "验证码无效或尝试次数过多");
    }
    const supplied = createHmac("sha256", this.secret()).update(`${accountId}:${pending.email}:${rawCode}`).digest();
    const expected = Buffer.from(pending.codeHash, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      pending.attempts += 1;
      this.persist();
      throw new AuthError("INVALID_EMAIL_CODE", "验证码不正确");
    }
    if (this.store.accounts.some((candidate) => candidate.id !== accountId && candidate.email === pending.email)) {
      account.pendingEmail = null;
      this.persist();
      throw new AuthError("EMAIL_TAKEN", "该邮箱已被其他账号使用");
    }
    account.email = pending.email;
    account.pendingEmail = null;
    this.persist();
    return publicAccount(account);
  }

  revokeSessions(accountId: string): void {
    const account = this.requireAccount(accountId);
    account.tokenVersion = (account.tokenVersion ?? 0) + 1;
    this.persist();
  }

  setAvatarKey(accountId: string, avatarKey: string | null): PublicAccount {
    const account = this.requireAccount(accountId);
    const previous = account.avatarKey;
    account.avatarKey = avatarKey;
    try {
      this.persist();
    } catch (error) {
      account.avatarKey = previous;
      throw error;
    }
    return publicAccount(account);
  }

  getAvatarKey(accountId: string): string | null {
    return this.store.accounts.find((account) => account.id === accountId)?.avatarKey ?? null;
  }

  deleteAvatarFile(accountId: string): void {
    const account = this.store.accounts.find((candidate) => candidate.id === accountId);
    if (account?.avatarKey) fs.rmSync(path.join(this.dataDir, "avatars", account.avatarKey), { force: true });
  }

  login(
    rawUsername: unknown,
    rawPassword: unknown,
    clientKey = "unknown"
  ): AuthResult {
    const username = normalizeUsername(rawUsername);
    const password = validatePassword(rawPassword);
    const attemptKey = this.attemptKey(clientKey, username);
    this.assertLoginAllowed(attemptKey);
    const account = this.store.accounts.find(
      (candidate) =>
        candidate.username.toLocaleLowerCase("en-US") ===
        username.toLocaleLowerCase("en-US")
    );
    if (!account || !this.verifyPassword(password, account)) {
      this.recordLoginFailure(attemptKey);
      throw new AuthError("INVALID_CREDENTIALS", "用户名或密码错误");
    }
    this.loginAttempts.delete(attemptKey);
    return {
      account: publicAccount(account),
      token: this.issueToken(account)
    };
  }

  resetPassword(rawUsername: unknown, rawEmail: unknown, rawPassword: unknown, clientKey = "unknown"): void {
    const username = normalizeUsername(rawUsername);
    const email = normalizeEmail(rawEmail);
    const password = validatePassword(rawPassword);
    const key = this.attemptKey(clientKey, `reset:${username}`);
    this.assertLoginAllowed(key);
    const account = this.store.accounts.find((candidate) =>
      candidate.username.toLocaleLowerCase("en-US") === username.toLocaleLowerCase("en-US") &&
      candidate.email?.toLocaleLowerCase("en-US") === email
    );
    if (!account) {
      this.recordLoginFailure(key);
      throw new AuthError("ACCOUNT_NOT_FOUND", "用户名或邮箱不匹配");
    }
    const passwordSalt = randomBytes(16).toString("base64url");
    const previous = { passwordSalt: account.passwordSalt, passwordHash: account.passwordHash, tokenVersion: account.tokenVersion };
    account.passwordSalt = passwordSalt;
    account.passwordHash = this.hashPassword(password, passwordSalt);
    account.tokenVersion = (account.tokenVersion ?? 0) + 1;
    try {
      this.persist();
      this.loginAttempts.delete(key);
    } catch (error) {
      Object.assign(account, previous);
      throw error;
    }
  }

  deleteAccount(accountId: string, rawPassword: unknown): void {
    const password = validatePassword(rawPassword);
    const index = this.store.accounts.findIndex((account) => account.id === accountId);
    const account = this.store.accounts[index];
    if (!account || !this.verifyPassword(password, account)) {
      throw new AuthError("INVALID_PASSWORD", "密码错误，账号未注销");
    }
    this.store.accounts.splice(index, 1);
    try {
      this.persist();
      if (account.avatarKey) fs.rmSync(path.join(this.dataDir, "avatars", account.avatarKey), { force: true });
    } catch (error) {
      this.store.accounts.splice(index, 0, account);
      throw error;
    }
  }

  private requireAccount(accountId: string): StoredAccount {
    const account = this.store.accounts.find((candidate) => candidate.id === accountId);
    if (!account) throw new AuthError("ACCOUNT_NOT_FOUND", "账号不存在");
    return account;
  }

  verifyToken(token: unknown): PublicAccount | null {
    return this.verifyTokenSession(token)?.account ?? null;
  }

  verifyTokenSession(token: unknown): { account: PublicAccount; expiresAt: number } | null {
    try {
      this.reloadStoreIfChanged();
    } catch {
      return null;
    }
    if (typeof token !== "string" || token.length > 2048) {
      return null;
    }
    const parts = token.split(".");
    if (parts.length !== 2) {
      return null;
    }
    const [payloadPart, signaturePart] = parts;
    if (!payloadPart || !signaturePart) {
      return null;
    }
    const expectedSignature = createHmac("sha256", this.secret())
      .update(payloadPart)
      .digest();
    let actualSignature: Buffer;
    try {
      actualSignature = Buffer.from(signaturePart, "base64url");
    } catch {
      return null;
    }
    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      return null;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(
        Buffer.from(payloadPart, "base64url").toString("utf8")
      );
    } catch {
      return null;
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("sub" in payload) ||
      !("exp" in payload)
    ) {
      return null;
    }
    const subject = (payload as { sub?: unknown }).sub;
    const expiresAt = (payload as { exp?: unknown }).exp;
    if (
      typeof subject !== "string" ||
      typeof expiresAt !== "number" ||
      expiresAt <= Date.now()
    ) {
      return null;
    }
    const account = this.store.accounts.find(
      (candidate) => candidate.id === subject
    );
    if (account && ((payload as { tv?: unknown }).tv ?? 0) !== (account.tokenVersion ?? 0)) return null;
    return account ? { account: publicAccount(account), expiresAt } : null;
  }

  findAccount(accountId: string | undefined): PublicAccount | null {
    if (!accountId) {
      return null;
    }
    const account = this.store.accounts.find(
      (candidate) => candidate.id === accountId
    );
    return account ? publicAccount(account) : null;
  }

  private load(): AuthStore {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.dataFile)) {
      const store = emptyStore();
      fs.writeFileSync(
        this.dataFile,
        JSON.stringify(store, null, 2),
        { encoding: "utf8", mode: 0o600 }
      );
      return store;
    }
    const parsed = JSON.parse(
      fs.readFileSync(this.dataFile, "utf8")
    ) as Partial<AuthStore>;
    if (
      parsed.version !== 1 ||
      typeof parsed.secret !== "string" ||
      parsed.secret.length < 20 ||
      !Array.isArray(parsed.accounts)
    ) {
      throw new Error(`Invalid account store: ${this.dataFile}`);
    }
    return parsed as AuthStore;
  }

  private persist(): void {
    const tempFile = `${this.dataFile}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(this.store, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    fs.renameSync(tempFile, this.dataFile);
    this.lastStoreSignature = this.storeSignature();
  }

  private storeSignature(): string {
    const stat = fs.statSync(this.dataFile);
    return `${stat.mtimeMs}:${stat.size}`;
  }

  private reloadStoreIfChanged(): void {
    const signature = this.storeSignature();
    if (signature === this.lastStoreSignature) return;
    const parsed = JSON.parse(fs.readFileSync(this.dataFile, "utf8")) as Partial<AuthStore>;
    if (
      parsed.version !== 1 ||
      typeof parsed.secret !== "string" ||
      parsed.secret.length < 20 ||
      !Array.isArray(parsed.accounts)
    ) {
      throw new Error("Invalid account store");
    }
    this.store.secret = parsed.secret;
    this.store.accounts = parsed.accounts;
    this.store.friendships = parsed.friendships;
    this.store.friendRequests = parsed.friendRequests;
    this.store.roomInvitations = parsed.roomInvitations;
    this.lastStoreSignature = signature;
  }

  private hashPassword(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString("hex");
  }

  private verifyPassword(password: string, account: StoredAccount): boolean {
    const actual = Buffer.from(
      this.hashPassword(password, account.passwordSalt),
      "hex"
    );
    const expected = Buffer.from(account.passwordHash, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  private secret(): Buffer {
    return Buffer.from(this.store.secret, "base64url");
  }

  private issueToken(account: StoredAccount): string {
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        sub: account.id,
        usr: account.username,
        tv: account.tokenVersion ?? 0,
        exp: Date.now() + TOKEN_TTL_MS
      })
    ).toString("base64url");
    const signature = createHmac("sha256", this.secret())
      .update(payload)
      .digest("base64url");
    return `${payload}.${signature}`;
  }

  private attemptKey(clientKey: string, username: string): string {
    return `${createHash("sha256")
      .update(clientKey)
      .digest("hex")
      .slice(0, 16)}:${username.toLocaleLowerCase("en-US")}`;
  }

  private assertLoginAllowed(key: string): void {
    const bucket = this.loginAttempts.get(key);
    if (!bucket) {
      return;
    }
    if (bucket.resetAt <= Date.now()) {
      this.loginAttempts.delete(key);
      return;
    }
    if (bucket.count >= LOGIN_MAX_FAILURES) {
      throw new AuthError(
        "TOO_MANY_ATTEMPTS",
        "登录失败次数过多，请稍后再试"
      );
    }
  }

  private recordLoginFailure(key: string): void {
    const current = this.loginAttempts.get(key);
    if (!current || current.resetAt <= Date.now()) {
      this.loginAttempts.set(key, {
        count: 1,
        resetAt: Date.now() + LOGIN_WINDOW_MS
      });
      return;
    }
    current.count += 1;
  }
}
