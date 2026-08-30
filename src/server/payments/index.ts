import { StripeProvider } from "./stripe-provider";
import type { PaymentProvider } from "./provider";

/**
 * Active payment provider. Swap here (or read from env) to add another provider
 * later — no other file imports a concrete implementation.
 */
export const paymentProvider: PaymentProvider = new StripeProvider();

export * from "./provider";
