/**
 * Payment provider abstraction.
 *
 * Two distinct money flows, never mixed:
 *   1. SaaS subscription — a barbershop pays the platform (platform Stripe acct).
 *   2. Client payment    — a client pays a barbershop (Stripe Connect, connected
 *      account, optional platform application fee).
 *
 * The rest of the app depends only on this interface. Adding Mercado Pago,
 * Adyen, etc. later means implementing `PaymentProvider` — no changes to the
 * financial domain. See docs/adr/0003-payment-provider-abstraction.md.
 */

export class PaymentProviderNotConfiguredError extends Error {
  constructor(provider = "stripe") {
    super(
      `Payment provider "${provider}" is not configured. Set the required keys ` +
        `(see .env.example) to enable checkout, webhooks and payouts.`,
    );
    this.name = "PaymentProviderNotConfiguredError";
  }
}

export type Money = { amountCents: number; currency: string };

export interface SubscriptionCheckoutInput {
  tenantId: string;
  planCode: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  existingCustomerId?: string;
  trialDays?: number;
  /** Stable key so a double-submit reuses the same Checkout Session. */
  idempotencyKey?: string;
}

export interface OneOffCheckoutInput {
  tenantId: string;
  connectedAccountId: string;
  description: string;
  amount: Money;
  applicationFeeCents: number;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  /** Ask Stripe to generate an invoice/receipt for the client on the connected account. */
  withInvoice?: boolean;
  /** Prefill the payer's email (used for the invoice/receipt). */
  customerEmail?: string;
  /** Stable key so a double-submit reuses the same Checkout Session. */
  idempotencyKey?: string;
}

export interface ClientSubscriptionInput {
  tenantId: string;
  connectedAccountId: string;
  priceId: string;
  applicationFeeBps: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface ConnectOnboardingInput {
  tenantId: string;
  country: string;
  email: string;
  refreshUrl: string;
  returnUrl: string;
  existingAccountId?: string;
}

export interface CheckoutResult {
  id: string;
  url: string;
}

export interface ConnectOnboardingResult {
  accountId: string;
  onboardingUrl: string;
}

export interface NormalizedWebhookEvent {
  id: string;
  type: string;
  /** Connected-account id for Connect events (`event.account`); undefined for platform events. */
  account?: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  readonly isConfigured: boolean;

  /** Flow 1 — SaaS subscription on the platform account. */
  createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<CheckoutResult>;
  createBillingPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Upgrade / downgrade an existing subscription in place (prorated). */
  updateSubscriptionPrice(
    subscriptionId: string,
    newPriceId: string,
  ): Promise<{ id: string; status: string }>;

  /** Flow 2 — Stripe Connect onboarding + client payments. */
  createConnectOnboarding(input: ConnectOnboardingInput): Promise<ConnectOnboardingResult>;
  getConnectAccountStatus(accountId: string): Promise<{
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    requirements: unknown;
  }>;
  createOneOffCheckout(input: OneOffCheckoutInput): Promise<CheckoutResult>;
  createClientSubscriptionCheckout(input: ClientSubscriptionInput): Promise<CheckoutResult>;
  refund(chargeId: string, amountCents?: number): Promise<{ id: string; status: string }>;

  /** Webhooks — signature verified, never trust the client. */
  verifyWebhook(
    payload: string,
    signature: string,
    kind: "platform" | "connect",
  ): NormalizedWebhookEvent;
}
