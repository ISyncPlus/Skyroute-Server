/**
 * The Prisma client.
 *
 * A single instance is shared across the process. Under `tsx watch` the module
 * is re-evaluated on every save, so the instance is parked on globalThis to
 * stop each reload opening a fresh connection pool and exhausting Postgres's
 * connection limit within a few minutes of editing.
 */

import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProduction ? ["warn", "error"] : ["warn", "error"],
  });

if (!env.isProduction) globalForPrisma.prisma = prisma;

export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
