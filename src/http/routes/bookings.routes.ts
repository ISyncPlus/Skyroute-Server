/**
 * Bookings: create, retrieve, cancel.
 *
 * Note what is NOT here: no route decides whether a booking belongs to the
 * caller. That question is answered inside the service, where the record is,
 * because a guard in a route can be bypassed by the next caller who forgets to
 * mount it.
 */

import { Router, type Request, type Response } from "express";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  cancelBookingSchema,
  createBookingSchema,
  managePnrSchema,
  pnrParamSchema,
} from "../schemas.js";
import {
  cancelBooking,
  createBooking,
  findByPnr,
  findByPnrAndSurname,
  listForUser,
  quoteRefund,
  type CancelRequester,
} from "../../services/booking.service.js";
import { badRequest, forbidden, notFound } from "../errors.js";
import { validatePassenger, validatePayment } from "../../domain/validation.js";
import { getFlight } from "../../services/flight.service.js";

export const bookingRoutes = Router();

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

/**
 * Book a journey.
 *
 * optionalAuth, not requireAuth: booking without an account is a supported
 * path, and forcing registration at the point of payment is how you lose the
 * sale. A signed-in caller gets the booking attached to their account; a guest
 * gets one reachable by reference and surname.
 */
bookingRoutes.post(
  "/",
  optionalAuth,
  validate(createBookingSchema),
  async (req: Request, res: Response) => {
    const body = req.body as typeof req.body & {
      legs: { flightId: string; cabin: string; seatIds: (string | null)[] }[];
    };

    /* The domain rules run here as well as in the browser. Client-side
       validation is a courtesy to the user; this is the one that counts,
       because anything can post to this endpoint. */
    const firstLeg = body.legs[0];
    const flight = await getFlight(firstLeg.flightId);
    const international = await isInternational(firstLeg.flightId);

    const fieldErrors: Record<string, string> = {};

    body.passengers.forEach((passenger: Parameters<typeof validatePassenger>[0], index: number) => {
      const check = validatePassenger(passenger, flight.departureTime, international);
      for (const [field, message] of Object.entries(check.errors)) {
        fieldErrors[`passengers.${index}.${field}`] = message;
      }
    });

    const paymentCheck = validatePayment({
      method: body.payment.method,
      cardHolder: body.payment.cardHolder ?? "",
      cardNumber: body.payment.cardNumber ?? "",
      expiry: body.payment.expiry ?? "",
      cvv: body.payment.cvv ?? "",
    });
    for (const [field, message] of Object.entries(paymentCheck.errors)) {
      fieldErrors[`payment.${field}`] = message;
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw badRequest("Please correct the highlighted fields.", fieldErrors);
    }

    const booking = await createBooking({
      legs: body.legs as never,
      tripType: body.tripType,
      userId: req.user?.id ?? null,
      contactEmail: body.contactEmail,
      contactPhone: body.contactPhone,
      passengers: body.passengers,
      payment: body.payment,
    });

    res.status(201).json({ booking });
  },
);

/** Passport rules differ by route, so the check is by country, not by guess. */
async function isInternational(flightId: string): Promise<boolean> {
  const flight = await getFlight(flightId);
  const { listAirports } = await import("../../services/flight.service.js");
  const airports = await listAirports();
  const origin = airports.find((airport) => airport.code === flight.originCode);
  const destination = airports.find((airport) => airport.code === flight.destinationCode);
  return Boolean(origin && destination && origin.country !== destination.country);
}

/* ------------------------------------------------------------------ */
/* Retrieve                                                            */
/* ------------------------------------------------------------------ */

/** Bookings attached to the signed-in account. Guest bookings never appear. */
bookingRoutes.get("/", requireAuth, async (req: Request, res: Response) => {
  res.json({ bookings: await listForUser(req.user!.id) });
});

/**
 * The "manage my booking" lookup. Reference plus surname, with no account —
 * this is the only way a guest reaches their own booking.
 */
bookingRoutes.post("/lookup", validate(managePnrSchema), async (req: Request, res: Response) => {
  const booking = await findByPnrAndSurname(req.body.pnr, req.body.surname);

  /* One message for "no such reference" and for "wrong surname". Separate
     messages would confirm that a reference exists, turning this form into a
     way to enumerate other people's bookings. */
  if (!booking) {
    throw notFound("No booking matches that reference and surname.");
  }

  res.json({ booking, refundIfCancelled: await quoteRefund(booking.pnr) });
});

/**
 * Fetch by reference alone. Requires an account, and the service still checks
 * ownership — a signed-in customer cannot read a stranger's booking by
 * guessing six characters.
 */
bookingRoutes.get(
  "/:pnr",
  requireAuth,
  validate(pnrParamSchema, "params"),
  async (req: Request, res: Response) => {
    const booking = await findByPnr(req.params.pnr as string);
    if (!booking) throw notFound("No booking was found with that reference.");

    const isOwner = booking.userId !== null && booking.userId === req.user!.id;
    if (!isOwner && req.user!.role !== "admin") {
      throw forbidden("You do not have permission to view this booking.");
    }

    res.json({ booking, refundIfCancelled: await quoteRefund(booking.pnr) });
  },
);

/* ------------------------------------------------------------------ */
/* Cancel                                                              */
/* ------------------------------------------------------------------ */

/**
 * Cancel a booking.
 *
 * The requester is built as a discriminated union before it reaches the
 * service, so there is no path on which neither identity is supplied and the
 * service falls through to an unguarded branch.
 */
bookingRoutes.post(
  "/:pnr/cancel",
  optionalAuth,
  validate(pnrParamSchema, "params"),
  validate(cancelBookingSchema),
  async (req: Request, res: Response) => {
    const pnr = req.params.pnr as string;

    let requester: CancelRequester;
    if (req.user) {
      requester = { kind: "account", user: req.user };
    } else if (typeof req.body.surname === "string" && req.body.surname.trim()) {
      requester = { kind: "guest", surname: req.body.surname };
    } else {
      throw badRequest("Sign in, or provide the surname on the booking, to cancel it.");
    }

    const { booking, refund } = await cancelBooking(pnr, requester);
    res.json({ booking, refund });
  },
);
