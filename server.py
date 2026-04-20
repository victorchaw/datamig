"""
════════════════════════════════════════════════════════════
 datamig — FastAPI + SQLAlchemy Backend
 Database-agnostic API server for the Data Migration Tool

 Supported databases (swap DATABASE_URL):
   MySQL:      mysql+pymysql://user:pass@host:3306/db
   PostgreSQL: postgresql+psycopg2://user:pass@host:5432/db
   SQL Server: mssql+pyodbc://user:pass@host/db?driver=ODBC+Driver+17
   SQLite:     sqlite:///./datamig.db
   Oracle:     oracle+cx_oracle://user:pass@host:1521/db
════════════════════════════════════════════════════════════
"""

import os
import re
import json
import uuid
import traceback
from datetime import datetime, timezone
from pathlib import Path
from io import BytesIO

import pandas as pd
from pydantic import BaseModel
from fastapi import FastAPI, File, Form, HTTPException, Header, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

# ─── Configuration ───────────────────────────────────────────
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "mysql+pymysql://root:datamig123@127.0.0.1:3306/datamig_db"
)
PORT = int(os.environ.get("PORT", 3000))
BASE_DIR = Path(__file__).resolve().parent

# ─── SQLAlchemy Engine ───────────────────────────────────────
default_engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=5,
    pool_pre_ping=True,  # auto-reconnect stale connections
    echo=False,
)

# ─── Session-based engine management ─────────────────────────
SESSIONS: dict = {}  # session_id → SQLAlchemy engine

def get_engine(session_id: str = None):
    """Return the engine for a given session, or the default."""
    if session_id and session_id in SESSIONS:
        return SESSIONS[session_id]
    return default_engine

class DbCredentials(BaseModel):
    dialect: str
    host: str = ""
    port: str = ""
    username: str = ""
    password: str = ""
    dbname: str = ""

# ─── FastAPI App ─────────────────────────────────────────────
app = FastAPI(
    title="datamig API",
    description="Data Migration Tool — CSV to any RDBMS via SQLAlchemy",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Helper: detect identity/autoincrement columns ──────────
def _is_autoincrement(col_info: dict) -> bool:
    """Check if a column is auto-incrementing, works across RDBMS."""
    return bool(col_info.get("autoincrement", False) and col_info.get("autoincrement") is not True) or \
           bool(col_info.get("autoincrement") is True and col_info.get("default") is None and
                str(col_info.get("type", "")).upper().startswith(("INT", "BIGINT", "SMALLINT")))


# ══════════════════════════════════════════════════════════════
#  API ENDPOINTS
# ══════════════════════════════════════════════════════════════

@app.get("/api/health")
def health_check(x_session_id: str = Header(None)):
    """Check database connectivity."""
    eng = get_engine(x_session_id)
    try:
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {
            "status": "ok",
            "database": "connected",
            "dialect": eng.dialect.name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "message": str(e)},
        )


@app.post("/api/connect")
def connect_db(creds: DbCredentials):
    """Test a database connection and return a session ID if successful."""
    if creds.dialect == "sqlite":
        db_url = f"sqlite:///./{creds.dbname}"
    else:
        port_str = f":{creds.port}" if creds.port else ""
        pass_str = f":{creds.password}" if creds.password else ""
        user_str = f"{creds.username}{pass_str}@" if creds.username else ""
        db_url = f"{creds.dialect}://{user_str}{creds.host}{port_str}/{creds.dbname}"
        if creds.dialect == "mssql+pyodbc":
            db_url += "?driver=ODBC+Driver+17+for+SQL+Server"

    try:
        new_engine = create_engine(db_url, pool_pre_ping=True)
        with new_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        sid = uuid.uuid4().hex
        SESSIONS[sid] = new_engine
        print(f"[CONNECT] Session {sid[:8]}… → {new_engine.dialect.name}")
        return {"success": True, "session_id": sid, "dialect": new_engine.dialect.name}
    except Exception as e:
        print(f"[CONNECT] Failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/schema")
def get_schema(x_session_id: str = Header(None)):
    """
    Return database schema dynamically using SQLAlchemy inspection.
    Works with any supported RDBMS.
    """
    eng = get_engine(x_session_id)
    try:
        insp = inspect(eng)
        table_names = insp.get_table_names()
        schema: dict = {}

        for table_name in table_names:
            columns = insp.get_columns(table_name)
            pk_cols = set(insp.get_pk_constraint(table_name).get("constrained_columns", []))

            col_list = []
            for col in columns:
                # Build a portable datatype string
                # SQLAlchemy may return 'VARCHAR(100) COLLATE "utf8mb4_unicode_ci"'
                # Strip collation/charset info and normalize for the frontend
                raw_type = str(col["type"]).upper()
                # Keep only the base type and optional (length) — strip COLLATE, CHARSET, etc.
                match = re.match(r'^(\w+(?:\([^)]*\))?)', raw_type)
                datatype = match.group(1).lower() if match else raw_type.lower()
                # Normalize SQLAlchemy generic names to standard SQL names
                type_map = {"integer": "int", "biginteger": "bigint", "smallinteger": "smallint",
                            "boolean": "bit", "text": "text", "float": "float", "numeric": "decimal"}
                base = datatype.split("(")[0]
                if base in type_map:
                    datatype = datatype.replace(base, type_map[base], 1)

                # Detect auto-increment
                is_identity = col.get("autoincrement", False) is True and col["name"] in pk_cols
                # Also check for explicit autoincrement identity columns
                if not is_identity and col.get("identity") is not None:
                    is_identity = True

                default_val = None
                if is_identity:
                    default_val = "AUTO_INCREMENT"
                elif col.get("default") is not None:
                    default_val = str(col["default"])

                col_list.append({
                    "name": col["name"],
                    "datatype": datatype,
                    "nullable": col.get("nullable", True),
                    "identity": is_identity,
                    "defaultValue": default_val,
                })

            fks = insp.get_foreign_keys(table_name)
            foreign_keys = []
            for fk in fks:
                # SQLAlchemy's get_foreign_keys returns dicts with:
                # "constrained_columns", "referred_table", "referred_columns", "name"
                for i, col_name in enumerate(fk["constrained_columns"]):
                    foreign_keys.append({
                        "column": col_name,
                        "referredTable": fk["referred_table"],
                        "referredColumn": fk["referred_columns"][i]
                    })

            schema[table_name] = {
                "tableName": table_name,
                "columns": col_list,
                "foreignKeys": foreign_keys,
            }

        return schema
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/insert/{table_name}")
async def insert_rows(table_name: str, request: Request, x_session_id: str = Header(None)):
    """
    Bulk-insert a JSON array of row objects into the specified table.
    Auto-increment columns are automatically stripped from inserts.
    """
    rows = await request.json()
    if not isinstance(rows, list) or len(rows) == 0:
        raise HTTPException(status_code=400, detail="Request body must be a non-empty array of row objects.")

    eng = get_engine(x_session_id)
    try:
        insp = inspect(eng)

        # Validate table exists
        if table_name not in insp.get_table_names():
            raise HTTPException(status_code=404, detail=f'Table "{table_name}" not found in database.')

        # Detect auto-increment columns to exclude from INSERT
        columns = insp.get_columns(table_name)
        pk_cols = set(insp.get_pk_constraint(table_name).get("constrained_columns", []))
        auto_cols = set()
        for col in columns:
            if col.get("autoincrement", False) is True and col["name"] in pk_cols:
                auto_cols.add(col["name"])
            if col.get("identity") is not None:
                auto_cols.add(col["name"])

        # Build column list from the first row, excluding auto-increment
        insert_keys = [k for k in rows[0].keys() if k not in auto_cols]
        if not insert_keys:
            raise HTTPException(status_code=400, detail="No insertable columns found (all are auto-increment).")

        # Build parameterized INSERT using text()
        col_clause = ", ".join(f"`{k}`" for k in insert_keys)
        param_clause = ", ".join(f":{k}" for k in insert_keys)
        sql = text(f"INSERT INTO `{table_name}` ({col_clause}) VALUES ({param_clause})")

        inserted = 0
        errors = []

        with Session(eng) as session:
            try:
                for i, row in enumerate(rows):
                    params = {}
                    for k in insert_keys:
                        v = row.get(k)
                        if v is None or v == "":
                            params[k] = None
                        else:
                            params[k] = v
                    session.execute(sql, params)
                    inserted += 1

                session.commit()
            except Exception as row_err:
                session.rollback()
                errors.append({"row": inserted + 1, "error": str(row_err)})

        result = {
            "success": True,
            "table": table_name,
            "inserted": inserted,
            "total": len(rows),
        }
        if errors:
            result["errors"] = errors
        return result

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ─── POST /api/etl-upload ────────────────────────────────────
# ETL pipeline: file upload → staging table → INSERT...SELECT → cleanup
#
# mapping_config JSON shape (sent as form field):
# {
#   "separator": ",",
#   "hasHeader": true,
#   "tables": {
#     "Brands": {
#       "mappings": [
#         { "csvColumn": "testName",     "dbColumn": "br_Name" },
#         { "csvColumn": "testDesc",     "dbColumn": "br_Description" },
#         { "csvColumn": "testCountries_ID", "dbColumn": "br_Countries_ID" }
#       ]
#     },
#     "AnotherTable": { ... }
#   }
# }
@app.post("/api/etl-upload")
async def etl_upload(
    file: UploadFile = File(...),
    mapping_config: str = Form(...),
    x_session_id: str = Header(None),
):
    """
    ETL pipeline for large file migrations.
    1. Stream file → staging table (via pandas chunked read)
    2. INSERT ... SELECT from staging → destination tables
    3. Drop staging table
    """
    staging_table = f"tmp_staging_{uuid.uuid4().hex[:12]}"
    staging_created = False

    try:
        config = json.loads(mapping_config)
        separator = config.get("separator", ",")
        has_header = config.get("hasHeader", True)
        table_configs = config.get("tables", {})

        if not table_configs:
            raise HTTPException(status_code=400, detail="mapping_config must include at least one table in 'tables'.")

        # Validate all destination tables exist
        eng = get_engine(x_session_id)
        insp = inspect(eng)
        existing_tables = set(insp.get_table_names())
        for tbl_name in table_configs:
            if tbl_name not in existing_tables:
                raise HTTPException(status_code=404, detail=f'Table "{tbl_name}" not found in database.')

        # ── Step 1: Extract & Load → staging table ───────────
        file_bytes = await file.read()
        file_stream = BytesIO(file_bytes)

        header_arg = 0 if has_header else None
        chunk_iter = pd.read_csv(
            file_stream,
            sep=separator,
            header=header_arg,
            dtype=str,           # keep everything as strings to avoid type coercion
            keep_default_na=False,
            chunksize=50_000,
            encoding_errors="replace",
        )

        total_staged = 0
        for chunk in chunk_iter:
            # Normalize column names: strip whitespace
            chunk.columns = [str(c).strip() for c in chunk.columns]
            chunk.to_sql(staging_table, con=eng, if_exists="append", index=False)
            total_staged += len(chunk)

        staging_created = True
        print(f"[ETL] Staged {total_staged:,} rows into {staging_table}")

        # ── Step 2: Transform → INSERT...SELECT into targets ─
        # Use explicit transaction — all-or-nothing
        all_results = []
        has_error = False
        with eng.connect() as conn:
            trans = conn.begin()
            for tbl_name, tbl_config in table_configs.items():
                mappings = tbl_config.get("mappings", [])
                if not mappings:
                    has_error = True
                    all_results.append({"table": tbl_name, "inserted": 0, "error": "No column mappings provided."})
                    break

                # Detect auto-increment columns to exclude
                columns = insp.get_columns(tbl_name)
                pk_cols = set(insp.get_pk_constraint(tbl_name).get("constrained_columns", []))
                auto_cols = set()
                for col in columns:
                    if col.get("autoincrement", False) is True and col["name"] in pk_cols:
                        auto_cols.add(col["name"])
                    if col.get("identity") is not None:
                        auto_cols.add(col["name"])

                # Filter out auto-increment columns from mappings
                filtered_mappings = [m for m in mappings if m["dbColumn"] not in auto_cols]

                if not filtered_mappings:
                    has_error = True
                    all_results.append({"table": tbl_name, "inserted": 0, "error": "All mapped columns are auto-increment."})
                    break

                q = '"' if eng.dialect.name in ['postgresql', 'sqlite'] else '`'
                db_cols = ", ".join(f'{q}{m["dbColumn"]}{q}' for m in filtered_mappings)
                select_exprs = []
                joins = []
                for m in filtered_mappings:
                    csv_col = m["csvColumn"]
                    fk_lookup = m.get("fkLookup")
                    if fk_lookup:
                        # FK Lookup: resolve FK value via subquery against parent table
                        # e.g. (SELECT ct_ID FROM Countries WHERE ct_Name = staging.testCountries LIMIT 1)
                        parent_tbl = fk_lookup["parentTable"]
                        match_col = fk_lookup["matchColumn"]
                        parent_pk = fk_lookup["parentPK"]
                        staging_val = f"NULLIF(TRIM({q}{staging_table}{q}.{q}{csv_col}{q}), '')"
                        # MySQL needs COLLATE to avoid mismatch between staging and parent tables
                        collate = " COLLATE utf8mb4_general_ci" if eng.dialect.name == "mysql" else ""
                        subquery = (
                            f"(SELECT {q}{parent_tbl}{q}.{q}{parent_pk}{q} "
                            f"FROM {q}{parent_tbl}{q} "
                            f"WHERE {q}{parent_tbl}{q}.{q}{match_col}{q}{collate} = {staging_val}{collate} "
                            f"LIMIT 1)"
                        )
                        select_exprs.append(subquery)
                        print(f"[ETL] FK Lookup: {csv_col} -> {parent_tbl}.{parent_pk} via {match_col}")
                    else:
                        select_exprs.append(f"NULLIF(TRIM({q}{staging_table}{q}.{q}{csv_col}{q}), '')")

                select_clause = ", ".join(select_exprs)
                joins_clause = " ".join(joins)

                op = tbl_config.get("operation", "insert")
                match_keys = tbl_config.get("matchKeys", [])

                if op in ["update", "upsert"] and not match_keys:
                    has_error = True
                    all_results.append({"table": tbl_name, "inserted": 0, "error": f"Operation '{op}' requires at least one match key."})
                    break

                if op == "insert":
                    sql = f"INSERT INTO {q}{tbl_name}{q} ({db_cols}) SELECT {select_clause} FROM {q}{staging_table}{q} {joins_clause}"
                elif op == "update":
                    dialect = eng.dialect.name
                    match_exprs = []
                    for mk in match_keys:
                        mapping = next((m for m in filtered_mappings if m["dbColumn"] == mk), None)
                        if mapping:
                            match_exprs.append(f"{q}{tbl_name}{q}.{q}{mk}{q} = {q}{staging_table}{q}.{q}{mapping['csvColumn']}{q}")
                    
                    if not match_exprs:
                        has_error = True
                        all_results.append({"table": tbl_name, "inserted": 0, "error": "Match keys not found in mapped columns."})
                        break

                    match_clause = " AND ".join(match_exprs)
                    set_exprs = []
                    for i, m in enumerate(filtered_mappings):
                        if m["dbColumn"] in match_keys:
                            continue
                        set_exprs.append(f"{q}{tbl_name}{q}.{q}{m['dbColumn']}{q} = {select_exprs[i]}")
                    
                    if not set_exprs:
                        has_error = True
                        all_results.append({"table": tbl_name, "inserted": 0, "error": "No columns to update (only match keys provided)."})
                        break

                    set_clause = ", ".join(set_exprs)

                    if dialect == "mysql":
                        sql = f"UPDATE {q}{tbl_name}{q} INNER JOIN {q}{staging_table}{q} ON {match_clause} {joins_clause} SET {set_clause}"
                    elif dialect == "postgresql":
                        sql = f"UPDATE {q}{tbl_name}{q} SET {set_clause} FROM {q}{staging_table}{q} {joins_clause} WHERE {match_clause}"
                    else:
                        sql = f"UPDATE {q}{tbl_name}{q} SET {set_clause} FROM {q}{tbl_name}{q} INNER JOIN {q}{staging_table}{q} ON {match_clause} {joins_clause}"

                elif op == "upsert":
                    dialect = eng.dialect.name
                    set_exprs = []
                    for i, m in enumerate(filtered_mappings):
                        if m["dbColumn"] not in match_keys:
                            set_exprs.append(f"{q}{m['dbColumn']}{q} = {select_exprs[i]}")
                    
                    if not set_exprs:
                        has_error = True
                        all_results.append({"table": tbl_name, "inserted": 0, "error": "No columns to upsert (only match keys provided)."})
                        break

                    set_clause = ", ".join(set_exprs)

                    if dialect == "mysql":
                        sql = f"INSERT INTO {q}{tbl_name}{q} ({db_cols}) SELECT {select_clause} FROM {q}{staging_table}{q} {joins_clause} ON DUPLICATE KEY UPDATE {set_clause}"
                    elif dialect == "postgresql":
                        pk_match = ", ".join(f"{q}{mk}{q}" for mk in match_keys)
                        sql = f"INSERT INTO {q}{tbl_name}{q} ({db_cols}) SELECT {select_clause} FROM {q}{staging_table}{q} {joins_clause} ON CONFLICT ({pk_match}) DO UPDATE SET {set_clause}"
                    else:
                        has_error = True
                        all_results.append({"table": tbl_name, "inserted": 0, "error": f"Upsert not yet supported for dialect '{eng.dialect.name}'."})
                        break

                try:
                    result = conn.execute(text(sql))
                    inserted = result.rowcount
                    all_results.append({"table": tbl_name, "inserted": inserted, "success": True})
                    print(f"[ETL] Inserted {inserted:,} rows into {tbl_name}")
                except Exception as tbl_err:
                    has_error = True
                    all_results.append({"table": tbl_name, "inserted": 0, "error": str(tbl_err)})
                    print(f"[ETL] Error inserting into {tbl_name}: {tbl_err}")
                    break

            # Commit or rollback the entire transaction
            if has_error:
                trans.rollback()
                print("[ETL] ROLLBACK — no data was committed")
                for r in all_results:
                    r["inserted"] = 0
            else:
                trans.commit()
                print("[ETL] COMMIT — all tables inserted successfully")

        # ── Summary ──────────────────────────────────────────
        total_inserted = sum(r.get("inserted", 0) for r in all_results)
        total_errors = sum(1 for r in all_results if "error" in r)

        return {
            "success": total_errors == 0,
            "staged_rows": total_staged,
            "tables": all_results,
            "total_inserted": total_inserted,
            "total_errors": total_errors,
        }

    except HTTPException:
        raise
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="mapping_config is not valid JSON.")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # ── Step 3: Cleanup — always drop staging table ──────
        if staging_created:
            try:
                with eng.begin() as conn:
                    conn.execute(text(f"DROP TABLE IF EXISTS `{staging_table}`"))
                print(f"[ETL] Cleaned up {staging_table}")
            except Exception:
                print(f"[ETL] WARNING: Failed to drop staging table {staging_table}")


@app.get("/api/tables/{table_name}/rows")
def get_rows(table_name: str, limit: int = 100, x_session_id: str = Header(None)):
    """Return up to `limit` rows from the specified table."""
    eng = get_engine(x_session_id)
    limit = min(limit, 1000)
    try:
        with eng.connect() as conn:
            result = conn.execute(text(f"SELECT * FROM `{table_name}` LIMIT :lim"), {"lim": limit})
            rows = [dict(row._mapping) for row in result]
        return {"table": table_name, "count": len(rows), "rows": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Static Files & SPA Fallback ─────────────────────────────
# Serve static files (CSS, JS, CSV, etc.)
app.mount("/static", StaticFiles(directory=str(BASE_DIR)), name="static")


@app.get("/")
def serve_index():
    """Serve the main index.html."""
    return FileResponse(str(BASE_DIR / "index.html"))


@app.get("/{filename:path}")
def serve_static(filename: str):
    """Serve any file from the project directory (JS, CSS, CSV, etc.)."""
    file_path = BASE_DIR / filename
    if file_path.is_file() and not filename.startswith((".", "venv", "node_modules", "__pycache__")):
        resp = FileResponse(str(file_path))
        # Prevent caching for dev assets
        if filename.endswith((".js", ".css", ".html")):
            resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        return resp
    return FileResponse(str(BASE_DIR / "index.html"))


# ─── Run ─────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print(f"\n  ┌─────────────────────────────────────────┐")
    print(f"  │  datamig API running on port {PORT}        │")
    print(f"  │  http://localhost:{PORT}                  │")
    print(f"  │  Swagger docs: http://localhost:{PORT}/docs │")
    print(f"  │  Database: {default_engine.dialect.name:<25s}  │")
    print(f"  └─────────────────────────────────────────┘\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
