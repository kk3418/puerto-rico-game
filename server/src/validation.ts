import { z } from "zod";

export const NICKNAME_REQUIRED = "NICKNAME_REQUIRED";
export const NICKNAME_TOO_LONG = "NICKNAME_TOO_LONG";

/** Zod issue messages that are stable API error codes (not human-readable text). */
export const ZOD_MESSAGE_CODES = new Set<string>([NICKNAME_REQUIRED, NICKNAME_TOO_LONG]);

export const nicknameSchema = z
  .string()
  .trim()
  .min(1, { message: NICKNAME_REQUIRED })
  .max(24, { message: NICKNAME_TOO_LONG });
