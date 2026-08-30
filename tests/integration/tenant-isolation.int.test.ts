/**
 * Cross-tenant isolation — explicit matrix. For every domain, a caller acting as
 * Tenant B must NOT be able to read or mutate a row owned by Tenant A, even when
 * it supplies A's row id directly (bypassing the UI, which only ever surfaces
 * same-tenant rows). Gated on RUN_DB_TESTS=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

import { getCustomerDetail, updateCustomer, anonymizeCustomer } from "@/features/crm/service";
import { getEmployee, setEmployeeStatus } from "@/features/team/service";
import { getService, setServiceStatus } from "@/features/services/service";
import { getAppointmentDetail } from "@/features/agenda/service";
import { cancelAppointment } from "@/features/scheduling/appointments";
import { refundClientPayment, cancelPaymentLink } from "@/features/payments/links";
import { getCampaign, cancelCampaign } from "@/features/campaigns/service";
import { listReviews, setReviewPublished } from "@/features/reviews/service";
import { adjustPoints, redeemReward } from "@/features/loyalty/service";
import { getConversationForStaff, takeOverConversation } from "@/features/chatbot/service";
import { getImport, confirmImport } from "@/features/import/service";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;
const prisma = new PrismaClient();
const uniq = () => Math.random().toString(36).slice(2, 10);
// A string userId satisfies every feature's Actor type (string | null). The
// cross-tenant guards all throw before any audit row is written, so the
// non-existent id never hits an FK.
const actor = { userId: "iso-user", label: "iso-test" };

async function mkTenant() {
  return prisma.tenant.create({
    data: {
      slug: `iso-${uniq()}`,
      name: "Iso",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      status: "ACTIVE",
      country: "BR",
      loyaltyConfig: { enabled: true, pointsPerVisit: 10, pointsPerCurrencyCents: 0 },
    },
  });
}

d("cross-tenant isolation", () => {
  let A = "";
  let B = "";
  const ids = {} as Record<
    | "emp"
    | "svc"
    | "cust"
    | "appt"
    | "pay"
    | "link"
    | "camp"
    | "review"
    | "reward"
    | "conv"
    | "imp",
    string
  >;

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    A = (await mkTenant()).id;
    B = (await mkTenant()).id;

    const emp = await prisma.employee.create({
      data: { tenantId: A, name: "EmpA", status: "ACTIVE" },
    });
    const svc = await prisma.service.create({
      data: {
        tenantId: A,
        name: "SvcA",
        priceCents: 5000,
        currency: "BRL",
        durationMin: 30,
        status: "ACTIVE",
      },
    });
    const cust = await prisma.customer.create({
      data: { tenantId: A, name: "CustA", email: `a-${uniq()}@x.com` },
    });
    const start = new Date(Date.now() + 3 * 86_400_000);
    const appt = await prisma.appointment.create({
      data: {
        tenantId: A,
        customerId: cust.id,
        employeeId: emp.id,
        serviceId: svc.id,
        status: "CONFIRMED",
        source: "DASHBOARD",
        startsAt: start,
        endsAt: new Date(start.getTime() + 1800_000),
        serviceName: "SvcA",
        durationMin: 30,
        bufferMin: 0,
        priceCents: 5000,
        currency: "BRL",
      },
    });
    const pay = await prisma.payment.create({
      data: {
        tenantId: A,
        purpose: "CLIENT_PAYMENT",
        status: "SUCCEEDED",
        method: "CARD",
        amountCents: 5000,
        currency: "BRL",
        provider: "stripe",
        providerChargeId: `ch_${uniq()}`,
        customerId: cust.id,
      },
    });
    const link = await prisma.paymentLink.create({
      data: {
        tenantId: A,
        description: "L",
        amountCents: 5000,
        currency: "BRL",
        status: "ACTIVE",
        provider: "stripe",
      },
    });
    const camp = await prisma.campaign.create({
      data: {
        tenantId: A,
        name: "CampA",
        channel: "EMAIL",
        status: "DRAFT",
        body: "hi",
        audience: { segment: "all" },
      },
    });
    await prisma.appointment.update({ where: { id: appt.id }, data: { status: "COMPLETED" } });
    const review = await prisma.review.create({
      data: {
        tenantId: A,
        appointmentId: appt.id,
        customerId: cust.id,
        employeeId: emp.id,
        rating: 5,
        isPublished: false,
      },
    });
    await prisma.loyaltyAccount.create({ data: { tenantId: A, customerId: cust.id, points: 100 } });
    const reward = await prisma.loyaltyReward.create({
      data: {
        tenantId: A,
        name: "R",
        pointsCost: 10,
        kind: "discount",
        amountOffCents: 500,
        isActive: true,
      },
    });
    const conv = await prisma.conversation.create({
      data: { tenantId: A, channel: "WEBCHAT", status: "OPEN", handledBy: "AI", locale: "pt-BR" },
    });
    const imp = await prisma.contactImport.create({
      data: {
        tenantId: A,
        fileName: "x.csv",
        status: "previewed",
        totalRows: 1,
        validRows: 1,
        report: {
          columns: ["name"],
          counts: { total: 1, valid: 1, duplicate: 0, error: 0 },
          rows: [
            {
              line: 2,
              name: "Z",
              email: null,
              phone: null,
              whatsapp: null,
              notes: null,
              tags: [],
              status: "ok",
              errors: [],
            },
          ],
        },
      },
    });

    Object.assign(ids, {
      emp: emp.id,
      svc: svc.id,
      cust: cust.id,
      appt: appt.id,
      pay: pay.id,
      link: link.id,
      camp: camp.id,
      review: review.id,
      reward: reward.id,
      conv: conv.id,
      imp: imp.id,
    });
  });

  afterAll(async () => {
    for (const id of [A, B]) await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("customers: B cannot read or mutate A's customer", async () => {
    expect(await getCustomerDetail(B, ids.cust)).toBeNull();
    await expect(updateCustomer(B, ids.cust, { name: "hax" } as never, actor)).rejects.toThrow();
    await expect(anonymizeCustomer(B, ids.cust, actor)).rejects.toThrow();
    expect((await prisma.customer.findUnique({ where: { id: ids.cust } }))!.name).toBe("CustA");
  });

  it("employees: B cannot read or deactivate A's employee", async () => {
    expect(await getEmployee(B, ids.emp)).toBeNull();
    await expect(setEmployeeStatus(B, ids.emp, "INACTIVE" as never, actor)).rejects.toThrow();
    expect((await prisma.employee.findUnique({ where: { id: ids.emp } }))!.status).toBe("ACTIVE");
  });

  it("services: B cannot read or archive A's service", async () => {
    expect(await getService(B, ids.svc)).toBeNull();
    await expect(setServiceStatus(B, ids.svc, "ARCHIVED", actor)).rejects.toMatchObject({
      name: "NotFoundError",
    });
    expect((await prisma.service.findUnique({ where: { id: ids.svc } }))!.status).toBe("ACTIVE");
  });

  it("appointments: B cannot read or cancel A's appointment", async () => {
    expect(await getAppointmentDetail(B, ids.appt)).toBeNull();
    await expect(cancelAppointment(B, ids.appt, actor)).rejects.toThrow();
  });

  it("payments: B cannot refund A's payment or cancel A's link", async () => {
    await expect(refundClientPayment(B, ids.pay)).rejects.toMatchObject({ name: "NotFoundError" });
    await cancelPaymentLink(B, ids.link); // updateMany — no-op, no throw
    expect((await prisma.paymentLink.findUnique({ where: { id: ids.link } }))!.status).toBe(
      "ACTIVE",
    );
  });

  it("campaigns: B cannot read or cancel A's campaign", async () => {
    expect(await getCampaign(B, ids.camp)).toBeNull();
    await cancelCampaign(B, ids.camp);
    expect((await prisma.campaign.findUnique({ where: { id: ids.camp } }))!.status).toBe("DRAFT");
  });

  it("reviews: A's review is invisible to B and B cannot publish it", async () => {
    const list = await listReviews(B, {});
    expect(list.rows.find((r) => r.id === ids.review)).toBeUndefined();
    await setReviewPublished(B, ids.review, true);
    expect((await prisma.review.findUnique({ where: { id: ids.review } }))!.isPublished).toBe(
      false,
    );
  });

  it("loyalty: B cannot adjust or redeem points for A's customer", async () => {
    await expect(adjustPoints(B, ids.cust, 50, "hax", actor)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(redeemReward(B, ids.cust, ids.reward, actor)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      (await prisma.loyaltyAccount.findUnique({ where: { customerId: ids.cust } }))!.points,
    ).toBe(100);
  });

  it("conversations: B cannot read or take over A's conversation", async () => {
    expect(await getConversationForStaff(B, ids.conv)).toBeNull();
    expect(await takeOverConversation(B, ids.conv, "user-b")).toBe(false);
  });

  it("imports: B cannot read or confirm A's import", async () => {
    expect(await getImport(B, ids.imp)).toBeNull();
    await expect(confirmImport(B, ids.imp)).rejects.toMatchObject({ name: "NotFoundError" });
    expect((await prisma.contactImport.findUnique({ where: { id: ids.imp } }))!.status).toBe(
      "previewed",
    );
  });
});
