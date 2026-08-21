/** Process entry point: connect, verify, listen, and shut down cleanly. */

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./db/client.js";
import { applyDatabaseConstraints } from "./db/constraints.js";
import { configurePassport } from "./lib/oauth.js";

async function main(): Promise<void> {
  /* Fail here, at boot, rather than on the first request. A server that starts
     without a database is a server that looks fine on the dashboard and is
     broken for every user. */
  await prisma.$connect();
  logger.info("Connected to the database.");

  // Idempotent, and cheap. Guarantees the seat-uniqueness index exists even if
  // someone set the schema up with `prisma db push`, which does not run it.
  await applyDatabaseConstraints();

  configurePassport();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, origins: env.webOrigins },
      `SkyRoute API listening on ${env.API_URL}`,
    );
  });

  /* Graceful shutdown. Stop accepting connections, let in-flight requests
     finish, then close the pool — so a deploy cannot cut a booking transaction
     in half. */
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down.");

    const forced = setTimeout(() => {
      logger.error("Shutdown timed out after 10s; exiting.");
      process.exit(1);
    }, 10_000);
    forced.unref();

    server.close(async () => {
      await prisma.$disconnect();
      clearTimeout(forced);
      logger.info("Shutdown complete.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection.");
  });

  process.on("uncaughtException", (error) => {
    // The process is in an unknown state; the only safe move is to leave.
    logger.fatal({ err: error }, "Uncaught exception. Exiting.");
    process.exit(1);
  });
}

main().catch(async (error) => {
  logger.fatal({ err: error }, "The server failed to start.");
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
