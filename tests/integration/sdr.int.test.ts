import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createImport, commitImport } from "@/features/sdr/import";
import { assertContactable } from "@/features/sdr/guard";
import { updateAllowlist, getSdrSettings } from "@/features/sdr/settings";
import { optOutLead } from "@/features/sdr/leads";
import { isSuppressed } from "@/features/sdr/suppression";
import { processInbound } from "@/features/sdr/inbound";
import { getActiveAgentConfig } from "@/features/sdr/agent-config";

const RUN = process.env.RUN_DB_TESTS === "1";
const d = RUN ? describe : describe.skip;
const prisma = new PrismaClient();
const uniq = () => Math.random().toString(36).slice(2, 10);

d("sdr (DB)", () => {
  const leadIds: string[] = [];
  const importIds: string[] = [];

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    await getActiveAgentConfig();
  });
  afterAll(async () => {
    await prisma.salesMessage.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.salesConversation.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.salesLeadEvent.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.salesLead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.salesImport.deleteMany({ where: { id: { in: importIds } } });
    await prisma.$disconnect();
  });

  it("imports a CSV, deduping on phone; commit is idempotent", async () => {
    const phone = `1199${uniq().replace(/\D/g, "").padEnd(6, "0").slice(0, 6)}0`;
    const sheet = {
      headers: ["nome", "barbearia", "whatsapp"],
      rows: [
        ["Ana", "Barbearia A", phone],
        ["Ana 2", "Barbearia A", phone],
        ["Bia", "Barbearia B", ""],
      ],
    };
    const created = await createImport({ fileName: "t.csv", sheet, createdById: null as never });
    importIds.push(created.importId);
    const mapping = created.suggestedMapping;

    const r1 = await commitImport(created.importId, mapping, { source: "test" });
    expect(r1.imported).toBe(1); // one valid, one dup, one no-contact error
    expect(r1.duplicates + r1.errors).toBeGreaterThanOrEqual(1);

    const r2 = await commitImport(created.importId, mapping, { source: "test" });
    expect(r2).toEqual(r1); // idempotent — already completed

    const lead = await prisma.salesLead.findFirst({ where: { importId: created.importId } });
    if (lead) leadIds.push(lead.id);
    expect(lead?.dedupeKey).toMatch(/^p:55/);
  });

  it("guard blocks in TEST MODE unless allow-listed", async () => {
    const wa = "5511970001111";
    const lead = await prisma.salesLead.create({ data: { barbershopName: "G", whatsapp: wa } });
    leadIds.push(lead.id);

    await updateAllowlist([]);
    let dec = await assertContactable(lead, "WHATSAPP");
    expect(dec.ok).toBe(false);
    expect(dec.reason).toMatch(/allowlist/i);

    await updateAllowlist([wa]);
    dec = await assertContactable(lead, "WHATSAPP");
    expect(dec.ok).toBe(true);
    await updateAllowlist([]);
  });

  it("opt-out suppresses every contact point and blocks future sends", async () => {
    const wa = "5511970002222";
    const lead = await prisma.salesLead.create({
      data: { barbershopName: "O", whatsapp: wa, email: `o-${uniq()}@x.com` },
    });
    leadIds.push(lead.id);
    await updateAllowlist([wa]);

    await optOutLead(lead.id, "test", "unit");
    expect(await isSuppressed(wa)).toBe(true);

    const fresh = await prisma.salesLead.findUniqueOrThrow({ where: { id: lead.id } });
    const dec = await assertContactable(fresh, "WHATSAPP");
    expect(dec.ok).toBe(false);
    await updateAllowlist([]);
  });

  it("inbound is idempotent on providerMessageId and ignores unknown senders", async () => {
    const unknown = await processInbound({
      provider: "whatsapp_cloud",
      providerMessageId: `wamid.${uniq()}`,
      from: "5511900000000",
      type: "text",
      text: "oi",
    });
    expect(unknown.status).toBe("ignored");

    const wa = "5511970003333";
    const lead = await prisma.salesLead.create({ data: { barbershopName: "I", whatsapp: wa } });
    leadIds.push(lead.id);
    const pmid = `wamid.${uniq()}`;
    const first = await processInbound({
      provider: "whatsapp_cloud",
      providerMessageId: pmid,
      from: wa,
      type: "text",
      text: "quanto custa?",
    });
    expect(["replied", "handed_off", "queued_human"]).toContain(first.status);

    const dup = await processInbound({
      provider: "whatsapp_cloud",
      providerMessageId: pmid,
      from: wa,
      type: "text",
      text: "quanto custa?",
    });
    expect(dup.status).toBe("duplicate");
  });

  it("settings row bootstraps with safe defaults", async () => {
    const s = await getSdrSettings();
    expect(s.id).toBe("global");
    expect(s.testMode).toBe(true);
    expect(s.dailyGlobalCap).toBeGreaterThan(0);
  });
});
