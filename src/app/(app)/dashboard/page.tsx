import { requireAuth } from "@/lib/session";
import { getDashboardData } from "@/lib/dashboard/queries";
import { HealthSummary } from "@/components/dashboard/health-summary";
import { RouteHealthGrid } from "@/components/dashboard/route-health-grid";
import { UpcomingRuns } from "@/components/dashboard/upcoming-runs";
import { ExecutionTimeline } from "@/components/dashboard/execution-timeline";
import { HelheimStrip } from "@/components/dashboard/helheim-strip";
import { RealmBanner } from "@/components/realm-banner";
import { DAILY_GREETINGS } from "@/lib/realm-config";

export default async function DashboardPage() {
  const session = await requireAuth();
  const data = await getDashboardData(session.user.id);

  const now = new Date();
  const dayInfo = DAILY_GREETINGS[now.getDay()];
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const firstName = session.user.name?.split(" ")[0] ?? "";

  return (
    <div className="space-y-6">
      <RealmBanner
        realm="asgard"
        rune="ᚱ"
        title="Dashboard"
        subtitle={`${dayInfo.greeting}, ${firstName} — ${dateStr}`}
        accentColor="#d4af37"
      />

      {/* Flavor text */}
      <p className="text-text-muted text-[11px] font-source-serif italic tracking-wide -mt-4 animate-fade-up" style={{ animationDelay: "0.03s" }}>
        {dayInfo.flavor}
      </p>

      {/* [A] Health Summary Strip */}
      <div className="animate-fade-up" style={{ animationDelay: "0.05s" }}>
        <HealthSummary stats={data.stats} />
      </div>

      {/* Bifrost accent line */}
      <div
        className="h-[2px] animate-fade-up"
        style={{
          background: "linear-gradient(90deg, #ff6b6b, #ffa726, #ffee58, #66bb6a, #42a5f5, #7e57c2, #ff6b6b)",
          backgroundSize: "200% 100%",
          animation: "bifrostBar 4s linear infinite",
          animationDelay: "0.08s",
        }}
      />

      {/* [B] Route Health Grid + [C] Upcoming Runs */}
      <div className="animate-fade-up" style={{ animationDelay: "0.1s" }}>
        <div className="flex items-center gap-4 mb-3">
          <h2 className="label-norse !mb-0 text-gold">The War Table</h2>
          <div className="flex-1 h-px bg-border" />
          <span className="text-gold-dim text-xs font-cinzel select-none">ᛒ</span>
          <div className="flex-1 h-px bg-border" />
        </div>
        <p className="text-text-muted text-[10px] font-space-grotesk tracking-wider italic mb-3">
          Dispatches across the Nine Realms
        </p>
        <div
          className="grid gap-6"
          style={{ gridTemplateColumns: "2fr 1fr" }}
        >
          <RouteHealthGrid routes={data.routes} />
          <UpcomingRuns runs={data.upcomingRuns} />
        </div>
      </div>

      {/* [D] Execution Timeline */}
      <div className="animate-fade-up" style={{ animationDelay: "0.15s" }}>
        <ExecutionTimeline
          initialRuns={data.recentRuns}
          initialTotal={data.totalRunCount}
        />
      </div>

      {/* [E] Helheim Summary Strip */}
      <div className="animate-fade-up" style={{ animationDelay: "0.2s" }}>
        <h2 className="label-norse text-gold mb-2">Helheim — Dead Letter Queue</h2>
        <HelheimStrip helheim={data.helheim} />
      </div>
    </div>
  );
}
