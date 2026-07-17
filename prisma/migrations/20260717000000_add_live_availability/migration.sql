ALTER TABLE "Store"
ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN "availabilityEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BusinessHour" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "isClosed" BOOLEAN NOT NULL DEFAULT false,
  "openMinute" INTEGER NOT NULL DEFAULT 540,
  "closeMinute" INTEGER NOT NULL DEFAULT 1020,
  CONSTRAINT "BusinessHour_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AvailabilityResource" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "singularLabel" TEXT NOT NULL,
  "totalCapacity" INTEGER NOT NULL,
  "availableNow" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AvailabilityResource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AvailabilityException" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "isClosed" BOOLEAN NOT NULL DEFAULT true,
  "openMinute" INTEGER,
  "closeMinute" INTEGER,
  "note" TEXT,
  CONSTRAINT "AvailabilityException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessHour_storeId_dayOfWeek_key" ON "BusinessHour"("storeId", "dayOfWeek");
CREATE INDEX "BusinessHour_storeId_idx" ON "BusinessHour"("storeId");
CREATE INDEX "AvailabilityResource_storeId_idx" ON "AvailabilityResource"("storeId");
CREATE UNIQUE INDEX "AvailabilityException_storeId_date_key" ON "AvailabilityException"("storeId", "date");
CREATE INDEX "AvailabilityException_storeId_date_idx" ON "AvailabilityException"("storeId", "date");

ALTER TABLE "BusinessHour" ADD CONSTRAINT "BusinessHour_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityResource" ADD CONSTRAINT "AvailabilityResource_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityException" ADD CONSTRAINT "AvailabilityException_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
