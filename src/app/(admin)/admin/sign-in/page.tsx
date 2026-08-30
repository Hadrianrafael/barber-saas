import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminSignInForm } from "@/features/admin-auth/components/admin-sign-in-form";

export default function AdminSignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Administração da plataforma</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminSignInForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
