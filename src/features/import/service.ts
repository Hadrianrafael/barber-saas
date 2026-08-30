import "server-only";
import { prisma } from "@/server/db/client";
import { logger } from "@/lib/logger";
import { optionalPhone } from "@/lib/validation";
import { parseCsv, mapHeader, type ImportColumn } from "./csv";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5000;

export type RowStatus = "ok" | "duplicate" | "error";
export interface PreviewRow {
  line: number;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  notes: string | null;
  tags: string[];
  status: RowStatus;
  errors: string[];
}
export interface ImportReport {
  columns: ImportColumn[];
  rows: PreviewRow[];
  counts: { total: number; valid: number; duplicate: number; error: number };
}

function cleanPhone(v: string): string | null {
  const r = optionalPhone.safeParse(v);
  return r.success && r.data ? r.data : v.trim() ? "__invalid__" : null;
}

/**
 * Parse + validate a CSV upload and persist a `ContactImport` in `previewed`
 * state. Nothing is written to `Customer` yet.
 */
export async function parseAndValidate(
  tenantId: string,
  fileName: string,
  content: string,
  createdById: string | null,
): Promise<{ importId: string; report: ImportReport }> {
  const grid = parseCsv(content);
  if (grid.length < 2) {
    throw Object.assign(new Error("empty_or_no_rows"), { name: "ImportValidationError" });
  }
  if (grid.length - 1 > MAX_ROWS) {
    throw Object.assign(new Error("too_many_rows"), { name: "ImportValidationError" });
  }

  const columns = mapHeader(grid[0]!);
  if (!columns.includes("name")) {
    throw Object.assign(new Error("missing_name_column"), { name: "ImportValidationError" });
  }

  // Existing contacts for duplicate detection.
  const existing = await prisma.customer.findMany({
    where: { tenantId },
    select: { email: true, phone: true },
  });
  const existEmail = new Set(
    existing.map((c) => c.email?.toLowerCase()).filter(Boolean) as string[],
  );
  const existPhone = new Set(existing.map((c) => c.phone).filter(Boolean) as string[]);
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();

  const rows: PreviewRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const raw = grid[i]!;
    const get = (col: ImportColumn) => {
      const idx = columns.indexOf(col);
      return idx >= 0 ? (raw[idx] ?? "").trim() : "";
    };
    const name = get("name");
    const emailRaw = get("email").toLowerCase();
    const phoneRaw = get("phone") || get("whatsapp");
    const phone = phoneRaw ? cleanPhone(phoneRaw) : null;
    const whatsapp = get("whatsapp") ? cleanPhone(get("whatsapp")) : phone;

    const errors: string[] = [];
    if (!name || name.length < 2) errors.push("name_required");
    if (emailRaw && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw)) errors.push("bad_email");
    if (phone === "__invalid__") errors.push("bad_phone");
    if (!emailRaw && (!phone || phone === "__invalid__")) errors.push("no_contact");

    let status: RowStatus = errors.length ? "error" : "ok";
    if (status === "ok") {
      const dupExisting =
        (emailRaw && existEmail.has(emailRaw)) || (phone && existPhone.has(phone));
      const dupInFile = (emailRaw && seenEmail.has(emailRaw)) || (phone && seenPhone.has(phone));
      if (dupExisting || dupInFile) status = "duplicate";
    }
    if (emailRaw) seenEmail.add(emailRaw);
    if (phone && phone !== "__invalid__") seenPhone.add(phone);

    rows.push({
      line: i + 1,
      name,
      email: emailRaw || null,
      phone: phone === "__invalid__" ? null : phone,
      whatsapp: whatsapp === "__invalid__" ? null : whatsapp,
      notes: get("notes") || null,
      tags: get("tags")
        ? get("tags")
            .split(/[;|]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      status,
      errors,
    });
  }

  const counts = {
    total: rows.length,
    valid: rows.filter((r) => r.status === "ok").length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
    error: rows.filter((r) => r.status === "error").length,
  };
  const report: ImportReport = { columns, rows, counts };

  const rec = await prisma.contactImport.create({
    data: {
      tenantId,
      fileName: fileName.slice(0, 200),
      status: "previewed",
      totalRows: counts.total,
      validRows: counts.valid,
      duplicateRows: counts.duplicate,
      errorRows: counts.error,
      report: report as unknown as object,
      createdById,
    },
  });
  logger.info({ tenantId, importId: rec.id, ...counts }, "import.previewed");
  return { importId: rec.id, report };
}

export async function getImport(tenantId: string, id: string) {
  return prisma.contactImport.findFirst({ where: { id, tenantId } });
}

export function listImports(tenantId: string) {
  return prisma.contactImport.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

/**
 * Commit the previewed rows. Only `ok` rows are inserted by default;
 * `includeDuplicates` also inserts rows flagged as duplicates (still deduped by
 * the unique tenant+email / tenant+phone constraints — a clash is skipped).
 * Consent is NEVER set — imported contacts start with no marketing opt-in.
 */
export async function confirmImport(
  tenantId: string,
  id: string,
  opts: { includeDuplicates?: boolean } = {},
): Promise<{ imported: number; skipped: number }> {
  const rec = await prisma.contactImport.findFirst({ where: { id, tenantId } });
  if (!rec) throw Object.assign(new Error("not_found"), { name: "NotFoundError" });
  if (rec.status !== "previewed") {
    throw Object.assign(new Error("already_processed"), { name: "ImportStateError" });
  }
  const report = rec.report as unknown as ImportReport;
  const wanted = report.rows.filter(
    (r) => r.status === "ok" || (opts.includeDuplicates && r.status === "duplicate"),
  );

  await prisma.contactImport.update({ where: { id }, data: { status: "importing" } });

  let imported = 0;
  let skipped = 0;
  for (const r of wanted) {
    try {
      await prisma.customer.create({
        data: {
          tenantId,
          name: r.name,
          email: r.email,
          phone: r.phone,
          whatsapp: r.whatsapp,
          notes: r.notes,
          tags: r.tags,
          source: "IMPORT",
        },
      });
      imported++;
    } catch {
      skipped++; // unique clash / bad row → skip, never abort the batch
    }
  }

  await prisma.contactImport.update({
    where: { id },
    data: { status: "completed", importedRows: imported },
  });
  logger.info({ tenantId, importId: id, imported, skipped }, "import.completed");
  return { imported, skipped };
}
