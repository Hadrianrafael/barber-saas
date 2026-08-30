import Stripe from "stripe";
import { env, isConfigured } from "@/env";
import {
  PaymentProviderNotConfiguredError,
  type PaymentProvider,
  type SubscriptionCheckoutInput,
  type OneOffCheckoutInput,
  type ClientSubscriptionInput,
  type ConnectOnboardingInput,
  type CheckoutResult,
  type ConnectOnboardingResult,
  type NormalizedWebhookEvent,
} from "./provider";

/**
 * Stripe implementation. Every public method guards on configuration first and
 * throws `PaymentProviderNotConfiguredError` when keys are absent — the app
 * never fakes a successful payment.
 */
export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly isConfigured = isConfigured.stripe;

  private client: Stripe | null = env.STRIPE_SECRET_KEY
    ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" })
    : null;

  private stripe(): Stripe {
    if (!this.client) throw new PaymentProviderNotConfiguredError("stripe");
    return this.client;
  }

  async createSubscriptionCheckout(i: SubscriptionCheckoutInput): Promise<CheckoutResult> {
    const s = await this.stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: i.priceId, quantity: 1 }],
      success_url: i.successUrl,
      cancel_url: i.cancelUrl,
      customer: i.existingCustomerId,
      customer_email: i.existingCustomerId ? undefined : i.customerEmail,
      client_reference_id: i.tenantId,
      subscription_data: i.trialDays ? { trial_period_days: i.trialDays } : undefined,
      metadata: { tenantId: i.tenantId, planCode: i.planCode, flow: "saas_subscription" },
    });
    return { id: s.id, url: s.url ?? "" };
  }

  async createBillingPortalSession(customerId: string, returnUrl: string) {
    const s = await this.stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: s.url };
  }

  async createConnectOnboarding(i: ConnectOnboardingInput): Promise<ConnectOnboardingResult> {
    const stripe = this.stripe();
    const accountId =
      i.existingAccountId ??
      (
        await stripe.accounts.create({
          type: "express",
          country: i.country,
          email: i.email,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: { tenantId: i.tenantId },
        })
      ).id;

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: i.refreshUrl,
      return_url: i.returnUrl,
      type: "account_onboarding",
    });
    return { accountId, onboardingUrl: link.url };
  }

  async getConnectAccountStatus(accountId: string) {
    const a = await this.stripe().accounts.retrieve(accountId);
    return {
      chargesEnabled: a.charges_enabled ?? false,
      payoutsEnabled: a.payouts_enabled ?? false,
      requirements: a.requirements ?? null,
    };
  }

  async createOneOffCheckout(i: OneOffCheckoutInput): Promise<CheckoutResult> {
    const s = await this.stripe().checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: i.amount.currency.toLowerCase(),
              product_data: { name: i.description },
              unit_amount: i.amount.amountCents,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          application_fee_amount: i.applicationFeeCents || undefined,
        },
        success_url: i.successUrl,
        cancel_url: i.cancelUrl,
        metadata: { ...i.metadata, tenantId: i.tenantId, flow: "client_payment" },
      },
      { stripeAccount: i.connectedAccountId },
    );
    return { id: s.id, url: s.url ?? "" };
  }

  async createClientSubscriptionCheckout(i: ClientSubscriptionInput): Promise<CheckoutResult> {
    const s = await this.stripe().checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: i.priceId, quantity: 1 }],
        subscription_data: {
          application_fee_percent: i.applicationFeeBps / 100 || undefined,
        },
        customer_email: i.customerEmail,
        success_url: i.successUrl,
        cancel_url: i.cancelUrl,
        metadata: { ...i.metadata, tenantId: i.tenantId, flow: "client_subscription" },
      },
      { stripeAccount: i.connectedAccountId },
    );
    return { id: s.id, url: s.url ?? "" };
  }

  async refund(chargeId: string, amountCents?: number) {
    const r = await this.stripe().refunds.create({
      charge: chargeId,
      amount: amountCents,
    });
    return { id: r.id, status: r.status ?? "unknown" };
  }

  verifyWebhook(
    payload: string,
    signature: string,
    kind: "platform" | "connect",
  ): NormalizedWebhookEvent {
    const secret =
      kind === "connect" ? env.STRIPE_CONNECT_WEBHOOK_SECRET : env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new PaymentProviderNotConfiguredError("stripe");
    const event = this.stripe().webhooks.constructEvent(payload, signature, secret);
    return { id: event.id, type: event.type, raw: event };
  }
}
