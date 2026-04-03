export default function HelheimLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="h-5 w-5 bg-scroll animate-pulse" />
          <div className="h-6 w-28 bg-scroll animate-pulse" />
        </div>
        <div className="h-4 w-72 bg-scroll animate-pulse mt-1" />
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-5 gap-px bg-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-deep p-5">
            <div className="h-3 w-20 bg-scroll animate-pulse" />
            <div className="h-7 w-12 bg-scroll animate-pulse mt-3" />
          </div>
        ))}
      </div>

      {/* List + Detail split */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "3fr 2fr" }}>
        {/* List panel */}
        <div className="bg-deep border border-border">
          <div className="px-4 py-3 border-b border-border flex gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-3 w-16 bg-scroll animate-pulse" />
            ))}
          </div>
          <div className="px-4 py-3 border-b border-border flex gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-4 w-14 bg-scroll animate-pulse" />
            ))}
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="px-4 py-3 border-b border-border/30 flex items-center gap-3"
            >
              <div className="w-2 h-2 bg-scroll animate-pulse" />
              <div className="h-3 w-28 bg-scroll animate-pulse" />
              <div className="h-3 w-12 bg-scroll animate-pulse" />
              <div className="h-3 w-10 bg-scroll animate-pulse ml-auto" />
              <div className="h-3 w-8 bg-scroll animate-pulse" />
              <div className="h-3 w-12 bg-scroll animate-pulse" />
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div className="bg-deep border border-border p-5">
          <div className="h-6 w-20 bg-scroll animate-pulse mb-4" />
          <div className="h-4 w-40 bg-scroll animate-pulse mb-2" />
          <div className="h-3 w-56 bg-scroll animate-pulse mb-6" />
          <div className="h-3 w-16 bg-scroll animate-pulse mb-2" />
          <div className="h-28 bg-scroll animate-pulse mb-6" />
          <div className="h-3 w-20 bg-scroll animate-pulse mb-2" />
          <div className="flex gap-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="w-5 h-5 bg-scroll animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
