import type { Prisma } from "@prisma/client";
import session from "express-session";
import { prisma } from "./db";
import { env } from "./env";

export const SESSION_COOKIE = "pr.sid";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Done = (err?: unknown, result?: session.SessionData | null) => void;

export class PrismaSessionStore extends session.Store {
  get(sid: string, callback: Done): void {
    void prisma.session
      .findUnique({ where: { sid } })
      .then((row) => {
        if (!row || row.expire < new Date()) {
          callback(undefined, null);
          return;
        }
        callback(undefined, row.sess as unknown as session.SessionData);
      })
      .catch((err: unknown) => callback(err));
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    const maxAge = sess.cookie.maxAge ?? SESSION_TTL_MS;
    const expire = new Date(Date.now() + maxAge);
    const payload = JSON.parse(JSON.stringify(sess)) as Prisma.InputJsonValue;
    void prisma.session
      .upsert({
        where: { sid },
        create: { sid, sess: payload, expire },
        update: { sess: payload, expire },
      })
      .then(() => callback?.())
      .catch((err: unknown) => callback?.(err));
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    void prisma.session
      .deleteMany({ where: { sid } })
      .then(() => callback?.())
      .catch((err: unknown) => callback?.(err));
  }

  touch(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    this.set(sid, sess, callback);
  }
}

export function sessionMiddleware(): ReturnType<typeof session> {
  return session({
    name: SESSION_COOKIE,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new PrismaSessionStore(),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_MS,
    },
  });
}
