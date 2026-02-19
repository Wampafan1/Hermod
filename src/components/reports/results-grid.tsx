"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { AgGridReact } from "ag-grid-react";
import { FormattingToolbar } from "./formatting-toolbar";
import type { ColDef, CellClassParams, Column, ColumnResizedEvent } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

interface FormattingConfig {
  columns: Record<
    string,
    { width?: number; numFmt?: string; bold?: boolean; fontColor?: string; bgColor?: string; align?: string }
  >;
  headerStyle: {
    bold?: boolean;
    bgColor?: string;
    fontColor?: string;
  };
  cellStyles: Record<string, Record<string, unknown>>;
}

interface ResultsGridProps {
  columns: string[];
  rows: Record<string, unknown>[];
  formatting: FormattingConfig;
  onFormattingChange: (formatting: FormattingConfig) => void;
}

export function ResultsGrid({
  columns,
  rows,
  formatting,
  onFormattingChange,
}: ResultsGridProps) {
  const gridRef = useRef<AgGridReact>(null);
  const [selectedColIndices, setSelectedColIndices] = useState<number[]>([]);

  const colDefs: ColDef[] = useMemo(() => {
    return columns.map((col, index) => {
      const colFmt = formatting.columns[String(index)] ?? {};
      return {
        field: col,
        headerName: col,
        width: colFmt.width ?? 150,
        resizable: true,
        sortable: true,
        filter: true,
        cellStyle: (params: CellClassParams) => {
          const style: Record<string, string> = {};
          if (colFmt.bold) style.fontWeight = "bold";
          if (colFmt.fontColor) style.color = colFmt.fontColor;
          if (colFmt.bgColor && colFmt.bgColor !== "transparent")
            style.backgroundColor = colFmt.bgColor;
          if (colFmt.align) style.textAlign = colFmt.align;
          return style;
        },
      };
    });
  }, [columns, formatting]);

  const handleColumnResized = useCallback(
    (event: ColumnResizedEvent) => {
      if (!event.finished || !event.column) return;
      const col = event.column as Column;
      const colIndex = columns.indexOf(col.getColId());
      if (colIndex === -1) return;
      const newWidth = col.getActualWidth();
      const updated = { ...formatting };
      updated.columns = { ...updated.columns };
      updated.columns[String(colIndex)] = {
        ...updated.columns[String(colIndex)],
        width: newWidth,
      };
      onFormattingChange(updated);
    },
    [columns, formatting, onFormattingChange]
  );

  function updateSelectedColumns(updater: (col: Record<string, unknown>) => Record<string, unknown>) {
    const updated = { ...formatting, columns: { ...formatting.columns } };
    const indices =
      selectedColIndices.length > 0
        ? selectedColIndices
        : columns.map((_, i) => i);
    for (const idx of indices) {
      const key = String(idx);
      updated.columns[key] = updater(updated.columns[key] ?? {}) as any;
    }
    onFormattingChange(updated);
  }

  const currentCol =
    selectedColIndices.length === 1
      ? formatting.columns[String(selectedColIndices[0])] ?? {}
      : {};

  return (
    <div className="flex flex-col h-full">
      <FormattingToolbar
        isBold={!!(currentCol as any).bold}
        currentAlign={(currentCol as any).align ?? "left"}
        onBold={() =>
          updateSelectedColumns((c) => ({ ...c, bold: !(c as any).bold }))
        }
        onTextColor={(color) =>
          updateSelectedColumns((c) => ({ ...c, fontColor: color }))
        }
        onBgColor={(color) =>
          updateSelectedColumns((c) => ({ ...c, bgColor: color }))
        }
        onNumFormat={(format) =>
          updateSelectedColumns((c) => ({ ...c, numFmt: format }))
        }
        onAlign={(align) =>
          updateSelectedColumns((c) => ({ ...c, align }))
        }
      />
      <div className="flex-1 ag-theme-alpine-dark">
        <AgGridReact
          ref={gridRef}
          rowData={rows}
          columnDefs={colDefs}
          defaultColDef={{
            resizable: true,
            sortable: true,
          }}
          onColumnResized={handleColumnResized}
          onCellClicked={(e) => {
            const idx = columns.indexOf(e.colDef.field ?? "");
            if (idx !== -1) setSelectedColIndices([idx]);
          }}
          suppressRowClickSelection
          animateRows={false}
          domLayout="normal"
        />
      </div>
    </div>
  );
}

export type { FormattingConfig };
