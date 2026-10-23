import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AuthError, AuthService } from "../../server/auth.ts";

function tempAuth(): AuthService {
  return new AuthService(
    mkdtempSync(path.join(os.tmpdir(), "uno-auth-unit-"))
  );
}

function expectAuthError(action: () => void, code: string): void {
  try {
    action();
    throw new Error(`Expected AuthError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe(code);
  }
}

describe("account authentication", () => {
  it("registers, logs in, and verifies a signed token", () => {
    const auth = tempAuth();
    const registered = auth.register("Alice_1", "Password123", "alice@example.com", "127.0.0.1");
    expect(registered.account.username).toBe("Alice_1");
    expect(registered.token.length).toBeGreaterThan(40);
    expect(auth.verifyToken(registered.token)?.id).toBe(registered.account.id);

    const loggedIn = auth.login("alice_1", "Password123", "127.0.0.1");
    expect(loggedIn.account.id).toBe(registered.account.id);
    expect(auth.verifyToken(`${loggedIn.token}x`)).toBeNull();
    expect(auth.verifyToken("not-a-token")).toBeNull();
    expect(auth.verifyTokenSession(loggedIn.token)?.expiresAt).toBeGreaterThan(Date.now());
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(auth.verifyToken(loggedIn.token)).toBeNull();
    vi.useRealTimers();
  });

  it("rejects duplicate names, invalid names, and wrong passwords", () => {
    const auth = tempAuth();
    auth.register("Alice_1", "Password123", "alice@example.com", "127.0.0.1");
    expectAuthError(
      () => auth.register("alice_1", "Password123", "other@example.com", "127.0.0.1"),
      "USERNAME_TAKEN"
    );
    expectAuthError(
      () => auth.register("x", "Password123", "x@example.com", "127.0.0.1"),
      "INVALID_USERNAME"
    );
    expectAuthError(
      () => auth.login("Alice_1", "WrongPass123", "127.0.0.1"),
      "INVALID_CREDENTIALS"
    );
  });

  it("persists accounts without storing plaintext passwords", () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "uno-auth-persist-"));
    const auth = new AuthService(dataDir);
    const result = auth.register("持久玩家", "Password123", "persist@example.com", "host");
    const raw = readFileSync(auth.dataFile, "utf8");
    expect(raw).not.toContain("Password123");
    expect(raw).toContain("passwordHash");

    const reloaded = new AuthService(dataDir);
    const login = reloaded.login("持久玩家", "Password123", "host");
    expect(login.account.id).toBe(result.account.id);
    expect(reloaded.verifyToken(result.token)?.username).toBe("持久玩家");
  });

  it("refreshes signed account sessions when another service process adds an account", () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "uno-auth-shared-"));
    const shogiAuth = new AuthService(dataDir);
    const unoAuth = new AuthService(dataDir);
    const account = unoAuth.register("CrossProcess", "Password123!");
    expect(shogiAuth.verifyToken(account.token)?.id).toBe(account.account.id);
  });

  it("rate limits repeated failed logins", () => {
    const auth = tempAuth();
    auth.register("RateLimit", "Password123", "rate@example.com", "10.0.0.1");
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expectAuthError(
        () => auth.login("RateLimit", "WrongPass123", "10.0.0.1"),
        "INVALID_CREDENTIALS"
      );
    }
    expectAuthError(
      () => auth.login("RateLimit", "Password123", "10.0.0.1"),
      "TOO_MANY_ATTEMPTS"
    );
  });

  it("resets a password only for the matching username and email and revokes prior tokens", () => {
    const auth = tempAuth();
    const registered = auth.register("Recovery", "Password123", "recover@example.com");
    expectAuthError(() => auth.resetPassword("Recovery", "wrong@example.com", "NewPassword123"), "ACCOUNT_NOT_FOUND");
    auth.resetPassword("Recovery", "RECOVER@example.com", "NewPassword123");
    expect(auth.verifyToken(registered.token)).toBeNull();
    expect(auth.login("Recovery", "NewPassword123").account.id).toBe(registered.account.id);
  });

  it("requires the current password to change credentials and revokes old sessions", () => {
    const auth = tempAuth();
    const registered = auth.register("ProfilePass", "Password123", "profile@example.com");
    expectAuthError(() => auth.changePassword(registered.account.id, "WrongPassword123", "NewPassword123"), "INVALID_PASSWORD");
    const changed = auth.changePassword(registered.account.id, "Password123", "NewPassword123");
    expect(auth.verifyToken(registered.token)).toBeNull();
    expect(auth.verifyToken(changed.token)?.id).toBe(registered.account.id);
    expect(auth.login("ProfilePass", "NewPassword123").account.id).toBe(registered.account.id);
  });

  it("does not claim to start email verification when SMTP is missing", async () => {
    const auth = tempAuth();
    const registered = auth.register("ProfileEmail", "Password123", "profile-mail@example.com");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASSWORD", "");
    vi.stubEnv("SMTP_FROM", "");
    await expect(auth.beginEmailChange(registered.account.id, "Password123", "new-profile@example.com"))
      .rejects.toMatchObject({ code: "EMAIL_SERVICE_UNAVAILABLE" });
    expect(auth.findAccount(registered.account.id)?.email).toBe("profile-mail@example.com");
    vi.unstubAllEnvs();
  });

  it("requires a syntactically valid unique email for registration", () => {
    const auth = tempAuth();
    auth.register("EmailOne", "Password123", "unique@example.com");
    expectAuthError(() => auth.register("EmailTwo", "Password123", "UNIQUE@example.com"), "EMAIL_TAKEN");
    expectAuthError(() => auth.register("EmailTwo", "Password123", "not-an-email"), "INVALID_EMAIL");
  });

  it("deletes an account only after password confirmation", () => {
    const auth = tempAuth();
    const registered = auth.register("DeleteMe", "Password123", "delete@example.com");
    expectAuthError(() => auth.deleteAccount(registered.account.id, "WrongPass123"), "INVALID_PASSWORD");
    auth.deleteAccount(registered.account.id, "Password123");
    expect(auth.verifyToken(registered.token)).toBeNull();
    expectAuthError(() => auth.login("DeleteMe", "Password123"), "INVALID_CREDENTIALS");
  });
});
