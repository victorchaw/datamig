# ETL Architecture Goals 2 & 3 Tasks

## Phase 1: Pre-requisites & Schema
- [x] Modify `GET /api/schema` in `server.py` to use `insp.get_foreign_keys()` to return relationship mappings for all tables.
- [x] Update frontend `DB_SCHEMA` parser to store the `foreignKeys` arrays on each table object.

## Phase 2: Relational Linking (Goal 2)
### Frontend UI
- [x] Add ability to reorder selected tables in "Multi-Table Configuration" to establish insertion execution order.
- [x] Modify the column mapping UI to detect if a DB column is a Foreign Key. If true, activate "Lookup Mode".
- [x] In Lookup Mode, provide a dropdown to select which Table/Column to match against, and ensure the generated JSON matches the `isLookup` schema.

### Backend ETL Engine
- [x] Update `/api/etl-upload` to loop through `table_configs.items()` in the explicitly provided order, rather than arbitrary iteration.
- [x] In the SQL generator loop, detect mappings with `isLookup == True`.
- [x] Dynamically construct `LEFT JOIN` clauses inside the `INSERT ... SELECT` statement to perform the lookup against the parent table in the DB.

## Phase 3: Update Mechanism (Goal 3)
### Frontend UI
- [x] Add a global toggle selection: `[ Insert | Update ]`. 
- [x] If `Update` is selected, display a radio button or checkbox next to each mapped column labeled "Use as Match Key".
- [x] Add validation on "Commit" to ensure at least one Match Key is selected if the operation is Update.
- [x] Package the `operation` type and `matchKeys` array into the `mapping_config` JSON.

### Backend ETL Engine
- [x] In `/api/etl-upload`, extract `operation`, `matchKeys`, and `engine.dialect.name`.
- [x] Create `generator_update_mysql(table, staging, match_keys, mappings)`
- [x] Create `generator_update_postgresql(...)`
- [x] Create `generator_update_mssql(...)`
- [x] Route the request to the correct dialect function and execute the generated SQL.
- [x] Verify Row Counts returned by the update query and return them to the frontend.

## Phase 4: Combined E2E Verification
- [x] Create a flat file that updates an existing Brand whilst inserting a new Country reference across multiple tables.
- [x] Test the pipeline on MySQL.
- [x] (Optional) Spin up a Postgres container and test backend dialect routing.
