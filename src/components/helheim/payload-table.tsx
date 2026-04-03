"use client";

interface Props {
  rows: Record<string, unknown>[];
  totalRows: number;
}

function truncate(val: unknown, max: number): string {
  if (val === null || val === undefined) return "—";
  const str = typeof val === "object" ? JSON.stringify(val) : String(val);
  return str.length > max ? str.slice(0, max) + "..." : str;
}

export function PayloadTable({ rows, totalRows }: Props) {
  if (rows.length === 0) {
    return (
      <p className="text-text-muted text-xs tracking-wide">
        Payload could not be decompressed
      </p>
    );
  }

  const columns = Object.keys(rows[0]);

  return (
    <div>
      <p className="text-text-muted text-[10px] font-space-grotesk tracking-wider uppercase mb-2">
        Showing {Math.min(10, totalRows)} of {totalRows.toLocaleString()} rows
      </p>
      <div className="overflow-x-auto border border-border">
        <table className="w-full text-[10px] font-inconsolata">
          <thead>
            <tr className="border-b border-border">
              {columns.map((col) => (
                <th
                  key={col}
                  className="text-left px-2 py-1.5 text-text-dim font-medium whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-border/30 hover:bg-scroll/50"
              >
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-2 py-1 text-text-dim whitespace-nowrap"
                  >
                    {truncate(row[col], 40)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
