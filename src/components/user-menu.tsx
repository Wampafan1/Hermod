"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

// ─── Menu Items ─────────────────────────────────────

const menuSections = [
  {
    header: "Settings",
    items: [
      { href: "/settings/ravens", label: "Data Agents", rune: "ᚱ" },
      { href: "/settings/raven-keys", label: "API Keys", rune: "ᚲ" },
    ],
  },
];

// ─── Component ──────────────────────────────────────

export function UserMenu() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const userName = session?.user?.name ?? "User";
  const tenantName = session?.user?.tenantName ?? "";
  const userImage = session?.user?.image;
  const initial = userName.charAt(0).toUpperCase();

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const handleSignOut = useCallback(() => {
    signOut({ callbackUrl: "/" });
  }, []);

  return (
    <div ref={containerRef} className="relative border-t border-[rgba(139,105,20,0.15)]">
      {/* Dropdown — opens ABOVE the profile row */}
      {open && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1 border border-[rgba(201,147,58,0.1)] shadow-lg z-50"
          style={{
            background: "rgba(4,6,15,0.95)",
            animation: "userMenuIn 0.15s ease",
          }}
        >
          {menuSections.map((section, sIdx) => (
            <div key={sIdx}>
              {section.header && (
                <div className="px-4 pt-3 pb-1 text-[8px] uppercase tracking-[0.35em] text-[#6B5F4A] font-space-grotesk select-none">
                  {section.header}
                </div>
              )}
              {section.items.map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2 text-xs transition-colors ${
                      isActive
                        ? "bg-[rgba(139,105,20,0.12)] text-gold-leaf"
                        : "text-[#A09882] hover:text-[#EDE4CC] hover:bg-[rgba(139,105,20,0.06)]"
                    }`}
                  >
                    <span className="text-[10px] w-4 text-center text-[#6B5F4A]">{item.rune}</span>
                    <span className="tracking-[0.08em] uppercase font-space-grotesk font-medium">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}

          {/* Divider */}
          <div className="mx-3 my-1 h-px bg-[rgba(139,105,20,0.15)]" />

          {/* Sign Out */}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-[#ef5350] hover:bg-[rgba(239,83,80,0.06)] transition-colors"
          >
            <span className="text-[10px] w-4 text-center">ᛞ</span>
            <span className="tracking-[0.08em] uppercase font-space-grotesk font-medium">
              Sign Out
            </span>
          </button>
        </div>
      )}

      {/* Profile row — click to toggle */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[rgba(139,105,20,0.06)] transition-colors text-left"
      >
        {/* Avatar */}
        {userImage ? (
          <img
            src={userImage}
            alt=""
            className="w-8 h-8 rounded-full shrink-0"
          />
        ) : (
          <div
            className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-cinzel"
            style={{
              background: "rgba(201,147,58,0.15)",
              color: "#c9933a",
            }}
          >
            {initial}
          </div>
        )}

        {/* Name + Tenant */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[#EDE4CC] truncate tracking-wide font-space-grotesk">
            {userName}
          </p>
          {tenantName && (
            <p className="text-[10px] text-[#6B5F4A] truncate tracking-wide font-space-grotesk">
              {tenantName}
            </p>
          )}
        </div>

        {/* Chevron */}
        <span
          className={`text-[10px] text-[#6B5F4A] transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        >
          ▲
        </span>
      </button>

      {/* Keyframe animation */}
      <style jsx>{`
        @keyframes userMenuIn {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
