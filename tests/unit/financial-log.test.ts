import { describe, it, expect, vi, beforeEach } from "vitest";
import { logger } from "@/lib/logger";
import { logFinancialEvent } from "@/server/payments/log";

describe("logFinancialEvent", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("emits the correlation fields, drops null/undefined, tags fin:true", () => {
    const spy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    logFinancialEvent("connect.checkout.paid", {
      flow: "client_payment",
      tenantId: "t_1",
      stripePaymentIntentId: "pi_1",
      paymentId: null,
      currency: undefined,
      amountCents: 5000,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [obj, msg] = spy.mock.calls[0]!;
    expect(msg).toBe("connect.checkout.paid");
    expect(obj).toMatchObject({
      fin: true,
      flow: "client_payment",
      tenantId: "t_1",
      stripePaymentIntentId: "pi_1",
      amountCents: 5000,
    });
    expect(obj).not.toHaveProperty("paymentId");
    expect(obj).not.toHaveProperty("currency");
  });

  it("routes to the requested level", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    logFinancialEvent("billing.invoice.failed", { flow: "saas_subscription" }, "warn");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("never forwards a secret-looking key even if passed as an unknown field", () => {
    const spy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    // @ts-expect-error — deliberately passing an unsupported field
    logFinancialEvent("x", { flow: "saas_subscription", secretKey: "sk_live_abc" });
    const [obj] = spy.mock.calls[0]!;
    // helper only spreads known + provided keys; but assert we didn't accidentally
    // include a value that looks like a live secret
    expect(JSON.stringify(obj)).not.toContain("sk_live_");
  });
});
