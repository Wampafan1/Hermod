"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { createUniver, defaultTheme, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import type { IWorkbookData, ICellData, IStyleData } from "@univerjs/presets";
import "@univerjs/preset-sheets-core/lib/index.css";

/**
 * SheetTemplate v2: stores Univer cosmetics keyed by column config IDs.
 * - snapshot: IWorkbookData with cell values stripped (styles, formulas, merges, freeze)
 * - columnMap: maps column config ID → positional index at time of save
 * - version: 2 (v1 had no columnMap, was purely positional)
 */
export interface SheetTemplate {
  snapshot: IWorkbookData;
  columnMap?: Record<string, number>;
  startRow?: number;
  version?: number;
}

const HEADER_STYLE_ID = "__hermod_header";
const DEFAULT_COL_WIDTH = 64; // ~8.43 Excel character widths * 7.5px
const DEFAULT_ROW_HEIGHT = 24;

/**
 * Light WYSIWYG theme for the cell canvas.
 * The surrounding chrome (toolbar, formula bar, tabs) stays dark via CSS overrides.
 * Cell area renders with standard Excel-like colors so what you see = what you get.
 */
const wyswigTheme = {
  ...defaultTheme,
  // Light cell area colors
  white: "#ffffff",
  black: "#000000",
  primary: {
    50: "#eff6ff",
    100: "#dbeafe",
    200: "#bfdbfe",
    300: "#93c5fd",
    400: "#60a5fa",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
    800: "#1e40af",
    900: "#1e3a8a",
  },
  gray: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
  },
};

interface UniverSheetProps {
  /** Display column names (from column config, after mapping) */
  columns: string[];
  /** Mapped row data (keyed by display names) */
  rows: Record<string, unknown>[];
  /** Column config IDs in display order (parallel to columns) */
  configIds: string[];
  /** 0-based row index where headers go (rows above are preamble) */
  startRow: number;
  /** Previously saved template to restore */
  template: SheetTemplate | null;
  /** Called when the user modifies formatting — provides updated template */
  onTemplateChange: (template: SheetTemplate) => void;
  /** Optional ref that receives the extractTemplate function for imperative calls */
  extractRef?: React.MutableRefObject<(() => SheetTemplate | null) | null>;
}

export function UniverSheet({
  columns,
  rows,
  configIds,
  startRow,
  template,
  onTemplateChange,
  extractRef,
}: UniverSheetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const univerAPIRef = useRef<ReturnType<typeof createUniver>["univerAPI"] | null>(null);
  const isInitializedRef = useRef(false);

  // Template extracted by cleanup, consumed by next effect run
  const latestExtractedRef = useRef<SheetTemplate | null>(null);

  // Stable callback ref
  const onTemplateChangeRef = useRef(onTemplateChange);
  onTemplateChangeRef.current = onTemplateChange;

  // Refs for values used in effects without triggering re-runs
  const configIdsRef = useRef(configIds);
  configIdsRef.current = configIds;

  const startRowRef = useRef(startRow);
  startRowRef.current = startRow;

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const templatePropRef = useRef(template);
  templatePropRef.current = template;

  // Stable data key — only changes when structure actually changes.
  // Prevents Univer destroy/recreate on mere reference changes.
  const dataKey = useMemo(
    () => `${columns.join(",")}_${rows.length}_${configIds.join(",")}_${startRow}`,
    [columns, rows.length, configIds, startRow]
  );

  /**
   * Build workbook data from mapped columns/rows, applying template formatting
   * using column config ID mapping instead of positional indices.
   */
  const buildWorkbookData = useCallback(
    (
      cols: string[],
      rowData: Record<string, unknown>[],
      colIds: string[],
      existingTemplate: SheetTemplate | null,
      sr: number
    ): IWorkbookData => {
      const sheetId = "hermod_sheet_1";

      // Default header style (Excel-standard: bold, light gray fill)
      const styles: Record<string, IStyleData> = {
        [HEADER_STYLE_ID]: {
          bl: 1,
          fs: 11,
          bg: { rgb: "#d9e1f2" },
          cl: { rgb: "#000000" },
          ht: 1,
          vt: 2,
        },
      };

      // Merge template styles
      if (existingTemplate?.snapshot?.styles) {
        const tmplStyles = existingTemplate.snapshot.styles as Record<string, IStyleData>;
        for (const [key, val] of Object.entries(tmplStyles)) {
          if (key !== HEADER_STYLE_ID) {
            styles[key] = val;
          }
        }
      }

      // Build the column position mapping: template col index → current col index
      const tmplToCurrent = buildPositionMap(existingTemplate, colIds);

      // Build cell data
      const cellData: Record<number, Record<number, ICellData>> = {};

      // Preamble rows (0 to sr-1): restore from template including values
      if (sr > 0 && existingTemplate?.snapshot?.sheets) {
        const firstSheet = Object.values(existingTemplate.snapshot.sheets)[0];
        if (firstSheet?.cellData) {
          const tmplCellData = firstSheet.cellData as Record<number, Record<number, ICellData>>;
          for (let r = 0; r < sr; r++) {
            if (tmplCellData[r]) {
              cellData[r] = {};
              for (const [colStr, cell] of Object.entries(tmplCellData[r] as Record<string, ICellData>)) {
                cellData[r][Number(colStr)] = { ...cell };
              }
            }
          }
        }
      }

      // Header row at startRow
      cellData[sr] = {};
      for (let c = 0; c < cols.length; c++) {
        cellData[sr][c] = {
          v: cols[c],
          s: HEADER_STYLE_ID,
        };
      }

      // Data rows at startRow+1+
      for (let r = 0; r < rowData.length; r++) {
        cellData[sr + 1 + r] = {};
        for (let c = 0; c < cols.length; c++) {
          const val = rowData[r][cols[c]];
          cellData[sr + 1 + r][c] = {
            v: val == null ? "" : val as string | number,
          };
        }
      }

      // Apply template cell styles/formulas to header and data area
      if (existingTemplate?.snapshot?.sheets) {
        const firstSheet = Object.values(existingTemplate.snapshot.sheets)[0];
        if (firstSheet?.cellData) {
          const tmplCellData = firstSheet.cellData as Record<number, Record<number, ICellData>>;
          for (const [rowStr, rowCells] of Object.entries(tmplCellData)) {
            const tmplRowIdx = Number(rowStr);
            if (tmplRowIdx < sr) continue; // Preamble already handled above

            for (const [colStr, cell] of Object.entries(rowCells as Record<string, ICellData>)) {
              const tmplColIdx = Number(colStr);
              const currentColIdx = tmplToCurrent.get(tmplColIdx);
              if (currentColIdx === undefined) continue;

              if (tmplRowIdx === sr) {
                // Header row: apply style at exact position
                if (!cell.s) continue;
                const existing = cellData[sr][currentColIdx] ?? {};
                existing.s = cell.s;
                cellData[sr][currentColIdx] = existing;
              } else {
                // Data row: propagate style + formula to ALL data rows
                if (!cell.f && !cell.s) continue;
                for (let r = 0; r < rowData.length; r++) {
                  const targetRow = sr + 1 + r;
                  if (!cellData[targetRow]) cellData[targetRow] = {};
                  const existing = cellData[targetRow][currentColIdx] ?? {};
                  if (cell.s) existing.s = cell.s;
                  if (cell.f) {
                    const remapped = remapFormulaColumns(cell.f, tmplToCurrent);
                    existing.f = adjustFormulaRow(remapped, tmplRowIdx, targetRow);
                  }
                  cellData[targetRow][currentColIdx] = existing;
                }
              }
            }
          }
        }
      }

      // Column widths — mapped by ID
      const columnData: Record<number, { w: number; hd: 0 }> = {};
      for (let c = 0; c < cols.length; c++) {
        let width = DEFAULT_COL_WIDTH;
        if (existingTemplate?.snapshot?.sheets) {
          const firstSheet = Object.values(existingTemplate.snapshot.sheets)[0];
          if (firstSheet?.columnData) {
            // Find the template column index for this config ID
            const tmplIdx = findTmplIndex(existingTemplate, colIds[c]);
            if (tmplIdx !== undefined) {
              const tmplCol = (firstSheet.columnData as Record<number, { w?: number }>)[tmplIdx];
              if (tmplCol?.w) width = tmplCol.w;
            }
          }
        }
        columnData[c] = { w: width, hd: 0 };
      }

      // Freeze and merge from template
      let freeze = { startRow: sr + 1, startColumn: -1, ySplit: sr + 1, xSplit: 0 };
      let mergeData: Array<{ startRow: number; startColumn: number; endRow: number; endColumn: number }> = [];

      if (existingTemplate?.snapshot?.sheets) {
        const firstSheet = Object.values(existingTemplate.snapshot.sheets)[0];
        if (firstSheet?.freeze) {
          freeze = firstSheet.freeze as typeof freeze;
        }
        if (firstSheet?.mergeData) {
          mergeData = (firstSheet.mergeData as typeof mergeData)
            .map((m) => {
              if (m.startRow < sr) {
                // Preamble merge — no column remapping
                return { ...m };
              }
              // Data area merge — remap columns
              const startCol = tmplToCurrent.get(m.startColumn);
              const endCol = tmplToCurrent.get(m.endColumn);
              if (startCol === undefined || endCol === undefined) return null;
              return { ...m, startColumn: startCol, endColumn: endCol };
            })
            .filter((m): m is NonNullable<typeof m> => m !== null);
        }
      }

      return {
        id: "hermod_workbook",
        name: "Report",
        appVersion: "0.0.1",
        locale: LocaleType.EN_US,
        styles,
        sheetOrder: [sheetId],
        sheets: {
          [sheetId]: {
            id: sheetId,
            name: "Results",
            tabColor: "#4472c4",
            hidden: 0,
            rowCount: Math.max(sr + rowData.length + 50, 100),
            columnCount: Math.max(cols.length + 10, 26),
            zoomRatio: 1,
            freeze,
            scrollTop: 0,
            scrollLeft: 0,
            defaultColumnWidth: DEFAULT_COL_WIDTH,
            defaultRowHeight: DEFAULT_ROW_HEIGHT,
            mergeData,
            cellData,
            rowData: {},
            columnData,
            showGridlines: 1,
            rowHeader: { width: 46, hidden: 0 },
            columnHeader: { height: 20, hidden: 0 },
            rightToLeft: 0,
          },
        },
        resources: [],
      };
    },
    []
  );

  /**
   * Extract a saveable template with column ID mapping.
   */
  const extractTemplate = useCallback((): SheetTemplate | null => {
    const api = univerAPIRef.current;
    if (!api) return null;

    const workbook = api.getActiveWorkbook();
    if (!workbook) return null;

    const snapshot = workbook.save() as IWorkbookData;
    const sr = startRowRef.current;

    // Strip raw cell values from data area (rows >= startRow) but keep styles/formulas.
    // Preamble rows (< startRow) keep everything including values.
    if (snapshot.sheets) {
      for (const sheet of Object.values(snapshot.sheets)) {
        if (sheet.cellData) {
          const cellData = sheet.cellData as Record<number, Record<number, ICellData>>;
          for (const [rowStr, rowCells] of Object.entries(cellData)) {
            const rowIdx = Number(rowStr);
            if (rowIdx < sr) continue; // Preamble: preserve values
            for (const [, cell] of Object.entries(rowCells as Record<string, ICellData>)) {
              if (!cell.f && !cell.si) {
                delete (cell as Record<string, unknown>).v;
              }
            }
          }
        }
      }
    }

    // Build column map: config ID → current position index
    const columnMap: Record<string, number> = {};
    const ids = configIdsRef.current;
    for (let i = 0; i < ids.length; i++) {
      columnMap[ids[i]] = i;
    }

    return { snapshot, columnMap, startRow: sr, version: 2 };
  }, []);

  // Expose extractTemplate to parent for imperative calls (e.g., before save)
  useEffect(() => {
    if (extractRef) {
      extractRef.current = extractTemplate;
    }
    return () => {
      if (extractRef) extractRef.current = null;
    };
  }, [extractRef, extractTemplate]);

  // Initialize Univer — keyed on dataKey (stable string) instead of raw array refs.
  // This prevents destroy/recreate cycles when React creates new array references
  // with identical content (e.g., column config change that doesn't alter structure).
  useEffect(() => {
    if (!containerRef.current || dataKey === "") return;

    // Use template from previous cleanup extraction, or fall back to prop
    const templateForBuild = latestExtractedRef.current || templatePropRef.current;
    latestExtractedRef.current = null;

    // Read rows/configIds/startRow from refs — they're captured in dataKey
    // but we don't want their array references as deps
    const workbookData = buildWorkbookData(
      columns,
      rowsRef.current,
      configIdsRef.current,
      templateForBuild,
      startRowRef.current
    );

    const { univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS),
      },
      theme: wyswigTheme,
      darkMode: false,
      presets: [
        UniverSheetsCorePreset({
          container: containerRef.current,
        }),
      ],
    });

    univerAPI.createWorkbook(workbookData);
    univerAPIRef.current = univerAPI;
    isInitializedRef.current = true;

    return () => {
      // Extract live template BEFORE disposing so next effect run can use it
      const tmpl = extractTemplate();
      if (tmpl) {
        latestExtractedRef.current = tmpl;
        onTemplateChangeRef.current(tmpl);
      }
      try {
        univerAPI.dispose();
      } catch {
        // ignore
      }
      univerAPIRef.current = null;
      isInitializedRef.current = false;
    };
  }, [dataKey, buildWorkbookData, extractTemplate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save template every 30 seconds
  useEffect(() => {
    if (!isInitializedRef.current) return;

    const interval = setInterval(() => {
      const tmpl = extractTemplate();
      if (tmpl) {
        onTemplateChangeRef.current(tmpl);
      }
    }, 30_000);

    return () => clearInterval(interval);
  }, [dataKey, extractTemplate]);

  // Save template on unmount
  useEffect(() => {
    return () => {
      const tmpl = extractTemplate();
      if (tmpl) {
        onTemplateChangeRef.current(tmpl);
      }
    };
  }, [extractTemplate]);

  return (
    <div
      ref={containerRef}
      className="univer-container"
      style={{ width: "100%", height: "100%", minHeight: 500 }}
    />
  );
}

/**
 * Build a mapping from template column positions to current column positions
 * using the column config IDs.
 */
function buildPositionMap(
  template: SheetTemplate | null,
  currentConfigIds: string[]
): Map<number, number> {
  const map = new Map<number, number>();

  if (!template?.columnMap) {
    // v1 template or no map — fall back to positional identity
    for (let i = 0; i < currentConfigIds.length; i++) {
      map.set(i, i);
    }
    return map;
  }

  // Build reverse: position → config ID at time of save
  const savedPosToId = new Map<number, string>();
  for (const [id, pos] of Object.entries(template.columnMap)) {
    savedPosToId.set(pos, id);
  }

  // Current: config ID → position now
  const currentIdToPos = new Map<string, number>();
  for (let i = 0; i < currentConfigIds.length; i++) {
    currentIdToPos.set(currentConfigIds[i], i);
  }

  // Map: savedPos → currentPos
  for (const [savedPos, id] of savedPosToId) {
    const currentPos = currentIdToPos.get(id);
    if (currentPos !== undefined) {
      map.set(savedPos, currentPos);
    }
  }

  return map;
}

/**
 * Find the template column index for a given config ID.
 */
function findTmplIndex(template: SheetTemplate | null, configId: string): number | undefined {
  if (!template?.columnMap) return undefined;
  return template.columnMap[configId];
}

/**
 * Remap formula column letter references when columns have moved.
 * e.g., if column A moved to column C, "=A2*B2" becomes "=C2*B2" (if B didn't move).
 */
function remapFormulaColumns(formula: string, posMap: Map<number, number>): string {
  return formula.replace(/([A-Z]+)(\d+)/g, (match, colLetters: string, rowNum: string) => {
    // Convert column letters to 0-based index
    let colIdx = 0;
    for (let i = 0; i < colLetters.length; i++) {
      colIdx = colIdx * 26 + (colLetters.charCodeAt(i) - 65);
    }
    const newIdx = posMap.get(colIdx);
    if (newIdx === undefined) return match; // Column not found, keep as-is
    if (newIdx === colIdx) return match; // Same position, no change

    // Convert back to column letters
    let newLetters = "";
    let idx = newIdx;
    do {
      newLetters = String.fromCharCode(65 + (idx % 26)) + newLetters;
      idx = Math.floor(idx / 26) - 1;
    } while (idx >= 0);

    return `${newLetters}${rowNum}`;
  });
}

/**
 * Adjust formula row references when propagating a formula from one row to another.
 * e.g., "=C2*D2" at row 1 → "=C3*D3" at row 2 (0-based rows, 1-based formula refs).
 */
function adjustFormulaRow(formula: string, templateRow: number, targetRow: number): string {
  const offset = targetRow - templateRow;
  if (offset === 0) return formula;
  return formula.replace(/([A-Z]+)(\d+)/g, (_, col, row) => {
    const newRow = Number(row) + offset;
    return `${col}${newRow}`;
  });
}
