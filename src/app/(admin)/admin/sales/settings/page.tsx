import { requireAdminSession } from "@/server/auth/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/env";
import { getSdrSettings, isTestMode } from "@/features/sdr/settings";
import { updateAllowlistAction, setDailyCapAction } from "@/features/sdr/actions";
import { SalesNav } from "../nav";
import { ProductionToggle } from "./production-toggle";

export const dynamic = "force-dynamic";

export default async function SalesSettingsPage() {
  await requireAdminSession();
  const [s, testMode] = await Promise.all([getSdrSettings(), isTestMode()]);
  const envLock = env.SDR_TEST_MODE;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <SalesNav active="/admin/sales/settings" />
      <h1 className="text-xl font-semibold">Configurações do SDR</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Modo de operação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Estado atual:{" "}
            <strong className={testMode ? "text-amber-700" : "text-emerald-700"}>
              {testMode ? "MODO DE TESTE" : "PRODUÇÃO"}
            </strong>
          </p>
          <p className="text-muted-foreground">
            Em modo de teste, nenhuma mensagem é enviada para leads reais — só para números/e-mails
            da lista de autorizados abaixo. A produção precisa ser ligada explicitamente aqui e cada
            lead precisa de base legal registrada.
          </p>
          {envLock ? (
            <p className="rounded-md bg-amber-50 p-3 text-amber-800">
              A variável de ambiente <code>SDR_TEST_MODE</code> está ativa e trava o sistema em
              teste. Para liberar a produção, defina <code>SDR_TEST_MODE=false</code> no ambiente e
              recarregue.
            </p>
          ) : (
            <ProductionToggle testMode={s.testMode} />
          )}
          {s.productionEnabledAt && (
            <p className="text-xs text-muted-foreground">
              Produção habilitada pela última vez em{" "}
              {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
                s.productionEnabledAt,
              )}
              .
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Lista de autorizados (modo de teste)</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateAllowlistAction} className="space-y-2 text-sm">
            <textarea
              name="entries"
              rows={4}
              defaultValue={s.testAllowlist.join("\n")}
              placeholder="+55 11 99999-0000&#10;fulano@empresa.com"
              className="w-full rounded-md border px-2 py-1 font-mono text-xs"
            />
            <button className="rounded-md border px-3 py-1.5">Salvar lista</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Limite global diário</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={setDailyCapAction} className="flex items-center gap-2 text-sm">
            <input
              name="cap"
              type="number"
              min={0}
              max={5000}
              defaultValue={s.dailyGlobalCap}
              className="h-8 w-28 rounded-md border px-2"
            />
            <button className="rounded-md border px-3 py-1.5">Salvar</button>
            <span className="text-muted-foreground">
              teto de mensagens de saída por dia, somando todas as campanhas
            </span>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
