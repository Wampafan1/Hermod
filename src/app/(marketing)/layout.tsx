export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="landing-page font-body selection:bg-[#ffdea4] selection:text-[#261900]">
      {/* Shared marketing nav */}
      <nav className="fixed top-0 left-0 w-full z-50 bg-[#fbf9f6]/80 backdrop-blur-xl flex justify-between items-center px-8 py-4 max-w-full mx-auto">
        <a href="/" className="text-2xl font-serif font-bold text-amber-800 tracking-[0.08em]">
          &#x16BA; HERMOD
        </a>
        <div className="hidden md:flex items-center space-x-8">
          <a className="text-slate-600 font-medium font-serif tracking-tight text-sm uppercase hover:text-amber-700 transition-colors" href="/#how-it-works">How It Works</a>
          <a className="text-slate-600 font-medium font-serif tracking-tight text-sm uppercase hover:text-amber-700 transition-colors" href="/#realms">The Realms</a>
          <a className="text-amber-900 font-bold border-b-2 border-amber-700 font-serif tracking-tight text-sm uppercase" href="/forge">Mj&ouml;lnir</a>
          <a className="text-slate-600 font-medium font-serif tracking-tight text-sm uppercase hover:text-amber-700 transition-colors" href="/connectors">Connectors</a>
          <a className="text-slate-600 font-medium font-serif tracking-tight text-sm uppercase hover:text-amber-700 transition-colors" href="/#pricing">Pricing</a>
        </div>
        <div className="flex items-center space-x-4">
          <a href="/login" className="px-5 py-2 text-xs font-mono font-bold tracking-widest text-slate-600 hover:text-amber-900 transition-all uppercase">Login</a>
          <a href="/login" className="px-6 py-2 bg-lp-primary text-on-primary text-xs font-mono font-bold tracking-widest hover:bg-primary-container transition-all uppercase">Get Started</a>
        </div>
      </nav>

      <main className="pt-[72px]">{children}</main>

      {/* Shared marketing footer */}
      <footer className="bg-slate-50">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 px-12 py-20 max-w-7xl mx-auto">
          <div className="md:col-span-1">
            <div className="text-xl font-serif font-black text-amber-900 mb-6">&#x16BA; HERMOD</div>
            <p className="font-mono text-[10px] tracking-widest text-slate-500 uppercase leading-loose">
              The AI-powered data pipeline engine. Route data between any source and any destination.
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
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/forge">Mj&ouml;lnir Premium</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/forge#forge-blueprints">AI Forge Blueprints</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/forge#smart-merge">Smart Merge</a></li>
            </ul>
          </div>
          <div>
            <h5 className="font-mono text-xs font-bold tracking-[0.3em] uppercase mb-8 text-amber-800">Company</h5>
            <ul className="space-y-4">
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="#">Docs</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="#">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-200 py-6 text-center">
          <p className="font-mono text-[9px] tracking-[0.3em] uppercase text-slate-400">
            &copy; {new Date().getFullYear()} Hermod. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
