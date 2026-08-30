export type SchedulingErrorCode =
  | "SERVICE_NOT_FOUND"
  | "SERVICE_INACTIVE"
  | "EMPLOYEE_NOT_FOUND"
  | "EMPLOYEE_INACTIVE"
  | "EMPLOYEE_CANT_DO_SERVICE"
  | "CUSTOMER_NOT_FOUND"
  | "APPOINTMENT_NOT_FOUND"
  | "SLOT_TAKEN"
  | "OUTSIDE_AVAILABILITY"
  | "TOO_SOON"
  | "TOO_FAR"
  | "INVALID_TRANSITION"
  | "NOT_OWN_AGENDA"
  | "VALIDATION";

export class SchedulingError extends Error {
  code: SchedulingErrorCode;
  constructor(code: SchedulingErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SchedulingError";
    this.code = code;
  }
}

export function isSchedulingError(e: unknown): e is SchedulingError {
  return e instanceof SchedulingError;
}
