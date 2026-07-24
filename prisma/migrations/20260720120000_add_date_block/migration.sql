-- CreateTable
CREATE TABLE "DateBlock" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "startTime" TEXT,
    "endTime" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DateBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DateBlock_providerId_idx" ON "DateBlock"("providerId");

-- CreateIndex
CREATE INDEX "DateBlock_date_idx" ON "DateBlock"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DateBlock_providerId_date_startTime_endTime_key" ON "DateBlock"("providerId", "date", "startTime", "endTime");

-- AddForeignKey
ALTER TABLE "DateBlock" ADD CONSTRAINT "DateBlock_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
