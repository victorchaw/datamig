# UI Redesign & Flat File Support — Implementation Plan

## Overview

Refactor the data migration tool to be more minimal, support all flat files (not just CSV), and redesign the validation/mapping page with professional data profiling.

---

## 1. Fix Mode Toggle Alignment

**Problem:** The segmented control for "Single Table / Multi Table" is taller than the select dropdowns, causing visual misalignment.

**Fix in CSS:** Add `align-items: center` to `.dest-row` and constrain `.mode-toggle` height to match select height.

---

## 2. Accept All Flat Files

### Files Affected: `index.html`, `app.js`, `server.py`

| Change | File |
|--------|------|
| Change `accept=".csv"` → `accept=".csv,.tsv,.txt,.dat,.pipe,.psv"` | `index.html` |
| Rename all UI text from "CSV" → "Data File" or "File" | `index.html` |
| Update parser to auto-detect separator from file extension | `app.js` |
| Update ETL upload to accept all extensions | `server.py` |

Auto-detection logic:
- `.tsv` → `\t`
- `.pipe`, `.psv` → `|`
- `.csv`, `.txt`, `.dat` → read from the `Sep` input (default `,`)

---

## 3. Assign Columns Page — Combine Col Letter + Name

### Current: Three separate columns — `CSV Col Letter` | `CSV Col #` | `CSV Column Name`
### New: One column — `Column` showing `A-1  columnName`

This saves horizontal space and feels more natural.

---

## 4. Redesign Data Profiling Cards

### Current: Kaggle-style cards with Valid/Weird/Missing + bar chart
### New: Compact profiling strips

Each card becomes a horizontal strip showing:
```
| A-1 columnName | Number | ████░░ 95% filled | Samples: 105, 203, 55 |
```

Key design choices:
- **Show 3-4 sample values** from each column so users can visualize actual data
- **Quality indicator** is simplified to a single progress bar showing "% filled" (non-empty)
- For **numeric** columns: show `Range: 5 – 980, Avg: 120`
- For **text** columns: show `Avg length: 12, Max: 45`
- Datatype uses simplified labels: `Number`, `Text`, `Date`, `Boolean`

> [!IMPORTANT]  
> This removes the "Valid / Weird / Non-ASCII / Missing" Kaggle-style breakdown and replaces it with a simpler "X% filled" metric + sample data.

---

## 5. Data Card Inferred Types → Simplified

| Old | New |
|-----|-----|
| `Integer` | `Number` |
| `Decimal` | `Number` |
| `URL` | `Text` |
| `Email` | `Text` |
| `Date / Time` | `Date` |
| `Text` | `Text` |

The profiler still detects URL/Email/Date internally but displays user-friendly categories.

---

## 6. DB Datatype Column → Read-Only from Schema

### Current: Editable `<select>` dropdown with 20+ options
### New: Read-only `<span>` showing the simplified DB type

- Grey background, no interaction
- If the inferred type **doesn't match** the DB type (e.g., the column contains text but DB expects Number), the cell turns **red** to alert the user
- The `friendlyType()` function maps granular MySQL types to simple labels:
  - `int`, `bigint`, `smallint`, `tinyint` → `Number`
  - `varchar(N)`, `text`, `char(N)` → `Text`
  - `date`, `datetime`, `datetime2` → `Date`
  - `decimal`, `float`, `double` → `Decimal`
  - `bit` → `Boolean`

---

## 7. Auto-hide Auto-Increment on INSERT / Show on UPDATE

### For INSERT mode:
- Filter out columns where `identity === true` or `autoincrement === true` from the DB column dropdown
- These columns don't appear because the DB generates them

### For UPDATE/UPSERT mode:
- Show all columns including identity/auto-increment
- Highlight the PK/unique columns with a gold accent border to indicate "this is the row ID you should match on"

---

## 8. Remove All "CSV" References

Global find-replace across HTML and JS:
- "CSV Column" → "Column"  
- "CSV Columns" → "Source Columns"
- "CSV Col Letter" → removed (combined into Column)
- "CSV Col #" → removed (combined into Column)
- "Upload CSV File" → "Upload File"
- ".csv" references → "flat file"

---

## Verification Plan

### Manual Verification
1. Load a `.tsv` file and verify it auto-detects tab separator
2. Load a `.csv` and verify the profiling cards show sample data  
3. Switch between INSERT and UPDATE modes and verify identity columns show/hide
4. Verify DB Datatype is greyed out and shows red when mismatched
5. Verify the Mode toggle is vertically aligned with Operation and Table
