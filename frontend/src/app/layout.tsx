import type { Metadata } from "next";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import AppHeader from "@/components/AppHeader";

export const metadata: Metadata = {
  title: "WattWise",
  description: "Home energy monitoring dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <AuthProvider>
          <AppHeader />
          <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
