import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "@/server/db/client";
import { parseCsv } from "@/features/import/csv";
import { autoMap, type SdrLeadField } from "./schema";
import { dedupeKey, normalizeEmail, normalizePhone, isEmail } from "./phone";
import { logger } from "@/lib/logger";

/**
 * Lead import: CSV or XLSX → column mapping → preview → commit. Idempotent on the
 * lead dedupe key (whatsapp/phone, else email). No external upload of the file —
 * it's parsed in-process and only the parsed rows are persisted transiently on
 * the SalesImport row.
 */

export type ParsedSheet = { headers: string[]; rows: string[][] };

export async function parseSpreadsheet(
  buf: Buffer,
  filename: string,
): Promise<ParsedSheet> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return { headers: [], rows: [] };
    const grid: string[][] = [];
    ws.eachRow((row) => {
      const vals: string[] = [];
      // exceljs values array is 1-indexed; skip [0]
      const raw = Array.isArray(row.values) ? row.values.slice(1) : [];
      for (const v of raw) vals.push(cellToString(v));
      grid.push(vals);
    });
    const [headers = [], ...rest] = grid;
    return { headers: headers.map((h) => h.trim()), rows: rest };
  }
  // csv / tsv / txt
  const text = buf.toString("utf8");
  const grid = parseCsv(text);
  const [headers = [], ...rest] = grid;
  return { headers: headers.map((h) => h.trim()), rows: rest };
}

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; hyperlink?: string; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (typeof o.text === "string") return o.text;
    if (o.hyperlink) return String(o.hyperlink);
    if (o.result != null) return String(o.result);
    if (v instanceof Date) return v.toISOString();
    return "";
  }
  return String(v).trim();
}

/** Create an import record from a parsed sheet and return an auto column map. */
export async function createImport(args: {
  fileName: string;
  sheet: ParsedSheet;
  createdById: string;
}): Promise<{ importId: string; headers: string[]; suggestedMapping: (SdrLeadField | null)[]; sampleRows: string[][] }> {
  const suggested = autoMap(args.sheet.headers);
  const rec = await prisma.salesImport.create({
    data: {
      fileName: args.fileName,
      status: "previewed",
      totalRows: args.sheet.rows.length,
      mapping: { headers: args.sheet.headers, suggested },
      report: { rows: args.sheet.rows.slice(0, 5000) }, // cap what we stash
      createdById: args.createdById,
    },
  });
  return {
    importId: rec.id,
    headers: args.sheet.headers,
    suggestedMapping: suggested,
    sampleRows: args.sheet.rows.slice(0, 20),
  };
}

type RowResult =
  | { kind: "valid"; data: Record<string, unknown> }
  | { kind: "duplicate"; key: string }
  | { kind: "error"; reason: string };

function buildRow(
  cells: string[],
  mapping: (SdrLeadField | null)[],
  defaults: { source?: string; tags?: string[] },
): RowResult {
  const rec: Record<string, unknown> = {};
  mapping.forEach((field, i) => {
    if (!field) return;
    const val = (cells[i] ?? "").trim();
    if (!val) return;
    if (field === "tags") {
      rec.tags = val.split(/[;,|]/).map((t) => t.trim()).filter(Boolean);
    } else {
      rec[field] = val;
    }
  });

  if (defaults.source && !rec.source) rec.source = defaults.source;
  if (defaults.tags?.length) rec.tags = [...new Set([...(rec.tags as string[] | undefined ?? []), ...defaults.tags])];

  // normalise contact fields
  if (rec.phone) rec.phone = normalizePhone(rec.phone as string) || null;
  if (rec.whatsapp) rec.whatsapp = normalizePhone(rec.whatsapp as string) || null;
  else if (rec.phone) rec.whatsapp = rec.phone; // default WA = phone
  if (rec.email) {
    const e = normalizeEmail(rec.email as string);
    rec.email = isEmail(e) ? e : null;
  }

  const key = dedupeKey({
    whatsapp: rec.whatsapp as string | null,
    phone: rec.phone as string | null,
    email: rec.email as string | null,
  });
  if (!key) return { kind: "error", reason: "no valid phone/whatsapp/email" };

  rec.dedupeKey = key;
  return { kind: "valid", data: rec };
}

export async function previewImport(
  importId: string,
  mapping: (SdrLeadField | null)[],
  defaults: { source?: string; tags?: string[] } = {},
): Promise<{ total: number; valid: number; duplicates: number; errors: number; errorSamples: string[] }> {
  const rec = await prisma.salesImport.findUniqueOrThrow({ where: { id: importId } });
  const rows = ((rec.report as { rows?: string[][] })?.rows ?? []) as string[][];

  let valid = 0;
  let errors = 0;
  const errorSamples: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  const existing = new Set(
    (
      await prisma.salesLead.findMany({ select: { dedupeKey: true }, where: { dedupeKey: { not: null } } })
    ).map((l) => l.dedupeKey!),
  );

  for (const cells of rows) {
    const r = buildRow(cells, mapping, defaults);
    if (r.kind === "error") {
      errors++;
      if (errorSamples.length < 8) errorSamples.push(r.reason);
      continue;
    }
    if (r.kind === "valid") {
      const key = r.data.dedupeKey as string;
      if (seen.has(key) || existing.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      valid++;
    }
  }
  await prisma.salesImport.update({
    where: { id: importId },
    data: {
      validRows: valid,
      duplicateRows: duplicates,
      errorRows: errors,
      mapping: { ...(rec.mapping as object), applied: mapping, defaults },
    },
  });
  return { total: rows.length, valid, duplicates, errors, errorSamples };
}

export async function commitImport(
  importId: string,
  mapping: (SdrLeadField | null)[],
  defaults: { source?: string; tags?: string[] } = {},
): Promise<{ imported: number; duplicates: number; errors: number }> {
  const rec = await prisma.salesImport.findUniqueOrThrow({ where: { id: importId } });
  if (rec.status === "completed") {
    return { imported: rec.importedRows, duplicates: rec.duplicateRows, errors: rec.errorRows };
  }
  await prisma.salesImport.update({ where: { id: importId }, data: { status: "importing" } });
  const rows = ((rec.report as { rows?: string[][] })?.rows ?? []) as string[][];

  const existing = new Set(
    (
      await prisma.salesLead.findMany({ select: { dedupeKey: true }, where: { dedupeKey: { not: null } } })
    ).map((l) => l.dedupeKey!),
  );

  let imported = 0;
  let duplicates = 0;
  let errors = 0;

  for (const cells of rows) {
    const r = buildRow(cells, mapping, defaults);
    if (r.kind !== "valid") {
      if (r.kind === "error") errors++;
      continue;
    }
    const key = r.data.dedupeKey as string;
    if (existing.has(key)) {
      duplicates++;
      continue;
    }
    existing.add(key);
    try {
      const created = await prisma.salesLead.create({
        data: { ...(r.data as object), importId } as never,
      });
      imported++;
      await prisma.salesLeadEvent.create({
        data: { leadId: created.id, kind: "imported", data: { importId } },
      });
    } catch (e) {
      errors++;
      logger.warn({ err: (e as Error).message, key }, "sdr.import.row_failed");
    }
  }

  await prisma.salesImport.update({
    where: { id: importId },
    data: {
      status: "completed",
      importedRows: imported,
      duplicateRows: duplicates,
      errorRows: errors,
    },
  });
  logger.info({ importId, imported, duplicates, errors }, "sdr.import.done");
  return { imported, duplicates, errors };
}
