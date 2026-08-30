/**
 * Slice 11 — loyalty / reviews / import / campaigns against a real Postgres.
 * Gated on RUN_DB_TESTS=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  earnForCompletedAppointment,
  redeemReward,
  createReward,
} from "@/features/loyalty/service";
import { submitReview, ratingSummary, setReviewPublished } from "@/features/reviews/service";
import { ReviewError } from "@/features/reviews/service";
import { parseAndValidate, confirmImport } from "@/features/import/service";
import { createCampaign, estimateRecipients, deliverCampaign } from "@/features/campaigns/service";
import { hashToken } from "@/lib/crypto";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;
const prisma = new PrismaClient();
const uniq = () => Math.random().toString(36).slice(2, 10);

async function shop(loyalty = false) {
  const t = await prisma.tenant.create({
    data: {
      slug: `s11-${uniq()}`,
      name: "S11",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      status: "ACTIVE",
      loyaltyConfig: loyalty
        ? { enabled: true, pointsPerVisit: 10, pointsPerCurrencyCents: 0 }
        : undefined,
    },
  });
  const emp = await prisma.employee.create({
    data: { tenantId: t.id, name: "B", status: "ACTIVE" },
  });
  const svc = await prisma.service.create({
    data: {
      tenantId: t.id,
      name: "Corte",
      priceCents: 5000,
      currency: "BRL",
      durationMin: 30,
      status: "ACTIVE",
    },
  });
  return { t, emp, svc };
}
async function appt(tId: string, custId: string, empId: string, svcId: string, status: string) {
  const start = new Date(Date.now() - 3600_000);
  return prisma.appointment.create({
    data: {
      tenantId: tId,
      customerId: custId,
      employeeId: empId,
      serviceId: svcId,
      status: status as never,
      source: "DASHBOARD",
      startsAt: start,
      endsAt: new Date(start.getTime() + 1800_000),
      serviceName: "Corte",
      durationMin: 30,
      bufferMin: 0,
      priceCents: 5000,
      currency: "BRL",
      publicToken: hashToken(`tok-${custId}`),
    },
  });
}

d("slice 11 (DB)", () => {
  const tenants: string[] = [];
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  afterAll(async () => {
    for (const id of tenants) await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("loyalty: earns once per completed appointment (idempotent) then redeems for a coupon", async () => {
    const s = await shop(true);
    tenants.push(s.t.id);
    const cust = await prisma.customer.create({
      data: { tenantId: s.t.id, name: "C", email: `c-${uniq()}@x.com` },
    });
    const a = await appt(s.t.id, cust.id, s.emp.id, s.svc.id, "COMPLETED");

    await earnForCompletedAppointment(s.t.id, a.id);
    await earnForCompletedAppointment(s.t.id, a.id); // idempotent
    const acct = await prisma.loyaltyAccount.findUnique({ where: { customerId: cust.id } });
    expect(acct!.points).toBe(10);
    const txs = await prisma.loyaltyTransaction.findMany({ where: { customerId: cust.id } });
    expect(txs).toHaveLength(1);

    const reward = await createReward(s.t.id, {
      name: "R$5 off",
      pointsCost: 10,
      kind: "discount",
      amountOffCents: 500,
    });
    const { couponCode } = await redeemReward(s.t.id, cust.id, reward.id, { userId: null, label: "test" });
    expect(couponCode).toMatch(/^LOYAL-/);
    const after = await prisma.loyaltyAccount.findUnique({ where: { customerId: cust.id } });
    expect(after!.points).toBe(0);
    const coupon = await prisma.coupon.findFirst({ where: { tenantId: s.t.id, code: couponCode } });
    expect(coupon!.amountOffCents).toBe(500);
  });

  it("loyalty: disabled program earns nothing", async () => {
    const s = await shop(false);
    tenants.push(s.t.id);
    const cust = await prisma.customer.create({ data: { tenantId: s.t.id, name: "C" } });
    const a = await appt(s.t.id, cust.id, s.emp.id, s.svc.id, "COMPLETED");
    await earnForCompletedAppointment(s.t.id, a.id);
    expect(await prisma.loyaltyAccount.findUnique({ where: { customerId: cust.id } })).toBeNull();
  });

  it("reviews: only a COMPLETED appointment can be reviewed, once, and moderation gates the average", async () => {
    const s = await shop();
    tenants.push(s.t.id);
    const cust = await prisma.customer.create({ data: { tenantId: s.t.id, name: "C" } });
    const pending = await appt(s.t.id, cust.id, s.emp.id, s.svc.id, "CONFIRMED");
    await expect(submitReview(`tok-${cust.id}`, 5, "great")).rejects.toBeInstanceOf(ReviewError);

    await prisma.appointment.update({ where: { id: pending.id }, data: { status: "COMPLETED" } });
    const r = await submitReview(`tok-${cust.id}`, 5, "great");
    expect(r.isPublished).toBe(false);
    await expect(submitReview(`tok-${cust.id}`, 4, "again")).rejects.toMatchObject({
      code: "ALREADY_REVIEWED",
    });

    let sum = await ratingSummary(s.t.id);
    expect(sum.overall.count).toBe(0); // unpublished not counted
    await setReviewPublished(s.t.id, r.id, true);
    sum = await ratingSummary(s.t.id);
    expect(sum.overall.count).toBe(1);
    expect(sum.overall.avg).toBe(5);
    expect(sum.perBarber[0]?.name).toBe("B");
  });

  it("import: parses + validates a CSV, confirm creates customers with NO consent", async () => {
    const s = await shop();
    tenants.push(s.t.id);
    await prisma.customer.create({ data: { tenantId: s.t.id, name: "Dup", email: "dup@x.com" } });

    const csv = [
      "name,email,phone",
      "Alice,alice@x.com,+5511999990001",
      "Bob,,+5511999990002",
      ",noname@x.com,",
      "Dup,dup@x.com,",
    ].join("\n");
    const { importId, report } = await parseAndValidate(s.t.id, "c.csv", csv, null);
    expect(report.counts).toMatchObject({ total: 4, valid: 2, duplicate: 1, error: 1 });

    const res = await confirmImport(s.t.id, importId);
    expect(res.imported).toBe(2);
    const created = await prisma.customer.findMany({
      where: { tenantId: s.t.id, source: "IMPORT" },
    });
    expect(created).toHaveLength(2);
    const consents = await prisma.communicationConsent.count({
      where: { customer: { tenantId: s.t.id } },
    });
    expect(consents).toBe(0);

    // second confirm is refused
    await expect(confirmImport(s.t.id, importId)).rejects.toMatchObject({
      name: "ImportStateError",
    });
  });

  it("campaign: estimate honours consent; deliver sends via the console e-mail transport", async () => {
    const s = await shop();
    tenants.push(s.t.id);
    // one reachable (email, no opt-out), one opted out
    const ok = await prisma.customer.create({
      data: { tenantId: s.t.id, name: "OK", email: `ok-${uniq()}@x.com` },
    });
    const no = await prisma.customer.create({
      data: { tenantId: s.t.id, name: "NO", email: `no-${uniq()}@x.com` },
    });
    // OK opted in to marketing email; NO never did (and one explicit opt-out for good measure)
    await prisma.communicationConsent.create({
      data: { customerId: ok.id, channel: "EMAIL", granted: true, grantedAt: new Date() },
    });
    await prisma.communicationConsent.create({
      data: { customerId: no.id, channel: "EMAIL", granted: false, revokedAt: new Date() },
    });

    const est = await estimateRecipients(s.t.id, "EMAIL", { segment: "all" });
    expect(est).toBe(1);

    const c = await createCampaign(
      s.t.id,
      {
        name: "Promo",
        channel: "EMAIL",
        locale: "pt-BR",
        subject: "Oi {{nome}}",
        body: "Agende em {{link_agendamento}}",
        audience: { segment: "all" },
      },
      { userId: null },
    );
    await prisma.campaign.update({
      where: { id: c.id },
      data: { status: "RUNNING", totalRecipients: 1 },
    });
    const out = await deliverCampaign(c.id);
    expect(out.sent).toBe(1);

    const msgs = await prisma.message.findMany({ where: { campaignId: c.id } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.customerId).toBe(ok.id);
    expect(msgs[0]!.category).toBe("marketing");
    expect(msgs[0]!.body).toContain("/barber/");
    const done = await prisma.campaign.findUnique({ where: { id: c.id } });
    expect(done!.status).toBe("COMPLETED");
  });
});
