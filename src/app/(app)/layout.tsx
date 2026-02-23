import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth is handled by middleware (src/middleware.ts) for route protection
  // and by individual pages via requireAuth() for session data.
  // No need to await requireAuth() here — it was serializing the layout
  // render before any HTML could be sent.

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
