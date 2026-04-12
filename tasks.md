# UI Redesign & Flat File Support — Tasks

## 1. Fix Mode Toggle Alignment
- [x] Fix CSS `.dest-row` alignment
- [x] Match `.mode-toggle` height to select dropdowns (both now 36px)

## 2. Accept All Flat Files
- [x] Update `accept` attribute in HTML dropzone (`.csv,.tsv,.txt,.dat,.pipe,.psv`)
- [x] Update parser to auto-detect separator from extension (`.tsv`→tab, `.pipe/.psv`→pipe)
- [x] Update `handleFile()` to auto-set separator input on upload

## 3. Remove All "CSV" References
- [x] Replace all UI text referencing "CSV" in `index.html` (meta, multi-table hint)
- [x] Replace all UI text referencing "CSV" in `app.js` (error messages, subtitles, confirm dialogs)

## 4. Redesign Mapping Table
- [x] Combine Col Letter + Col # + Col Name into single "Column" column (A-1 columnName)
- [x] Replace DB Datatype dropdown with read-only span (`db-type-badge`)
- [x] Red mismatch highlighting when inferred type ≠ DB type (e.g., Text → Number)
- [x] Hide auto-increment columns for INSERT mode
- [x] Show & highlight identity columns with 🔑 for UPDATE/UPSERT mode

## 5. Redesign Data Profiling Cards
- [x] Replace Kaggle-style cards with horizontal profiling strips
- [x] Show sample data (up to 4 values) in each strip
- [x] Simplify inferred types (Number/Text/Date instead of Integer/Email/URL)
- [x] Show "% filled" progress bar instead of Valid/Weird/Missing breakdown
- [x] Show contextual stats (Range for numbers, Avg/Max length for text)

## 6. Update Mapping Table Headers
- [x] Remove CSV Col Letter, CSV Col #, CSV Column Name → single "Column"
- [x] Update HTML table headers (Column, Detected, →, Map to DB Column, DB Type, Default Value, NULL Replacement)

## 7. Supporting Functions
- [x] Add `friendlyDbType()` to convert granular DB types to user-friendly labels
- [x] Add `isTypeMatch()` for mismatch detection (Text→Number = mismatch)
- [x] Fix type mismatch logic (removed overly permissive "Text can go into anything" rule)
