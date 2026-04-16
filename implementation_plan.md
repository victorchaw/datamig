# Add Output Selection & Database Connection

This plan outlines the architecture for allowing users to choose how their data is exported, directly addressing your request to support JSON, raw SQL queries, and direct database connections via a dynamic credential form.

## Background & Approach

Currently, the tool relies on a static `DATABASE_URL` specified in your server configuration. 
Since databases (like MySQL and PostgreSQL) don't use standard "login pages" you can redirect a browser to, we must provide a credential form on the landing page. Users will type their credentials (host, username, password), and we will establish a connection dynamically. To keep this secure, the backend will temporarily stash these credentials securely in memory (tied to a session ID) rather than saving them to a file.

## Proposed Changes

### Frontend (`index.html` & `app.js`)
*   **[MODIFY] `index.html`**
    *   Add a new **"Output Destination" section** below the file upload area with three radio cards:
        1. **Generate JSON**
        2. **Generate SQL Queries**
        3. **Connect to Database**
    *   Add a **Database Connection Form** that appears only when option #3 is selected. It will have fields for: RDBMS Type (MySQL, Postgres, SQL Server, etc.), Host, Port, Username, Password (masked), and Database Name.
*   **[MODIFY] `app.js`**
    *   Update the "Commit" logic to branch based on the selected output.
    *   If JSON: Package the mapping and data, and show the JSON instantly in the Output modal.
    *   If SQL: Call a new backend endpoint to strictly generate and return SQL text, then show it in a copyable text area.
    *   If Database: Send the user's credentials to the backend to test the connection *before* proceeding to the mapping page (since we need the real DB schema to map!). 

### Backend (`server.py`)
*   **[MODIFY] `server.py`**
    *   Add a new **`/api/connect` endpoint** that accepts database credentials from the frontend, attempts a connection, and if successful, returns a secure `session_id`. The backend will hold the connection string securely in memory for that session.
    *   Update `/api/schema` and `/api/etl-upload` to accept the `session_id` so they act on the user's connected database rather than a hardcoded default.
    *   Add a new **`/api/generate-sql` endpoint** to return raw, copy-pasteable SQL statements (e.g. `INSERT INTO ...`) based on the mappings, without actually executing anything.

## Open Questions

1. **Direct DB Connect Requirement**: To map columns correctly, the tool *must* know the schema (table definitions). If a user selects "Generate JSON" or "Generate SQL" but does *not* connect to a database, how should we know the target table names and columns? 
   * *Option A:* Let them manually type the target table names and column names in the UI. 
   * *Option B:* The JSON/SQL options are only available *after* they connect to a database to fetch the schema, but instead of committing, they just export.
   * *Option C:* We use the existing dummy/static schema fallback if they don't connect.
   * Let me know which flow you prefer!

## Verification Plan
1. Launch `server.py` and open `index.html`.
2. Visually verify the new "Output Destination" toggles.
3. Test "Connect to Database" by entering SQLite or an invalid MySQL connection to ensure errors are handled and the session persists correctly.
4. Verify that "Generate SQL" produces properly formatted `INSERT` statements.
