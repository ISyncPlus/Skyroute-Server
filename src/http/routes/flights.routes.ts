/** Public flight discovery: airports, search, seat maps. */

import { Router, type Request, type Response } from "express";
import { query, validate } from "../middleware/validate.js";
import { alternativeDatesSchema, searchSchema, type SearchInput } from "../schemas.js";
import {
  datesWithFlights,
  getFlight,
  getSeatMap,
  listAirports,
  search,
} from "../../services/flight.service.js";

export const flightRoutes = Router();

flightRoutes.get("/airports", async (_req: Request, res: Response) => {
  res.json({ airports: await listAirports() });
});

/**
 * Search is exposed as both GET and POST.
 *
 * GET keeps a search shareable and bookmarkable, which is what people expect
 * of a results page. POST exists because a multi-city journey carries an array
 * of legs that does not belong in a query string.
 */
flightRoutes.get(
  "/search",
  validate(searchSchema, "query"),
  async (req: Request, res: Response) => {
    res.json(await search(query<SearchInput>(req)));
  },
);

flightRoutes.post("/search", validate(searchSchema), async (req: Request, res: Response) => {
  res.json(await search(req.body));
});

/**
 * Dates on this route that actually have departures — what turns an empty
 * results page into "nothing on the 14th, but there are seats on the 15th".
 */
flightRoutes.get(
  "/alternative-dates",
  validate(alternativeDatesSchema, "query"),
  async (req: Request, res: Response) => {
    const { originCode, destinationCode } = query<{
      originCode: string;
      destinationCode: string;
    }>(req);
    res.json({ dates: await datesWithFlights(originCode, destinationCode) });
  },
);

flightRoutes.get("/:flightId", async (req: Request, res: Response) => {
  res.json({ flight: await getFlight(req.params.flightId as string) });
});

flightRoutes.get("/:flightId/seats", async (req: Request, res: Response) => {
  res.json(await getSeatMap(req.params.flightId as string));
});
