import { stopImpersonationAction } from "../actions";

/** Shown at the top of the tenant app whenever a platform admin is impersonating. */
export function ImpersonationBanner({ tenantLabel }: { tenantLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-1.5 text-xs font-medium text-amber-950">
      <span>⚠ Impersonating tenant: {tenantLabel}. Actions are audited.</span>
      <form action={stopImpersonationAction}>
        <button type="submit" className="rounded bg-amber-950/10 px-2 py-0.5 underline">
          Exit
        </button>
      </form>
    </div>
  );
}
