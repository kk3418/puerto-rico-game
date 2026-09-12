import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { HttpError } from "../errors";
import { SESSION_COOKIE } from "../session";
import { findOrCreateUser, publicUser } from "./accounts";
import { exchangeGithubCode, createGithubOAuthState, githubAuthorizeUrl, githubConfigured } from "./github";
import { verifyGoogleIdToken } from "./google";

function providerFlags() {
  return {
    google: Boolean(env.GOOGLE_CLIENT_ID),
    github: githubConfigured(),
  };
}

const nicknameSchema = z
  .string()
  .trim()
  .min(1, "請輸入暱稱")
  .max(24, "暱稱太長");

export const authRouter = Router();

authRouter.post("/guest", async (req, res) => {
  const body = z.object({ nickname: nicknameSchema.optional() }).parse(req.body ?? {});
  if (!req.session.guestId) {
    req.session.guestId = randomUUID();
  }
  if (body.nickname) {
    req.session.guestNickname = body.nickname;
  }
  const user = req.session.userId
    ? await prisma.user.findUnique({ where: { id: req.session.userId } })
    : null;
  res.json({
    guest: {
      id: req.session.guestId,
      nickname: req.session.guestNickname ?? null,
    },
    user: user ? publicUser(user) : null,
    authenticated: Boolean(user),
    providers: providerFlags(),
  });
});

authRouter.post("/google", async (req, res) => {
  const { idToken } = z.object({ idToken: z.string().min(1) }).parse(req.body);
  const profile = await verifyGoogleIdToken(idToken);
  const user = await findOrCreateUser(prisma, profile, req.session.guestId);
  req.session.userId = user.id;
  res.json({
    user: publicUser(user),
    guest: req.session.guestId
      ? { id: req.session.guestId, nickname: req.session.guestNickname ?? null }
      : null,
    authenticated: true,
    providers: providerFlags(),
  });
});

authRouter.get("/github", (req, res, next) => {
  if (!githubConfigured()) {
    next(new HttpError(503, "尚未設定 GitHub 登入"));
    return;
  }
  const state = createGithubOAuthState();
  req.session.githubOAuthState = state;
  req.session.save((err) => {
    if (err) {
      res.redirect(`${env.CLIENT_ORIGIN}/?authError=github`);
      return;
    }
    res.redirect(githubAuthorizeUrl(state));
  });
});

authRouter.get("/github/callback", async (req, res) => {
  const query = z
    .object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
    })
    .parse(req.query);

  if (query.error || !query.code || !query.state || query.state !== req.session.githubOAuthState) {
    delete req.session.githubOAuthState;
    res.redirect(`${env.CLIENT_ORIGIN}/?authError=github`);
    return;
  }
  delete req.session.githubOAuthState;

  try {
    const profile = await exchangeGithubCode(query.code);
    const user = await findOrCreateUser(prisma, profile, req.session.guestId);
    req.session.userId = user.id;
    req.session.save((err) => {
      if (err) {
        res.redirect(`${env.CLIENT_ORIGIN}/?authError=github`);
        return;
      }
      res.redirect(`${env.CLIENT_ORIGIN}/`);
    });
  } catch {
    res.redirect(`${env.CLIENT_ORIGIN}/?authError=github`);
  }
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "無法登出" });
      return;
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });
});

authRouter.get("/me", async (req, res) => {
  const user = req.session.userId
    ? await prisma.user.findUnique({ where: { id: req.session.userId } })
    : null;
  if (req.session.userId && !user) {
    delete req.session.userId;
  }
  res.json({
    user: user ? publicUser(user) : null,
    guest: req.session.guestId
      ? { id: req.session.guestId, nickname: req.session.guestNickname ?? null }
      : null,
    authenticated: Boolean(user),
    providers: providerFlags(),
  });
});
