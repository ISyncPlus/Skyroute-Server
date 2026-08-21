/**
 * Reference data and the schedule generator.
 * ------------------------------------------
 * A realistic but entirely fictional schedule, expanded from route templates
 * into concrete departures. The airports, aircraft layouts and routes are
 * carried over unchanged from the browser build so that fares, seat maps and
 * flight numbers are identical either side of the migration.
 *
 * One thing did have to change. In the browser, "09:15" meant nine-fifteen
 * where the user was sitting, and Date's local-time methods were exactly
 * right. A server has no such luck: it might run in UTC in Frankfurt while the
 * airline it is simulating operates out of Lagos, and a departure board that
 * shifts by an hour depending on where the process happens to be deployed is
 * not a departure board. Departure times are therefore anchored explicitly to
 * Africa/Lagos and stored as absolute instants.
 */

import type { Airport, CabinConfig, Flight } from "./types.js";

export const AIRPORTS: Airport[] = [
  { code: "LOS", city: "Lagos", name: "Murtala Muhammed International", country: "Nigeria" },
  { code: "ABV", city: "Abuja", name: "Nnamdi Azikiwe International", country: "Nigeria" },
  { code: "PHC", city: "Port Harcourt", name: "Port Harcourt International", country: "Nigeria" },
  { code: "KAN", city: "Kano", name: "Mallam Aminu Kano International", country: "Nigeria" },
  { code: "ENU", city: "Enugu", name: "Akanu Ibiam International", country: "Nigeria" },
  { code: "QOW", city: "Owerri", name: "Sam Mbakwe International Cargo", country: "Nigeria" },
  { code: "CBQ", city: "Calabar", name: "Margaret Ekpo International", country: "Nigeria" },
  { code: "BNI", city: "Benin City", name: "Benin Airport", country: "Nigeria" },
  { code: "ACC", city: "Accra", name: "Kotoka International", country: "Ghana" },
  { code: "NBO", city: "Nairobi", name: "Jomo Kenyatta International", country: "Kenya" },
  { code: "JNB", city: "Johannesburg", name: "O. R. Tambo International", country: "South Africa" },
  { code: "CAI", city: "Cairo", name: "Cairo International", country: "Egypt" },
  { code: "LHR", city: "London", name: "Heathrow", country: "United Kingdom" },
  { code: "DXB", city: "Dubai", name: "Dubai International", country: "United Arab Emirates" },
  { code: "JFK", city: "New York", name: "John F. Kennedy International", country: "United States" },
  { code: "CDG", city: "Paris", name: "Charles de Gaulle", country: "France" },
];

/** Cabin layouts keyed by aircraft type. */
export const AIRCRAFT_LAYOUTS: Record<string, CabinConfig[]> = {
  "Embraer E175": [
    { cabin: "business", startRow: 1, endRow: 2, columns: ["A", "C", "D", "F"] },
    { cabin: "economy", startRow: 6, endRow: 20, columns: ["A", "C", "D", "F"] },
  ],
  "Bombardier CRJ900": [
    { cabin: "business", startRow: 1, endRow: 2, columns: ["A", "C", "D", "F"] },
    { cabin: "economy", startRow: 6, endRow: 22, columns: ["A", "C", "D", "F"] },
  ],
  "Boeing 737-800": [
    { cabin: "business", startRow: 1, endRow: 3, columns: ["A", "C", "D", "F"] },
    { cabin: "economy", startRow: 8, endRow: 32, columns: ["A", "B", "C", "D", "E", "F"] },
  ],
  "Airbus A320neo": [
    { cabin: "business", startRow: 1, endRow: 3, columns: ["A", "C", "D", "F"] },
    { cabin: "economy", startRow: 8, endRow: 30, columns: ["A", "B", "C", "D", "E", "F"] },
  ],
  "Boeing 787-9": [
    { cabin: "first", startRow: 1, endRow: 2, columns: ["A", "D", "G", "K"] },
    { cabin: "business", startRow: 5, endRow: 10, columns: ["A", "C", "D", "G", "H", "K"] },
    { cabin: "economy", startRow: 20, endRow: 42, columns: ["A", "B", "C", "D", "E", "F", "G", "H", "K"] },
  ],
  "Airbus A330-300": [
    { cabin: "first", startRow: 1, endRow: 2, columns: ["A", "D", "G", "K"] },
    { cabin: "business", startRow: 5, endRow: 9, columns: ["A", "C", "D", "G", "H", "K"] },
    { cabin: "economy", startRow: 20, endRow: 40, columns: ["A", "B", "C", "D", "E", "F", "G", "H", "K"] },
  ],
};

/** Rows that sit beside an emergency exit, per aircraft type. */
export const EXIT_ROWS: Record<string, number[]> = {
  "Embraer E175": [11],
  "Bombardier CRJ900": [12],
  "Boeing 737-800": [16, 17],
  "Airbus A320neo": [15, 16],
  "Boeing 787-9": [20, 30],
  "Airbus A330-300": [20, 29],
};

interface RouteTemplate {
  origin: string;
  destination: string;
  airline: string;
  airlineCode: string;
  aircraft: string;
  baseFare: number;
  durationMinutes: number;
  /** Local departure times, 24-hour "HH:MM". */
  departures: string[];
  /** 0 = Sunday. Omit for daily service. */
  daysOfWeek?: number[];
}

export const ROUTES: RouteTemplate[] = [
  // ---- Nigerian domestic trunk routes ----
  { origin: "LOS", destination: "ABV", airline: "Air Peace", airlineCode: "P4", aircraft: "Boeing 737-800", baseFare: 118000, durationMinutes: 70, departures: ["06:30", "09:15", "13:40", "18:05"] },
  { origin: "ABV", destination: "LOS", airline: "Air Peace", airlineCode: "P4", aircraft: "Boeing 737-800", baseFare: 118000, durationMinutes: 70, departures: ["07:00", "11:20", "15:45", "19:30"] },
  { origin: "LOS", destination: "ABV", airline: "Ibom Air", airlineCode: "QI", aircraft: "Bombardier CRJ900", baseFare: 132000, durationMinutes: 75, departures: ["07:45", "16:10"] },
  { origin: "ABV", destination: "LOS", airline: "Ibom Air", airlineCode: "QI", aircraft: "Bombardier CRJ900", baseFare: 132000, durationMinutes: 75, departures: ["10:05", "17:55"] },
  { origin: "LOS", destination: "PHC", airline: "Air Peace", airlineCode: "P4", aircraft: "Embraer E175", baseFare: 126000, durationMinutes: 60, departures: ["08:00", "14:25"] },
  { origin: "PHC", destination: "LOS", airline: "Air Peace", airlineCode: "P4", aircraft: "Embraer E175", baseFare: 126000, durationMinutes: 60, departures: ["10:15", "16:40"] },
  { origin: "LOS", destination: "ENU", airline: "United Nigeria", airlineCode: "U5", aircraft: "Embraer E175", baseFare: 109000, durationMinutes: 65, departures: ["09:30", "15:20"] },
  { origin: "ENU", destination: "LOS", airline: "United Nigeria", airlineCode: "U5", aircraft: "Embraer E175", baseFare: 109000, durationMinutes: 65, departures: ["11:40", "17:15"] },
  { origin: "LOS", destination: "KAN", airline: "Max Air", airlineCode: "VM", aircraft: "Boeing 737-800", baseFare: 145000, durationMinutes: 105, departures: ["07:20", "13:00"] },
  { origin: "KAN", destination: "LOS", airline: "Max Air", airlineCode: "VM", aircraft: "Boeing 737-800", baseFare: 145000, durationMinutes: 105, departures: ["10:00", "15:50"] },
  { origin: "LOS", destination: "QOW", airline: "Green Africa", airlineCode: "Q9", aircraft: "Embraer E175", baseFare: 98000, durationMinutes: 60, departures: ["08:40", "16:55"] },
  { origin: "QOW", destination: "LOS", airline: "Green Africa", airlineCode: "Q9", aircraft: "Embraer E175", baseFare: 98000, durationMinutes: 60, departures: ["10:50", "18:20"] },
  { origin: "LOS", destination: "CBQ", airline: "Ibom Air", airlineCode: "QI", aircraft: "Bombardier CRJ900", baseFare: 112000, durationMinutes: 70, departures: ["12:10"], daysOfWeek: [1, 3, 5, 6] },
  { origin: "CBQ", destination: "LOS", airline: "Ibom Air", airlineCode: "QI", aircraft: "Bombardier CRJ900", baseFare: 112000, durationMinutes: 70, departures: ["14:20"], daysOfWeek: [1, 3, 5, 6] },
  { origin: "LOS", destination: "BNI", airline: "Overland Airways", airlineCode: "OJ", aircraft: "Embraer E175", baseFare: 94000, durationMinutes: 45, departures: ["09:00"], daysOfWeek: [1, 2, 4, 5] },
  { origin: "BNI", destination: "LOS", airline: "Overland Airways", airlineCode: "OJ", aircraft: "Embraer E175", baseFare: 94000, durationMinutes: 45, departures: ["11:30"], daysOfWeek: [1, 2, 4, 5] },
  { origin: "ABV", destination: "PHC", airline: "Air Peace", airlineCode: "P4", aircraft: "Embraer E175", baseFare: 121000, durationMinutes: 75, departures: ["08:20", "17:30"] },
  { origin: "PHC", destination: "ABV", airline: "Air Peace", airlineCode: "P4", aircraft: "Embraer E175", baseFare: 121000, durationMinutes: 75, departures: ["10:35", "19:15"] },
  { origin: "ABV", destination: "KAN", airline: "Azman Air", airlineCode: "AZ", aircraft: "Airbus A320neo", baseFare: 105000, durationMinutes: 55, departures: ["12:45"] },
  { origin: "KAN", destination: "ABV", airline: "Azman Air", airlineCode: "AZ", aircraft: "Airbus A320neo", baseFare: 105000, durationMinutes: 55, departures: ["14:40"] },

  // ---- Regional Africa ----
  { origin: "LOS", destination: "ACC", airline: "Africa World Airlines", airlineCode: "AW", aircraft: "Embraer E175", baseFare: 285000, durationMinutes: 60, departures: ["11:00", "18:30"] },
  { origin: "ACC", destination: "LOS", airline: "Africa World Airlines", airlineCode: "AW", aircraft: "Embraer E175", baseFare: 285000, durationMinutes: 60, departures: ["13:15", "20:40"] },
  { origin: "LOS", destination: "NBO", airline: "Kenya Airways", airlineCode: "KQ", aircraft: "Boeing 787-9", baseFare: 640000, durationMinutes: 315, departures: ["14:50"] },
  { origin: "NBO", destination: "LOS", airline: "Kenya Airways", airlineCode: "KQ", aircraft: "Boeing 787-9", baseFare: 640000, durationMinutes: 330, departures: ["09:10"] },
  { origin: "LOS", destination: "JNB", airline: "South African Airways", airlineCode: "SA", aircraft: "Airbus A330-300", baseFare: 720000, durationMinutes: 375, departures: ["13:05"], daysOfWeek: [0, 2, 4, 6] },
  { origin: "JNB", destination: "LOS", airline: "South African Airways", airlineCode: "SA", aircraft: "Airbus A330-300", baseFare: 720000, durationMinutes: 360, departures: ["21:40"], daysOfWeek: [0, 2, 4, 6] },
  { origin: "ABV", destination: "CAI", airline: "EgyptAir", airlineCode: "MS", aircraft: "Boeing 737-800", baseFare: 690000, durationMinutes: 300, departures: ["23:15"], daysOfWeek: [1, 4] },
  { origin: "CAI", destination: "ABV", airline: "EgyptAir", airlineCode: "MS", aircraft: "Boeing 737-800", baseFare: 690000, durationMinutes: 315, departures: ["15:30"], daysOfWeek: [1, 4] },

  // ---- Long haul ----
  { origin: "LOS", destination: "LHR", airline: "British Airways", airlineCode: "BA", aircraft: "Boeing 787-9", baseFare: 1180000, durationMinutes: 400, departures: ["22:35"] },
  { origin: "LHR", destination: "LOS", airline: "British Airways", airlineCode: "BA", aircraft: "Boeing 787-9", baseFare: 1180000, durationMinutes: 385, departures: ["11:25"] },
  { origin: "LOS", destination: "DXB", airline: "Emirates", airlineCode: "EK", aircraft: "Boeing 777-300ER", baseFare: 1050000, durationMinutes: 435, departures: ["15:20"] },
  { origin: "DXB", destination: "LOS", airline: "Emirates", airlineCode: "EK", aircraft: "Boeing 777-300ER", baseFare: 1050000, durationMinutes: 465, departures: ["09:45"] },
  { origin: "LOS", destination: "CDG", airline: "Air France", airlineCode: "AF", aircraft: "Airbus A330-300", baseFare: 1120000, durationMinutes: 390, departures: ["23:50"], daysOfWeek: [0, 1, 3, 5] },
  { origin: "CDG", destination: "LOS", airline: "Air France", airlineCode: "AF", aircraft: "Airbus A330-300", baseFare: 1120000, durationMinutes: 375, departures: ["10:30"], daysOfWeek: [0, 1, 3, 5] },
  { origin: "LOS", destination: "JFK", airline: "Delta Air Lines", airlineCode: "DL", aircraft: "Airbus A330-300", baseFare: 1480000, durationMinutes: 675, departures: ["23:10"], daysOfWeek: [2, 4, 6] },
  { origin: "JFK", destination: "LOS", airline: "Delta Air Lines", airlineCode: "DL", aircraft: "Airbus A330-300", baseFare: 1480000, durationMinutes: 640, departures: ["12:00"], daysOfWeek: [2, 4, 6] },
];

/** The 777-300ER shares the 787-9 layout for the purposes of the simulation. */
AIRCRAFT_LAYOUTS["Boeing 777-300ER"] = AIRCRAFT_LAYOUTS["Boeing 787-9"]!;
EXIT_ROWS["Boeing 777-300ER"] = EXIT_ROWS["Boeing 787-9"]!;

/* ------------------------------------------------------------------ */
/* Schedule generation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Nigeria observes UTC+01:00 all year and has never operated daylight saving,
 * so a fixed offset is correct rather than merely convenient. Were the airline
 * to serve a country that does shift, this would have to become a real
 * timezone lookup — the offset would no longer be a constant.
 */
export const OPERATING_TZ_OFFSET = "+01:00";

/** Days of schedule generated ahead of the current date. */
export const SCHEDULE_HORIZON_DAYS = 21;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** YYYY-MM-DD in the operating timezone. */
export function toDateKey(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

/**
 * The absolute instant at which "HH:MM on this calendar date, Lagos time"
 * occurs. Building the string and letting Date parse the offset avoids the
 * trap of `new Date(y, m, d, h)`, which silently means the *server's* timezone.
 */
export function atOperatingTime(dateKey: string, hours: number, minutes: number): Date {
  return new Date(`${dateKey}T${pad(hours)}:${pad(minutes)}:00${OPERATING_TZ_OFFSET}`);
}

/** Advance a YYYY-MM-DD key by whole days without touching timezones. */
function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Day of the week (0 = Sunday) for a calendar date in the operating timezone. */
function weekdayOf(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export interface GeneratedFlight extends Omit<Flight, "cabins"> {
  /** Cabins live on the aircraft record in the database, not on the flight. */
  aircraft: string;
}

/**
 * Expand the route templates into concrete departures covering `horizonDays`
 * from `from`. Departures already in the past are skipped, so re-running this
 * to extend the schedule never back-fills flights that cannot be sold.
 */
export function generateSchedule(
  from: Date = new Date(),
  horizonDays: number = SCHEDULE_HORIZON_DAYS,
): GeneratedFlight[] {
  const flights: GeneratedFlight[] = [];
  const startKey = toDateKey(from);
  const now = from.getTime();

  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset += 1) {
    const dateKey = addDays(startKey, dayOffset);
    const weekday = weekdayOf(dateKey);

    ROUTES.forEach((route, routeIndex) => {
      if (route.daysOfWeek && !route.daysOfWeek.includes(weekday)) return;

      route.departures.forEach((departure, departureIndex) => {
        const [hours, minutes] = departure.split(":").map(Number) as [number, number];
        const departureAt = atOperatingTime(dateKey, hours, minutes);

        // A departure that has already gone cannot be sold.
        if (departureAt.getTime() <= now) return;

        const arrivalAt = new Date(departureAt.getTime() + route.durationMinutes * 60_000);
        const sequence = 100 + routeIndex * 7 + departureIndex * 2;
        const flightNumber = `${route.airlineCode}${sequence}`;

        flights.push({
          id: `${flightNumber}-${dateKey}-${pad(hours)}${pad(minutes)}`,
          flightNumber,
          airline: route.airline,
          airlineCode: route.airlineCode,
          originCode: route.origin,
          destinationCode: route.destination,
          departureTime: departureAt.toISOString(),
          arrivalTime: arrivalAt.toISOString(),
          durationMinutes: route.durationMinutes,
          aircraft: route.aircraft,
          baseFare: route.baseFare,
          currency: "NGN",
          blockedSeats: [],
          status: "scheduled",
        });
      });
    });
  }

  return flights;
}

/** Look up an airport by IATA code. */
export function findAirport(code: string, airports: Airport[] = AIRPORTS): Airport | undefined {
  return airports.find((airport) => airport.code === code.toUpperCase());
}
