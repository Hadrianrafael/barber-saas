"use server";

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/server/rbac/guard";
import { parseAndValidate, confirmImport, MAX_IMPORT_BYTES } from "./service";

export interface ImportState {
  ok: boolean;
  code?: string;
  importId?: string;
  result?: { imported: number; skipped: number };
}

const ALLOWED_MIME = new Set(["text/csv", "application/vnd.ms-excel", "text/plain", ""]);

export async function uploadImportAction(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const ctx = await requireTenantContext({ permission: "import.run" });
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, code: "noFile" };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, code: "tooLarge" };
  if (!/\.csv$/i.test(file.name) || !ALLOWED_MIME.has(file.type)) {
    return { ok: false, code: "badType" };
  }

  const content = await file.text();
  try {
    const { importId } = await parseAndValidate(
      ctx.tenantId,
      file.name,
      content,
      ctx.session.userId,
    );
    revalidatePath(`/${String(fd.get("locale") ?? "pt-BR")}/import`);
    return { ok: true, code: "previewed", importId };
  } catch (e) {
    if (e instanceof Error && e.name === "ImportValidationError") {
      return { ok: false, code: e.message };
    }
    throw e;
  }
}

export async function confirmImportAction(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const ctx = await requireTenantContext({ permission: "import.run" });
  const id = String(fd.get("id") ?? "");
  const includeDuplicates = String(fd.get("includeDuplicates") ?? "") === "true";
  if (!id) return { ok: false, code: "invalid" };
  try {
    const result = await confirmImport(ctx.tenantId, id, { includeDuplicates });
    revalidatePath(`/${String(fd.get("locale") ?? "pt-BR")}/import`);
    return { ok: true, code: "done", result };
  } catch (e) {
    if (e instanceof Error && (e.name === "NotFoundError" || e.name === "ImportStateError")) {
      return { ok: false, code: e.message };
    }
    throw e;
  }
}
