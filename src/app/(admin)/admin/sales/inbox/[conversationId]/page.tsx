import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSession } from "@/server/auth/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getConversation } from "@/features/sdr/inbox";
import { takeOverAction, returnToAiAction, closeConversationAction } from "@/features/sdr/actions";
import { SalesNav } from "../../nav";
import { ManualReply } from "./manual-reply";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  await requireAdminSession();
  const { conversationId } = await params;
  const conv = await getConversation(conversationId);
  if (!conv) notFound();
  const df = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <SalesNav active="/admin/sales/inbox" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            <Link href={`/admin/sales/leads/${conv.leadId}`} className="underline">
              {conv.lead.barbershopName || conv.lead.name || "Lead"}
            </Link>
          </h1>
          <p className="text-xs text-muted-foreground">
            {conv.channel} · {conv.status} · atende {conv.handledBy} · lead {conv.lead.status} ·{" "}
            {conv.lead.qualification ?? "sem qualificação"} (score {conv.lead.score})
          </p>
        </div>
        <div className="flex gap-2">
          {conv.handledBy === "AI" ? (
            <form action={takeOverAction}>
              <input type="hidden" name="id" value={conv.id} />
              <button className="rounded-md border px-3 py-1.5 text-sm">Assumir conversa</button>
            </form>
          ) : (
            <form action={returnToAiAction}>
              <input type="hidden" name="id" value={conv.id} />
              <button className="rounded-md border px-3 py-1.5 text-sm">Devolver para IA</button>
            </form>
          )}
          <form action={closeConversationAction}>
            <input type="hidden" name="id" value={conv.id} />
            <button className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground">
              Encerrar
            </button>
          </form>
        </div>
      </div>

      {conv.contextSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Resumo do contexto (IA)</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">
            {conv.contextSummary}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          {conv.messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.direction === "INBOUND" ? "bg-muted" : "ml-auto bg-foreground text-background"
              }`}
            >
              <div className="text-[10px] uppercase opacity-60">
                {m.direction === "INBOUND" ? "Lead" : "SDR"} · {m.kind} · {m.status} ·{" "}
                {df.format(m.createdAt)}
              </div>
              <div className="whitespace-pre-wrap">{m.body}</div>
              {m.mediaUrl && (
                <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                  áudio
                </a>
              )}
              {m.error && <div className="text-[10px] text-red-400">{m.error}</div>}
            </div>
          ))}
          {!conv.messages.length && (
            <p className="text-center text-sm text-muted-foreground">Sem mensagens.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Responder manualmente
            {conv.handledBy === "AI" && (
              <span className="ml-2 font-normal text-amber-700">
                (assuma a conversa para pausar a IA)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ManualReply conversationId={conv.id} />
        </CardContent>
      </Card>
    </div>
  );
}
