import { randomBytes } from "node:crypto";
import { env } from "../env";
import { HttpError } from "../errors";
import type { ProviderProfile } from "./accounts";

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_USER = "https://api.github.com/user";
const GITHUB_EMAILS = "https://api.github.com/user/emails";

export function githubConfigured(): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.GITHUB_CALLBACK_URL);
}

export function createGithubOAuthState(): string {
  return randomBytes(16).toString("hex");
}

export function githubAuthorizeUrl(state: string): string {
  if (!githubConfigured()) {
    throw new HttpError(503, "尚未設定 GitHub 登入");
  }
  const url = new URL(GITHUB_AUTHORIZE);
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID!);
  url.searchParams.set("redirect_uri", env.GITHUB_CALLBACK_URL!);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}

type GithubUser = {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
};

type GithubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

export async function exchangeGithubCode(code: string): Promise<ProviderProfile> {
  if (!githubConfigured()) {
    throw new HttpError(503, "尚未設定 GitHub 登入");
  }

  const tokenRes = await fetch(GITHUB_TOKEN, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: env.GITHUB_CALLBACK_URL,
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new HttpError(401, "GitHub 授權失敗");
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${tokenJson.access_token}`,
    "User-Agent": "puerto-rico-game",
  };

  const userRes = await fetch(GITHUB_USER, { headers });
  if (!userRes.ok) {
    throw new HttpError(401, "無法讀取 GitHub 資料");
  }
  const user = (await userRes.json()) as GithubUser;

  let email: string | null = null;
  let emailVerified = false;
  const emailRes = await fetch(GITHUB_EMAILS, { headers });
  if (emailRes.ok) {
    const emails = (await emailRes.json()) as GithubEmail[];
    const primaryVerified = emails.find((item) => item.primary && item.verified);
    const anyVerified = emails.find((item) => item.verified);
    const chosen = primaryVerified ?? anyVerified;
    if (chosen) {
      email = chosen.email;
      emailVerified = true;
    }
  }

  return {
    provider: "github",
    providerAccountId: String(user.id),
    email,
    emailVerified,
    displayName: user.name || user.login,
    avatarUrl: user.avatar_url,
  };
}
