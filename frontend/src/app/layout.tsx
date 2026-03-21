import type { Metadata } from "next";
import "./globals.css";

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
        <header className="border-b border-gray-800 px-4 sm:px-6 py-3 sm:py-4">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">
            <span className="text-yellow-400">⚡</span> WattWise
          </h1>
        </header>
        <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">{children}</main>
      </body>
    </html>
  );
}
