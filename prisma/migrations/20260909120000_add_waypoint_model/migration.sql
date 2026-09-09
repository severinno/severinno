-- CreateTable
CREATE TABLE "Waypoint" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "label" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "arrivalEstimate" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "geofenceRadiusMeters" INTEGER NOT NULL DEFAULT 200,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Waypoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Waypoint_bookingId_idx" ON "Waypoint"("bookingId");

-- CreateIndex
CREATE INDEX "Waypoint_bookingId_order_idx" ON "Waypoint"("bookingId", "order");

-- CreateIndex
CREATE INDEX "Waypoint_bookingId_arrivedAt_idx" ON "Waypoint"("bookingId", "arrivedAt");

-- AddForeignKey
ALTER TABLE "Waypoint" ADD CONSTRAINT "Waypoint_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
