# Project Status Report: datamig

**Target Audience**: Next AI Agent

## Project Overview
**Name**: datamig (Data Migration Tool)
**Goal**: Provide a robust, intuitive web application for mapping CSV data to single or multiple database tables. The tool infers data types, detects data quality issues, and converts the mapped source data into JSON payloads meant for backend API insertion/updates.
**Architecture**: Frontend-only prototype (Vanilla HTML, CSS, JavaScript). State is managed via closures and global-like variables within a monolithic `app.js` file. No backend exists yet; the app currently outputs a consolidated JSON structure representing the planned migration.

## Current Technical Stack
*   **HTML**: Structure definition (`index.html`).
*   **CSS**: Vanilla CSS (`index.css`), modern styling, responsive design. Features custom utility classes and complex state handlers (like modal popups and drag overlays).
*   **JavaScript**: Vanilla JS (`app.js`). Manages all interactivity, state transitions, client-side CSV processing, column type inference, and JSON payload generation.
*   **Version Control**: Initialized Git repository, and code has most recently been pushed to the `main` branch of `https://github.com/victorchaw/datamig`.

## Summary of Recent Progress
We successfully finalized the core "Assign to Columns" workflow for multi-table setups. Previously, this UI suffered from severe interaction bugs. We completely rewrote the drag-and-drop system state, instituted batch selection tools, resolved crashes preventing navigation to the mapping screens, and established a stable cross-browser mechanism for prompting users before overriding mapping limits.

## Specific Debugging Issues Solved (What We Just Fixed)
1. **Listener Accumulation on Re-renders**:
   * *Problem*: The `renderAssignPage()` function repeatedly called `attachAssignListeners()`, duplicating document-level `mousemove`/`mouseup` listeners every time a UI chip was assigned or removed.
   * *Fix*: Hoisted drag variables to the module level and created an `ensureDragDocumentListeners()` initialization function protected by a boolean guard flag so it runs exactly once.
2. **Clunky "Two-Step" Dragging**:
   * *Problem*: Clicking an unchecked item forced the user into a locked 'selecting' mode, requiring them to let go and click perfectly again to drag it horizontally. 
   * *Fix*: Replaced the mode selection with a `'pending'` state governed by an 8px dead-zone threshold. On mouse movement, the dominant direction determines the mode—horizontal transitions to `'dragging-to-table'`, vertical sweeps enter `'selecting'` (multi-select lasso). No movement on mouseup toggles the item like a normal checklist click.
3. **The "Select All" NaN Crash**:
   * *Problem*: Added a "Select All" checkbox. However, `getCheckedIndices()` was too broad and scooped up this checkbox, parsing its nonexistent index as `NaN`. When "Continue to Mapping" was clicked, routing this `NaN` into the profile array threw a `TypeError` and silently aborted navigation.
   * *Fix*: Safely scoped `getCheckedIndices()` inside `app.js` to only target checkboxes inside `.csv-col-item` rows, and appended a `!isNaN(idx)` filter.
4. **Native Confirm Auto-Dismiss**:
   * *Problem*: If unassigned columns remained, the native `window.confirm()` prompt flashed and instantly disappeared on local `file://` environments.
   * *Fix*: Built a custom HTML modal overlay (`#confirm-modal`), styled it in `index.css`, and injected the async interaction logic inside the `btnAssignContinue.addEventListener` in `app.js`.

## Logic of Modified Files
* **`app.js`**: 
  * Replaced the inline boolean drag state with a robust State Machine (`let _dragState = null | 'pending' | 'selecting' | 'dragging-to-table';`).
  * Updated checkbox querying logic to support "Select All" indeterminate states (`updateSelectAllCheckbox`).
  * Wired up the custom modal's "Proceed" and "Cancel" buttons using temporary functional event listeners with cleanup closures.
  * *Dev Note*: Added a URL query shortcut: visiting `index.html?demo` auto-injects mock CSV data and jumps straight to the multi-table assignment page to drastically speed up UI testing in the browser agent.
* **`index.html`**:
  * Added the DOM markup for the `.csv-col-select-all` header panel.
  * Injected the DOM markup for the custom `#confirm-modal` right above the footer.
* **`index.css`**:
  * Added sticky positioning and formatting for `.csv-col-select-all`.
  * Built the `.modal-backdrop` and `.modal-content` components, employing `backdrop-filter: blur(4px)` and CSS transition properties (`opacity`, `transform`) for smooth pop-ins.

## Immediate Next Steps for Next Agent
1.  **Refine "Fixed Width" Options**: Implement the logic behind the "Fixed Width" separator setting (currently only a UI button).
2.  **Schema Hookup**: Convert the hardcoded `DB_SCHEMA` variable into an asynchronous payload from a backend/API endpoint.
3.  **Finish Workflow**: Connect the final "Commit to Database" UI to process the actual backend POST request for the generated `json-output`.
