/** Structured logging. Pretty in development, JSON lines in production. */

import { pino } from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.isTest ? "silent" : env.LOG_LEVEL,

  // Anything that could carry a credential is removed before the record is
  // written. Logs end up in places with looser access control than the
  // database, so they must never become the weakest link.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.cardNumber",
      "*.cvv",
      "*.passwordHash",
      "*.token",
    ],
    censor: "[redacted]",
  },

  transport: env.isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
});
