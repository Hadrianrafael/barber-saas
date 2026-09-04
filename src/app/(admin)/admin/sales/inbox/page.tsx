import Link from "next/link";
import { requireAdminSession } from "@/server/auth/current-user";
import { Card, CardContent } from "@/components/ui/card";
import { listConversations } from "@/features/sdr/inbox";
import { SalesNav } from "../nav";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ handledBy?: string; qualification?: string; page?: string }>;
}) {
  await requireAdminSession();
  const sp = await searchParams;
  const { rows, total, page, pageSize } = await listConversations({
    handledBy: (sp.handledBy as "AI" | "HUMAN") || undefined,
    qualification: (sp.qualification as "FRIO" | "MORNO" | "QUENTE") || undefined,
    page: Number(sp.page) || 1,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const df = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <SalesNav active="/admin/sales/inbox" />
      <h1 className="text-xl font-semibold">Inbox ({total})</h1>

      <form method="get" className="flex flex-wrap gap-2 text-sm">
        <select name="handledBy" defaultValue={sp.handledBy ?? ""} className="h-9 rounded-md border px-2">
          <option value="">quem atende: todos</option>
          <option value="AI">IA</option>
          <option value="HUMAN">Humano</option>
        </select>
        <select name="qualification" defaultValue={sp.qualification ?? ""} className="h-9 rounded-md border px-2">
          <option value="">qualificação: todas</option>
          {["QUENTE", "MORNO", "FRIO"].map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
        <button className="h-9 rounded-md border px-3">Filtrar</button>
      </form>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-2">Barbearia</th>
                <th className="p-2">Última mensagem</th>
                <th className="p-2">Atende</th>
                <th className="p-2">Status lead</th>
                <th className="p-2">Qualif.</th>
                <th className="p-2">Quando</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b hover:bg-muted/40">
                  <td className="p-2">
                    <Link href={`/admin/sales/inbox/${c.id}`} className="font-medium underline">
                      {c.lead.barbershopName || c.lead.name || "—"}
                    </Link>
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {c.messages[0]?.body?.slice(0, 60) ?? "—"}
                  </td>
                  <td className="p-2">
                    <span className={c.handledBy === "HUMAN" ? "text-blue-700" : ""}>{c.handledBy}</span>
                  </td>
                  <td className="p-2">{c.lead.status}</td>
                  <td className="p-2">{c.lead.qualification ?? "—"}</td>
                  <td className="p-2 text-muted-foreground">
                    {c.lastMessageAt ? df.format(c.lastMessageAt) : "—"}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Nenhuma conversa ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex justify-between text-sm">
          <Link
            aria-disabled={page <= 1}
            className="underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
            href={`/admin/sales/inbox?handledBy=${sp.handledBy ?? ""}&qualification=${sp.qualification ?? ""}&page=${page - 1}`}
          >
            Anterior
          </Link>
          <span className="text-muted-foreground">
            {page} / {pages}
          </span>
          <Link
            aria-disabled={page >= pages}
            className="underline aria-disabled:pointer-events-none aria-disabled:opacity-40"
            href={`/admin/sales/inbox?handledBy=${sp.handledBy ?? ""}&qualification=${sp.qualification ?? ""}&page=${page + 1}`}
          >
            Próxima
          </Link>
        </div>
      )}
    </div>
  );
}
