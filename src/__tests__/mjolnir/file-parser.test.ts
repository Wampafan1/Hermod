import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseExcelBuffer, detectHeaderRow, detectHeaderRowHeuristic, MAX_FILE_SIZE, SAMPLE_ROW_CAP } from "@/lib/mjolnir/file-parser";

/**
 * Helper: create an in-memory .xlsx buffer from headers and row data.
 */
async function createTestWorkbook(
  headers: string[],
  rows: unknown[][]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(headers);
  rows.forEach((row) => ws.addRow(row));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("parseExcelBuffer", () => {
  it("parses a basic workbook with headers and data rows", async () => {
    const buffer = await createTestWorkbook(
      ["Name", "Age", "City"],
      [
        ["Alice", 30, "NYC"],
        ["Bob", 25, "LA"],
        ["Charlie", 35, "Chicago"],
      ]
    );

    const result = await parseExcelBuffer(buffer, "test.xlsx", "file-001");

    expect(result.fileId).toBe("file-001");
    expect(result.filename).toBe("test.xlsx");
    expect(result.rowCount).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({ Name: "Alice", Age: 30, City: "NYC" });
    expect(result.rows[1]).toEqual({ Name: "Bob", Age: 25, City: "LA" });
    expect(result.rows[2]).toEqual({ Name: "Charlie", Age: 35, City: "Chicago" });
  });

  it("returns correct column names", async () => {
    const buffer = await createTestWorkbook(
      ["First Name", "Last Name", "Email Address"],
      [["John", "Doe", "john@test.com"]]
    );

    const result = await parseExcelBuffer(buffer, "contacts.xlsx", "file-002");

    expect(result.columns).toEqual(["First Name", "Last Name", "Email Address"]);
  });

  it("returns correct row count", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => [`Item ${i}`, i * 10]);
    const buffer = await createTestWorkbook(["Product", "Price"], rows);

    const result = await parseExcelBuffer(buffer, "products.xlsx", "file-003");

    expect(result.rowCount).toBe(25);
    expect(result.rows).toHaveLength(25);
  });

  it("caps sample at SAMPLE_ROW_CAP rows", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => [`Row ${i}`, i]);
    const buffer = await createTestWorkbook(["Label", "Value"], rows);

    const result = await parseExcelBuffer(buffer, "big.xlsx", "file-004");

    expect(result.rowCount).toBe(100);
    expect(result.rows).toHaveLength(100);
    expect(result.sampleRows).toHaveLength(SAMPLE_ROW_CAP);
    // Sample should be the first 50 rows
    expect(result.sampleRows[0]).toEqual({ Label: "Row 0", Value: 0 });
    expect(result.sampleRows[SAMPLE_ROW_CAP - 1]).toEqual({
      Label: `Row ${SAMPLE_ROW_CAP - 1}`,
      Value: SAMPLE_ROW_CAP - 1,
    });
  });

  it("handles formula cells by using the result value", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["A", "B", "Sum"]);
    ws.getCell("A2").value = 10;
    ws.getCell("B2").value = 20;
    // ExcelJS stores formula with a result property
    ws.getCell("C2").value = { formula: "A2+B2", result: 30 } as ExcelJS.CellFormulaValue;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await parseExcelBuffer(buffer, "formulas.xlsx", "file-005");

    expect(result.rows[0]["Sum"]).toBe(30);
  });

  it("handles date values", async () => {
    const date1 = new Date("2024-01-15T00:00:00Z");
    const date2 = new Date("2024-06-30T00:00:00Z");
    const buffer = await createTestWorkbook(
      ["Name", "Date"],
      [
        ["Event A", date1],
        ["Event B", date2],
      ]
    );

    const result = await parseExcelBuffer(buffer, "dates.xlsx", "file-006");

    expect(result.rows[0]["Date"]).toBeInstanceOf(Date);
    expect(result.rows[1]["Date"]).toBeInstanceOf(Date);
  });

  it("handles null and empty cells", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Name", "Value", "Notes"]);
    ws.addRow(["Alice", 100, null]);
    ws.addRow(["Bob", null, "Some notes"]);
    ws.addRow([null, 200, null]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await parseExcelBuffer(buffer, "sparse.xlsx", "file-007");

    expect(result.rows[0]["Notes"]).toBeNull();
    expect(result.rows[1]["Value"]).toBeNull();
    // Row 3 has null Name but still has Value — should be included
    expect(result.rows[2]["Value"]).toBe(200);
  });

  it("handles rich text cells", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Title", "Description"]);
    ws.getCell("A2").value = "Simple";
    ws.getCell("B2").value = {
      richText: [
        { text: "Bold " },
        { text: "and " },
        { text: "italic" },
      ],
    } as ExcelJS.CellRichTextValue;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await parseExcelBuffer(buffer, "rich.xlsx", "file-008");

    expect(result.rows[0]["Description"]).toBe("Bold and italic");
  });

  it("rejects a corrupt/non-xlsx buffer", async () => {
    const corruptBuffer = Buffer.from("this is not an xlsx file");

    await expect(
      parseExcelBuffer(corruptBuffer, "corrupt.xlsx", "file-009")
    ).rejects.toThrow();
  });

  it("rejects a file exceeding the maximum size limit", async () => {
    // Create a buffer slightly over the limit
    const oversizedBuffer = Buffer.alloc(MAX_FILE_SIZE + 1, 0);

    await expect(
      parseExcelBuffer(oversizedBuffer, "huge.xlsx", "file-010")
    ).rejects.toThrow(/exceeds maximum size/);
  });

  it("handles an empty worksheet (headers only, no data rows)", async () => {
    const buffer = await createTestWorkbook(["Col A", "Col B", "Col C"], []);

    const result = await parseExcelBuffer(buffer, "empty.xlsx", "file-011");

    expect(result.columns).toEqual(["Col A", "Col B", "Col C"]);
    expect(result.rowCount).toBe(0);
    expect(result.rows).toHaveLength(0);
    expect(result.sampleRows).toHaveLength(0);
  });

  it("returns fingerprints for all columns", async () => {
    const buffer = await createTestWorkbook(
      ["ID", "Name", "Score"],
      [
        [1, "Alice", 95.5],
        [2, "Bob", 87.3],
        [3, "Charlie", 92.1],
        [4, "Diana", 88.7],
        [5, "Eve", 91.0],
      ]
    );

    const result = await parseExcelBuffer(buffer, "scores.xlsx", "file-012");

    expect(result.fingerprints).toHaveLength(3);
    expect(result.fingerprints[0].name).toBe("ID");
    expect(result.fingerprints[1].name).toBe("Name");
    expect(result.fingerprints[2].name).toBe("Score");

    // ID column should be detected as number type
    expect(result.fingerprints[0].dataType).toBe("number");
    // Name column should be detected as string type
    expect(result.fingerprints[1].dataType).toBe("string");
    // Score column should be detected as number type
    expect(result.fingerprints[2].dataType).toBe("number");

    // All fingerprints should have a sampleHash
    for (const fp of result.fingerprints) {
      expect(fp.sampleHash).toBeDefined();
      expect(fp.sampleHash.length).toBe(64); // SHA-256 hex length
    }
  });

  it("returns headerRowIndex=1 for simple workbooks", async () => {
    const buffer = await createTestWorkbook(
      ["A", "B", "C"],
      [[1, 2, 3]]
    );

    const result = await parseExcelBuffer(buffer, "simple.xlsx", "file-013");
    expect(result.headerRowIndex).toBe(1);
  });
});

// ─── Multi-Row Header Detection ─────────────────────

describe("multi-row header detection", () => {
  it("detects header in row 2 when row 1 has merged category groups", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");

    // Row 1: merged category headers
    ws.getCell("A1").value = "IDENTITY";
    ws.getCell("D1").value = "METRICS";
    ws.mergeCells("A1:C1"); // IDENTITY spans cols 1-3
    ws.mergeCells("D1:F1"); // METRICS spans cols 4-6

    // Row 2: actual column headers
    ws.getCell("A2").value = "SKU";
    ws.getCell("B2").value = "ASIN";
    ws.getCell("C2").value = "Description";
    ws.getCell("D2").value = "On Hand";
    ws.getCell("E2").value = "Available";
    ws.getCell("F2").value = "In Transit";

    // Row 3: data
    ws.getCell("A3").value = "SK001";
    ws.getCell("B3").value = "B000ABC";
    ws.getCell("C3").value = "Widget";
    ws.getCell("D3").value = 100;
    ws.getCell("E3").value = 80;
    ws.getCell("F3").value = 20;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseExcelBuffer(buffer, "multi-header.xlsx", "file-mh1");

    // Should detect row 2 as headers, not row 1
    expect(result.headerRowIndex).toBe(2);
    expect(result.columns).toEqual(["SKU", "ASIN", "Description", "On Hand", "Available", "In Transit"]);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]["SKU"]).toBe("SK001");
    expect(result.rows[0]["On Hand"]).toBe(100);
  });

  it("extracts column groups from merged cells above header row", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");

    // Row 1: merged categories
    ws.getCell("A1").value = "IDENTITY";
    ws.getCell("C1").value = "INVENTORY";
    ws.mergeCells("A1:B1");
    ws.mergeCells("C1:D1");

    // Row 2: headers
    ws.getCell("A2").value = "SKU";
    ws.getCell("B2").value = "Name";
    ws.getCell("C2").value = "Stock";
    ws.getCell("D2").value = "Reserved";

    // Row 3: data
    ws.getCell("A3").value = "SK1";
    ws.getCell("B3").value = "Widget";
    ws.getCell("C3").value = 50;
    ws.getCell("D3").value = 10;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseExcelBuffer(buffer, "groups.xlsx", "file-mh2");

    expect(result.columnGroups).toBeDefined();
    expect(result.columnGroups).toHaveLength(2);
    expect(result.columnGroups![0].name).toBe("IDENTITY");
    expect(result.columnGroups![0].columns).toEqual(["SKU", "Name"]);
    expect(result.columnGroups![1].name).toBe("INVENTORY");
    expect(result.columnGroups![1].columns).toEqual(["Stock", "Reserved"]);
  });

  it("uses row 1 for simple workbooks without merged cells", async () => {
    const buffer = await createTestWorkbook(
      ["A", "B", "C"],
      [
        [1, 2, 3],
        [4, 5, 6],
      ]
    );

    const result = await parseExcelBuffer(buffer, "simple.xlsx", "file-mh3");

    expect(result.headerRowIndex).toBe(1);
    expect(result.columns).toEqual(["A", "B", "C"]);
    expect(result.columnGroups).toBeUndefined();
  });
});

// ─── Formula Extraction ─────────────────────────────

describe("formula extraction", () => {
  it("extracts formula metadata from data cells", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");

    // Row 1: headers
    ws.getCell("A1").value = "Price";
    ws.getCell("B1").value = "Quantity";
    ws.getCell("C1").value = "Total";

    // Row 2: data with formula in C2
    ws.getCell("A2").value = 10;
    ws.getCell("B2").value = 5;
    ws.getCell("C2").value = { formula: "A2*B2", result: undefined } as unknown as ExcelJS.CellFormulaValue;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseExcelBuffer(buffer, "formula.xlsx", "file-f1");

    expect(result.formulas).toBeDefined();
    expect(result.formulas).toHaveLength(1);

    const f = result.formulas![0];
    expect(f.column).toBe("Total");
    expect(f.formula).toBe("=A2*B2");
    expect(f.expression).toBe("{Price}*{Quantity}");
    expect(f.referencedColumns).toEqual(["Price", "Quantity"]);
  });

  it("resolves formula cell references to column names", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");

    ws.getCell("A1").value = "SOU On Hand";
    ws.getCell("B1").value = "DSHIP On Hand";
    ws.getCell("C1").value = "In Transit";
    ws.getCell("D1").value = "TOTAL";

    ws.getCell("A2").value = 100;
    ws.getCell("B2").value = 50;
    ws.getCell("C2").value = 25;
    ws.getCell("D2").value = { formula: "A2+B2+C2", result: undefined } as unknown as ExcelJS.CellFormulaValue;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseExcelBuffer(buffer, "refs.xlsx", "file-f2");

    const f = result.formulas![0];
    expect(f.column).toBe("TOTAL");
    expect(f.expression).toBe("{SOU On Hand}+{DSHIP On Hand}+{In Transit}");
    expect(f.referencedColumns).toEqual(["SOU On Hand", "DSHIP On Hand", "In Transit"]);
  });

  it("handles IFERROR formulas with cell refs", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");

    ws.getCell("A1").value = "Consumed";
    ws.getCell("B1").value = "Total";
    ws.getCell("C1").value = "Percent";

    ws.getCell("A2").value = 25;
    ws.getCell("B2").value = 100;
    ws.getCell("C2").value = { formula: "IFERROR(A2/B2,0)", result: undefined } as unknown as ExcelJS.CellFormulaValue;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseExcelBuffer(buffer, "iferror.xlsx", "file-f3");

    const f = result.formulas![0];
    expect(f.column).toBe("Percent");
    expect(f.expression).toBe("IFERROR({Consumed}/{Total},0)");
    expect(f.referencedColumns).toContain("Consumed");
    expect(f.referencedColumns).toContain("Total");
  });

  it("returns null for formula cells without cached results in row data", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");

    ws.getCell("A1").value = "A";
    ws.getCell("B1").value = "B";
    ws.getCell("C1").value = "Sum";

    ws.getCell("A2").value = 10;
    ws.getCell("B2").value = 20;
    ws.getCell("C2").value = { formula: "A2+B2", result: undefined } as unknown as ExcelJS.CellFormulaValue;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseExcelBuffer(buffer, "no-cache.xlsx", "file-f4");

    // Data value should be null (no cached result)
    expect(result.rows[0]["Sum"]).toBeNull();
    // But formula metadata should still be captured
    expect(result.formulas).toHaveLength(1);
    expect(result.formulas![0].column).toBe("Sum");
  });

  it("uses cached formula results when available", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");

    ws.getCell("A1").value = "A";
    ws.getCell("B1").value = "Sum";

    ws.getCell("A2").value = 10;
    ws.getCell("B2").value = { formula: "A2*2", result: 20 } as ExcelJS.CellFormulaValue;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseExcelBuffer(buffer, "cached.xlsx", "file-f5");

    // Data value should use the cached result
    expect(result.rows[0]["Sum"]).toBe(20);
    // Formula metadata should still be captured
    expect(result.formulas).toHaveLength(1);
  });

  it("returns no formulas when sheet has no formula cells", async () => {
    const buffer = await createTestWorkbook(
      ["A", "B"],
      [[1, 2], [3, 4]]
    );

    const result = await parseExcelBuffer(buffer, "no-formulas.xlsx", "file-f6");
    expect(result.formulas).toBeUndefined();
  });
});
