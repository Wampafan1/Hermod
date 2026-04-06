"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/user-menu";

interface NavItem {
  href: string;
  label: string;
  rune: string;
  realmColor: string;
}

interface NavSection {
  header?: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", rune: "ᛟ", realmColor: "#d4af37" },
    ],
  },
  {
    header: "Bifrost Routes",
    items: [
      { href: "/bifrost", label: "Routes", rune: "ᛒ", realmColor: "rainbow" },
      { href: "/schedules", label: "Schedules", rune: "ᛏ", realmColor: "#d4af37" },
    ],
  },
  {
    header: "Realm Gates",
    items: [
      { href: "/gates", label: "Gates", rune: "ᚷ", realmColor: "#7eb8d4" },
    ],
  },
  {
    header: "Odin\u2019s Armory",
    items: [
      { href: "/connections", label: "Connections", rune: "ᚨ", realmColor: "#ce93d8" },
      { href: "/mjolnir", label: "Mjolnir", rune: "ᛗ", realmColor: "#ffb74d" },
      { href: "/reports", label: "Reports", rune: "ᚠ", realmColor: "#d4af37" },
      { href: "/history", label: "History", rune: "ᚺ", realmColor: "#d4af37" },
      { href: "/helheim", label: "Helheim", rune: "ᛞ", realmColor: "#78909c" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

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
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navSections.map((section, sIdx) => (
          <div key={sIdx}>
            {section.header && (
              <div className="px-3 pt-3 pb-1 text-[8px] uppercase tracking-[0.35em] text-[#6B5F4A] font-space-grotesk select-none">
                {section.header}
              </div>
            )}
            {section.items.map((item) => {
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
                  className={`group flex items-center gap-3 px-3 py-2 text-sm transition-all border-l-2 ${
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
          </div>
        ))}
      </nav>

      {/* User menu */}
      <UserMenu />
    </aside>
  );
}
