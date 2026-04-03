"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { RouteHistory } from "@/components/bifrost/route-history";

export default function RouteHistoryPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <div>
      <Link
        href="/bifrost"
        className="text-text-dim text-xs tracking-wider hover:text-gold mb-4 inline-block"
      >
        &larr; Back to Routes
      </Link>
      <RouteHistory routeId={id} />
    </div>
  );
}
