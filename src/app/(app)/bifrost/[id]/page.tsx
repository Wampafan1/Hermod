"use client";

import { useParams } from "next/navigation";
import { RouteEditor } from "@/components/bifrost/route-editor";

export default function EditRoutePage() {
  const params = useParams();
  const id = params.id as string;

  return <RouteEditor routeId={id} />;
}
