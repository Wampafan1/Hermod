export default function Loading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-7 w-32 skeleton-norse" />
        <div className="h-4 w-56 skeleton-norse mt-2" />
      </div>
      <div className="space-y-px">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-deep border border-border p-5 skeleton-norse h-20" />
        ))}
      </div>
    </div>
  );
}
