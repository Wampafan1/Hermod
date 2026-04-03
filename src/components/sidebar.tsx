"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", rune: "ᛟ", realmColor: "#d4af37" },
  { href: "/reports", label: "Reports", rune: "ᚠ", realmColor: "#d4af37" },
  { href: "/connections", label: "Connections", rune: "ᚨ", realmColor: "#ce93d8" },
  { href: "/bifrost", label: "Bifrost", rune: "ᛒ", realmColor: "rainbow" },
  { href: "/mjolnir", label: "Mjolnir", rune: "ᛗ", realmColor: "#ffb74d" },
  { href: "/schedules", label: "Schedules", rune: "ᛏ", realmColor: "#d4af37" },
  { href: "/history", label: "History", rune: "ᚺ", realmColor: "#d4af37" },
  { href: "/helheim", label: "Helheim", rune: "ᛞ", realmColor: "#78909c" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className="sidebar-iron w-56 h-screen border-r border-[rgba(139,105,20,0.15)] flex flex-col">
      {/* Logo — the book's title page */}
      <div className="px-5 py-6 flex items-center gap-3">
        <span className="text-gold-leaf text-xl font-cinzel">ᚺ</span>
        <span className="font-cinzel text-gold-leaf tracking-[0.12em] text-sm">
          Hermod
        </span>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-[rgba(139,105,20,0.15)]" />

      {/* Nav — iron binding with gold-leaf active state */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);

          const borderStyle = isActive
            ? item.realmColor === "rainbow"
              ? { borderImage: "linear-gradient(to bottom, #ff6b6b, #ffa726, #ffee58, #66bb6a, #42a5f5, #7e57c2) 1" }
              : { borderColor: item.realmColor }
            : undefined;

          const runeStyle = isActive
            ? item.realmColor === "rainbow"
              ? {
                  background: "linear-gradient(135deg, #ff6b6b, #ffa726, #ffee58, #66bb6a, #42a5f5, #7e57c2)",
                  WebkitBackgroundClip: "text" as const,
                  WebkitTextFillColor: "transparent",
                }
              : { color: item.realmColor }
            : {};

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 px-3 py-2.5 text-sm transition-all border-l-2 ${
                isActive
                  ? "bg-[rgba(139,105,20,0.12)] text-gold-leaf"
                  : "text-[#A09882] hover:text-[#EDE4CC] hover:bg-[rgba(139,105,20,0.06)] border-transparent"
              }`}
              style={isActive ? borderStyle : undefined}
              onMouseEnter={(e) => {
                if (!isActive) {
                  if (item.realmColor === "rainbow") {
                    e.currentTarget.style.borderImage = "linear-gradient(to bottom, #ff6b6b, #ffa726, #ffee58, #66bb6a, #42a5f5, #7e57c2) 1";
                  } else {
                    e.currentTarget.style.borderColor = item.realmColor;
                  }
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.borderImage = "";
                  e.currentTarget.style.borderColor = "transparent";
                }
              }}
            >
              <span className="text-xs w-4 text-center" style={runeStyle}>
                {item.rune}
              </span>
              <span className="tracking-[0.08em] uppercase text-xs font-space-grotesk font-medium">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="border-t border-[rgba(139,105,20,0.15)] p-3">
        <div className="flex items-center gap-3 px-3 py-2">
          {session?.user?.image && (
            <img
              src={session.user.image}
              alt=""
              className="w-6 h-6 rounded-full"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[#A09882] truncate tracking-wide font-space-grotesk">
              {session?.user?.name}
            </p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="btn-subtle text-[0.625rem]"
          >
            Exit
          </button>
        </div>
      </div>
    </aside>
  );
}
