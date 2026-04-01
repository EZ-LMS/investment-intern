import { parse } from 'csv-parse/sync';
import { config } from '../config.js';
import type { TrackingSource } from '../types.js';

export async function fetchTrackingSources(): Promise<TrackingSource[]> {
  const res = await fetch(config.googleSheetsCsvUrl);
  if (!res.ok) throw new Error(`Failed to fetch Google Sheet: ${res.status}`);
  const csv = await res.text();

  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    from_line: 2,   // Skip the blank leading row in the sheet
  }) as Record<string, string>[];

  return rows
    .filter((r) => r['Media'] && r['Name'] && r['Link'])
    .map((r) => ({
      media: r['Media'] ?? '',
      name: r['Name'] ?? '',
      link: r['Link'] ?? '',
    }));
}
