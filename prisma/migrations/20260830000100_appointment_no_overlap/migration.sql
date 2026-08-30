-- Prevent double-booking a barber at the database level (defence in depth on top
-- of the serializable service-layer check). Overlap is only disallowed between
-- appointments that still occupy the slot (not canceled / no-show).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "appointment_no_overlap"
  EXCLUDE USING gist (
    "employeeId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING', 'CONFIRMED', 'COMPLETED'));
