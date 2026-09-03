// Empty stand-in for the `server-only` / `client-only` marker packages.
// Next.js bundles its own resolution for these; the standalone worker & cron
// scripts run via `tsx` (outside Next) where the bare specifier is otherwise
// unresolved and crashes module load. Mapped in tsconfig `paths`.
export {};
