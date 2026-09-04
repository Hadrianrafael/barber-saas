"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  uploadLeadsAction,
  previewImportAction,
  commitImportAction,
  type SdrState,
} from "@/features/sdr/actions";

const FIELDS = [
  "",
  "name",
  "barbershopName",
  "phone",
  "whatsapp",
  "email",
  "city",
  "state",
  "website",
  "instagram",
  "notes",
  "source",
  "tags",
  "status",
] as const;

type UploadData = {
  importId: string;
  headers: string[];
  suggestedMapping: (string | null)[];
  sampleRows: string[][];
};

type PreviewData = { total: number; valid: number; duplicates: number; errors: number; errorSamples: string[] };

export function ImportWizard() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadData | null>(null);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [defaultSource, setDefaultSource] = useState("");
  const [defaultTags, setDefaultTags] = useState("");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [done, setDone] = useState<{ imported: number; duplicates: number; errors: number } | null>(null);

  function handleUpload(fd: FormData) {
    setErr(null);
    start(async () => {
      const res: SdrState = await uploadLeadsAction({ ok: false }, fd);
      if (!res.ok) return setErr(res.message || res.code || "Falha ao ler o arquivo");
      const d = res.data as unknown as UploadData;
      setUpload(d);
      setMapping(d.suggestedMapping.map((m) => m ?? ""));
      setPreview(null);
      setDone(null);
    });
  }

  function runPreview() {
    if (!upload) return;
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("importId", upload.importId);
      fd.set("mapping", JSON.stringify(mapping.map((m) => m || null)));
      fd.set("defaultSource", defaultSource);
      fd.set("defaultTags", defaultTags);
      const res = await previewImportAction({ ok: false }, fd);
      if (!res.ok) return setErr(res.message || "Falha na pré-visualização");
      setPreview(res.data as unknown as PreviewData);
    });
  }

  function runCommit() {
    if (!upload) return;
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("importId", upload.importId);
      fd.set("mapping", JSON.stringify(mapping.map((m) => m || null)));
      fd.set("defaultSource", defaultSource);
      fd.set("defaultTags", defaultTags);
      const res = await commitImportAction({ ok: false }, fd);
      if (!res.ok) return setErr(res.message || "Falha ao importar");
      setDone(res.data as unknown as { imported: number; duplicates: number; errors: number });
    });
  }

  return (
    <div className="space-y-5">
      {err && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{err}</p>}

      {!upload && (
        <form action={handleUpload} className="space-y-3 rounded-md border p-4">
          <p className="text-sm text-muted-foreground">
            Selecione um arquivo <code>.csv</code>, <code>.xlsx</code> ou <code>.xlsm</code> (até 8 MB).
          </p>
          <input type="file" name="file" accept=".csv,.xlsx,.xlsm,text/csv" required className="text-sm" />
          <button
            type="submit"
            disabled={pending}
            className="block rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
          >
            {pending ? "Lendo…" : "Enviar arquivo"}
          </button>
        </form>
      )}

      {upload && !done && (
        <div className="space-y-4">
          <div className="rounded-md border p-4">
            <h2 className="mb-3 text-sm font-semibold">Mapeamento de colunas</h2>
            <div className="space-y-2">
              {upload.headers.map((h, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="w-48 truncate text-muted-foreground" title={h}>
                    {h || `coluna ${i + 1}`}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <select
                    value={mapping[i] ?? ""}
                    onChange={(e) => {
                      const next = [...mapping];
                      next[i] = e.target.value || null;
                      setMapping(next);
                    }}
                    className="h-8 rounded-md border px-2"
                  >
                    {FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {f || "(ignorar)"}
                      </option>
                    ))}
                  </select>
                  <span className="truncate text-xs text-muted-foreground">
                    ex: {upload.sampleRows[0]?.[i] ?? ""}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 rounded-md border p-4 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Origem padrão (opcional)</span>
              <input
                value={defaultSource}
                onChange={(e) => setDefaultSource(e.target.value)}
                className="h-8 rounded-md border px-2"
                placeholder="ex: planilha-instagram"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Tags padrão (vírgula)</span>
              <input
                value={defaultTags}
                onChange={(e) => setDefaultTags(e.target.value)}
                className="h-8 rounded-md border px-2"
                placeholder="sp, zona-sul"
              />
            </label>
          </div>

          <div className="flex gap-2">
            <button
              onClick={runPreview}
              disabled={pending}
              className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
            >
              {pending ? "Processando…" : "Pré-visualizar"}
            </button>
            {preview && (
              <button
                onClick={runCommit}
                disabled={pending || preview.valid === 0}
                className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
              >
                Importar {preview.valid} leads
              </button>
            )}
          </div>

          {preview && (
            <div className="rounded-md border p-4 text-sm">
              <p>
                <strong>{preview.valid}</strong> válidos · <strong>{preview.duplicates}</strong> duplicados ·{" "}
                <strong>{preview.errors}</strong> com erro · {preview.total} linhas
              </p>
              {preview.errorSamples.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                  {preview.errorSamples.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {done && (
        <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p>
            Importação concluída: <strong>{done.imported}</strong> criados, {done.duplicates} duplicados,{" "}
            {done.errors} erros.
          </p>
          <button
            onClick={() => router.push("/admin/sales/leads")}
            className="rounded-md bg-foreground px-4 py-2 text-background"
          >
            Ver leads
          </button>
        </div>
      )}
    </div>
  );
}
