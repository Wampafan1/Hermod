"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const PATH_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/reports": "Reports",
  "/reports/new": "New Report",
  "/connections": "Connections",
  "/schedules": "Schedules",
  "/history": "Run History",
};

function getLabel(pathname: string): string {
  if (PATH_LABELS[pathname]) return PATH_LABELS[pathname];
  if (pathname.startsWith("/reports/") && pathname.endsWith("/schedule"))
    return "Schedule";
  if (pathname.startsWith("/reports/")) return "Report Editor";
  return "";
}

export function Topbar() {
  const pathname = usePathname();
  const [time, setTime] = useState("");

  useEffect(() => {
    function tick() {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      );
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  const label = getLabel(pathname);

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-void/80 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-2 text-text-dim text-xs tracking-[0.2em] uppercase">
        <span className="text-gold/40">ᚺ</span>
        {label && (
          <>
            <span className="text-gold/20">/</span>
            <span>{label}</span>
          </>
        )}
      </div>
      <div className="text-text-dim text-xs tracking-[0.15em] font-inconsolata">
        {time}
      </div>
    </header>
  );
}
