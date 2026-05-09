import type { ColumnMap } from "@/lib/gates/push-executor";

export const jobLineValueCurrentKey = ["job_number", "7501_line_number"];
export const jobLineValueHardenedKey = [
  "job_number",
  "7501_line_number",
  "line_entered_value",
];

export const jobLineValueMapping: ColumnMap[] = [
  { sourceColumn: "job_number", destinationColumn: "job_number", sourceType: "TEXT", destType: "TEXT" },
  { sourceColumn: "7501_line_number", destinationColumn: "7501_line_number", sourceType: "TEXT", destType: "TEXT" },
  { sourceColumn: "line_entered_value", destinationColumn: "line_entered_value", sourceType: "TEXT", destType: "TEXT" },
];

export function buildJobLineValueRows(): Record<string, unknown>[] {
  const rows = Array.from({ length: 1550 }, (_, index) => ({
    job_number: `SNGB${String(index + 1).padStart(7, "0")}`,
    "7501_line_number": String((index % 17) + 1).padStart(4, "0"),
    line_entered_value: `VALUE-${index + 1}`,
  }));

  rows[1143] = {
    job_number: "SNGB0097414",
    "7501_line_number": "0001",
    line_entered_value: "110.25",
  };
  rows[1144] = {
    job_number: "SNGB0097414",
    "7501_line_number": "0001",
    line_entered_value: "115.75",
  };
  rows[1204] = {
    job_number: "SNGB0097746",
    "7501_line_number": "0001",
    line_entered_value: "210.00",
  };
  rows[1205] = {
    job_number: "SNGB0097746",
    "7501_line_number": "0001",
    line_entered_value: "211.00",
  };
  rows[1547] = {
    job_number: "SNGB0102183",
    "7501_line_number": "0007",
    line_entered_value: "310.00",
  };
  rows[1548] = {
    job_number: "SNGB0102183",
    "7501_line_number": "0007",
    line_entered_value: "315.00",
  };
  rows.push({
    job_number: " ",
    "7501_line_number": "",
    line_entered_value: " ",
  });

  return rows;
}
