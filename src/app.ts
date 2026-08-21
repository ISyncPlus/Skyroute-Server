/**
 * Express application assembly.
 *
 * Kept separate from src/index.ts so tests can mount the app with supertest
 * without opening a port or starting a listener.
 */

import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { passport } from "./lib/oauth.js";
import { apiRoutes } from "./http/routes/index.js";
import { errorHandler, notFoundHandler } from "./http/middleware/error.js";

export function createApp(): Express {
  const app = express();

  /* Behind a proxy (Render, Railway, nginx) the client IP arrives in
     X-Forwarded-For. Without this, rate limiting sees the proxy's address and
     throttles every user as though they were one person. */
  if (env.isProduction) app.set("trust proxy", 1);

  app.disable("x-powered-by");

  app.use(
    helmet({
      // The API serves JSON, not documents, so a strict CSP here would
      // constrain nothing while breaking the OAuth redirect chain.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: curl, a server-to-server call, a health probe.
        if (!origin) return callback(null, true);
        if (env.webOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not permitted.`));
      },
      // Required for the session cookie to travel cross-origin at all.
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.use(compression());

  // A body larger than this is not a booking; it is an attempt to exhaust
  // memory. Bounded before parsing, not after.
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "256kb" }));
  app.use(cookieParser());

  app.use(
    pinoHttp({
      logger,
      // Health checks fire constantly and say nothing when they succeed.
      autoLogging: { ignore: (req) => req.url === "/api/health" },
    }),
  );

  app.use(passport.initialize());

  /* A broad ceiling that no legitimate user approaches. The per-endpoint
     limiter on credentials is the one that does the real work; this exists to
     blunt indiscriminate traffic. */
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: env.isProduction ? 300 : 100_000,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );

  app.use("/api", apiRoutes);

  app.get("/", (_req, res) => {
    res.json({
      name: "SkyRoute API",
      version: "1.0.0",
      documentation: "/api/health",
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
