import type express from "express";
import type { AuthService } from "./auth.ts";
import type { GameKind } from "../shared/social.ts";

export function installSocialApi(
  app: express.Express,
  auth: AuthService,
  isMember: (accountId: string, game: GameKind, roomCode: string, token: string) => Promise<boolean>,
  presence?: (id: string) => { online: boolean; game: string | null; roomCode: string | null; watching: boolean }
): void {
  app.use("/api/social", (request, response, next) => {
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    const account = auth.verifyToken(token);
    if (!account) { response.status(401).json({ ok: false, message: "请先登录" }); return; }
    response.locals.accountId = account.id;
    response.locals.token = token;
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/social", (_request, response) => response.json({ ok: true, data: auth.socialState(response.locals.accountId, presence) }));
  app.get("/api/social/invitations", (_request, response) => response.json({ ok: true, data: auth.invitationsFor(response.locals.accountId) }));
  app.delete("/api/social/invitations/:id", (request, response) => { auth.dismissInvitation(response.locals.accountId, String(request.params.id)); response.json({ ok: true }); });
  app.post("/api/social/invitations", async (request, response) => {
    try {
      const { targetId, game, roomCode, role } = request.body ?? {};
      if (!["uno", "shogi", "arknights"].includes(game) || !["player", "spectator"].includes(role) || typeof targetId !== "string" || typeof roomCode !== "string" ||
        !(game === "uno" ? /^[A-Z2-9]{6}$/.test(roomCode) : /^\d{4}$/.test(roomCode))) {
        response.status(400).json({ ok: false, message: "无效的房间邀请" }); return;
      }
      if (!await isMember(response.locals.accountId, game, roomCode, response.locals.token)) { response.status(403).json({ ok: false, message: "只有房间内的玩家可以发出邀请" }); return; }
      // Only a friend who is online right now can be invited: an invite sent to a closed tab would never be seen.
      const target = presence?.(targetId);
      if (target && !target.online) { response.status(409).json({ ok: false, message: "该好友当前不在线，无法邀请" }); return; }
      // Someone already in a room (playing or watching) cannot be invited into a second one.
      if (target?.roomCode) {
        response.status(409).json({ ok: false, message: target.watching ? "该好友正在观战其他房间" : "该好友正在其他房间对局中" });
        return;
      }
      auth.inviteFriend(response.locals.accountId, targetId, game, roomCode, role);
      response.json({ ok: true });
    } catch (error) { response.status(400).json({ ok: false, message: error instanceof Error ? error.message : "邀请失败" }); }
  });
}
