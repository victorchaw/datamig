# Project Status Report: datamig

**Target Audience**: Next AI Agent / Developer
**Last Updated**: 2026-04-11

## Project Overview
**Name**: datamig (Data Migration Tool)
**Goal**: A full-stack web application for migrating flat-file data (CSV, TSV, TXT, DAT, pipe/PSV) into a relational database. The tool parses files, auto-detects separators via content sniffing, infers data types, lets users map source columns to one or more database tables, validates the mapping (blocking type mismatches), and commits rows directly into a live MySQL database (or any RDBMS supported by SQLAlchemy) with all-or-nothing transactional safety.
**Architecture**: Vanilla HTML/CSS/JS frontend served by a **Python FastAPI + SQLAlchemy** backend. The backend dynamically reads the database schema and exposes a REST API for schema retrieval and data insertion.

## Current Technical Stack
| Layer | Technology | File(s) | Lines |
|-------|-----------|---------|-------|
| **Frontend** | Vanilla HTML, CSS, JavaScript | `index.html`, `index.css`, `app.js` | 371 + 2,466 + 1,338 |
| **Backend** | Python 3.12 + FastAPI + Uvicorn | `server.py` | 522 |
| **ORM / DB** | SQLAlchemy 2.0 (database-agnostic) | `server.py` | — |
| **Database** | MySQL 8.0 (Docker container `datamig-mysql`) | `setup-db.sql` | — |
| **Dependencies** | `requirements.txt` (Python), virtual env in `venv/` | `requirements.txt` | — |

### Database Connection
- **Docker container**: `datamig-mysql` with persistent volume `datamig-mysql-data`
- **Connection URL**: `mysql+pymysql://root:datamig123@127.0.0.1:3306/datamig_db`
- **To switch RDBMS**: Change the `DATABASE_URL` environment variable. SQLAlchemy supports MySQL, PostgreSQL, SQL Server, SQLite, and Oracle.

### Git Repository
- **Remote**: `https://github.com/victorchaw/datamig` (branch: `main`)
- **Uncommitted changes**: `app.js`, `index.css`, `index.html`, `status_report.md`, plus many untracked new files (`server.py`, `setup-db.sql`, test data files, etc.)

## File Map
```
DataMigrationTools/
├── index.html              # Frontend UI structure (371 lines)
├── index.css               # Full styling (2,466 lines) — design system, toasts, modals
├── app.js                  # Frontend logic (1,338 lines) — parsing, profiling, mapping, API calls
├── server.py               # Python FastAPI + SQLAlchemy backend (522 lines)
├── setup-db.sql            # MySQL DB + table creation script with seed data
├── requirements.txt        # Python dependencies (fastapi, uvicorn, sqlalchemy, pymysql, pandas)
├── package.json            # Script shortcuts (npm run dev → python server.py)
├── flowmap.html            # Standalone flowmap visualization (not part of main app)
├── testdata.csv            # Sample CSV for testing (4 rows, 8 columns, comma-separated)
├── testdata_pipe.txt       # Pipe-separated test data (4 rows)
├── testdata_semicolon.csv  # Semicolon-separated test data (4 rows)
├── testdata_colon.txt      # Colon-separated test data (4 rows)
├── testdata_comma.csv      # Comma-separated test data (4 rows)
├── testdata_tab.tsv        # Tab-separated test data (4 rows)
├── test_relational.csv     # Multi-table relational test data
├── test_upsert.csv         # Upsert operation test data
├── test_etl_features.py    # Python test script for ETL features
├── test_sample.tsv         # Small TSV sample
├── venv/                   # Python virtual environment (gitignored)
├── node_modules/           # Legacy Node.js deps (can be deleted)
└── .gitignore
```

## API Endpoints (server.py)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Returns DB connection status + dialect name |
| `GET` | `/api/schema` | Returns all tables + columns (from SQLAlchemy inspect) |
| `POST` | `/api/etl-upload` | **ETL pipeline**: accepts multipart file + mapping config, stages data, inserts via SQL with transactional rollback |
| `POST` | `/api/insert/{tableName}` | Legacy: bulk-inserts JSON array (with rollback on failure) |
| `GET` | `/api/tables/{tableName}/rows` | Returns up to N rows for verification |
| `GET` | `/docs` | Auto-generated Swagger UI (from FastAPI) |

## Frontend → Backend Integration
- On page load, `app.js` calls `GET /api/schema` to populate `DB_SCHEMA` dynamically.
- A green/red status badge in the topbar shows whether the API is connected.
- **File preview is limited to 500 rows** (`PREVIEW_ROW_LIMIT`) — even for multi-million row files, only 500 rows are parsed in the browser for profiling and mapping.
- On "Commit to Database", `app.js` sends the **raw file + mapping config** as `FormData` to `POST /api/etl-upload`.
- The backend stages the entire file into a temp table via Pandas chunked reads (50k rows/chunk), then uses `INSERT ... SELECT` to move data to destination tables.
- **All-or-nothing transactions**: If any table fails during multi-table commit, ALL changes are rolled back. No partial data is committed.
- Insert result modal shows success/error per table with friendly error messages (translated from raw DB exceptions).

## Key Frontend Features

### Separator Auto-Detection (`sniffSeparator()`)
- **Content-based**: Reads first 4KB of uploaded file, samples up to 10 lines
- **Candidates**: `\t`, `|`, `;`, `:`, `,` (in priority order)
- **Algorithm**: Picks the separator with the highest consistent column count across lines
- **Extension override**: `.tsv` always maps to tab
- **Tested with**: comma, pipe, semicolon, colon, and tab-separated files

### Data Profiling
- Horizontal profiling strips with visual progress bars
- Text columns show: `X null · Max: Y · Z dupe`
- Number columns show: range statistics
- Color-coded warning badges for missing/weird data columns

### Type Validation & Commit Blocking
- `isTypeMatch()` checks inferred type vs. DB column type
- Type mismatches (e.g., Text → Number) are highlighted in red
- **Commit is blocked** with a custom modal listing all mismatched columns
- Custom `showBlockingModal()` replaced all native `alert()` calls to prevent UI flash/re-render bugs

### Error Handling
- `friendlyError()` translates raw Python/MySQL exceptions into human-readable messages:
  - Missing default → "Column X requires a value..."
  - Duplicate entry → "Duplicate value for key..."
  - Data truncated → "Data too long or wrong format..."
  - Cannot be null → "Column X cannot be NULL..."
  - Foreign key constraint → "Referenced value does not exist..."
  - Table missing → "Table does not exist..."
  - Fallback: strips Python class prefix and SQL details, truncates to 200 chars

## Key Frontend State Variables (app.js)
- `DB_SCHEMA` — Mutable; loaded from API, falls back to hardcoded schema if offline.
- `apiConnected` — Boolean; controls whether commit sends HTTP requests or only shows JSON.
- `parsedHeaders`, `parsedRows` — File data after parsing (limited to first 500 rows for preview).
- `totalFileRows` — Actual total rows in the file (may exceed parsedRows for large files).
- `PREVIEW_ROW_LIMIT` — Constant (500); max rows parsed in the browser.
- `columnMapping` — Array of mapping objects linking file columns → DB columns.
- `tableAssignments` — Multi-table mode: which file columns go to which tables.
- `allTableMappings` — Stores per-table mappings for multi-table commits.

## Database Schema (datamig_db)
```sql
Countries (ct_ID INT PK AUTO_INCREMENT, ct_Name VARCHAR(100), ct_Code VARCHAR(5))
Brands    (br_ID INT PK AUTO_INCREMENT, br_Name VARCHAR(100), br_Description VARCHAR(500),
           br_Countries_ID INT FK→Countries, br_Website VARCHAR(255), br_ContactEmail VARCHAR(255))
```
Seed data: 9 countries (IDs 1–5, 105–108), 0 brands initially.

## Recent Changes (This Session — 2026-04-11)

### Server-Side
1. **All-or-nothing transactions** — ETL endpoint (`/api/etl-upload`) now uses explicit `conn.begin()` + `trans.rollback()` / `trans.commit()`. If ANY table fails in a multi-table commit, ALL inserted data is rolled back. No partial commits.
2. **Single-table rollback** — `/api/insert/{table}` endpoint also rolls back all rows if any single row fails (previously committed successful rows even when later rows failed).
3. **Lookup feature removed** — Removed the lookup JOIN logic from the ETL endpoint (the LEFT JOIN + PK select code for `isLookup` / `lookupTable` / `lookupMatchColumn` has been stripped out).

### Frontend
4. **Content-based separator detection** — Replaced extension-only detection with `sniffSeparator()` that reads file content. Supports `\t`, `|`, `;`, `:`, `,`. Added colon as a candidate.
5. **Custom blocking modals** — Replaced all native `alert()` and `confirm()` calls with `showBlockingModal()` to prevent the flash/disappear bug caused by DOM re-renders.
6. **Text profiling strips** — Now show `X null · Max: Y · Z dupe` (removed Avg len per user request).
7. **Commit blocking** — Type mismatch detection blocks commits and shows a clear modal listing incompatible columns.
8. **Friendly error messages** — `friendlyError()` parses common MySQL exceptions into plain English.
9. **Result modal update** — "Partial Success" replaced with "Failed — Rolled Back" with clear "No data was committed" messaging.
10. **Dropdown font fix** — Standardized Operation/Table dropdowns to 36px height with `.75rem` font-size for both `select` and `option` elements.

## How to Start
```bash
# 1. Start MySQL (Docker must be running)
docker start datamig-mysql

# 2. (First time only) Run the setup script
docker exec -i datamig-mysql mysql -u root -pdatamig123 < setup-db.sql

# 3. Start the API server
source venv/bin/activate
python3 server.py
# → http://localhost:3000 (app) / http://localhost:3000/docs (Swagger)
```

## How to Switch Database (e.g., to PostgreSQL)
```bash
# Install the PostgreSQL driver
pip install psycopg2-binary

# Set the connection URL and start
DATABASE_URL="postgresql://user:pass@localhost:5432/datamig_db" python3 server.py
```
No code changes needed — SQLAlchemy handles the rest.

## ETL Mapping Config JSON Shape
The frontend sends this JSON as a form field alongside the raw file:
```json
{
  "separator": ",",
  "hasHeader": true,
  "tables": {
    "Brands": {
      "operation": "insert",
      "mappings": [
        { "csvColumn": "testName", "dbColumn": "br_Name" },
        { "csvColumn": "testDesc", "dbColumn": "br_Description" }
      ]
    }
  }
}
```

## Completed Tasks (All Done)
- [x] MySQL + FastAPI backend integration
- [x] Dynamic schema loading from SQLAlchemy inspect
- [x] ETL pipeline with staging tables and chunked reads
- [x] UI redesign (minimal, compact controls)
- [x] Flat-file support (.csv, .tsv, .txt, .dat, .pipe, .psv)
- [x] Content-based separator auto-detection
- [x] Data profiling strips (null count, max length, duplicates)
- [x] Type mismatch detection and commit blocking
- [x] Custom blocking modals (no native alerts)
- [x] Friendly error message parsing
- [x] All-or-nothing transaction rollback
- [x] Lookup feature removal
- [x] Dropdown font-size fix

## Known Issues
- None currently reported. All bugs raised in this session have been resolved.

## Immediate Next Steps
1. **Git commit** — Many files are untracked. Commit `server.py`, `setup-db.sql`, `requirements.txt`, test data files, and all frontend changes.
2. **Large-file stress test** — Generate a 1M+ row CSV and test the full pipeline for memory and throughput.
3. **UPDATE / UPSERT operations** — Implement the full logic for UPDATE and UPSERT operations (joining on unique keys). Server-side SQL generation exists but frontend UI for match-key selection is incomplete.
4. **Multi-table assignment** — The drag-and-drop column assignment for multi-table mode needs further E2E testing.
5. **Clean up `node_modules/`** — Run `rm -rf node_modules package-lock.json` (legacy from Express backend).
6. **Authentication** — Add basic auth or API keys for production use.
7. **Fixed-width file support** — Implement parsing logic for fixed-width flat files.
