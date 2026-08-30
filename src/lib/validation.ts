import { z } from "zod";

/**
 * International phone input. Users type formatted numbers — `(11) 99999-8888`,
 * `+34 600 000 000` — so we strip everything except digits and a leading `+`
 * BEFORE validating, then require 8–15 digits (E.164 range). Empty is allowed;
 * callers decide if the field is required.
 */
export const optionalPhone = z
  .string()
  .trim()
  .max(32)
  .refine((v) => v === "" || !/[A-Za-z]/.test(v), { message: "invalidPhone" })
  .transform((v) => v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, ""))
  .refine((v) => v === "" || /^\+?\d{8,15}$/.test(v), { message: "invalidPhone" });

export const requiredPhone = optionalPhone.refine((v) => v.length > 0, {
  message: "invalidPhone",
});
