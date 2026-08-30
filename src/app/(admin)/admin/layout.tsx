import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "../../globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata = {
  title: "Admin · Barber SaaS",
  robots: { index: false, follow: false },
};

/**
 * Root layout for the Super Admin realm — fully separate from the tenant app:
 * its own `<html>`, its own session cookie (barber_admin_session), its own
 * sign-in. Copy is static pt-BR for V1 (internal tool); localization is a later
 * pass.
 */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${inter.variable} min-h-screen bg-background font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
