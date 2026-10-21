import type { DataSourceSummary } from '@routewise/shared';
import { query } from '../pool.js';

interface SourceRow {
  code: string;
  name: string;
  kind: string;
  attribution: string | null;
  license_name: string | null;
  is_official: boolean;
  last_imported_at: Date | null;
  stop_count?: string | number;
}

const STALE_DAYS = 45;

export async function listDataSources(): Promise<DataSourceSummary[]> {
  const res = await query<SourceRow>(
    `SELECT ds.code, ds.name, ds.kind, ds.attribution, ds.license_name, ds.is_official,
            ds.last_imported_at,
            (SELECT count(*) FROM stops s WHERE s.data_source_id = ds.id) AS stop_count
     FROM data_sources ds
     ORDER BY ds.is_official DESC, ds.name ASC`,
  );
  return res.rows.map(mapSource);
}

export async function listSourcesWithCoverage(): Promise<
  (DataSourceSummary & { stopCount: number })[]
> {
  const sources = await listDataSources();
  const res = await query<SourceRow>(
    `SELECT ds.code, ds.name, ds.kind, ds.attribution, ds.license_name, ds.is_official,
            ds.last_imported_at,
            (SELECT count(*) FROM stops s WHERE s.data_source_id = ds.id) AS stop_count
     FROM data_sources ds
     ORDER BY ds.is_official DESC, ds.name ASC`,
  );
  return res.rows.map((row) => ({
    ...mapSource(row),
    stopCount: Number(row.stop_count ?? 0),
  }));
}

function mapSource(row: SourceRow): DataSourceSummary {
  const imported = row.last_imported_at ? new Date(row.last_imported_at) : null;
  let freshness: DataSourceSummary['freshness'] = 'unknown';
  if (imported) {
    const ageDays = (Date.now() - imported.getTime()) / 86_400_000;
    freshness = ageDays <= STALE_DAYS ? 'fresh' : 'stale';
  }
  return {
    code: row.code,
    name: row.name,
    kind: row.kind,
    attribution: row.attribution,
    licenseName: row.license_name,
    isOfficial: row.is_official,
    lastImportedAt: imported ? imported.toISOString() : null,
    freshness,
  };
}
