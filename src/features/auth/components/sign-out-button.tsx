import { signOutAction } from "../actions";
import { Button } from "@/components/ui/button";

export function SignOutButton({ locale, label }: { locale: string; label: string }) {
  return (
    <form action={signOutAction}>
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" variant="outline" size="sm" className="w-full">
        {label}
      </Button>
    </form>
  );
}
