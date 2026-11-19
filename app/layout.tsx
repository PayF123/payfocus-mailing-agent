import "./globals.css";
import type { Metadata } from "next";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "PayFocus — Mail Operations Desk",
  description: "Customer Inquiry Triage and Outbound Reply Workspace",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f6f7f9] text-slate-800 antialiased selection:bg-blue-100 selection:text-slate-900">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
