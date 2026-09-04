import "server-only";
import { prisma } from "@/server/db/client";
import { env } from "@/env";
import { normalizeEmail, normalizePhone, isEmail } from "./phone";

/**
 * Global SDR settings — a single "global" row. `testMode` (DB) AND
 * `env.SDR_TEST_MODE` together gate real sends: production requires BOTH to be
 * off. The allowlist limits who can be contacted while test mode is on.
 */

export type SdrSettings = {
  id: string;
  testMode: boolean;
  testAllowlist: string[];
  dailyGlobalCap: number;
  productionEnabledAt: Date | null;
  productionEnabledById: string | null;
};

export async function getSdrSettings(): Promise<SdrSettings> {
  const row = await prisma.salesSetting.upsert({
    where: { id: "global" },
    create: { id: "global" },
    update: {},
  });
  return row;
}

/** Effective test mode: env kill-switch OR the DB flag. */
export async function isTestMode(): Promise<boolean> {
  if (env.SDR_TEST_MODE) return true;
  const s = await getSdrSettings();
  return s.testMode;
}

export async function updateAllowlist(entries: string[]): Promise<SdrSettings> {
  const clean = Array.from(
    new Set(
      entries
        .map((e) => e.trim())
        .filter(Boolean)
        .map((e) => (isEmail(e) ? normalizeEmail(e) : normalizePhone(e)))
        .filter(Boolean),
    ),
  );
  return prisma.salesSetting.upsert({
    where: { id: "global" },
    create: { id: "global", testAllowlist: clean },
    update: { testAllowlist: clean },
  });
}

export async function setDailyGlobalCap(cap: number): Promise<SdrSettings> {
  const v = Math.max(0, Math.min(5000, Math.round(cap)));
  return prisma.salesSetting.upsert({
    where: { id: "global" },
    create: { id: "global", dailyGlobalCap: v },
    update: { dailyGlobalCap: v },
  });
}

/**
 * Turn production mode ON. Deliberately explicit and audited — never a default.
 * Still refuses if the env kill-switch (SDR_TEST_MODE) is set.
 */
export async function enableProduction(actorId: string): Promise<{ ok: boolean; reason?: string }> {
  if (env.SDR_TEST_MODE) {
    return { ok: false, reason: "SDR_TEST_MODE env kill-switch is on — set it to false first." };
  }
  await prisma.salesSetting.upsert({
    where: { id: "global" },
    create: {
      id: "global",
      testMode: false,
      productionEnabledAt: new Date(),
      productionEnabledById: actorId,
    },
    update: { testMode: false, productionEnabledAt: new Date(), productionEnabledById: actorId },
  });
  return { ok: true };
}

export async function disableProduction(): Promise<void> {
  await prisma.salesSetting.upsert({
    where: { id: "global" },
    create: { id: "global", testMode: true },
    update: { testMode: true },
  });
}

/** Is this recipient allowed while in test mode? */
export async function inAllowlist(recipient: string): Promise<boolean> {
  const s = await getSdrSettings();
  const norm = isEmail(recipient) ? normalizeEmail(recipient) : normalizePhone(recipient);
  return s.testAllowlist.includes(norm);
}
