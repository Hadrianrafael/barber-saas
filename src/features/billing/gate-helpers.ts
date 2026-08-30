import "server-only";
import { assertWithinLimit, assertFeature, isPlanLimitError, type Entitlements } from "./gate";
import type { LimitedResource, GatedFeature } from "./plan-limits";

/**
 * Wraps a gate assertion for use inside server actions. Returns a
 * `{ ok:false, code }` state on a plan-limit/billing failure, or `null` when
 * the tenant is allowed to proceed. The `code` maps to i18n under
 * `billing.gate.*`.
 */
export async function gateLimit(
  tenantId: string,
  resource: LimitedResource,
  ent?: Entitlements,
): Promise<{ ok: false; code: string } | null> {
  try {
    await assertWithinLimit(tenantId, resource, ent);
    return null;
  } catch (e) {
    if (isPlanLimitError(e)) return { ok: false, code: e.code };
    throw e;
  }
}

export async function gateFeature(
  tenantId: string,
  feature: GatedFeature,
  ent?: Entitlements,
): Promise<{ ok: false; code: string } | null> {
  try {
    await assertFeature(tenantId, feature, ent);
    return null;
  } catch (e) {
    if (isPlanLimitError(e)) return { ok: false, code: e.code };
    throw e;
  }
}
