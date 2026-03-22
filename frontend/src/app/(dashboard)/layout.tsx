import AuthProvider from "@/components/AuthProvider";
import AppHeader from "@/components/AppHeader";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <AppHeader />
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {children}
      </main>
    </AuthProvider>
  );
}
