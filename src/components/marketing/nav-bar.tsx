"use client";

import { useState, useEffect } from "react";

const LINK_CLASS =
  "text-slate-600 font-medium font-serif tracking-tight text-sm uppercase hover:text-amber-700 transition-colors";

interface NavBarProps {
  /** On the landing page, anchor links use "#section"; on marketing pages they use "/#section" */
  anchorPrefix?: string;
  /** When true, the nav fades out on desktop after scrolling past the hero */
  scrolledPastHero?: boolean;
}

export function NavBar({ anchorPrefix = "/#", scrolledPastHero = false }: NavBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu on resize to desktop
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) setMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Prevent body scroll when menu is open + Escape key to close
  useEffect(() => {
    if (!menuOpen) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const links = [
    { label: "How It Works", href: `${anchorPrefix}how-it-works` },
    { label: "The Realms", href: `${anchorPrefix}realms` },
    { label: "The Forge", href: "/forge" },
    { label: "Data Agent", href: "/data-agent" },
    { label: "Pricing", href: `${anchorPrefix}pricing` },
  ];

  return (
    <nav
      className="fixed top-0 left-0 w-full z-50 bg-[#fbf9f6]/80 backdrop-blur-xl flex justify-between items-center px-8 py-4 max-w-full mx-auto nav-marketing"
      style={scrolledPastHero ? {
        opacity: 0,
        pointerEvents: "none" as const,
        transition: "opacity 0.3s ease",
      } : {
        opacity: 1,
        transition: "opacity 0.3s ease",
      }}
      data-scrolled={scrolledPastHero ? "true" : "false"}
    >

      {/* Logo */}
      <a href="/" className="text-2xl font-serif font-bold text-amber-800 tracking-[0.08em]">
        &#x16BA; HERMOD
      </a>

      {/* Desktop links */}
      <div className="hidden md:flex items-center space-x-8">
        {links.map((l) => (
          <a key={l.label} className={LINK_CLASS} href={l.href}>
            {l.label}
          </a>
        ))}
      </div>

      {/* Right side: Login/Get Started (desktop) + Hamburger (mobile) */}
      <div className="flex items-center space-x-4">
        <a
          href="/login"
          className="hidden md:inline-block px-5 py-2 text-xs font-mono font-bold tracking-widest text-slate-600 hover:text-amber-900 transition-all uppercase"
        >
          Login
        </a>
        <a
          href="/login"
          className="hidden md:inline-block px-6 py-2 bg-lp-primary text-on-primary text-xs font-mono font-bold tracking-widest hover:bg-primary-container transition-all uppercase"
        >
          Get Started
        </a>

        {/* Hamburger button — mobile only */}
        <button
          className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-[5px] group"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
        >
          <span
            className="block w-5 h-[2px] bg-slate-600 transition-transform duration-200 origin-center"
            style={menuOpen ? { transform: "translateY(3.5px) rotate(45deg)" } : {}}
          />
          <span
            className="block w-5 h-[2px] bg-slate-600 transition-opacity duration-200"
            style={menuOpen ? { opacity: 0 } : {}}
          />
          <span
            className="block w-5 h-[2px] bg-slate-600 transition-transform duration-200 origin-center"
            style={menuOpen ? { transform: "translateY(-3.5px) rotate(-45deg)" } : {}}
          />
        </button>
      </div>

      {/* Mobile menu overlay */}
      {menuOpen && (
        <div
          id="mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className="fixed inset-0 top-[56px] bg-[#fbf9f6] z-[110] md:hidden flex flex-col px-8 py-6 space-y-1 overflow-y-auto"
        >
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="block py-3 text-slate-700 font-serif text-lg uppercase tracking-wide border-b border-slate-200 hover:text-amber-700 transition-colors"
            >
              {l.label}
            </a>
          ))}
          <div className="pt-4 space-y-3">
            <a
              href="/login"
              onClick={() => setMenuOpen(false)}
              className="block py-3 text-center text-xs font-mono font-bold tracking-widest text-slate-600 uppercase border border-slate-300 hover:text-amber-900 transition-all"
            >
              Login
            </a>
            <a
              href="/login"
              onClick={() => setMenuOpen(false)}
              className="block py-3 text-center text-xs font-mono font-bold tracking-widest bg-lp-primary text-on-primary uppercase hover:bg-primary-container transition-all"
            >
              Get Started
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
