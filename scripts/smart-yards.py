"""
Smart Motrex Yards — Phase 1 live scan + Phase 2 template 58 for inside vehicles only.
Mirrors yards.ipynb. Usage:
  python scripts/smart-yards.py              # inside-now vehicles only
  python scripts/smart-yards.py --test-kbk   # KBK 012E only (quick verify)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
for env_name in (".env.local", ".env"):
    env_path = ROOT / env_name
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))

WIALON_TOKEN = os.environ.get("WIALON_TOKEN", "").strip()
DATABASE_URL = os.environ.get("MotrexTransferDB", "").strip().strip('"')
if not WIALON_TOKEN or not DATABASE_URL:
    sys.exit("WIALON_TOKEN and MotrexTransferDB required in .env")

WIALON_URL = "https://hst-api.wialon.com/wialon/ajax.html"
REPORT_RESOURCE_ID = 26054231
TEMPLATE_VISITS = 58
TEMPLATE_ONLINE = 55
GROUP_ID = 26659458
TEMPLATE_58_GEOFENCE_IDS = {1, 54, 5, 6, 59, 52, 47}
TARGET_REGISTRATION = "KBK 012E"

EAT = timezone(timedelta(hours=3))
now_eat = datetime.now(EAT)
from_dt = now_eat - timedelta(days=30)
from_ts = int(from_dt.timestamp())
to_ts = int(now_eat.timestamp())
report_date = now_eat.strftime("%Y-%m-%d")

session = requests.Session()


def wialon_call(svc: str, params: dict, sid: str, retries: int = 5):
    last_err = None
    for attempt in range(retries):
        resp = session.post(
            WIALON_URL,
            data={"svc": svc, "params": json.dumps(params), "sid": sid},
            timeout=300,
        )
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, dict) and data.get("error"):
            last_err = RuntimeError(f"Wialon error {data['error']} for {svc}: {data}")
            time.sleep(2 ** attempt)
            continue
        return data
    raise last_err


def wialon_login(token: str) -> str:
    data = wialon_call("token/login", {"token": token}, "")
    sid = data.get("eid")
    if not sid:
        raise RuntimeError(f"Login failed: {data}")
    wialon_call("render/set_locale", {"tzOffset": 10800, "language": "en", "formatDate": "%d.%m.%Y %H:%M:%S"}, sid)
    return sid


def cell_text(cell) -> str:
    if isinstance(cell, dict):
        return str(cell.get("t") or "").strip()
    return str(cell or "").strip()


def cell_coords(cell) -> tuple[float | None, float | None]:
    if isinstance(cell, dict) and isinstance(cell.get("x"), (int, float)) and isinstance(cell.get("y"), (int, float)):
        return float(cell["y"]), float(cell["x"])
    return None, None


def registration_label(value: str) -> str:
    return re.sub(r"^Motrex\s*-\s*", "", str(value or "").strip(), flags=re.I).strip()


def load_yards_geofences() -> list[dict]:
    path = ROOT / "motrex_geofences_selected.json"
    geofences = json.loads(path.read_text(encoding="utf-8"))
    return [g for g in geofences if g.get("id") in TEMPLATE_58_GEOFENCE_IDS]


def point_in_polygon(lat: float, lng: float, polygon: list[dict]) -> bool:
    if len(polygon) < 3:
        return False
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        yi, xi = polygon[i]["lat"], polygon[i]["lng"]
        yj, xj = polygon[j]["lat"], polygon[j]["lng"]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def resolve_geofence(lat: float | None, lng: float | None, location: str, geofences: list[dict]) -> str | None:
    if lat is not None and lng is not None:
        for g in geofences:
            if point_in_polygon(lat, lng, g["coordinates"]):
                return g["name"]
    text = str(location or "").strip()
    if not text:
        return None
    aliases = [
        (r"mcl\s*parking\s*vipingo", "MCL PARKING VIPINGO"),
        (r"vipingo\s*main\s*yard", "Vipingo Main yard"),
        (r"vipingo[\s_]*loading", "Vipingo_Loading_Zone"),
        (r"motrex\s*mikindani", "Motrex Mikindani Yard"),
    ]
    for pattern, name in aliases:
        if re.search(pattern, text, re.I):
            return name
    for g in geofences:
        if g["name"].lower() in text.lower():
            return g["name"]
    return None


def exec_report_direct(resource_id: int, template_id: int, object_id: int, sid: str) -> dict:
    wialon_call("report/cleanup_result", {}, sid)
    return wialon_call(
        "report/exec_report",
        {
            "reportResourceId": resource_id,
            "reportTemplateId": template_id,
            "reportObjectId": object_id,
            "reportObjectSecId": 0,
            "interval": {"flags": 0, "from": from_ts, "to": to_ts},
        },
        sid,
    )


def get_table_rows(table_index: int, row_count: int, sid: str) -> list:
    if row_count <= 0:
        return []
    return wialon_call(
        "report/get_result_rows",
        {"tableIndex": table_index, "indexFrom": 0, "indexTo": row_count - 1},
        sid,
    )


def get_table_subrows(table_index: int, row_index: int, sid: str) -> list:
    return wialon_call(
        "report/get_result_subrows",
        {"tableIndex": table_index, "rowIndex": row_index, "colIndex": 0, "indexFrom": 0, "indexTo": 1000},
        sid,
    )


def pick_column(headers: list, patterns: list[str]) -> int:
    for i, h in enumerate(headers):
        low = str(h).lower()
        if any(p in low for p in patterns):
            return i
    return -1


def get_group_unit_ids(sid: str) -> list[int]:
    group = wialon_call("core/search_item", {"id": GROUP_ID, "flags": 1}, sid)
    for key in ("u", "units"):
        candidate = group.get(key) or (group.get("item") or {}).get(key)
        if isinstance(candidate, list):
            return [int(x) for x in candidate if str(x).isdigit()]
        if isinstance(candidate, dict):
            return [int(k) for k in candidate.keys() if str(k).isdigit()]
    return []


def build_name_to_unit_id(sid: str) -> dict[str, int]:
    mapping: dict[str, int] = {}
    search = wialon_call(
        "core/search_items",
        {
            "spec": {
                "itemsType": "avl_unit",
                "propName": "sys_name",
                "propValueMask": "Motrex*",
                "sortType": "sys_name",
            },
            "force": 1,
            "flags": 1,
            "from": 0,
            "to": 10000,
        },
        sid,
    )
    for item in search.get("items") or []:
        uid = int(item.get("id") or 0)
        name = str(item.get("nm") or item.get("name") or "")
        if not uid or not name:
            continue
        mapping[name.upper()] = uid
        mapping[registration_label(name).upper()] = uid
    return mapping


def phase1_inside_now(sid: str, geofences: list[dict]) -> pd.DataFrame:
    t0 = time.time()
    print("[phase1] Template 55 on full group (direct exec)...")
    exec_result = exec_report_direct(REPORT_RESOURCE_ID, TEMPLATE_ONLINE, GROUP_ID, sid)
    tables = exec_result.get("reportResult", {}).get("tables", []) or []
    table_idx = 0
    for i, t in enumerate(tables):
        if int(t.get("rows", 0) or 0) > 0:
            table_idx = i
            break
    table = tables[table_idx]
    headers = table.get("header") or []
    row_count = int(table.get("rows", 0) or 0)
    raw_rows = get_table_rows(table_idx, row_count, sid)
    idx_vehicle = pick_column(headers, ["group", "vehicle", "unit", "name"])
    idx_location = pick_column(headers, ["location", "address", "place", "position"])
    unit_ids = get_group_unit_ids(sid)
    name_map = build_name_to_unit_id(sid)
    records = []
    for row in raw_rows:
        cells = row.get("c", []) if isinstance(row, dict) else []
        vehicle = cell_text(cells[idx_vehicle if idx_vehicle >= 0 else 0])
        loc_cell = cells[idx_location if idx_location >= 0 else 1]
        lat, lon = cell_coords(loc_cell)
        location = cell_text(loc_cell)
        geofence = resolve_geofence(lat, lon, location, geofences)
        if not geofence:
            continue
        unit_id = name_map.get(vehicle.upper()) or name_map.get(registration_label(vehicle).upper())
        records.append({
            "unit_id": unit_id,
            "vehicle": vehicle,
            "registration": registration_label(vehicle),
            "geofence": geofence,
            "lat": lat,
            "lon": lon,
        })
    df = pd.DataFrame(records)
    print(f"[phase1] {len(df)} vehicles inside yard geofences in {time.time() - t0:.1f}s")
    return df


def parse_wialon_dt(value: str) -> datetime | None:
    raw = str(value or "").strip()
    m = re.match(r"^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$", raw)
    if not m:
        return None
    dd, mm, yyyy, hh, mi, ss = map(int, m.groups())
    return datetime(yyyy, mm, dd, hh, mi, ss, tzinfo=EAT)


def is_open_visit(time_out: str) -> bool:
    v = str(time_out or "").strip()
    return not v or v in ("—", "-", "0")


def fetch_visits_for_unit(sid: str, unit_id: int, unit_name: str, geofences: list[dict]) -> pd.DataFrame:
    t0 = time.time()
    exec_result = exec_report_direct(REPORT_RESOURCE_ID, TEMPLATE_VISITS, unit_id, sid)
    tables = exec_result.get("reportResult", {}).get("tables", []) or []
    table_idx = None
    for i, t in enumerate(tables):
        headers = [str(h).lower() for h in (t.get("header") or [])]
        if "geofence" in " ".join(headers) and "time in" in " ".join(headers):
            table_idx = i
            break
    if table_idx is None:
        for i, t in enumerate(tables):
            if int(t.get("rows", 0) or 0) > 0:
                table_idx = i
                break
    if table_idx is None:
        print(f"[phase2] no tables for unit {unit_id}")
        return pd.DataFrame()
    table = tables[table_idx]
    headers = [str(h) for h in (table.get("header") or [])]
    parent_rows = int(table.get("rows", 0) or 0)
    visits = []

    def append_visit(cells: list, vehicle: str) -> None:
        if not cells:
            return
        # Detalized subrows include Grouping as first column (5 cells total).
        if len(cells) >= 5:
            geo_i, tin_i, tout_i, dur_i = 1, 2, 3, 4
        elif len(cells) >= 4:
            geo_i, tin_i, tout_i, dur_i = 0, 1, 2, 3
        else:
            geo_i = pick_column(headers, ["geofence", "zone"]) if headers else 0
            tin_i = pick_column(headers, ["time in", "beginning"]) if headers else 1
            tout_i = pick_column(headers, ["time out", "end"]) if headers else 2
            dur_i = pick_column(headers, ["duration"]) if headers else 3
            if geo_i < 0:
                geo_i, tin_i, tout_i, dur_i = 0, 1, 2, 3
        raw_geofence = cell_text(cells[geo_i] if geo_i < len(cells) else "")
        geofence = resolve_geofence(None, None, raw_geofence, geofences) or normalize_geofence_name(raw_geofence, geofences)
        if not geofence:
            return
        visits.append({
            "Grouping": vehicle,
            "Vehicle": vehicle,
            "Geofence": geofence,
            "Time in": cell_text(cells[tin_i] if tin_i < len(cells) else ""),
            "Time out": cell_text(cells[tout_i] if tout_i < len(cells) else ""),
            "Duration in": cell_text(cells[dur_i] if dur_i < len(cells) else ""),
        })

    for parent_idx in range(parent_rows):
        subrows = get_table_subrows(table_idx, parent_idx, sid)
        if isinstance(subrows, list) and subrows:
            for sub in subrows:
                cells = sub.get("c", []) if isinstance(sub, dict) else []
                append_visit(cells, unit_name)
            continue
        parent_raw = get_table_rows(table_idx, parent_rows, sid)
        if parent_idx < len(parent_raw):
            cells = parent_raw[parent_idx].get("c", []) if isinstance(parent_raw[parent_idx], dict) else []
            append_visit(cells, unit_name)

    print(f"[phase2] unit {unit_id} ({registration_label(unit_name)}): {len(visits)} visits in {time.time() - t0:.1f}s (parents={parent_rows})")
    return pd.DataFrame(visits)


def normalize_geofence_name(name: str, geofences: list[dict]) -> str | None:
    raw = re.sub(r"\s+", " ", str(name or "").strip())
    if not raw:
        return None
    for g in geofences:
        if g["name"].lower() == raw.lower():
            return g["name"]
    return resolve_geofence(None, None, raw, geofences)


def compute_inside_summary(visits_df: pd.DataFrame, live_geofence: str | None) -> dict | None:
    if visits_df.empty:
        return None
    open_rows = visits_df[visits_df["Time out"].apply(is_open_visit)]
    candidates = open_rows if not open_rows.empty else visits_df.tail(1)
    geofence_names = {g["name"] for g in load_yards_geofences()}
    for _, row in candidates.iloc[::-1].iterrows():
        geofence = str(row["Geofence"] or "").strip()
        if live_geofence:
            if geofence != live_geofence and live_geofence not in geofence:
                continue
        elif geofence not in geofence_names:
            continue
        time_in = parse_wialon_dt(row["Time in"])
        if not time_in:
            continue
        duration = now_eat - time_in
        hours = int(duration.total_seconds() // 3600)
        mins = int((duration.total_seconds() % 3600) // 60)
        vehicle = str(row.get("Vehicle") or row.get("Grouping") or "")
        return {
            "vehicle": vehicle,
            "registration": registration_label(vehicle),
            "geofence": geofence,
            "time_in": row["Time in"],
            "time_out": "",
            "duration_live": f"{hours}h {mins}m",
            "status": "Inside",
        }
    return None


def save_inside_rows_to_neon(inside_rows: list[dict]) -> int:
    try:
        import psycopg2
    except ImportError:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "-q"])
        import psycopg2

    now_label = now_eat.strftime("%Y-%m-%d %H:%M:%S") + " EAT"
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    inserted = 0
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM motrex_yards WHERE report_date = %s", (report_date,))
            for row in inside_rows:
                reg = str(row.get("registration") or "").strip()
                cur.execute(
                    """
                    INSERT INTO motrex_yards
                      (report_date, registration_number, vehicle, geofence, time_in, time_out,
                       duration_seconds, status, last_execution_time, raw_row, updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
                    """,
                    (
                        report_date,
                        reg,
                        reg,
                        row["geofence"],
                        row.get("time_in"),
                        None,
                        None,
                        "Inside",
                        now_label,
                        json.dumps(row),
                    ),
                )
                inserted += 1
        conn.commit()
    finally:
        conn.close()
    return inserted


def find_unit_by_registration(sid: str, registration: str) -> tuple[int, str]:
    reg_upper = registration.upper().replace(" ", "")
    search = wialon_call(
        "core/search_items",
        {
            "spec": {
                "itemsType": "avl_unit",
                "propName": "sys_name",
                "propValueMask": f"*{registration}*",
                "sortType": "sys_name",
            },
            "force": 1,
            "flags": 1,
            "from": 0,
            "to": 50,
        },
        sid,
    )
    for item in search.get("items") or []:
        name = str(item.get("nm") or item.get("name") or "")
        uid = int(item.get("id") or 0)
        if not uid or not name:
            continue
        compact = registration_label(name).upper().replace(" ", "")
        if reg_upper in compact or reg_upper in name.upper().replace(" ", ""):
            return uid, name
    raise RuntimeError(f"Unit not found: {registration}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-kbk", action="store_true", help="Test KBK 012E only")
    args = parser.parse_args()

    geofences = load_yards_geofences()
    print(f"Range: {from_dt:%Y-%m-%d} -> {now_eat:%Y-%m-%d} EAT | {len(geofences)} yard geofences")

    sid = wialon_login(WIALON_TOKEN)
    print("Logged in")

    unit_ids = get_group_unit_ids(sid)
    print(f"Group units: {len(unit_ids)}")

    all_inside: list[dict] = []

    if args.test_kbk:
        unit_id, unit_name = find_unit_by_registration(sid, TARGET_REGISTRATION)
        print(f"Test vehicle: {unit_name} (id={unit_id})")
        df = fetch_visits_for_unit(sid, unit_id, unit_name, geofences)
        if df.empty:
            print("No visits returned (check Wialon template 58 / date range).")
        else:
            inside = compute_inside_summary(df, None)
            if inside:
                print(
                    f"Inside now @ {inside['geofence']}: in since {inside['time_in']} ({inside['duration_live']})"
                )
                all_inside.append(inside)
            else:
                print("Not inside any selected yard geofence right now — nothing saved.")
    else:
        inside_df = phase1_inside_now(sid, geofences)
        if inside_df.empty:
            print("No vehicles inside yard geofences right now.")
        else:
            print(inside_df[["registration", "geofence"]].to_string(index=False))
            for _, row in inside_df.iterrows():
                uid = row["unit_id"]
                if not uid or pd.isna(uid):
                    print(f"  skip {row['registration']}: no unit_id")
                    continue
                uid = int(uid)
                df = fetch_visits_for_unit(sid, uid, row["vehicle"], geofences)
                inside = compute_inside_summary(df, row["geofence"])
                if inside:
                    print(
                        f"  {row['registration']} @ {inside['geofence']}: in since {inside['time_in']} ({inside['duration_live']})"
                    )
                    all_inside.append(inside)
                else:
                    print(
                        f"  skip {row['registration']}: template 58 has no open visit in {row['geofence']}"
                    )

    if all_inside:
        n = save_inside_rows_to_neon(all_inside)
        print(f"Saved {n} inside-now row(s) to motrex_yards ({report_date})")

        import psycopg2
        conn = psycopg2.connect(DATABASE_URL)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT registration_number, geofence, time_in, time_out FROM motrex_yards WHERE report_date = %s LIMIT 10",
                (report_date,),
            )
            print("Neon verify:")
            for r in cur.fetchall():
                print(" ", r)
        conn.close()


if __name__ == "__main__":
    main()
