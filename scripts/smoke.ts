/**
 * Post-deploy smoke test against a running instance.
 *
 *   npm run smoke -- https://staging.yourdomain.com
 *   SMOKE_URL=https://app.yourdomain.com npm run smoke
 *
 * Hits the health endpoints + a few public routes and checks status codes /
 * expected markers. No auth, no secrets, read-only. Exit 0 if all pass.
 */
/* eslint-disable no-console */

const base = (process.argv[2] ?? process.env.SMOKE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

interface Check {
  name: string;
  path: string;
  expectStatus?: number | number[];
  expectBody?: RegExp;
  redirectOk?: boolean;
}

const checks: Check[] = [
  {
    name: "liveness",
    path: "/api/health/live",
    expectStatus: 200,
    expectBody: /"status"\s*:\s*"alive"/,
  },
  {
    name: "readiness",
    path: "/api/health",
    expectStatus: [200, 503],
    expectBody: /"status"\s*:\s*"(healthy|degraded)"/,
  },
  { name: "home redirect → locale", path: "/", expectStatus: [200, 307, 308], redirectOk: true },
  { name: "marketing page (pt-BR)", path: "/pt-BR", expectStatus: 200 },
  { name: "sign-in page", path: "/pt-BR/sign-in", expectStatus: 200 },
  { name: "pricing page", path: "/pt-BR/pricing", expectStatus: [200, 404] },
  {
    name: "unknown barbershop → 404",
    path: "/pt-BR/barber/__nope__" + Date.now(),
    expectStatus: 404,
  },
  {
    name: "protected route → redirect to sign-in",
    path: "/pt-BR/dashboard",
    expectStatus: [307, 308],
    redirectOk: true,
  },
  {
    name: "stripe webhook rejects unsigned",
    path: "/api/webhooks/stripe",
    expectStatus: [400, 200],
  },
];

function statusOk(got: number, want?: number | number[]): boolean {
  if (want == null) return got < 500;
  return Array.isArray(want) ? want.includes(got) : got === want;
}

async function run() {
  console.log(`\nSmoke test → ${base}\n`);
  let failed = 0;

  for (const c of checks) {
    try {
      const res = await fetch(base + c.path, {
        method: c.name.includes("webhook") ? "POST" : "GET",
        redirect: c.redirectOk ? "manual" : "follow",
        headers: c.name.includes("webhook") ? { "content-type": "application/json" } : {},
        body: c.name.includes("webhook") ? "{}" : undefined,
        signal: AbortSignal.timeout(15000),
      });
      const body = c.expectBody ? await res.text() : "";
      const sOk = statusOk(res.status, c.expectStatus);
      const bOk = !c.expectBody || c.expectBody.test(body);
      const pass = sOk && bOk;
      if (!pass) failed++;
      console.log(
        `  ${pass ? "✓" : "✗"} ${c.name.padEnd(40)} ${res.status}` +
          (bOk ? "" : ` (body did not match ${c.expectBody})`),
      );
    } catch (e) {
      failed++;
      console.log(`  ✗ ${c.name.padEnd(40)} ERROR ${(e as Error).message}`);
    }
  }

  console.log(`\n${failed === 0 ? "✓ smoke test passed" : `✗ ${failed} check(s) failed`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
