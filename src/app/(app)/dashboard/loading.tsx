export default function Loading() {
  return (
    <div className="space-y-8">
      <div>
        <div className="h-7 w-40 skeleton-norse" />
        <div className="h-4 w-32 skeleton-norse mt-2" />
      </div>
      <div className="grid grid-cols-3 gap-px">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-deep border border-border p-5 skeleton-norse h-24" />
        ))}
      </div>
      <div className="flex gap-3">
        <div className="h-9 w-28 skeleton-norse" />
        <div className="h-9 w-32 skeleton-norse" />
      </div>
      <div>
        <div className="h-5 w-28 skeleton-norse mb-3" />
        <div className="space-y-px">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-deep border border-border p-4 skeleton-norse h-12" />
          ))}
        </div>
      </div>
    </div>
  );
}
