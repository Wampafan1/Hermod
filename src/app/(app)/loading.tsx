export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 skeleton-norse" />
      <div className="space-y-px">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-deep border border-border p-5 skeleton-norse h-20" />
        ))}
      </div>
    </div>
  );
}
