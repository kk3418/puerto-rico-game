import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    guestId?: string;
    guestNickname?: string;
    githubOAuthState?: string;
  }
}
