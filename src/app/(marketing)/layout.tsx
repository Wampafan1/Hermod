import { NavBar } from "@/components/marketing/nav-bar";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="landing-page font-body selection:bg-[#ffdea4] selection:text-[#261900]">
      {/* Shared marketing nav */}
      <NavBar />

      <main className="pt-[72px]">{children}</main>

      {/* Shared marketing footer */}
      <footer className="bg-slate-50">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 px-12 py-16 max-w-7xl mx-auto">
          <div className="md:col-span-1">
            <div className="text-xl font-serif font-black text-amber-900 mb-6">&#x16BA; HERMOD</div>
            <p className="font-mono text-[10px] tracking-widest text-slate-500 uppercase leading-loose">
              Automated report delivery from any database to any inbox.
            </p>
          </div>
          <div>
            <h5 className="font-mono text-xs font-bold tracking-[0.3em] uppercase mb-8 text-amber-800">Platform</h5>
            <ul className="space-y-4">
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/#how-it-works">How It Works</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/#realms">The Realms</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/#pricing">Pricing</a></li>
            </ul>
          </div>
          <div>
            <h5 className="font-mono text-xs font-bold tracking-[0.3em] uppercase mb-8 text-amber-800">Features</h5>
            <ul className="space-y-4">
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/forge">The Forge</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/data-agent">Data Agent</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/connectors">Connectors</a></li>
            </ul>
          </div>
          <div>
            <h5 className="font-mono text-xs font-bold tracking-[0.3em] uppercase mb-8 text-amber-800">Company</h5>
            <ul className="space-y-4">
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/privacy">Privacy Policy</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/terms">Terms of Service</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-amber-900/10 py-8 px-12 text-center">
          <div className="font-serif text-amber-900/40 text-lg tracking-[2em] mb-4">&#x16A0; &#x16A2; &#x16A6; &#x16A8; &#x16B1; &#x16B2;</div>
          <p className="font-mono text-[10px] tracking-[0.3em] text-slate-400 uppercase">
            &copy; 2026 Hermod. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
