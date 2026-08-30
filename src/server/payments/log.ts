import { logger } from "@/lib/logger";

/**
 * Structured logging for financial events. Always carries the correlation set
 * (Stripe event id ↔ internal + Stripe ids). NEVER pass secret keys, full card
 * data, CVV or tokens — and even if a caller does, this helper **allowlists**
 * the fields below at runtime, so nothing else is ever written to the log.
 */
export interface FinancialLogFields {
  flow: "saas_subscription" | "client_payment";
  stripeEventId?: string | null;
  stripeEventType?: string | null;
  stripeAccountId?: string | null;
  tenantId?: string | null;
  stripeCustomerId?: string | null;
  customerId?: string | null; // internal
  paymentId?: string | null; // internal
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  subscriptionId?: string | null; // internal
  stripeSubscriptionId?: string | null;
  invoiceId?: string | null; // internal
  stripeInvoiceId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  status?: string | null;
}

const ALLOWED_KEYS: (keyof FinancialLogFields)[] = [
  "flow",
  "stripeEventId",
  "stripeEventType",
  "stripeAccountId",
  "tenantId",
  "stripeCustomerId",
  "customerId",
  "paymentId",
  "stripePaymentIntentId",
  "stripeChargeId",
  "subscriptionId",
  "stripeSubscriptionId",
  "invoiceId",
  "stripeInvoiceId",
  "amountCents",
  "currency",
  "status",
];

export function logFinancialEvent(
  msg: string,
  fields: FinancialLogFields,
  level: "info" | "warn" | "error" = "info",
): void {
  const clean: Record<string, unknown> = { fin: true };
  for (const k of ALLOWED_KEYS) {
    const v = fields[k];
    if (v !== undefined && v !== null) clean[k] = v;
  }
  logger[level](clean, msg);
}
