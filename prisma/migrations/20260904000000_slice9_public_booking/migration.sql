-- Slice 9: public booking — opaque self-service token on the appointment.
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "publicToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_publicToken_key" ON "Appointment" ("publicToken");
