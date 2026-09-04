import { requireAdminSession } from "@/server/auth/current-user";
import { SalesNav } from "../../nav";
import { ImportWizard } from "./import-wizard";

export const dynamic = "force-dynamic";

export default async function SalesImportPage() {
  await requireAdminSession();
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <SalesNav active="/admin/sales/leads" />
      <h1 className="text-xl font-semibold">Importar leads</h1>
      <ImportWizard />
    </div>
  );
}
