export default function Loading() {
  return (
    <div className="flex h-[calc(100vh-5.5rem)] gap-4">
      {/* Main editor area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar skeleton */}
        <div className="flex items-center gap-3 mb-3">
          <div className="h-9 w-48 skeleton-norse" />
          <div className="h-9 w-24 skeleton-norse" />
        </div>

        {/* SQL editor skeleton */}
        <div className="h-[35%] bg-deep border border-border skeleton-norse" />

        {/* Resize handle placeholder */}
        <div className="h-px my-1" />

        {/* Spreadsheet area skeleton */}
        <div className="flex-1 bg-deep border border-border skeleton-norse" />
      </div>

      {/* Config sidebar skeleton */}
      <div className="w-72 shrink-0 space-y-4">
        <div className="h-5 w-20 skeleton-norse" />
        <div className="h-9 w-full skeleton-norse" />
        <div className="h-5 w-28 skeleton-norse" />
        <div className="h-20 w-full skeleton-norse" />
        <div className="h-5 w-24 skeleton-norse" />
        <div className="h-9 w-full skeleton-norse" />
        <div className="mt-6 h-9 w-full skeleton-norse" />
        <div className="h-9 w-full skeleton-norse" />
      </div>
    </div>
  );
}
