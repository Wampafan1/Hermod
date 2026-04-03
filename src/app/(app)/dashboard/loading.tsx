export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="h-7 w-36 bg-scroll animate-pulse" />
        <div className="h-4 w-56 bg-scroll animate-pulse mt-2" />
      </div>

      {/* [A] Health Summary — 5 cards */}
      <div className="grid grid-cols-5 gap-px bg-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-deep p-5">
            <div className="h-3 w-20 bg-scroll animate-pulse" />
            <div className="h-7 w-16 bg-scroll animate-pulse mt-3" />
          </div>
        ))}
      </div>

      {/* [B] Route Grid + [C] Upcoming */}
      <div className="grid gap-6" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <div>
          <div className="h-3 w-24 bg-scroll animate-pulse mb-2" />
          <div className="grid gap-px bg-border" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-void p-4">
                <div className="h-4 w-40 bg-scroll animate-pulse" />
                <div className="h-3 w-28 bg-scroll animate-pulse mt-2" />
                <div className="h-3 w-48 bg-scroll animate-pulse mt-2" />
              </div>
            ))}
          </div>
        </div>
        <div className="bg-deep border border-border">
          <div className="px-4 py-3 border-b border-border">
            <div className="h-3 w-24 bg-scroll animate-pulse" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-3 border-b border-border">
              <div className="h-4 w-36 bg-scroll animate-pulse" />
              <div className="h-3 w-24 bg-scroll animate-pulse mt-1" />
            </div>
          ))}
        </div>
      </div>

      {/* [D] Execution Timeline */}
      <div className="bg-deep border border-border">
        <div className="px-4 py-3 border-b border-border flex justify-between">
          <div className="h-3 w-28 bg-scroll animate-pulse" />
          <div className="flex gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-3 w-16 bg-scroll animate-pulse" />
            ))}
          </div>
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-4 py-3 border-b border-border/30 flex gap-4">
            <div className="w-2 h-2 bg-scroll animate-pulse mt-1" />
            <div className="h-3 w-32 bg-scroll animate-pulse" />
            <div className="h-3 w-16 bg-scroll animate-pulse" />
            <div className="h-3 w-16 bg-scroll animate-pulse ml-auto" />
            <div className="h-3 w-14 bg-scroll animate-pulse" />
            <div className="h-3 w-20 bg-scroll animate-pulse" />
          </div>
        ))}
      </div>

      {/* [E] Helheim Strip */}
      <div>
        <div className="h-3 w-44 bg-scroll animate-pulse mb-2" />
        <div className="flex gap-px bg-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex-1 bg-deep px-4 py-3">
              <div className="h-3 w-16 bg-scroll animate-pulse" />
              <div className="h-5 w-10 bg-scroll animate-pulse mt-2" />
            </div>
          ))}
          <div className="bg-deep px-4 py-3 flex items-center">
            <div className="h-3 w-24 bg-scroll animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
