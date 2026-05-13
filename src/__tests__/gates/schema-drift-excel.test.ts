import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { analyzeFile } from "@/lib/duckdb/file-analyzer";
import { toHermodType } from "@/lib/duckdb/type-mapper";
import { computeSchemaDiff, type SavedColumn } from "@/lib/gates/schema-diff";
import { buildSchemaDriftResolutionOptions } from "@/lib/gates/push-validation";

async function workbookBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function addBillingSummaryHeader(worksheet: ExcelJS.Worksheet): void {
  worksheet.getCell(1, 1).value = "ETD";
  worksheet.getCell(1, 2).value = "CBM";
  worksheet.getCell(1, 3).value = "Mgmt Fee (USD)";
  worksheet.getCell(1, 4).value = "ISF Fee (USD)";
  worksheet.getCell(1, 5).value = "Others Fee (USD)";
  worksheet.getCell(1, 6).value = "Total Amount (USD)";
  worksheet.getCell(1, 20).value = "";
}

function addBillingSummaryRow(
  worksheet: ExcelJS.Worksheet,
  row: number,
  values: {
    etd: number | Date;
    cbm: number;
    mgmt: number;
    isf: number;
    others: number;
    total: number;
    note?: string;
  }
): void {
  worksheet.getCell(row, 1).value = values.etd;
  worksheet.getCell(row, 2).value = values.cbm;
  worksheet.getCell(row, 3).value = values.mgmt;
  worksheet.getCell(row, 4).value = values.isf;
  worksheet.getCell(row, 5).value = values.others;
  worksheet.getCell(row, 6).value = values.total;
  worksheet.getCell(row, 20).value = values.note ?? null;
}

describe("Gate Excel schema drift inference", () => {
  it("keeps billing summary numeric columns numeric and skips grand-total formulas", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Departures");

    addBillingSummaryHeader(worksheet);
    addBillingSummaryRow(worksheet, 2, {
      etd: 45585,
      cbm: 3.25,
      mgmt: 120,
      isf: 45,
      others: 7.5,
      total: 172.5,
      note: "Reviewed",
    });
    addBillingSummaryRow(worksheet, 3, {
      etd: new Date("2026-04-18T00:00:00Z"),
      cbm: 4.5,
      mgmt: 150,
      isf: 55,
      others: 12.25,
      total: 217.25,
    });
    worksheet.getCell(4, 1).value = "Grand Total :";
    worksheet.getCell(4, 2).value = { formula: "SUM(B2:B3)", result: 7.75 };
    worksheet.getCell(4, 3).value = { formula: "SUM(C2:C3)", result: 270 };
    worksheet.getCell(4, 4).value = { formula: "SUM(D2:D3)", result: 100 };
    worksheet.getCell(4, 5).value = { formula: "SUM(E2:E3)", result: 19.75 };
    worksheet.getCell(4, 6).value = { formula: "SUM(F2:F3)", result: 389.75 };
    worksheet.getCell(5, 1).value = "Notes:";
    worksheet.getCell(5, 2).value = { formula: "B4" };

    const analysis = await analyzeFile(
      await workbookBuffer(workbook),
      "LOV - OM Billing Summary - Departures 10.20.24 thru 4.18.26.xlsx",
      { skipUCC: true }
    );

    const byName = new Map(analysis.columns.map((column) => [column.name, column]));

    expect(analysis.rowCount).toBe(2);
    expect(byName.get("CBM")).toBeDefined();
    expect(byName.get("Mgmt Fee (USD)")).toBeDefined();
    expect(byName.get("ISF Fee (USD)")).toBeDefined();
    expect(byName.get("Others Fee (USD)")).toBeDefined();
    expect(byName.get("column_20")).toBeDefined();

    for (const name of ["CBM", "Mgmt Fee (USD)", "ISF Fee (USD)", "Others Fee (USD)"]) {
      const column = byName.get(name);
      expect(toHermodType(column!.duckdbType), name).toMatch(/^(INTEGER|FLOAT)$/);
      expect(toHermodType(column!.duckdbType), name).not.toBe("JSON");
    }

    const etd = byName.get("ETD");
    expect(etd).toBeDefined();
    expect(toHermodType(etd!.duckdbType)).not.toBe("INTEGER");
    expect(toHermodType(etd!.duckdbType)).not.toBe("JSON");
    expect(etd!.sampleValues[0]).toMatch(/^20\d{2}-\d{2}-\d{2}/);

    const savedColumns: SavedColumn[] = [
      { name: "ETD", duckdbType: "BIGINT", inferredType: "integer", nullable: false },
      { name: "CBM", duckdbType: "DOUBLE", inferredType: "number", nullable: false },
      { name: "Mgmt Fee (USD)", duckdbType: "BIGINT", inferredType: "integer", nullable: false },
      { name: "ISF Fee (USD)", duckdbType: "BIGINT", inferredType: "integer", nullable: false },
      { name: "Others Fee (USD)", duckdbType: "DOUBLE", inferredType: "number", nullable: false },
      { name: "Total Amount (USD)", duckdbType: "DOUBLE", inferredType: "number", nullable: false },
    ];
    const drift = computeSchemaDiff(savedColumns, analysis.columns);

    expect(drift.diff.typeChanged).toEqual([]);
    expect(drift.diff.added).toEqual([{ name: "column_20", type: byName.get("column_20")!.duckdbType }]);

    const resolution = buildSchemaDriftResolutionOptions({
      diff: drift.diff,
      columnMapping: [
        { sourceColumn: "ETD", destinationColumn: "etd" },
        { sourceColumn: "CBM", destinationColumn: "cbm" },
      ],
      connectionType: "POSTGRES",
      targetSchema: "public",
      targetTable: "loves_billing_summary",
    });

    expect(resolution.adjustFile.actions).toContain(
      "Remove column: column_20 (blank header) (not in destination)"
    );
  });
});
