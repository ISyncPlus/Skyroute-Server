/**
 * Request schemas.
 *
 * Zod is used for shape and type; the business rules stay in src/domain, where
 * they are unit-tested without a server running. A schema here answers "is
 * this a well-formed request", never "is this allowed".
 */

import { z } from "zod";
import { MAX_PASSENGERS_PER_BOOKING } from "../domain/validation.js";

export const cabinClass = z.enum(["economy", "business", "first"]);
export const passengerType = z.enum(["adult", "child", "infant"]);
export const tripType = z.enum(["one-way", "round-trip", "multi-city"]);
export const paymentMethod = z.enum(["card", "transfer", "wallet"]);
export const flightStatus = z.enum(["scheduled", "delayed", "cancelled"]);

const iataCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Enter a three-letter airport code.");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "That is not a real date.");

const pnr = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/, "A booking reference is six characters.");

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const registerSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required.").max(100),
  email: z.string().trim().email("Enter a valid email address.").max(120),
  phone: z.string().trim().min(1, "Phone number is required.").max(20),
  password: z.string().min(1, "Password is required.").max(200),
  confirmPassword: z.string().min(1, "Please confirm your password."),
});

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email address is required.").max(120),
  password: z.string().min(1, "Password is required.").max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string().min(1, "Enter a new password.").max(200),
});

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export const searchSchema = z
  .object({
    originCode: iataCode,
    destinationCode: iataCode,
    departureDate: isoDate,
    tripType: tripType.default("one-way"),
    returnDate: isoDate.optional(),
    extraLegs: z
      .array(
        z.object({
          originCode: iataCode,
          destinationCode: iataCode,
          departureDate: isoDate,
        }),
      )
      .max(5, "A journey may not exceed six flights.")
      .optional(),
    cabin: cabinClass.default("economy"),
    adults: z.coerce.number().int().min(1, "At least one adult is required.").max(9),
    children: z.coerce.number().int().min(0).max(8).default(0),
    infants: z.coerce.number().int().min(0).max(8).default(0),
  })
  .superRefine((value, ctx) => {
    if (value.originCode === value.destinationCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destinationCode"],
        message: "Departure and arrival airports must be different.",
      });
    }

    if (value.adults + value.children + value.infants > MAX_PASSENGERS_PER_BOOKING) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adults"],
        message: `A single booking may not exceed ${MAX_PASSENGERS_PER_BOOKING} passengers.`,
      });
    }

    // An infant travels on an adult's lap, so there must be a lap per infant.
    if (value.infants > value.adults) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["infants"],
        message: "Each infant must be accompanied by an adult.",
      });
    }

    if (value.tripType === "round-trip") {
      if (!value.returnDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["returnDate"],
          message: "Select a return date.",
        });
      } else if (value.returnDate < value.departureDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["returnDate"],
          message: "The return cannot be before the outbound.",
        });
      }
    }

    if (value.tripType === "multi-city" && !value.extraLegs?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extraLegs"],
        message: "A multi-city journey needs at least two flights.",
      });
    }
  });

export const alternativeDatesSchema = z.object({
  originCode: iataCode,
  destinationCode: iataCode,
});

/* ------------------------------------------------------------------ */
/* Bookings                                                            */
/* ------------------------------------------------------------------ */

const passengerSchema = z.object({
  title: z.enum(["Mr", "Mrs", "Miss", "Ms", "Dr"]),
  firstName: z.string().trim().min(1, "First name is required.").max(50),
  lastName: z.string().trim().min(1, "Surname is required.").max(50),
  dateOfBirth: isoDate,
  gender: z.enum(["male", "female"]),
  passportNumber: z.string().trim().max(20).optional(),
  type: passengerType,
});

const legSchema = z.object({
  flightId: z.string().trim().min(1).max(80),
  cabin: cabinClass,
  seatIds: z.array(z.string().trim().regex(/^\d{1,3}[A-K]$/i).nullable()).max(9),
});

export const createBookingSchema = z
  .object({
    legs: z.array(legSchema).min(1, "At least one flight is required.").max(6),
    tripType: tripType.optional(),
    contactEmail: z.string().trim().email("Enter a valid email address.").max(120),
    contactPhone: z.string().trim().min(1, "A contact phone number is required.").max(20),
    passengers: z
      .array(passengerSchema)
      .min(1, "At least one passenger is required.")
      .max(MAX_PASSENGERS_PER_BOOKING),
    payment: z.object({
      method: paymentMethod,
      cardHolder: z.string().trim().max(80).optional(),
      cardNumber: z.string().trim().max(25).optional(),
      expiry: z.string().trim().max(7).optional(),
      cvv: z.string().trim().max(4).optional(),
      senderName: z.string().trim().max(80).optional(),
      forceFailure: z.boolean().optional(),
    }),
  })
  .superRefine((value, ctx) => {
    value.legs.forEach((leg, index) => {
      if (leg.seatIds.length !== value.passengers.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["legs", index, "seatIds"],
          message: "A seat entry is required for every passenger.",
        });
      }
    });
  });

export const managePnrSchema = z.object({
  pnr,
  surname: z.string().trim().min(1, "Enter the surname on the booking.").max(50),
});

export const pnrParamSchema = z.object({ pnr });

export const cancelBookingSchema = z.object({
  /** Required only when cancelling a guest booking without signing in. */
  surname: z.string().trim().min(1).max(50).optional(),
});

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
};

export const adminFlightQuerySchema = z.object({
  status: flightStatus.optional(),
  originCode: iataCode.optional(),
  destinationCode: iataCode.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...pagination,
});

export const adminBookingQuerySchema = z.object({
  status: z.enum(["confirmed", "cancelled", "pending"]).optional(),
  ...pagination,
});

export const createFlightSchema = z.object({
  flightNumber: z.string().trim().regex(/^[A-Z0-9]{2,8}$/i, "Enter a valid flight number."),
  airline: z.string().trim().min(1).max(60),
  airlineCode: z.string().trim().regex(/^[A-Z0-9]{2,3}$/i, "Enter a valid airline code."),
  originCode: iataCode,
  destinationCode: iataCode,
  departureTime: z.string().datetime({ offset: true }),
  arrivalTime: z.string().datetime({ offset: true }),
  aircraft: z.string().trim().min(1).max(60),
  baseFare: z.coerce.number().int().min(1000).max(50_000_000),
  currency: z.string().trim().length(3).optional(),
  blockedSeats: z.array(z.string().trim().max(5)).max(200).optional(),
  status: flightStatus.optional(),
});

export const updateFlightSchema = createFlightSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Nothing to update.",
);

export const setRoleSchema = z.object({ role: z.enum(["customer", "admin"]) });

export const extendScheduleSchema = z.object({
  horizonDays: z.coerce.number().int().min(1).max(365).optional(),
});

export type SearchInput = z.infer<typeof searchSchema>;
export type CreateBookingBody = z.infer<typeof createBookingSchema>;
