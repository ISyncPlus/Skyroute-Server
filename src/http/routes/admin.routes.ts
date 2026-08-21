/**
 * Administration console.
 *
 * requireAdmin guards the whole router, and every service beneath re-checks.
 * Two layers is not redundancy for its own sake: the router protects the
 * endpoint, the service protects the operation, and only the second survives
 * somebody calling the service from somewhere new.
 */

import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../middleware/auth.js";
import { query, validate } from "../middleware/validate.js";
import {
  adminBookingQuerySchema,
  adminFlightQuerySchema,
  createFlightSchema,
  extendScheduleSchema,
  setRoleSchema,
  updateFlightSchema,
} from "../schemas.js";
import {
  createFlight,
  deleteFlight,
  extendSchedule,
  getStats,
  listAllBookings,
  listFlights,
  listUsers,
  setUserRole,
  updateFlight,
  type FlightListQuery,
} from "../../services/admin.service.js";
import { cancelBooking } from "../../services/booking.service.js";

export const adminRoutes = Router();

adminRoutes.use(requireAdmin);

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

adminRoutes.get("/stats", async (req: Request, res: Response) => {
  res.json({ stats: await getStats(req.user!) });
});

/* ------------------------------------------------------------------ */
/* Flights                                                             */
/* ------------------------------------------------------------------ */

adminRoutes.get(
  "/flights",
  validate(adminFlightQuerySchema, "query"),
  async (req: Request, res: Response) => {
    res.json(await listFlights(req.user!, query<FlightListQuery>(req)));
  },
);

adminRoutes.post("/flights", validate(createFlightSchema), async (req: Request, res: Response) => {
  res.status(201).json({ flight: await createFlight(req.user!, req.body) });
});

adminRoutes.patch(
  "/flights/:flightId",
  validate(updateFlightSchema),
  async (req: Request, res: Response) => {
    res.json({ flight: await updateFlight(req.user!, req.params.flightId as string, req.body) });
  },
);

adminRoutes.delete("/flights/:flightId", async (req: Request, res: Response) => {
  res.json(await deleteFlight(req.user!, req.params.flightId as string));
});

/* ------------------------------------------------------------------ */
/* Bookings                                                            */
/* ------------------------------------------------------------------ */

adminRoutes.get(
  "/bookings",
  validate(adminBookingQuerySchema, "query"),
  async (req: Request, res: Response) => {
    res.json(
      await listAllBookings(
        req.user!,
        query<{ status?: "confirmed" | "cancelled" | "pending"; page: number; pageSize: number }>(
          req,
        ),
      ),
    );
  },
);

/** An administrator may cancel any booking; the service enforces that rule. */
adminRoutes.post("/bookings/:pnr/cancel", async (req: Request, res: Response) => {
  const { booking, refund } = await cancelBooking(req.params.pnr as string, {
    kind: "account",
    user: req.user!,
  });
  res.json({ booking, refund });
});

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

adminRoutes.get("/users", async (req: Request, res: Response) => {
  res.json({ users: await listUsers(req.user!) });
});

adminRoutes.patch(
  "/users/:userId/role",
  validate(setRoleSchema),
  async (req: Request, res: Response) => {
    res.json({ user: await setUserRole(req.user!, req.params.userId as string, req.body.role) });
  },
);

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

/**
 * Top the schedule back up. Departures fall into the past as real time
 * advances, so without this the system eventually has nothing to sell.
 */
adminRoutes.post(
  "/schedule/extend",
  validate(extendScheduleSchema),
  async (req: Request, res: Response) => {
    res.json(await extendSchedule(req.user!, req.body.horizonDays));
  },
);
