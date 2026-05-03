"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/user-menu";
import { HermodWordmark } from "@/components/rune-h";

interface NavItem {
  href: string;
  label: string;
  rune: string;
  realmColor: string;
}

interface NavSection {
  header?: string;
  collapsible?: boolean;
  rune?: string;
  realmColor?: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", rune: "\u16DF", realmColor: "#d4af37" },
    ],
  },
  {
    header: "Bifrost Routes",
    items: [
      { href: "/bifrost", label: "Routes", rune: "\u16D2", realmColor: "rainbow" },
      { href: "/schedules", label: "Schedules", rune: "\u16CF", realmColor: "#d4af37" },
    ],
  },
  {
    header: "DB Operations",
    collapsible: true,
    rune: "\u16BE",
    realmColor: "#7eb8d4",
    items: [
      { href: "/backups", label: "Backups", rune: "\u16BE", realmColor: "#7eb8d4" },
      { href: "/backups/restores", label: "Restores", rune: "\u16B1", realmColor: "#7eb8d4" },
      { href: "/backups/storage", label: "Cold Storage", rune: "\u16DA", realmColor: "#7eb8d4" },
    ],
  },
  {
    header: "Realm Gates",
    items: [
      { href: "/gates", label: "Gates", rune: "\u16B7", realmColor: "#7eb8d4" },
    ],
  },
  {
    header: "Odin\u2019s Armory",
    items: [
      { href: "/connections", label: "Connections", rune: "\u16A8", realmColor: "#ce93d8" },
      { href: "/mjolnir", label: "Mjolnir", rune: "\u16D7", realmColor: "#ffb74d" },
      { href: "/reports", label: "Reports", rune: "\u16A0", realmColor: "#d4af37" },
      { href: "/history", label: "History", rune: "\u16BA", realmColor: "#d4af37" },
      { href: "/helheim", label: "Helheim", rune: "\u16DE", realmColor: "#78909c" },
    ],
  },
];

function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/dashboard") return pathname === "/dashboard";
  if (item.href === "/backups/storage") return pathname.startsWith("/backups/storage");
  if (item.href === "/backups/restores") {
    return pathname.startsWith("/backups/restores") ||
      pathname === "/backups/restore" ||
      /^\/backups\/[^/]+\/restore$/.test(pathname);
  }
  if (item.href === "/backups") {
    return pathname === "/backups" ||
      pathname === "/backups/new" ||
      pathname === "/backups/mssql" ||
      pathname.startsWith("/backups/mssql/") ||
      /^\/backups\/(?!storage(?:\/|$)|restores(?:\/|$))[^/]+(?:\/history)?$/.test(pathname);
  }
  return pathname.startsWith(item.href);
}

function activeBackground(color: string): string {
  if (color === "rainbow") {
    return "linear-gradient(90deg, rgba(139,105,20,0.18) 0%, rgba(139,105,20,0.04) 100%)";
  }
  return `linear-gradient(90deg, ${color}22 0%, transparent 100%)`;
}

function runeStyle(color: string, active: boolean) {
  if (!active) return {};
  if (color === "rainbow") {
    return {
      background: "linear-gradient(135deg, #ff6b6b, #ffa726, #ffee58, #66bb6a, #42a5f5, #7e57c2)",
      WebkitBackgroundClip: "text" as const,
      WebkitTextFillColor: "transparent",
    };
  }
  return { color };
}

export function Sidebar() {
  const pathname = usePathname();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  return (
    <aside className="sidebar-iron w-56 h-screen border-r border-[rgba(139,105,20,0.15)] flex flex-col">
      {/* Logo - the book's title page */}
      <div className="px-5 py-6">
        <HermodWordmark size={22} runeColor="var(--gold-leaf)" textColor="var(--gold-leaf)" />
      </div>

      <div className="mx-4 h-px bg-[rgba(139,105,20,0.15)]" />

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navSections.map((section, sIdx) => {
          const sectionKey = section.header ?? String(sIdx);
          const sectionActive = section.items.some((item) => isNavItemActive(item, pathname));
          const sectionOpen = section.collapsible
            ? openSections[sectionKey] ?? sectionActive
            : true;

          return (
            <div key={sectionKey}>
              {section.header && section.collapsible ? (
                <button
                  type="button"
                  aria-expanded={sectionOpen}
                  onClick={() => setOpenSections((current) => ({
                    ...current,
                    [sectionKey]: !(current[sectionKey] ?? sectionActive),
                  }))}
                  className={`group relative flex w-full items-center gap-3 pl-5 pr-3 py-2 text-sm transition-all ${
                    sectionActive
                      ? "text-gold-leaf"
                      : "text-[#A09882] hover:text-[#EDE4CC] hover:bg-[rgba(139,105,20,0.06)]"
                  }`}
                  style={
                    sectionActive && section.realmColor
                      ? { background: activeBackground(section.realmColor) }
                      : undefined
                  }
                >
                  <span
                    aria-hidden
                    className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] leading-none transition-opacity"
                    style={{
                      color: section.realmColor ?? "var(--gold-leaf)",
                      opacity: sectionActive ? 1 : 0,
                    }}
                  >
                    {"\u25B8"}
                  </span>
                  <span
                    className="text-xs w-4 text-center"
                    style={{ color: section.realmColor ?? "var(--gold-leaf)" }}
                  >
                    {section.rune}
                  </span>
                  <span className="tracking-[0.08em] uppercase text-xs font-space-grotesk font-medium">
                    {section.header}
                  </span>
                  <span className="ml-auto text-[10px] text-[#6B5F4A]">
                    {sectionOpen ? "\u25BE" : "\u25B8"}
                  </span>
                </button>
              ) : section.header ? (
                <div className="px-3 pt-3 pb-1 text-[8px] uppercase tracking-[0.35em] text-[#6B5F4A] font-space-grotesk select-none">
                  {section.header}
                </div>
              ) : null}

              {sectionOpen && section.items.map((item) => {
                const isActive = isNavItemActive(item, pathname);
                const childIndent = section.collapsible ? "pl-8" : "pl-5";

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group relative flex items-center gap-3 ${childIndent} pr-3 py-2 text-sm transition-all ${
                      isActive
                        ? "text-gold-leaf"
                        : "text-[#A09882] hover:text-[#EDE4CC] hover:bg-[rgba(139,105,20,0.06)]"
                    }`}
                    style={isActive ? { background: activeBackground(item.realmColor) } : undefined}
                  >
                    <span
                      aria-hidden
                      className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] leading-none transition-opacity"
                      style={{
                        color:
                          item.realmColor === "rainbow"
                            ? "var(--gold-leaf)"
                            : item.realmColor,
                        opacity: isActive ? 1 : 0,
                      }}
                    >
                      {"\u25B8"}
                    </span>
                    <span className="text-xs w-4 text-center" style={runeStyle(item.realmColor, isActive)}>
                      {item.rune}
                    </span>
                    <span className="tracking-[0.08em] uppercase text-xs font-space-grotesk font-medium">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <UserMenu />
    </aside>
  );
}
