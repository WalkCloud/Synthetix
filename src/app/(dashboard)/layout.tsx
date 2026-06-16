import { Sidebar } from "@/components/layout/sidebar";
import { UserProvider } from "@/lib/user-context";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserProvider>
      <div className="min-h-screen">
        <Sidebar />
        <main className="ml-[260px]">{children}</main>
      </div>
    </UserProvider>
  );
}
