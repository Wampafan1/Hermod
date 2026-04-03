import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { withAuth } from "@/lib/api";
import { detectExcelSchema } from "@/lib/alfheim/excel-detector";

const UPLOADS_DIR = join(process.cwd(), "uploads");
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export const POST = withAuth(async (req, session) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File exceeds 100MB limit" },
      { status: 400 }
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !["xlsx", "xls"].includes(ext)) {
    return NextResponse.json(
      { error: "Only .xlsx and .xls files are accepted" },
      { status: 400 }
    );
  }

  // Ensure uploads directory exists
  await mkdir(UPLOADS_DIR, { recursive: true });

  // Save to uploads directory — fileId is the only reference returned to client
  const fileId = randomUUID();
  const filename = `${session.user.id}_${fileId}.${ext}`;
  const filePath = join(UPLOADS_DIR, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  // Detect schema
  const sheetName = formData.get("sheetName") as string | null;
  const headerRow = formData.get("headerRow");
  const dataStartRow = formData.get("dataStartRow");

  const result = await detectExcelSchema(filePath, {
    sheetName: sheetName || undefined,
    headerRow: headerRow ? Number(headerRow) : undefined,
    dataStartRow: dataStartRow ? Number(dataStartRow) : undefined,
  });

  return NextResponse.json({
    fileId,
    filePath, // server path — stored in connection config for provider access
    originalFilename: file.name,
    fileSize: file.size,
    ...result,
  });
});
