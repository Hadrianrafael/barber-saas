-- Slice 4: proper FK for Customer.preferredEmployeeId (SET NULL on barber delete).
ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_preferredEmployeeId_fkey"
  FOREIGN KEY ("preferredEmployeeId") REFERENCES "Employee"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
