/**
 * OpenAPI / Swagger Specification Builder
 *
 * Automatically generates an OpenAPI 3.0 document from Zod schemas and
 * route definitions.
 */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  adminBookingQuerySchema,
  adminFlightQuerySchema,
  alternativeDatesSchema,
  cancelBookingSchema,
  changePasswordSchema,
  createBookingSchema,
  createFlightSchema,
  extendScheduleSchema,
  loginSchema,
  managePnrSchema,
  pnrParamSchema,
  registerSchema,
  searchSchema,
  setRoleSchema,
  updateFlightSchema,
  updateProfileSchema,
} from "./schemas.js";

// Enhance Zod with .openapi() metadata methods
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

/* ------------------------------------------------------------------ */
/* Security Schemes                                                   */
/* ------------------------------------------------------------------ */

const bearerAuth = registry.registerComponent("securitySchemes", "BearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Session token returned by register or login endpoints. Pass as `Authorization: Bearer <token>` or as a cookie (`skyroute_session`).",
});

/* ------------------------------------------------------------------ */
/* Component Schemas                                                  */
/* ------------------------------------------------------------------ */

registry.register("RegisterInput", registerSchema);
registry.register("LoginInput", loginSchema);
registry.register("ChangePasswordInput", changePasswordSchema);
registry.register("UpdateProfileInput", updateProfileSchema);
registry.register("SearchFlightInput", searchSchema);
registry.register("AlternativeDatesInput", alternativeDatesSchema);
registry.register("CreateBookingInput", createBookingSchema);
registry.register("ManagePnrInput", managePnrSchema);
registry.register("PnrParam", pnrParamSchema);
registry.register("CancelBookingInput", cancelBookingSchema);
registry.register("AdminFlightQuery", adminFlightQuerySchema);
registry.register("AdminBookingQuery", adminBookingQuerySchema);
registry.register("CreateFlightInput", createFlightSchema);
registry.register("UpdateFlightInput", updateFlightSchema);
registry.register("SetRoleInput", setRoleSchema);
registry.register("ExtendScheduleInput", extendScheduleSchema);

/* ------------------------------------------------------------------ */
/* Health                                                             */
/* ------------------------------------------------------------------ */

registry.registerPath({
  method: "get",
  path: "/api/health",
  tags: ["System"],
  summary: "Health Check",
  description: "Database liveness and server uptime probe.",
  responses: {
    200: {
      description: "Server and database are healthy.",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("ok"),
            database: z.literal("reachable"),
            latencyMs: z.number(),
            uptimeSeconds: z.number(),
          }),
        },
      },
    },
    503: {
      description: "Database is unreachable / degraded service.",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("degraded"),
            database: z.literal("unreachable"),
          }),
        },
      },
    },
  },
});

/* ------------------------------------------------------------------ */
/* Auth                                                               */
/* ------------------------------------------------------------------ */

registry.registerPath({
  method: "post",
  path: "/api/auth/register",
  tags: ["Auth"],
  summary: "Register Account",
  description: "Create a new user account with credentials, issuing a session cookie and bearer token.",
  request: {
    body: {
      content: { "application/json": { schema: registerSchema } },
    },
  },
  responses: {
    201: {
      description: "User registered successfully.",
      content: {
        "application/json": {
          schema: z.object({
            user: z.object({
              id: z.string(),
              email: z.string(),
              fullName: z.string(),
              phone: z.string().nullable(),
              role: z.string(),
            }),
            token: z.string(),
            expiresAt: z.string(),
          }),
        },
      },
    },
    400: { description: "Validation failure or password mismatch." },
    409: { description: "Email is already registered." },
    429: { description: "Too many attempts from this IP." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/login",
  tags: ["Auth"],
  summary: "Sign In",
  description: "Sign in with email and password.",
  request: {
    body: {
      content: { "application/json": { schema: loginSchema } },
    },
  },
  responses: {
    200: {
      description: "Signed in successfully.",
      content: {
        "application/json": {
          schema: z.object({
            user: z.object({
              id: z.string(),
              email: z.string(),
              fullName: z.string(),
              role: z.string(),
            }),
            token: z.string(),
            expiresAt: z.string(),
          }),
        },
      },
    },
    400: { description: "Validation failure." },
    401: { description: "Invalid email or password." },
    429: { description: "Too many attempts from this IP." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/logout",
  tags: ["Auth"],
  summary: "Sign Out Current Session",
  description: "Revoke the current session token and clear the session cookie.",
  responses: {
    204: { description: "Signed out successfully." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/logout-all",
  tags: ["Auth"],
  summary: "Sign Out All Devices",
  description: "Revoke all active sessions for the authenticated user.",
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: {
      description: "All sessions revoked.",
      content: {
        "application/json": {
          schema: z.object({ sessionsRevoked: z.number() }),
        },
      },
    },
    401: { description: "Authentication required." },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/auth/me",
  tags: ["Auth"],
  summary: "Current Profile",
  description: "Returns the profile of the currently signed-in user or null if anonymous.",
  responses: {
    200: {
      description: "Profile object or null.",
      content: {
        "application/json": {
          schema: z.object({
            user: z.record(z.unknown()).nullable(),
            linkedProviders: z.array(z.string()).optional(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/auth/me",
  tags: ["Auth"],
  summary: "Update Profile",
  description: "Update the authenticated user's name, phone, or avatar.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: { "application/json": { schema: updateProfileSchema } },
    },
  },
  responses: {
    200: { description: "Profile updated successfully." },
    400: { description: "Validation failure." },
    401: { description: "Authentication required." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/change-password",
  tags: ["Auth"],
  summary: "Change Password",
  description: "Change password and revoke all existing sessions.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: { "application/json": { schema: changePasswordSchema } },
    },
  },
  responses: {
    200: {
      description: "Password changed.",
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }),
        },
      },
    },
    400: { description: "Validation failure." },
    401: { description: "Current password invalid or unauthenticated." },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/auth/oauth/providers",
  tags: ["Auth"],
  summary: "Enabled OAuth Providers",
  description: "Lists configured OAuth providers (e.g. google, github).",
  responses: {
    200: {
      description: "List of enabled providers.",
      content: {
        "application/json": {
          schema: z.object({ providers: z.array(z.string()) }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/auth/oauth/{provider}",
  tags: ["Auth"],
  summary: "Initiate OAuth Flow",
  description: "Redirects the browser to the third-party OAuth provider login page.",
  request: {
    params: z.object({ provider: z.enum(["google", "github"]) }),
  },
  responses: {
    302: { description: "Redirect to OAuth consent screen." },
    404: { description: "Provider not configured." },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/auth/oauth/{provider}/callback",
  tags: ["Auth"],
  summary: "OAuth Callback",
  description: "Callback endpoint that OAuth providers redirect back to.",
  request: {
    params: z.object({ provider: z.enum(["google", "github"]) }),
  },
  responses: {
    302: { description: "Redirects back to frontend with session cookie or error query param." },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/auth/oauth/{provider}",
  tags: ["Auth"],
  summary: "Unlink OAuth Provider",
  description: "Unlink an external OAuth provider from the signed-in account.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ provider: z.string() }),
  },
  responses: {
    200: { description: "Provider unlinked." },
    400: { description: "Cannot unlink only sign-in method." },
    401: { description: "Authentication required." },
  },
});

/* ------------------------------------------------------------------ */
/* Flights                                                            */
/* ------------------------------------------------------------------ */

registry.registerPath({
  method: "get",
  path: "/api/flights/airports",
  tags: ["Flights"],
  summary: "List Airports",
  description: "Retrieve all served airports, cities, countries, and IATA codes.",
  responses: {
    200: {
      description: "List of active airports.",
      content: {
        "application/json": {
          schema: z.object({
            airports: z.array(
              z.object({
                code: z.string(),
                name: z.string(),
                city: z.string(),
                country: z.string(),
                timezone: z.string(),
              }),
            ),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/flights/search",
  tags: ["Flights"],
  summary: "Search Flights (GET)",
  description: "Search for available one-way, round-trip, or multi-city flights using URL query parameters.",
  request: {
    query: searchSchema,
  },
  responses: {
    200: { description: "Search results with itineraries and seat availability." },
    400: { description: "Validation failure (e.g. invalid date or airport codes)." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/flights/search",
  tags: ["Flights"],
  summary: "Search Flights (POST)",
  description: "Search for available flights using JSON body. Ideal for complex multi-city queries.",
  request: {
    body: {
      content: { "application/json": { schema: searchSchema } },
    },
  },
  responses: {
    200: { description: "Search results with itineraries and seat availability." },
    400: { description: "Validation failure." },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/flights/alternative-dates",
  tags: ["Flights"],
  summary: "Alternative Available Dates",
  description: "List nearby dates with scheduled flights between origin and destination.",
  request: {
    query: alternativeDatesSchema,
  },
  responses: {
    200: {
      description: "List of ISO dates with flight departures.",
      content: {
        "application/json": {
          schema: z.object({ dates: z.array(z.string()) }),
        },
      },
    },
    400: { description: "Validation failure." },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/flights/{flightId}",
  tags: ["Flights"],
  summary: "Get Flight Details",
  description: "Get detailed flight info by ID.",
  request: {
    params: z.object({ flightId: z.string() }),
  },
  responses: {
    200: { description: "Flight details." },
    404: { description: "Flight not found." },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/flights/{flightId}/seats",
  tags: ["Flights"],
  summary: "Get Flight Seat Map",
  description: "Get seat layout, cabin classes, occupancy status, and seat pricing.",
  request: {
    params: z.object({ flightId: z.string() }),
  },
  responses: {
    200: { description: "Seat map configuration and availability." },
    404: { description: "Flight not found." },
  },
});

/* ------------------------------------------------------------------ */
/* Bookings                                                           */
/* ------------------------------------------------------------------ */

registry.registerPath({
  method: "post",
  path: "/api/bookings",
  tags: ["Bookings"],
  summary: "Create Booking",
  description: "Create a new flight reservation with passenger details and payment. Supports guest and authenticated bookings.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createBookingSchema } },
    },
  },
  responses: {
    201: { description: "Booking confirmed with PNR reference." },
    400: { description: "Validation error, seat unavailable, or invalid payment." },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/bookings",
  tags: ["Bookings"],
  summary: "List User Bookings",
  description: "List all bookings belonging to the signed-in account.",
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: { description: "List of user bookings." },
    401: { description: "Authentication required." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/bookings/lookup",
  tags: ["Bookings"],
  summary: "Guest Booking Lookup",
  description: "Retrieve booking details using 6-character PNR reference code and passenger surname.",
  request: {
    body: {
      content: { "application/json": { schema: managePnrSchema } },
    },
  },
  responses: {
    200: { description: "Booking details and cancellation quote." },
    404: { description: "Booking reference or surname does not match." },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/bookings/{pnr}",
  tags: ["Bookings"],
  summary: "Get Booking by PNR",
  description: "Retrieve booking details by PNR.",
  request: {
    params: pnrParamSchema,
  },
  responses: {
    200: { description: "Booking details and cancellation quote." },
    404: { description: "Booking reference not found." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/bookings/{pnr}/cancel",
  tags: ["Bookings"],
  summary: "Cancel Booking",
  description: "Cancel a booking and calculate refund according to policy. Accepts account session or surname verification.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: pnrParamSchema,
    body: {
      content: { "application/json": { schema: cancelBookingSchema } },
    },
  },
  responses: {
    200: { description: "Booking cancelled with refund receipt." },
    400: { description: "Surname missing for guest cancellation or flight already departed." },
    404: { description: "Booking not found." },
  },
});

/* ------------------------------------------------------------------ */
/* Admin                                                              */
/* ------------------------------------------------------------------ */

registry.registerPath({
  method: "get",
  path: "/api/admin/stats",
  tags: ["Admin"],
  summary: "Admin Dashboard Metrics",
  description: "System overview stats: revenue, booking totals, active flights, and passenger counts.",
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: { description: "System metrics." },
    401: { description: "Authentication required." },
    403: { description: "Admin privileges required." },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/admin/flights",
  tags: ["Admin"],
  summary: "Admin List Flights",
  description: "Paginated flight list with status, route, and date filters.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: adminFlightQuerySchema,
  },
  responses: {
    200: { description: "Paginated list of flights." },
    401: { description: "Authentication required." },
    403: { description: "Admin privileges required." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/admin/flights",
  tags: ["Admin"],
  summary: "Create Flight",
  description: "Add a new scheduled flight into the system.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: { "application/json": { schema: createFlightSchema } },
    },
  },
  responses: {
    201: { description: "Flight created." },
    400: { description: "Validation failure." },
    403: { description: "Admin privileges required." },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/admin/flights/{flightId}",
  tags: ["Admin"],
  summary: "Update Flight",
  description: "Update flight schedule, status, or fare.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ flightId: z.string() }),
    body: {
      content: { "application/json": { schema: updateFlightSchema } },
    },
  },
  responses: {
    200: { description: "Flight updated." },
    400: { description: "Validation failure." },
    403: { description: "Admin privileges required." },
    404: { description: "Flight not found." },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/admin/flights/{flightId}",
  tags: ["Admin"],
  summary: "Delete Flight",
  description: "Delete an unscheduled or empty flight.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ flightId: z.string() }),
  },
  responses: {
    200: { description: "Flight removed." },
    400: { description: "Cannot delete flight with active bookings." },
    403: { description: "Admin privileges required." },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/admin/bookings",
  tags: ["Admin"],
  summary: "Admin List Bookings",
  description: "Paginated list of all bookings across all customers.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: adminBookingQuerySchema,
  },
  responses: {
    200: { description: "Paginated list of bookings." },
    403: { description: "Admin privileges required." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/admin/bookings/{pnr}/cancel",
  tags: ["Admin"],
  summary: "Admin Cancel Booking",
  description: "Administrative override to cancel any booking.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: pnrParamSchema,
  },
  responses: {
    200: { description: "Booking cancelled." },
    403: { description: "Admin privileges required." },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/admin/users",
  tags: ["Admin"],
  summary: "List Users",
  description: "List registered users.",
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: { description: "List of users." },
    403: { description: "Admin privileges required." },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/admin/users/{userId}/role",
  tags: ["Admin"],
  summary: "Change User Role",
  description: "Promote or demote a user between customer and admin roles.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ userId: z.string() }),
    body: {
      content: { "application/json": { schema: setRoleSchema } },
    },
  },
  responses: {
    200: { description: "Role updated." },
    400: { description: "Validation failure or self-demotion blocked." },
    403: { description: "Admin privileges required." },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/admin/schedule/extend",
  tags: ["Admin"],
  summary: "Extend Flight Schedule",
  description: "Generate future flight occurrences for recurring route templates.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: { "application/json": { schema: extendScheduleSchema } },
    },
  },
  responses: {
    200: { description: "New flight dates created." },
    403: { description: "Admin privileges required." },
  },
});

/* ------------------------------------------------------------------ */
/* Generator                                                          */
/* ------------------------------------------------------------------ */

export function generateOpenApiSpec() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "SkyRoute Flight Booking API",
      version: "1.0.0",
      description:
        "Comprehensive REST API documentation for SkyRoute. Includes user authentication, flight schedules & searches, seat allocations, booking workflows, and administrative management.",
    },
    servers: [
      {
        url: "/",
        description: "Current Server Instance",
      },
    ],
  });
}
