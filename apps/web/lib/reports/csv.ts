import type { CsvRow } from "@fiao/contracts/reports";

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: CsvRow[]): string {
  const first = rows[0];
  if (!first) return "";
  const headers = Object.keys(first);
  const lines = rows.map((row) => headers.map((header) => csvEscape(String(row[header] ?? ""))).join(","));
  return [headers.join(","), ...lines].join("\n");
}
