-- CreateEnum
CREATE TYPE "cabin_class" AS ENUM ('economy', 'business', 'first');

-- CreateEnum
CREATE TYPE "passenger_type" AS ENUM ('adult', 'child', 'infant');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('confirmed', 'cancelled', 'pending');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('successful', 'failed', 'pending');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('card', 'transfer', 'wallet');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('customer', 'admin');

-- CreateEnum
CREATE TYPE "flight_status" AS ENUM ('scheduled', 'delayed', 'cancelled');

-- CreateEnum
CREATE TYPE "trip_type" AS ENUM ('one-way', 'round-trip', 'multi-city');

-- CreateTable
CREATE TABLE "airports" (
    "code" CHAR(3) NOT NULL,
    "city" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,

    CONSTRAINT "airports_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "aircraft" (
    "type" TEXT NOT NULL,
    "exit_rows" INTEGER[],

    CONSTRAINT "aircraft_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "aircraft_cabins" (
    "id" SERIAL NOT NULL,
    "aircraft_type" TEXT NOT NULL,
    "cabin" "cabin_class" NOT NULL,
    "start_row" INTEGER NOT NULL,
    "end_row" INTEGER NOT NULL,
    "columns" TEXT[],

    CONSTRAINT "aircraft_cabins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flights" (
    "id" TEXT NOT NULL,
    "flight_number" TEXT NOT NULL,
    "airline" TEXT NOT NULL,
    "airline_code" VARCHAR(3) NOT NULL,
    "origin_code" CHAR(3) NOT NULL,
    "destination_code" CHAR(3) NOT NULL,
    "departure_time" TIMESTAMPTZ(3) NOT NULL,
    "arrival_time" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "aircraft_type" TEXT NOT NULL,
    "base_fare" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "blocked_seats" TEXT[],
    "status" "flight_status" NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "flights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "phone" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'customer',
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,
    "ip" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "pnr" CHAR(6) NOT NULL,
    "user_id" TEXT,
    "trip_type" "trip_type" NOT NULL DEFAULT 'one-way',
    "status" "booking_status" NOT NULL DEFAULT 'confirmed',
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "base_fare_total" INTEGER NOT NULL,
    "cabin_surcharge" INTEGER NOT NULL,
    "seat_selection_fee" INTEGER NOT NULL,
    "taxes" INTEGER NOT NULL,
    "service_charge" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    "refund_amount" INTEGER,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("pnr")
);

-- CreateTable
CREATE TABLE "booking_segments" (
    "id" TEXT NOT NULL,
    "booking_pnr" CHAR(6) NOT NULL,
    "flight_id" TEXT NOT NULL,
    "cabin" "cabin_class" NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "booking_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passengers" (
    "id" TEXT NOT NULL,
    "booking_pnr" CHAR(6) NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" TEXT NOT NULL,
    "passport_number" TEXT,
    "type" "passenger_type" NOT NULL,

    CONSTRAINT "passengers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_assignments" (
    "id" TEXT NOT NULL,
    "segment_id" TEXT NOT NULL,
    "passenger_id" TEXT NOT NULL,
    "flight_id" TEXT NOT NULL,
    "seat_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "seat_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "booking_pnr" CHAR(6) NOT NULL,
    "method" "payment_method" NOT NULL,
    "masked_card_number" TEXT NOT NULL,
    "card_holder" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "payment_status" NOT NULL,
    "transaction_reference" TEXT NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "failure_reason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "aircraft_cabins_aircraft_type_cabin_key" ON "aircraft_cabins"("aircraft_type", "cabin");

-- CreateIndex
CREATE INDEX "flights_origin_code_destination_code_departure_time_idx" ON "flights"("origin_code", "destination_code", "departure_time");

-- CreateIndex
CREATE INDEX "flights_departure_time_idx" ON "flights"("departure_time");

-- CreateIndex
CREATE INDEX "flights_status_idx" ON "flights"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "oauth_accounts_user_id_idx" ON "oauth_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_provider_account_id_key" ON "oauth_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "bookings_user_id_idx" ON "bookings"("user_id");

-- CreateIndex
CREATE INDEX "bookings_created_at_idx" ON "bookings"("created_at");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "booking_segments_flight_id_idx" ON "booking_segments"("flight_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_segments_booking_pnr_position_key" ON "booking_segments"("booking_pnr", "position");

-- CreateIndex
CREATE INDEX "passengers_booking_pnr_idx" ON "passengers"("booking_pnr");

-- CreateIndex
CREATE INDEX "passengers_last_name_idx" ON "passengers"("last_name");

-- CreateIndex
CREATE UNIQUE INDEX "passengers_booking_pnr_position_key" ON "passengers"("booking_pnr", "position");

-- CreateIndex
CREATE INDEX "seat_assignments_flight_id_active_idx" ON "seat_assignments"("flight_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "seat_assignments_segment_id_passenger_id_key" ON "seat_assignments"("segment_id", "passenger_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_booking_pnr_key" ON "payments"("booking_pnr");

-- CreateIndex
CREATE UNIQUE INDEX "payments_transaction_reference_key" ON "payments"("transaction_reference");

-- AddForeignKey
ALTER TABLE "aircraft_cabins" ADD CONSTRAINT "aircraft_cabins_aircraft_type_fkey" FOREIGN KEY ("aircraft_type") REFERENCES "aircraft"("type") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_origin_code_fkey" FOREIGN KEY ("origin_code") REFERENCES "airports"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_destination_code_fkey" FOREIGN KEY ("destination_code") REFERENCES "airports"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_aircraft_type_fkey" FOREIGN KEY ("aircraft_type") REFERENCES "aircraft"("type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_segments" ADD CONSTRAINT "booking_segments_booking_pnr_fkey" FOREIGN KEY ("booking_pnr") REFERENCES "bookings"("pnr") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_segments" ADD CONSTRAINT "booking_segments_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_booking_pnr_fkey" FOREIGN KEY ("booking_pnr") REFERENCES "bookings"("pnr") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "booking_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_pnr_fkey" FOREIGN KEY ("booking_pnr") REFERENCES "bookings"("pnr") ON DELETE CASCADE ON UPDATE CASCADE;
