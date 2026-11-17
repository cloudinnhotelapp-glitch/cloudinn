-- Room shifts of guests in house (owner request 2026-11-12). Additive only: one new table; nothing existing is changed or
-- removed.

-- CreateTable
CREATE TABLE "stay_room_shifts" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "stayId" UUID NOT NULL,
    "fromRoomId" UUID NOT NULL,
    "toRoomId" UUID NOT NULL,
    "shiftDate" DATE NOT NULL,
    "previousNightlyRate" DECIMAL(12,2) NOT NULL,
    "previousRateOverridden" BOOLEAN NOT NULL DEFAULT false,
    "previousRateOverrideReason" VARCHAR(500),
    "newNightlyRate" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(300),
    "shiftedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stay_room_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stay_room_shifts_stayId_idx" ON "stay_room_shifts"("stayId");

-- AddForeignKey
ALTER TABLE "stay_room_shifts" ADD CONSTRAINT "stay_room_shifts_locationId_businessId_fkey" FOREIGN KEY ("locationId", "businessId") REFERENCES "locations"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_room_shifts" ADD CONSTRAINT "stay_room_shifts_stayId_locationId_fkey" FOREIGN KEY ("stayId", "locationId") REFERENCES "stays"("id", "locationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_room_shifts" ADD CONSTRAINT "stay_room_shifts_fromRoomId_locationId_fkey" FOREIGN KEY ("fromRoomId", "locationId") REFERENCES "rooms"("id", "locationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_room_shifts" ADD CONSTRAINT "stay_room_shifts_toRoomId_locationId_fkey" FOREIGN KEY ("toRoomId", "locationId") REFERENCES "rooms"("id", "locationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_room_shifts" ADD CONSTRAINT "stay_room_shifts_shiftedByUserId_businessId_fkey" FOREIGN KEY ("shiftedByUserId", "businessId") REFERENCES "business_users"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A shift is always to another room, and prices are never negative.
ALTER TABLE "stay_room_shifts" ADD CONSTRAINT "stay_room_shifts_rooms_check" CHECK ("fromRoomId" <> "toRoomId");
ALTER TABLE "stay_room_shifts" ADD CONSTRAINT "stay_room_shifts_rates_check" CHECK ("previousNightlyRate" >= 0 AND "newNightlyRate" >= 0);
