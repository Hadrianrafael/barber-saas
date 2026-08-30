/**
 * Dependency-free CSV parser. Handles quoted fields, escaped quotes (""),
 * embedded commas/newlines, and CRLF. Not a full RFC-4180 implementation but
 * covers what Excel / Google Sheets / Numbers export.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const text = input.replace(/^﻿/, ""); // strip BOM

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const HEADER_ALIASES: Record<string, string> = {
  name: "name",
  nome: "name",
  nombre: "name",
  "full name": "name",
  email: "email",
  "e-mail": "email",
  correo: "email",
  phone: "phone",
  telefone: "phone",
  celular: "phone",
  telefono: "phone",
  whatsapp: "whatsapp",
  notes: "notes",
  observacoes: "notes",
  observações: "notes",
  notas: "notes",
  tags: "tags",
};

export type ImportColumn = "name" | "email" | "phone" | "whatsapp" | "notes" | "tags" | null;

/** Map a header row to our known columns (null = ignored). */
export function mapHeader(header: string[]): ImportColumn[] {
  return header.map((h) => {
    const key = h.trim().toLowerCase();
    return (HEADER_ALIASES[key] as ImportColumn) ?? null;
  });
}
