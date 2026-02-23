"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", rune: "ᛟ" },
  { href: "/reports", label: "Reports", rune: "ᚱ" },
  { href: "/connections", label: "Connections", rune: "ᚷ" },
  { href: "/schedules", label: "Schedules", rune: "ᛏ" },
  { href: "/history", label: "History", rune: "ᚺ" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className="w-56 h-screen bg-deep border-r border-border flex flex-col">
      {/* Logo */}
      <div className="px-5 py-6 flex items-center gap-3">
        <span className="text-gold text-xl font-cinzel">ᚺ</span>
        <span className="font-cinzel text-gold-bright tracking-[0.2em] text-sm uppercase">
          Hermod
        </span>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-border" />

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-gold/5 text-gold-bright border-l-2 border-gold"
                  : "text-text-dim hover:text-text hover:bg-gold/[0.03] border-l-2 border-transparent"
              }`}
            >
              <span className="text-xs w-4 text-center">{item.rune}</span>
              <span className="tracking-[0.1em] uppercase text-xs">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 px-3 py-2">
          {session?.user?.image && (
            <img
              src={session.user.image}
              alt=""
              className="w-6 h-6 rounded-full"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text truncate tracking-wide">
              {session?.user?.name}
            </p>
          </div>
          <button
            onClick={() => signOut()}
            className="btn-subtle text-[0.625rem]"
          >
            Exit
          </button>
        </div>
      </div>
    </aside>
  );
}
