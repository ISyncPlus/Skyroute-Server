/**
 * Validation rules.
 * -----------------
 * Pure functions, shared by the UI (for inline field errors) and by the
 * repository (as a last line of defence before anything is written to
 * storage). Validating in both places means a user cannot bypass the rules by
 * editing localStorage by hand and reloading.
 */

import type { PassengerType, Payment, SearchCriteria } from "./types.js";

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export const MAX_PASSENGERS_PER_BOOKING = 9;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
/** Nigerian mobile numbers, with or without the +234 country code. */
const PHONE_PATTERN = /^(\+?234|0)[7-9][0-1]\d{8}$/;
const NAME_PATTERN = /^[A-Za-z][A-Za-z' -]{1,49}$/;
const PASSPORT_PATTERN = /^[A-Z0-9]{6,12}$/i;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test((value ?? "").trim());
}

export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test((value ?? "").replace(/[\s-]/g, ""));
}

export function isValidName(value: string): boolean {
  return NAME_PATTERN.test((value ?? "").trim());
}

export function isValidPassport(value: string): boolean {
  return PASSPORT_PATTERN.test((value ?? "").trim());
}

/**
 * Password policy: at least 8 characters with a lower-case letter, an
 * upper-case letter and a digit.
 */
export function validatePassword(password: string): ValidationResult {
  const errors: Record<string, string> = {};
  const value = password ?? "";

  if (value.length < 8) errors.password = "Password must be at least 8 characters long.";
  else if (!/[a-z]/.test(value)) errors.password = "Password must contain a lower-case letter.";
  else if (!/[A-Z]/.test(value)) errors.password = "Password must contain an upper-case letter.";
  else if (!/\d/.test(value)) errors.password = "Password must contain a number.";

  return { valid: Object.keys(errors).length === 0, errors };
}

/** Registration form rules. */
export function validateRegistration(input: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}): ValidationResult {
  const errors: Record<string, string> = {};

  if (!input.fullName?.trim()) errors.fullName = "Full name is required.";
  else if (input.fullName.trim().split(/\s+/).length < 2) errors.fullName = "Please enter both first and last name.";

  if (!input.email?.trim()) errors.email = "Email address is required.";
  else if (!isValidEmail(input.email)) errors.email = "Enter a valid email address.";

  if (!input.phone?.trim()) errors.phone = "Phone number is required.";
  else if (!isValidPhone(input.phone)) errors.phone = "Enter a valid Nigerian phone number, e.g. 08031234567.";

  const passwordCheck = validatePassword(input.password);
  Object.assign(errors, passwordCheck.errors);

  if (input.password !== input.confirmPassword) errors.confirmPassword = "Passwords do not match.";

  return { valid: Object.keys(errors).length === 0, errors };
}

/** Search form rules. */
export function validateSearch(criteria: Partial<SearchCriteria>, today: Date = new Date()): ValidationResult {
  const errors: Record<string, string> = {};

  if (!criteria.originCode) errors.originCode = "Select a departure airport.";
  if (!criteria.destinationCode) errors.destinationCode = "Select an arrival airport.";
  if (
    criteria.originCode &&
    criteria.destinationCode &&
    criteria.originCode === criteria.destinationCode
  ) {
    errors.destinationCode = "Departure and arrival airports must be different.";
  }

  if (!criteria.departureDate) {
    errors.departureDate = "Select a departure date.";
  } else {
    const selected = new Date(`${criteria.departureDate}T00:00:00`);
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (Number.isNaN(selected.getTime())) errors.departureDate = "Enter a valid date.";
    else if (selected < midnight) errors.departureDate = "Departure date cannot be in the past.";
  }

  const adults = criteria.adults ?? 0;
  const children = criteria.children ?? 0;
  const infants = criteria.infants ?? 0;

  if (adults < 1) errors.adults = "At least one adult is required on a booking.";
  if (adults + children + infants > MAX_PASSENGERS_PER_BOOKING) {
    errors.adults = `A single booking may not exceed ${MAX_PASSENGERS_PER_BOOKING} passengers.`;
  }
  if (infants > adults) errors.infants = "Each infant must be accompanied by an adult.";

  return { valid: Object.keys(errors).length === 0, errors };
}

/** Age band implied by a date of birth on the travel date. */
export function passengerTypeForAge(dateOfBirth: string, travelDate: string): PassengerType | null {
  const dob = new Date(`${dateOfBirth}T00:00:00`);
  const travel = new Date(travelDate);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(travel.getTime())) return null;

  let age = travel.getFullYear() - dob.getFullYear();
  const monthDelta = travel.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && travel.getDate() < dob.getDate())) age -= 1;

  if (age < 0) return null;
  if (age < 2) return "infant";
  if (age < 12) return "child";
  return "adult";
}

/** Passenger detail rules, including the age-band cross-check. */
export function validatePassenger(
  passenger: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    passportNumber: string;
    type: PassengerType;
  },
  travelDate: string,
  requirePassport: boolean,
): ValidationResult {
  const errors: Record<string, string> = {};

  if (!passenger.firstName?.trim()) errors.firstName = "First name is required.";
  else if (!isValidName(passenger.firstName)) errors.firstName = "Enter a valid first name.";

  if (!passenger.lastName?.trim()) errors.lastName = "Surname is required.";
  else if (!isValidName(passenger.lastName)) errors.lastName = "Enter a valid surname.";

  if (!passenger.dateOfBirth) {
    errors.dateOfBirth = "Date of birth is required.";
  } else {
    const derived = passengerTypeForAge(passenger.dateOfBirth, travelDate);
    if (derived === null) errors.dateOfBirth = "Enter a valid date of birth.";
    else if (derived !== passenger.type) {
      errors.dateOfBirth = `This date of birth corresponds to an ${derived} fare, not an ${passenger.type} fare.`;
    }
  }

  if (requirePassport) {
    if (!passenger.passportNumber?.trim()) errors.passportNumber = "Passport number is required for international travel.";
    else if (!isValidPassport(passenger.passportNumber)) errors.passportNumber = "Enter a valid passport number (6-12 letters or digits).";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Luhn check digit algorithm - the same check real payment processors run
 * before a card is sent to the network. Included so the simulated payment
 * step performs a genuine, verifiable validation rather than accepting any
 * sixteen digits.
 */
export function luhnCheck(cardNumber: string): boolean {
  const digits = (cardNumber ?? "").replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Card brand inferred from the leading digits. */
export function detectCardBrand(cardNumber: string): string {
  const digits = (cardNumber ?? "").replace(/\D/g, "");
  if (/^4/.test(digits)) return "Visa";
  if (/^5[1-5]/.test(digits)) return "Mastercard";
  if (/^506(0|1|2|3|4|5)/.test(digits) || /^650/.test(digits)) return "Verve";
  if (/^3[47]/.test(digits)) return "American Express";
  return "Card";
}

/** Expiry must be a real month that has not yet passed. */
export function isValidExpiry(expiry: string, now: Date = new Date()): boolean {
  const match = /^(\d{2})\s*\/\s*(\d{2})$/.exec((expiry ?? "").trim());
  if (!match) return false;

  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;

  // Valid through the last day of the stated month.
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);
  return endOfMonth >= now;
}

/** Payment form rules. */
export function validatePayment(input: {
  /** Defaults to `card` so older callers keep their behaviour. */
  method?: Payment["method"];
  cardHolder: string;
  cardNumber: string;
  expiry: string;
  cvv: string;
}, now: Date = new Date()): ValidationResult {
  const errors: Record<string, string> = {};

  /* Only a card is authorised by what the payer types. A transfer is confirmed
     against the reference on the receiving account, and a wallet against the
     wallet's own balance — demanding a card number for either is what made
     those two methods impossible to complete. */
  if ((input.method ?? "card") !== "card") return { valid: true, errors };

  if (!input.cardHolder?.trim()) errors.cardHolder = "Cardholder name is required.";
  else if (input.cardHolder.trim().length < 3) errors.cardHolder = "Enter the name as printed on the card.";

  if (!input.cardNumber?.trim()) errors.cardNumber = "Card number is required.";
  else if (!luhnCheck(input.cardNumber)) errors.cardNumber = "That card number is not valid.";

  if (!input.expiry?.trim()) errors.expiry = "Expiry date is required.";
  else if (!isValidExpiry(input.expiry, now)) errors.expiry = "Enter a valid, unexpired date as MM/YY.";

  if (!input.cvv?.trim()) errors.cvv = "CVV is required.";
  else if (!/^\d{3,4}$/.test(input.cvv.trim())) errors.cvv = "CVV must be 3 or 4 digits.";

  return { valid: Object.keys(errors).length === 0, errors };
}

/** Show only the last four digits, exactly as a real receipt would. */
export function maskCardNumber(cardNumber: string): string {
  const digits = (cardNumber ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `**** **** **** ${digits.slice(-4)}`;
}

/**
 * Escape characters that carry meaning in HTML. Values read back from
 * localStorage are treated as untrusted input, since a user can edit them
 * directly through the browser's developer tools.
 */
export function sanitiseText(value: string, maxLength = 200): string {
  return (value ?? "")
    .toString()
    .slice(0, maxLength)
    .replace(/[<>]/g, "")
    .trim();
}
