const API_URL = "https://hst-api.wialon.com/wialon/ajax.html";

export type RawCell = string | { t?: string; x?: number; y?: number };
export type RawRow = { c?: RawCell[] };

export function cellText(cell: RawCell | undefined): string {
  if (typeof cell === "string") return cell;
  return String(cell?.t ?? "");
}

export function cellCoords(cell: RawCell | undefined): { lat: number | null; lon: number | null } {
  if (!cell || typeof cell === "string") return { lat: null, lon: null };
  if (typeof cell.x === "number" && typeof cell.y === "number") {
    return { lat: cell.y, lon: cell.x };
  }
  return { lat: null, lon: null };
}

export function toRows(payload: unknown): RawRow[] {
  return Array.isArray(payload) ? (payload as RawRow[]) : [];
}

export function pickColumnIndex(headers: string[], regex: RegExp): number {
  return headers.findIndex((h) => regex.test(String(h).toLowerCase()));
}

export function pickAny(headers: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const idx = pickColumnIndex(headers, p);
    if (idx >= 0) return idx;
  }
  return -1;
}

export function toNumber(value: unknown): number {
  const match = String(value ?? "").match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : 0;
}

export async function callWialon<T>(svc: string, params: object, sid: string): Promise<T> {
  const body = new URLSearchParams({
    svc,
    params: JSON.stringify(params),
    sid,
  });
  const response = await fetch(API_URL, { method: "POST", body, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Track3 Database request failed (status ${response.status}).`);
  }
  const payload = (await response.json()) as { error?: number; reason?: string } | T;
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const errPayload = payload as { error?: number; reason?: string };
    if (typeof errPayload.error === "number" && errPayload.error !== 0) {
      throw new Error(
        `Track3 Database error ${String(errPayload.error)}${errPayload.reason ? `: ${errPayload.reason}` : ""}`,
      );
    }
  }
  return payload as T;
}

export async function wialonLogin(): Promise<string> {
  const token = process.env.WIALON_TOKEN?.trim();
  if (!token) throw new Error("WIALON_TOKEN is not configured.");
  const loginResponse = await fetch(
    `${API_URL}?svc=token/login&params=${encodeURIComponent(JSON.stringify({ token }))}`,
    { method: "POST", cache: "no-store" },
  );
  if (!loginResponse.ok) {
    throw new Error(`Track3 Database authentication failed (status ${loginResponse.status}).`);
  }
  const login = (await loginResponse.json()) as { eid?: string; error?: number; reason?: string };
  if (typeof login.error === "number" && login.error !== 0) {
    throw new Error(
      `Track3 Database authentication error ${login.error}${login.reason ? `: ${login.reason}` : ""}`,
    );
  }
  const sid = login.eid;
  if (typeof sid !== "string" || !sid) {
    throw new Error("Track3 Database authentication failed.");
  }
  await callWialon("render/set_locale", { tzOffset: 10800, language: "en", formatDate: "%d.%m.%Y %H:%M:%S" }, sid);
  return sid;
}

export async function wialonLogout(sid: string): Promise<void> {
  await callWialon("core/logout", {}, sid).catch(() => undefined);
}

export async function fetchTableRowsRaw(
  sid: string,
  tableIndex: number,
  rowCount: number,
): Promise<RawRow[]> {
  if (rowCount <= 0) return [];
  const rows = await callWialon<unknown>(
    "report/get_result_rows",
    { tableIndex, indexFrom: 0, indexTo: Math.max(rowCount - 1, 0) },
    sid,
  );
  return toRows(rows);
}

async function fetchTableSubrowsRaw(
  sid: string,
  tableIndex: number,
  parentRowCount: number,
): Promise<RawRow[]> {
  const all: RawRow[] = [];
  for (let rowIndex = 0; rowIndex < parentRowCount; rowIndex += 1) {
    const subRows = await callWialon<unknown>(
      "report/get_result_subrows",
      { tableIndex, rowIndex, colIndex: 0, indexFrom: 0, indexTo: 1000 },
      sid,
    );
    all.push(...toRows(subRows));
  }
  return all;
}

export interface ExecReportOptions {
  resourceId: number;
  templateId?: number;
  objectId: number;
  reportObjectIdList?: number[];
  from: number;
  to: number;
  inlineTemplate?: Record<string, unknown>;
  remoteExec?: boolean;
}

export interface ReportTableMeta {
  header: string[];
  rows: number;
  index: number;
}

export interface WialonReportTemplate {
  id: number;
  n: string;
  ct: string;
  p?: string;
  tbl?: unknown[];
  [key: string]: unknown;
}

type ExecReportResponse = { reportResult?: { tables?: Array<{ header?: string[]; rows?: number }> } };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRemoteReportResult(sid: string): Promise<ExecReportResponse> {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const status = await callWialon<{ status?: number }>("report/get_report_status", {}, sid);
    if (status.status === 4) {
      return callWialon<ExecReportResponse>("report/apply_report_result", {}, sid);
    }
    if (status.status === 8 || status.status === 16) {
      throw new Error(`Track3 Database remote report failed with status ${status.status}.`);
    }
    if (attempt > 0 && attempt % 12 === 0) {
      console.warn(`Track3 Database remote report still processing (${Math.round((attempt * 5) / 60)}m).`);
    }
    await sleep(5_000);
  }
  throw new Error("Track3 Database remote report timed out while waiting for Wialon.");
}

export async function execReport(
  sid: string,
  opts: ExecReportOptions,
): Promise<{ tables: ReportTableMeta[] }> {
  await callWialon("report/cleanup_result", {}, sid).catch(() => undefined);

  const params: Record<string, unknown> = {
    reportResourceId: opts.resourceId,
    reportObjectId: opts.objectId,
    reportObjectSecId: 0,
    interval: { flags: 0, from: opts.from, to: opts.to },
  };
  if (opts.reportObjectIdList?.length) {
    params.reportObjectIdList = opts.reportObjectIdList;
  }
  if (opts.remoteExec) {
    params.remoteExec = 1;
  }

  if (opts.inlineTemplate) {
    params.reportTemplateId = 0;
    params.reportTemplate = opts.inlineTemplate;
  } else {
    params.reportTemplateId = opts.templateId ?? 0;
  }

  let exec: ExecReportResponse;
  if (opts.remoteExec) {
    await callWialon("report/exec_report", params, sid);
    exec = await waitForRemoteReportResult(sid);
  } else {
    exec = await callWialon<ExecReportResponse>("report/exec_report", params, sid);
  }

  const rawTables = exec.reportResult?.tables ?? [];
  return {
    tables: rawTables.map((t, index) => ({
      header: t.header ?? [],
      rows: t.rows ?? 0,
      index,
    })),
  };
}

export async function getReportTemplateData(
  sid: string,
  resourceId: number,
  templateId: number,
): Promise<WialonReportTemplate> {
  const templates = await callWialon<WialonReportTemplate[]>(
    "report/get_report_data",
    { itemId: resourceId, col: [templateId] },
    sid,
  );
  const template = templates[0];
  if (!template) {
    throw new Error(`Track3 Database template ${templateId} was not found.`);
  }
  return template;
}

type UnitGroupPayload = {
  item?: { u?: unknown; units?: unknown };
  items?: Array<{ u?: unknown; units?: unknown }>;
  u?: unknown;
  units?: unknown;
};

type SearchItemsPayload = {
  items?: Array<{ id?: number; nm?: string }>;
};

function extractUnitIds(payload: UnitGroupPayload): number[] {
  const candidates = [
    payload.u,
    payload.units,
    payload.item?.u,
    payload.item?.units,
    payload.items?.[0]?.u,
    payload.items?.[0]?.units,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      const ids = candidate
        .map((value) => {
          if (typeof value === "number") return value;
          if (typeof value === "string") return Number(value);
          if (typeof value === "object" && value !== null && "id" in value) return Number(value.id);
          return NaN;
        })
        .filter((id) => Number.isFinite(id) && id > 0);
      if (ids.length) return ids;
    }
    if (typeof candidate === "object") {
      const ids = Object.keys(candidate)
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0);
      if (ids.length) return ids;
    }
  }
  return [];
}

export async function fetchUnitGroupUnitIds(sid: string, groupId: number): Promise<number[]> {
  const attempts = [
    () => callWialon<UnitGroupPayload>("core/search_item", { id: groupId, flags: 1 }, sid),
    () =>
      callWialon<UnitGroupPayload>(
        "core/search_items",
        {
          spec: {
            itemsType: "avl_unit_group",
            propName: "sys_id",
            propValueMask: String(groupId),
            sortType: "sys_name",
          },
          force: 1,
          flags: 1,
          from: 0,
          to: 0,
        },
        sid,
      ),
  ];

  for (const attempt of attempts) {
    try {
      const ids = extractUnitIds(await attempt());
      if (ids.length) return Array.from(new Set(ids)).sort((a, b) => a - b);
    } catch {
      // Some Wialon accounts reject one search shape; try the next supported shape.
    }
  }

  const unitSearch = await callWialon<SearchItemsPayload>(
    "core/search_items",
    {
      spec: {
        itemsType: "avl_unit",
        propName: "sys_name",
        propValueMask: "*",
        sortType: "sys_name",
      },
      force: 1,
      flags: 1,
      from: 0,
      to: 10000,
    },
    sid,
  ).catch(() => null);
  const motrexUnitIds = (unitSearch?.items ?? [])
    .filter((item) => /^Motrex\s*-/i.test(String(item.nm ?? "")))
    .map((item) => Number(item.id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (motrexUnitIds.length) {
    return Array.from(new Set(motrexUnitIds)).sort((a, b) => a - b);
  }

  throw new Error(`Track3 Database could not resolve units for group ${groupId}.`);
}

export async function fetchAllTableData(
  sid: string,
  tables: ReportTableMeta[],
  tableIndex: number,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const table = tables[tableIndex];
  if (!table || table.rows <= 0) return { headers: table?.header ?? [], rows: [] };

  let rawRows = await fetchTableSubrowsRaw(sid, tableIndex, table.rows);
  if (!rawRows.length) {
    rawRows = await fetchTableRowsRaw(sid, tableIndex, table.rows);
  }

  const headers = table.header;
  const rows = rawRows.map((row) => {
    const cells = row.c ?? [];
    const out: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = String(headers[i] ?? "").trim() || `col_${i}`;
      out[key] = cellText(cells[i]);
    }
    return out;
  });

  return { headers, rows };
}

export function rowsFromRaw(
  headers: string[],
  rawRows: RawRow[],
): Record<string, string>[] {
  return rawRows.map((row) => {
    const cells = row.c ?? [];
    const out: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = String(headers[i] ?? "").trim() || `col_${i}`;
      out[key] = cellText(cells[i]);
    }
    return out;
  });
}

export async function fetchPrimaryTable(
  sid: string,
  tables: ReportTableMeta[],
  preferredIndex = 0,
): Promise<{ headers: string[]; rows: Record<string, string>[]; tableIndex: number }> {
  const idx = tables[preferredIndex] ? preferredIndex : 0;
  const data = await fetchAllTableData(sid, tables, idx);
  return { ...data, tableIndex: idx };
}
