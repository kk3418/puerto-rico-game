import type { Request } from "express";
import { HttpError } from "./errors";

export type SessionIdentity = {
  userId?: string;
  guestId?: string;
};

export function requireIdentity(req: Request): SessionIdentity {
  const userId = req.session.userId;
  const guestId = req.session.guestId;
  if (!userId && !guestId) {
    throw new HttpError(401, "需要登入或訪客工作階段");
  }
  return { userId, guestId };
}

export function requireUser(req: Request): { userId: string } {
  const userId = req.session.userId;
  if (!userId) {
    throw new HttpError(401, "請先登入");
  }
  return { userId };
}
