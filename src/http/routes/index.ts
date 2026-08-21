/** The API surface, assembled. */

import { Router, type Request, type Response } from "express";
import { prisma } from "../../db/client.js";
import { optionalAuth } from "../middleware/auth.js";
import { authRoutes } from "./auth.routes.js";
import { flightRoutes } from "./flights.routes.js";
import { bookingRoutes } from "./bookings.routes.js";
import { adminRoutes } from "./admin.routes.js";

export const apiRoutes = Router();

/**
 * Liveness and readiness.
 *
 * The database is actually queried rather than assumed: a process that is
 * running but cannot reach Postgres is not healthy, and reporting it as
 * healthy is how a load balancer keeps sending traffic into a black hole.
 */
apiRoutes.get("/health", async (_req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      database: "reachable",
      latencyMs: Date.now() - startedAt,
      uptimeSeconds: Math.round(process.uptime()),
    });
  } catch {
    res.status(503).json({ status: "degraded", database: "unreachable" });
  }
});

// Attached before the routers so any handler can read req.user if it is there,
// without each one having to remember to ask.
apiRoutes.use(optionalAuth);

apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/flights", flightRoutes);
apiRoutes.use("/bookings", bookingRoutes);
apiRoutes.use("/admin", adminRoutes);
