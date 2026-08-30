-- Slice 3: team / services / scheduling schema additions.
-- The new AppointmentStatus value is added here; the overlap constraint that
-- references it is recreated in the NEXT migration (a new enum value cannot be
-- used in the same transaction that adds it).

-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS' BEFORE 'COMPLETED';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CommissionType" AS ENUM ('PERCENT', 'FIXED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: Employee
ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "commissionType" "CommissionType" NOT NULL DEFAULT 'PERCENT',
  ADD COLUMN IF NOT EXISTS "commissionFixedCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: BusinessHour
ALTER TABLE "BusinessHour"
  ADD COLUMN IF NOT EXISTS "breakStartMin" INTEGER,
  ADD COLUMN IF NOT EXISTS "breakEndMin" INTEGER;

-- AlterTable: Appointment (service snapshot + lifecycle timestamps)
ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "serviceName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "durationMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "bufferMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "noShowAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdById" TEXT;
