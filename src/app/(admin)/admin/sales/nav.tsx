import Link from "next/link";

const LINKS = [
  { href: "/admin/sales", label: "Painel" },
  { href: "/admin/sales/leads", label: "Leads" },
  { href: "/admin/sales/campaigns", label: "Campanhas" },
  { href: "/admin/sales/inbox", label: "Inbox" },
  { href: "/admin/sales/assistant", label: "Assistente" },
  { href: "/admin/sales/settings", label: "Configurações" },
];

export function SalesNav({ active }: { active: string }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b pb-3 text-sm">
      <Link href="/admin" className="mr-2 text-muted-foreground underline">
        ← Admin
      </Link>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-md px-3 py-1.5 ${
            active === l.href ? "bg-foreground text-background" : "hover:bg-muted"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
