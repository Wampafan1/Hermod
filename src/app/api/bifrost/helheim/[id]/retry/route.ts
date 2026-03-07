import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import {
  decompressPayload,
  markRetrying,
  markRecovered,
  markRetryFailed,
} from "@/lib/bifrost/helheim/dead-letter";
import { getProvider, toConnectionLike } from "@/lib/providers";
import type { DestConfig } from "@/lib/bifrost/types";

// POST /api/bifrost/helheim/[id]/retry — Manual retry
export const POST = withAuth(async (req, session) => {
  const id = req.url.split("/helheim/")[1]?.split("/")[0]?.split("?")[0];

  const entry = await prisma.helheimEntry.findFirst({
    where: {
      id,
      route: { userId: session.user.id },
    },
    include: {
      route: {
        include: {
          dest: { select: { id: true, type: true, config: true, credentials: true } },
        },
      },
    },
  });

  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  if (entry.status === "recovered") {
    return NextResponse.json({ error: "Entry already recovered" }, { status: 400 });
  }

  await markRetrying(entry.id);

  const destProvider = getProvider(entry.route.dest.type);
  const destConnLike = toConnectionLike(entry.route.dest);
  const destConn = await destProvider.connect(destConnLike);
  const rows = await decompressPayload(entry.payload);
  const destConfig = entry.route.destConfig as unknown as DestConfig;

  try {
    const result = await destProvider.load!(destConn, rows, destConfig);
    await markRecovered(entry.id);
    return NextResponse.json({ status: "recovered", rowsLoaded: result.rowsLoaded });
  } catch (err) {
    await markRetryFailed(entry.id, entry.retryCount, entry.maxRetries, err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, status: "retry_failed" }, { status: 500 });
  } finally {
    await destConn.close();
  }
});
