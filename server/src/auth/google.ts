import { OAuth2Client } from "google-auth-library";
import { env } from "../env";
import { HttpError } from "../errors";
import type { ProviderProfile } from "./accounts";

export async function verifyGoogleIdToken(idToken: string): Promise<ProviderProfile> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new HttpError(503, "尚未設定 Google 登入");
  }
  const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, "Google 身分驗證失敗");
  }
  if (!payload?.sub) {
    throw new HttpError(401, "Google 身分驗證失敗");
  }
  return {
    provider: "google",
    providerAccountId: payload.sub,
    email: payload.email ?? null,
    emailVerified: Boolean(payload.email_verified && payload.email),
    displayName: payload.name || payload.email || "Google 玩家",
    avatarUrl: payload.picture ?? null,
  };
}
