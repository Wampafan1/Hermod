import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { z } from "zod";
import { analyzeSheetWithAI } from "@/lib/alfheim/sheet-analyzer";

const bodySchema = z.object({
  rawRows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  filename: z.string().min(1),
  sheetName: z.string().optional(),
  totalRows: z.number().int().min(0),
  totalColumns: z.number().int().min(0),
});

export const POST = withAuth(async (req) => {
  const body = await req.json();
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await analyzeSheetWithAI(parsed.data);
  return NextResponse.json(result);
});
