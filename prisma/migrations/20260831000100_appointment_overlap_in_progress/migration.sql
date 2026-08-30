-- Recreate the double-booking guard so an IN_PROGRESS appointment also holds its
-- slot. Separate migration so the new enum value (added in the previous one) is
-- committed before it is referenced here.

ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS "appointment_no_overlap";

ALTER TABLE "Appointment"
  ADD CONSTRAINT "appointment_no_overlap"
  EXCLUDE USING gist (
    "employeeId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'));
