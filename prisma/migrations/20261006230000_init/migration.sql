CREATE TABLE "channels" (
    "channel_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(36) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "provider_key_hash" VARCHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "channels_pkey" PRIMARY KEY ("channel_id")
);
CREATE UNIQUE INDEX "channels_slug_key" ON "channels"("slug");

CREATE TABLE "external_reservations" (
    "external_reservation_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channel_id" UUID NOT NULL,
    "external_id" VARCHAR(100) NOT NULL,
    "booking_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "external_reservations_pkey" PRIMARY KEY ("external_reservation_id")
);
CREATE UNIQUE INDEX "external_reservations_channel_id_external_id_key"
    ON "external_reservations"("channel_id", "external_id");
CREATE UNIQUE INDEX "external_reservations_booking_id_key"
    ON "external_reservations"("booking_id");
CREATE INDEX "external_reservations_booking_id_idx" ON "external_reservations"("booking_id");
ALTER TABLE "external_reservations" ADD CONSTRAINT "external_reservations_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("channel_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "channel_inventory" (
    "channel_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "available_count" INTEGER NOT NULL,
    "blocked_count" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "channel_inventory_pkey" PRIMARY KEY ("channel_id", "room_type_id", "date")
);
CREATE INDEX "channel_inventory_room_type_id_date_idx" ON "channel_inventory"("room_type_id", "date");
ALTER TABLE "channel_inventory" ADD CONSTRAINT "channel_inventory_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("channel_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "channel_rates" (
    "projection_key" VARCHAR(220) NOT NULL,
    "channel_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "price" DECIMAL(10,2),
    "multiplier" DECIMAL(5,2),
    "min_stay" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "channel_rates_pkey" PRIMARY KEY ("projection_key")
);
CREATE INDEX "channel_rates_channel_id_room_type_id_start_date_idx"
    ON "channel_rates"("channel_id", "room_type_id", "start_date");
ALTER TABLE "channel_rates" ADD CONSTRAINT "channel_rates_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("channel_id") ON DELETE CASCADE ON UPDATE CASCADE;
