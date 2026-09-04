import Link from "next/link";
import { requireAdminSession } from "@/server/auth/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listCampaigns } from "@/features/sdr/campaigns";
import { CreateCampaignForm } from "./create-form";
import { SalesNav } from "../nav";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  await requireAdminSession();
  const campaigns = await listCampaigns();

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <SalesNav active="/admin/sales/campaigns" />
      <h1 className="text-xl font-semibold">Campanhas</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Nova campanha</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateCampaignForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-2">Nome</th>
                <th className="p-2">Status</th>
                <th className="p-2">Modo</th>
                <th className="p-2">Canal</th>
                <th className="p-2">Leads</th>
                <th className="p-2">Enviadas</th>
                <th className="p-2">Cap/dia</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b hover:bg-muted/40">
                  <td className="p-2">
                    <Link href={`/admin/sales/campaigns/${c.id}`} className="font-medium underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="p-2">{c.status}</td>
                  <td className="p-2">
                    <span className={c.mode === "PRODUCTION" ? "text-emerald-700" : "text-amber-700"}>
                      {c.mode}
                    </span>
                  </td>
                  <td className="p-2">{c.channel}</td>
                  <td className="p-2">{c._count.leads}</td>
                  <td className="p-2">{c.sentCount}</td>
                  <td className="p-2">{c.dailyCap}</td>
                </tr>
              ))}
              {!campaigns.length && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    Nenhuma campanha.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
