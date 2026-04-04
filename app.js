/* ════════════════════════════════════════════════════════════
   datamig — Application Logic
   CSV parsing, data profiling, column mapping, multi-table, JSON output
   ════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    /* ═══════════════════════════════════════ DB SCHEMA ═══════════════════════════════════════ */
    const DB_SCHEMA = {
        Brands: {
            tableName: 'Brands',
            columns: [
                { name: 'br_ID', datatype: 'int', nullable: false, identity: true, defaultValue: 'IDENTITY(1,1)' },
                { name: 'br_Name', datatype: 'nvarchar(100)', nullable: false, identity: false, defaultValue: null },
                { name: 'br_Description', datatype: 'nvarchar(500)', nullable: true, identity: false, defaultValue: null },
                { name: 'br_Countries_ID', datatype: 'int', nullable: true, identity: false, defaultValue: null },
                { name: 'br_Website', datatype: 'nvarchar(255)', nullable: true, identity: false, defaultValue: null },
                { name: 'br_ContactEmail', datatype: 'nvarchar(255)', nullable: true, identity: false, defaultValue: null },
            ]
        },
        Countries: {
            tableName: 'Countries',
            columns: [
                { name: 'ct_ID', datatype: 'int', nullable: false, identity: true, defaultValue: 'IDENTITY(1,1)' },
                { name: 'ct_Name', datatype: 'nvarchar(100)', nullable: false, identity: false, defaultValue: null },
                { name: 'ct_Code', datatype: 'nvarchar(5)', nullable: true, identity: false, defaultValue: null },
            ]
        }
    };

    const DATATYPE_OPTIONS = [
        { value: 'int', label: 'Integer (−2.1B to 2.1B)' },
        { value: 'bigint', label: 'Big Integer (−9.2E18 to 9.2E18)' },
        { value: 'smallint', label: 'Small Integer (−32,768 to 32,767)' },
        { value: 'tinyint', label: 'Tiny Integer (0 to 255)' },
        { value: 'bit', label: 'Boolean (0 or 1)' },
        { value: 'decimal', label: 'Decimal' }, { value: 'numeric', label: 'Numeric' },
        { value: 'float', label: 'Float' }, { value: 'real', label: 'Real' }, { value: 'money', label: 'Money' },
        { value: 'varchar(64)', label: 'VARCHAR(64)' }, { value: 'varchar(128)', label: 'VARCHAR(128)' },
        { value: 'varchar(255)', label: 'VARCHAR(255)' }, { value: 'varchar(MAX)', label: 'VARCHAR(MAX)' },
        { value: 'nvarchar(64)', label: 'NVARCHAR(64)' }, { value: 'nvarchar(128)', label: 'NVARCHAR(128)' },
        { value: 'nvarchar(255)', label: 'NVARCHAR(255)' }, { value: 'nvarchar(500)', label: 'NVARCHAR(500)' },
        { value: 'nvarchar(MAX)', label: 'NVARCHAR(MAX)' },
        { value: 'text', label: 'Text (legacy)' }, { value: 'ntext', label: 'Unicode Text (legacy)' },
        { value: 'date', label: 'Date (YYYY-MM-DD)' }, { value: 'datetime', label: 'DateTime (YYYY-MM-DD HH:mm:ss)' },
        { value: 'datetime2', label: 'DateTime2 (YYYY-MM-DD HH:mm:ss.fff)' },
        { value: 'smalldatetime', label: 'SmallDateTime (YYYY-MM-DD HH:mm)' },
        { value: 'time', label: 'Time (HH:mm:ss)' },
        { value: 'uniqueidentifier', label: 'UUID / GUID' }, { value: 'xml', label: 'XML' },
    ];

    function friendlyType(v) { const f = DATATYPE_OPTIONS.find(o => o.value === v); return f ? f.label : v; }

    /* ═══════════════════════════════════════ DOM ═══════════════════════════════════════ */
    const $ = id => document.getElementById(id);
    const dropzone = $('dropzone'), fileInput = $('file-input'), btnBrowse = $('btn-browse');
    const filePreview = $('file-preview'), fileNameEl = $('file-name'), fileSizeEl = $('file-size');
    const btnRemove = $('btn-remove-file');
    const radioCards = document.querySelectorAll('.radio-card');
    const chipSep = $('chip-sep'), customToggle = $('use-custom-sep');
    const customWrapper = $('custom-sep-wrapper'), customInput = $('custom-sep');
    const form = $('migration-form'), mainContent = document.querySelector('.main-content');
    const btnReset = $('btn-reset'), btnValidate = $('btn-validate'), btnValidateLabel = $('btn-validate-label');
    const steps = document.querySelectorAll('.step'), connectors = document.querySelectorAll('.step-connector');
    const singleControls = $('single-table-controls'), multiHint = $('multi-table-hint');

    const assignSection = $('assign-section'), assignRight = $('assign-right');
    const csvColList = $('csv-col-list'), csvColCount = $('csv-col-count');
    const btnAssignBack = $('btn-assign-back'), btnAddTable = $('btn-add-table'), btnAssignContinue = $('btn-assign-continue');

    const validationSection = $('validation-section'), summaryEl = $('summary-section');
    const dataCardsEl = $('data-cards'), mappingTbody = $('mapping-tbody');
    const sourcePreviewThead = $('source-preview-thead'), sourcePreviewTbody = $('source-preview-tbody');
    const previewThead = $('preview-thead'), previewTbody = $('preview-tbody');
    const rowCountBadge = $('row-count-badge'), tableProgressBadge = $('table-progress-badge');
    const validationTitle = $('validation-title'), validationSubtitle = $('validation-subtitle');
    const btnBackEdit = $('btn-back-edit'), btnPrevTable = $('btn-prev-table');
    const btnCommit = $('btn-commit'), btnCommitLabel = $('btn-commit-label');

    const outputSection = $('output-section'), jsonOutput = $('json-output');
    const btnCopyJson = $('btn-copy-json'), btnNewImport = $('btn-new-import');

    /* ═══════════════════════════════════════ STATE ═══════════════════════════════════════ */
    let currentFile = null, parsedHeaders = [], parsedRows = [], columnProfiles = [], columnMapping = [];
    let multiTableMode = false;
    // Multi-table state
    let tableAssignments = []; // [{tableName:'Brands', columnIndices:[0,1,2]}, ...]
    let currentTableIdx = 0;
    let allTableMappings = []; // saved mapping per table
    let allTableProfiles = []; // saved profiles per table

    /* ═══════════════════════════════════════ HELPERS ═══════════════════════════════════════ */
    function formatBytes(b) {
        if (b === 0) return '0 B';
        const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(b) / Math.log(k));
        return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
    }
    function colLetter(n) { let s = ''; while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } return s; }
    function getSeparator() { return customToggle.checked && customInput.value ? customInput.value : ','; }
    function hasHeader() { return $('header-yes').checked; }
    function getSelectedTable() { return $('db-table-select').value; }
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function isConstraintDefault(val) {
        if (!val) return false;
        const u = val.toUpperCase().trim();
        return u.startsWith('IDENTITY') || u.startsWith('NEWID') || u.startsWith('NEWSEQUENTIALID') || u.startsWith('GETDATE') || u.startsWith('GETUTCDATE') || u.startsWith('SYSDATETIME');
    }
    function isMultiMode() { return $('mode-multi').checked; }

    /* ═══════════════════════════════════════ PROFILING ═══════════════════════════════════════ */
    function profileAllColumns(headers, rows) { return headers.map((h, i) => profileColumn(h, i, rows)); }
    function profileColumn(name, colIdx, rows) {
        const total = rows.length; let missing = 0, valid = 0, weird = 0;
        let allInt = true, allNumeric = true, hasUrls = false, hasEmails = false, hasDates = false;
        let totalLen = 0, maxLen = 0, nonEmpty = 0; const numericVals = []; const re = /[\x00-\x1F\x7F]/;
        rows.forEach(row => {
            const val = colIdx < row.length ? row[colIdx] : '';
            if (val === '' || val == null) { missing++; return; }
            nonEmpty++; totalLen += val.length; if (val.length > maxLen) maxLen = val.length;
            if (re.test(val)) weird++; else valid++;
            if (!/^-?\d+$/.test(val)) allInt = false;
            if (!/^-?\d+(\.\d+)?$/.test(val)) allNumeric = false;
            if (/^-?\d+(\.\d+)?$/.test(val)) numericVals.push(parseFloat(val));
            if (/^https?:\/\//i.test(val)) hasUrls = true;
            if (/@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(val) && !val.startsWith('http')) hasEmails = true;
            if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(val) || /^\d{2}[-/]\d{2}[-/]\d{4}/.test(val)) hasDates = true;
        });
        if (nonEmpty === 0) { allInt = false; allNumeric = false; }
        let inferredType = 'Text', typeIcon = 'A', typeClass = 'type-icon-text';
        if (allInt && nonEmpty > 0) { inferredType = 'Integer'; typeIcon = '#'; typeClass = 'type-icon-number'; }
        else if (allNumeric && nonEmpty > 0) { inferredType = 'Decimal'; typeIcon = '#'; typeClass = 'type-icon-number'; }
        else if (hasUrls && !hasEmails) { inferredType = 'URL'; typeIcon = '🔗'; typeClass = 'type-icon-url'; }
        else if (hasEmails) { inferredType = 'Email'; typeIcon = '@'; typeClass = 'type-icon-email'; }
        else if (hasDates && nonEmpty > 0) { inferredType = 'Date / Time'; typeIcon = '📅'; typeClass = 'type-icon-date'; }
        let numStats = null;
        if (numericVals.length > 0) {
            numericVals.sort((a, b) => a - b);
            const sum = numericVals.reduce((a, b) => a + b, 0);
            numStats = { min: numericVals[0], max: numericVals[numericVals.length - 1], mean: sum / numericVals.length, unique: new Set(numericVals).size };
        }
        return { name, colIdx, total, missing, valid, weird, nonEmpty, avgLen: nonEmpty ? totalLen / nonEmpty : 0, maxLen, allInt, allNumeric, hasUrls, hasEmails, hasDates, inferredType, typeIcon, typeClass, numStats };
    }

    /* ═══════════════════════════════════════ INFERENCE ═══════════════════════════════════════ */
    function scorePair(p, dbCol) {
        const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const strip = s => s.replace(/^(br|ct|test|col|fld|field|tbl|db|src|dst)_?/i, '');
        const cn = norm(p.name), dn = norm(dbCol.name), cb = norm(strip(p.name)), db = norm(strip(dbCol.name));
        let ns = 0;
        if (cn === dn) ns = 100; else if (cb === db && db.length > 1) ns = 90;
        else if (cn.includes(db) && db.length > 2) ns = 75; else if (dn.includes(cb) && cb.length > 2) ns = 75;
        else if (cb.includes(db) && db.length > 2) ns = 60; else if (db.includes(cb) && cb.length > 2) ns = 60;
        let ds = 0; const dt = dbCol.datatype.toLowerCase();
        if (/^(int|bigint|smallint|tinyint)$/.test(dt)) {
            if (p.allInt && p.nonEmpty > 0) ds += 60; else if (p.allNumeric && p.nonEmpty > 0) ds += 30;
            if (dbCol.name.toLowerCase().includes('id') && p.allInt && p.maxLen <= 10) ds += 20;
        } else if (dbCol.name.toLowerCase().match(/(website|url|link|homepage)/)) { if (p.hasUrls) ds += 80; }
        else if (dbCol.name.toLowerCase().match(/(email|mail)/)) { if (p.hasEmails) ds += 80; }
        else if (/varchar|text|char/i.test(dt)) {
            if (!p.allInt && p.nonEmpty > 0) ds += 20;
            if (dbCol.name.toLowerCase().match(/(desc|description|note|comment)/) && p.avgLen > 30) ds += 40;
            if (dbCol.name.toLowerCase().match(/(name|title|label)/) && p.avgLen > 2 && p.avgLen < 100 && !p.allInt) ds += 40;
        }
        return ns + ds;
    }
    function inferMapping(profiles, dbColumns) {
        const scores = dbColumns.map(d => profiles.map(p => scorePair(p, d)));
        const assigned = new Array(profiles.length).fill(null); const usedDb = new Set();
        for (let r = 0; r < Math.min(profiles.length, dbColumns.length); r++) {
            let best = 0, bD = -1, bC = -1;
            for (let d = 0; d < dbColumns.length; d++) { if (usedDb.has(d)) continue; for (let c = 0; c < profiles.length; c++) { if (assigned[c] !== null) continue; if (scores[d][c] > best) { best = scores[d][c]; bD = d; bC = c; } } }
            if (bD >= 0 && best >= 30) { assigned[bC] = dbColumns[bD]; usedDb.add(bD); } else break;
        }
        return profiles.map((p, i) => {
            const d = assigned[i];
            return { csvIndex: p.colIdx, csvName: p.name, dbColName: d ? d.name : null, datatype: d ? d.datatype : '', defaultValue: d ? (d.identity ? 'IDENTITY(1,1)' : (d.defaultValue || '')) : '', nullReplacement: '', nullable: d ? d.nullable : true, identity: d ? d.identity : false, isMapped: !!d, inferredType: p.inferredType };
        });
    }

    /* ═══════════════════════════════════════ CSV PARSER ═══════════════════════════════════════ */
    function parseCSV(text, sep) {
        const rows = []; let cur = [], field = '', inQ = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i], nx = text[i + 1];
            if (inQ) { if (ch === '"' && nx === '"') { field += '"'; i++; } else if (ch === '"') inQ = false; else field += ch; }
            else { if (ch === '"') inQ = true; else if (ch === sep) { cur.push(field); field = ''; } else if (ch === '\r' && nx === '\n') { cur.push(field); field = ''; rows.push(cur); cur = []; i++; } else if (ch === '\n') { cur.push(field); field = ''; rows.push(cur); cur = []; } else field += ch; }
        }
        if (field || cur.length) { cur.push(field); rows.push(cur); }
        if (rows.length && rows[rows.length - 1].every(c => c === '')) rows.pop();
        return rows;
    }

    /* ═══════════════════════════════════════ STEPS ═══════════════════════════════════════ */
    function updateSteps(active) {
        steps.forEach((s, i) => s.classList.toggle('active', i < active));
        connectors.forEach((c, i) => c.classList.toggle('active', i < active - 1));
    }
    function checkValidateReady() {
        if (multiTableMode) { btnValidate.disabled = !currentFile; }
        else { btnValidate.disabled = !(currentFile && getSelectedTable()); }
    }

    /* ═══════════════════════════════════════ DROPZONE ═══════════════════════════════════════ */
    ['dragenter', 'dragover'].forEach(e => dropzone.addEventListener(e, ev => { ev.preventDefault(); dropzone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(e => dropzone.addEventListener(e, () => dropzone.classList.remove('dragover')));
    dropzone.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    btnBrowse.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

    function handleFile(file) {
        currentFile = file; fileNameEl.textContent = file.name; fileSizeEl.textContent = formatBytes(file.size);
        dropzone.style.display = 'none'; filePreview.classList.remove('hidden'); updateSteps(2); checkValidateReady();
    }
    btnRemove.addEventListener('click', () => { fileInput.value = ''; currentFile = null; filePreview.classList.add('hidden'); dropzone.style.display = ''; updateSteps(1); checkValidateReady(); });

    radioCards.forEach(c => c.addEventListener('click', () => {
        c.closest('.radio-group').querySelectorAll('.radio-card').forEach(r => r.classList.remove('selected'));
        c.classList.add('selected'); c.querySelector('input').checked = true;
    }));

    /* ─── Table mode toggle ─── */
    document.querySelectorAll('#table-mode-group .radio-card').forEach(c => c.addEventListener('click', () => {
        multiTableMode = isMultiMode();
        singleControls.classList.toggle('hidden', multiTableMode);
        multiHint.classList.toggle('hidden', !multiTableMode);
        btnValidateLabel.textContent = multiTableMode ? 'Assign Columns' : 'Validate & Map';
        checkValidateReady();
    }));

    /* ─── Separator ─── */
    customToggle.addEventListener('change', () => {
        const on = customToggle.checked; customWrapper.classList.toggle('hidden', !on);
        if (on) { chipSep.classList.remove('active'); customInput.focus(); } else { chipSep.classList.add('active'); chipSep.textContent = ','; }
    });
    customInput.addEventListener('input', () => {
        const v = customInput.value;
        if (v) { chipSep.textContent = v; chipSep.classList.add('active'); } else { chipSep.textContent = ','; chipSep.classList.remove('active'); }
    });
    $('db-table-select').addEventListener('change', () => { updateSteps(3); checkValidateReady(); });

    /* ═══════════════════════════════════════ VALIDATE & MAP ═══════════════════════════════════════ */
    btnValidate.addEventListener('click', () => {
        if (!currentFile) return;
        const reader = new FileReader();
        reader.onload = e => {
            const allRows = parseCSV(e.target.result, getSeparator());
            if (!allRows.length) { alert('CSV appears empty.'); return; }
            if (hasHeader()) { parsedHeaders = allRows[0]; parsedRows = allRows.slice(1); }
            else { parsedHeaders = allRows[0].map((_, i) => 'Column ' + (i + 1)); parsedRows = allRows; }
            columnProfiles = profileAllColumns(parsedHeaders, parsedRows);

            if (multiTableMode) { showAssignPage(); }
            else {
                const schema = DB_SCHEMA[getSelectedTable()]; if (!schema) return;
                columnMapping = inferMapping(columnProfiles, schema.columns);
                currentTableIdx = 0; allTableMappings = []; tableAssignments = [];
                showValidationPage(getSelectedTable(), false);
            }
        };
        reader.readAsText(currentFile);
    });

    // Track which columns/profiles are active for the current view
    let activeColumnIndices = null; // null = all columns, or array of original CSV indices

    function showValidationPage(tableName, isMulti) {
        const schema = DB_SCHEMA[tableName]; if (!schema) return;
        if (isMulti) {
            const assign = tableAssignments[currentTableIdx];
            activeColumnIndices = assign.columnIndices;
            const activeProfiles = assign.columnIndices.map(i => columnProfiles[i]);
            columnMapping = inferMapping(activeProfiles, schema.columns);
        } else {
            activeColumnIndices = null; // show all
        }
        validationTitle.textContent = isMulti ? `Mapping: ${tableName}` : 'Column Mapping & Validation';
        validationSubtitle.textContent = isMulti ? `Table ${currentTableIdx + 1} of ${tableAssignments.length} — Review mapping for ${tableName}` : 'Review how CSV columns map to database columns. Fill in replacement values for NULLs.';
        if (isMulti) {
            tableProgressBadge.style.display = ''; tableProgressBadge.textContent = `Table ${currentTableIdx + 1} of ${tableAssignments.length}`;
            btnPrevTable.classList.toggle('hidden', currentTableIdx === 0);
            btnBackEdit.textContent = currentTableIdx === 0 ? '← Back to Assignment' : '';
            btnBackEdit.classList.toggle('hidden', currentTableIdx > 0);
            const isLast = currentTableIdx === tableAssignments.length - 1;
            btnCommitLabel.textContent = isLast ? 'Commit to Database' : 'Next Table →';
        } else {
            tableProgressBadge.style.display = 'none'; btnPrevTable.classList.add('hidden');
            btnBackEdit.textContent = '← Back to Edit'; btnBackEdit.classList.remove('hidden');
            btnCommitLabel.textContent = 'Commit to Database';
        }
        renderSummary(); renderDataCards(); renderMapping(schema); renderSourcePreview(); renderPreview();
        updateSteps(4); mainContent.style.display = 'none'; assignSection.classList.add('hidden');
        validationSection.classList.remove('hidden'); outputSection.classList.add('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ═══════════════════════════════════════ RENDER FUNCTIONS ═══════════════════════════════════════ */
    function getActiveProfiles() {
        if (activeColumnIndices) return activeColumnIndices.map(i => columnProfiles[i]);
        return columnProfiles;
    }

    function renderSummary() {
        const ap = getActiveProfiles();
        const tR = parsedRows.length, tC = ap.length, tM = columnMapping.filter(m => m.isMapped).length;
        const tMiss = ap.reduce((s, p) => s + p.missing, 0), tW = ap.reduce((s, p) => s + p.weird, 0), tV = ap.reduce((s, p) => s + p.valid, 0);
        const tCells = tR * tC, vP = tCells ? ((tV / tCells) * 100).toFixed(1) : '0', wP = tCells ? ((tW / tCells) * 100).toFixed(0) : '0', mP = tCells ? ((tMiss / tCells) * 100).toFixed(0) : '0';
        rowCountBadge.textContent = tR + ' row' + (tR !== 1 ? 's' : '');
        summaryEl.innerHTML = `<div class="summary-banner"><div class="summary-stat-block"><span class="summary-stat-label">Total Rows</span><span class="summary-stat-value">${tR.toLocaleString()}</span></div><div class="summary-stat-block"><span class="summary-stat-label">Columns</span><span class="summary-stat-value">${tC}</span></div><div class="summary-stat-block"><span class="summary-stat-label">Mapped</span><span class="summary-stat-value">${tM} / ${columnMapping.length}</span></div><div class="summary-bar-section"><div class="quality-bar"><div class="quality-bar-valid" style="width:${vP}%"></div><div class="quality-bar-weird" style="width:${wP}%"></div><div class="quality-bar-missing" style="width:${mP}%"></div></div><div style="display:flex;gap:1.25rem;font-size:.72rem;"><span class="summary-stat-label"><span class="quality-dot dot-valid"></span> Valid ${tV.toLocaleString()} (${vP}%)</span><span class="summary-stat-label"><span class="quality-dot dot-weird"></span> Weird ${tW.toLocaleString()} (${wP}%)</span><span class="summary-stat-label"><span class="quality-dot dot-missing"></span> Missing ${tMiss.toLocaleString()} (${mP}%)</span></div></div></div>`;
    }

    function renderDataCards() {
        const ap = getActiveProfiles();
        let html = '';
        ap.forEach(p => {
            const t = p.total || 1, vP = ((p.valid / t) * 100).toFixed(0), wP = ((p.weird / t) * 100).toFixed(0), mP = ((p.missing / t) * 100).toFixed(0);
            let extra = '';
            if (p.numStats) extra = `<div class="card-extra-stats"><div class="extra-stat-row"><span class="extra-stat-label">Min</span><span class="extra-stat-value">${p.numStats.min.toLocaleString()}</span></div><div class="extra-stat-row"><span class="extra-stat-label">Max</span><span class="extra-stat-value">${p.numStats.max.toLocaleString()}</span></div><div class="extra-stat-row"><span class="extra-stat-label">Mean</span><span class="extra-stat-value">${p.numStats.mean.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div><div class="extra-stat-row"><span class="extra-stat-label">Unique</span><span class="extra-stat-value">${p.numStats.unique}</span></div></div>`;
            else if (p.nonEmpty > 0) { const u = new Set(); parsedRows.forEach(r => { if (p.colIdx < r.length && r[p.colIdx]) u.add(r[p.colIdx]); }); extra = `<div class="card-extra-stats"><div class="extra-stat-row"><span class="extra-stat-label">Avg Length</span><span class="extra-stat-value">${p.avgLen.toFixed(1)}</span></div><div class="extra-stat-row"><span class="extra-stat-label">Max Length</span><span class="extra-stat-value">${p.maxLen}</span></div><div class="extra-stat-row"><span class="extra-stat-label">Unique</span><span class="extra-stat-value">${u.size}</span></div></div>`; }
            html += `<div class="data-card"><div class="data-card-header"><span class="data-card-type-icon ${p.typeClass}">${p.typeIcon}</span><span class="data-card-name" title="${escHtml(p.name)}">${escHtml(p.name)}</span></div><span class="data-card-inferred">${p.inferredType}</span><div class="quality-bar" style="margin-top:.45rem;"><div class="quality-bar-valid" style="width:${vP}%"></div><div class="quality-bar-weird" style="width:${wP}%"></div><div class="quality-bar-missing" style="width:${mP}%"></div></div><div class="quality-stats"><div class="quality-stat"><span class="quality-stat-label"><span class="quality-dot dot-valid"></span> Valid</span><span><span class="quality-stat-value">${p.valid}</span><span class="quality-stat-pct">${vP}%</span></span></div><div class="quality-stat"><span class="quality-stat-label"><span class="quality-dot dot-weird"></span> Weird / Non-ASCII</span><span><span class="quality-stat-value">${p.weird}</span><span class="quality-stat-pct">${wP}%</span></span></div><div class="quality-stat"><span class="quality-stat-label"><span class="quality-dot dot-missing"></span> Missing</span><span><span class="quality-stat-value">${p.missing}</span><span class="quality-stat-pct">${mP}%</span></span></div></div>${extra}</div>`;
        });
        dataCardsEl.innerHTML = html;
    }

    function renderMapping(schemaOverride) {
        const tbl = multiTableMode && tableAssignments.length ? tableAssignments[currentTableIdx].tableName : getSelectedTable();
        const schema = schemaOverride || DB_SCHEMA[tbl]; if (!schema) return;
        let html = '';
        columnMapping.forEach((map, i) => {
            const letter = colLetter(map.csvIndex), num = map.csvIndex + 1;
            const profile = columnProfiles.find(p => p.colIdx === map.csvIndex) || columnProfiles[0];
            const isMapped = map.isMapped, rowClass = isMapped ? '' : 'unmapped-row', hasCon = isConstraintDefault(map.defaultValue);
            const inferColor = { 'Integer': 'rgba(14,165,233,.1); color:#0ea5e9', 'Decimal': 'rgba(14,165,233,.1); color:#0ea5e9', 'URL': 'rgba(139,92,246,.1); color:#8b5cf6', 'Email': 'rgba(245,158,11,.1); color:#f59e0b', 'Date / Time': 'rgba(99,102,241,.1); color:#6366f1', 'Text': 'rgba(16,185,129,.1); color:#10b981' }[profile.inferredType] || 'rgba(100,116,139,.1); color:#64748b';
            let dbSel = `<select class="mapping-select db-col-map-select" data-row="${i}"><option value="">— not mapped —</option>`;
            schema.columns.forEach(c => { dbSel += `<option value="${c.name}"${c.name === map.dbColName ? ' selected' : ''}>${c.name}</option>`; });
            dbSel += '</select>';
            let dtSel = `<select class="mapping-select datatype-select" data-row="${i}"${!isMapped ? ' disabled' : ''}><option value="">—</option>`;
            DATATYPE_OPTIONS.forEach(o => { dtSel += `<option value="${o.value}"${o.value === map.datatype ? ' selected' : ''}>${o.label}</option>`; });
            if (map.datatype && !DATATYPE_OPTIONS.find(o => o.value === map.datatype)) dtSel += `<option value="${map.datatype}" selected>${friendlyType(map.datatype)}</option>`;
            dtSel += '</select>';
            const dDis = !isMapped ? ' disabled' : '', dCls = hasCon ? 'default-input constraint-locked' : 'default-input', dRo = hasCon ? ' readonly' : '';
            html += `<tr class="${rowClass}"><td><span class="col-letter">${letter}</span></td><td><span class="col-num">${num}</span></td><td><span class="csv-col-name">${escHtml(map.csvName)}</span></td><td><span class="inferred-type-badge" style="background:${inferColor}">${profile.inferredType}</span></td><td class="arrow-col">→</td><td>${dbSel}</td><td>${dtSel}</td><td><input type="text" class="${dCls}" data-row="${i}" value="${escHtml(map.defaultValue)}" placeholder="None"${dDis}${dRo} /></td><td>${map.nullable ? `<input type="text" class="null-input" data-row="${i}" value="${escHtml(map.nullReplacement)}" placeholder="Value for NULL…" />` : '<span class="nullable-no">NOT NULL</span>'}</td></tr>`;
        });
        mappingTbody.innerHTML = html;
        mappingTbody.querySelectorAll('.db-col-map-select').forEach(s => s.addEventListener('change', onDbColumnChange));
        mappingTbody.querySelectorAll('.datatype-select').forEach(s => s.addEventListener('change', e => { columnMapping[parseInt(e.target.dataset.row)].datatype = e.target.value; }));
        mappingTbody.querySelectorAll('.default-input:not(.constraint-locked)').forEach(s => s.addEventListener('input', e => { columnMapping[parseInt(e.target.dataset.row)].defaultValue = e.target.value; renderPreview(); }));
        mappingTbody.querySelectorAll('.null-input').forEach(s => s.addEventListener('input', e => { columnMapping[parseInt(e.target.dataset.row)].nullReplacement = e.target.value; renderPreview(); }));
    }

    function onDbColumnChange(e) {
        const row = parseInt(e.target.dataset.row), newVal = e.target.value || null, csvN = columnMapping[row].csvName, prev = columnMapping[row].dbColName;
        if (newVal) {
            const eIdx = columnMapping.findIndex((m, idx) => idx !== row && m.dbColName === newVal && m.isMapped);
            if (eIdx >= 0) {
                const eCsv = columnMapping[eIdx].csvName, eLtr = colLetter(columnMapping[eIdx].csvIndex);
                setTimeout(() => {
                    const ok = confirm('Duplicate Mapping Detected\n\n"' + newVal + '" is already mapped to CSV column "' + eCsv + '" (Column ' + eLtr + ').\n\nDo you want to overwrite?\nOK = Remove mapping from "' + eCsv + '" and assign to "' + csvN + '"\nCancel = Keep the existing mapping');
                    if (ok) { columnMapping[eIdx].dbColName = null; columnMapping[eIdx].isMapped = false; columnMapping[eIdx].datatype = ''; columnMapping[eIdx].nullable = true; columnMapping[eIdx].identity = false; columnMapping[eIdx].defaultValue = ''; applyDbMapping(row, newVal); }
                    else { columnMapping[row].dbColName = prev; e.target.value = prev || ''; }
                    renderMapping(); renderPreview(); renderSummary();
                }, 0); return;
            }
        }
        applyDbMapping(row, newVal); renderMapping(); renderPreview(); renderSummary();
    }

    function applyDbMapping(row, dbColName) {
        const tbl = multiTableMode && tableAssignments.length ? tableAssignments[currentTableIdx].tableName : getSelectedTable();
        columnMapping[row].dbColName = dbColName; columnMapping[row].isMapped = !!dbColName;
        if (dbColName) {
            const schema = DB_SCHEMA[tbl]; const d = schema ? schema.columns.find(c => c.name === dbColName) : null;
            if (d) { columnMapping[row].datatype = d.datatype; columnMapping[row].nullable = d.nullable; columnMapping[row].identity = d.identity; columnMapping[row].defaultValue = d.identity ? 'IDENTITY(1,1)' : (d.defaultValue || ''); }
        } else { columnMapping[row].datatype = ''; columnMapping[row].nullable = true; columnMapping[row].identity = false; columnMapping[row].defaultValue = ''; }
    }

    function renderSourcePreview() {
        // In multi-table mode, only show assigned columns in source preview
        const indices = activeColumnIndices || parsedHeaders.map((_, i) => i);
        let th = '<tr>'; indices.forEach(i => { th += `<th>${colLetter(i)}: ${escHtml(parsedHeaders[i])}</th>`; }); th += '</tr>';
        sourcePreviewThead.innerHTML = th;
        let html = '';
        parsedRows.slice(0, 5).forEach(row => { html += '<tr>'; indices.forEach(i => { const v = i < row.length ? row[i] : ''; html += (v === '' || v == null) ? '<td class="null-cell">NULL</td>' : `<td>${escHtml(v)}</td>`; }); html += '</tr>'; });
        sourcePreviewTbody.innerHTML = html;
    }

    function renderPreview() {
        const mapped = columnMapping.filter(m => m.isMapped);
        let th = '<tr>'; mapped.forEach(m => { th += `<th>${m.dbColName}</th>`; }); th += '</tr>';
        previewThead.innerHTML = th;
        let html = '';
        parsedRows.slice(0, 5).forEach(row => {
            html += '<tr>'; mapped.forEach(map => {
                const val = map.csvIndex < row.length ? row[map.csvIndex] : '';
                const isNull = val === '' || val == null;
                if (isNull && map.nullReplacement) html += `<td class="replaced-cell" title="NULL replaced">${escHtml(map.nullReplacement)}</td>`;
                else if (isNull && map.defaultValue && !map.identity) html += `<td class="default-cell" title="Default applied">${escHtml(map.defaultValue)}</td>`;
                else if (isNull) html += '<td class="null-cell">NULL</td>'; else html += `<td>${escHtml(val)}</td>`;
            }); html += '</tr>';
        });
        previewTbody.innerHTML = html;
    }

    /* ═══════════════════════════════════════ COLUMN ASSIGNMENT PAGE ═══════════════════════════════════════ */
    function showAssignPage() {
        mainContent.style.display = 'none'; validationSection.classList.add('hidden'); outputSection.classList.add('hidden');
        assignSection.classList.remove('hidden');
        if (!tableAssignments.length) {
            tableAssignments = [
                { tableName: Object.keys(DB_SCHEMA)[0] || '', columnIndices: [] },
                { tableName: Object.keys(DB_SCHEMA)[1] || Object.keys(DB_SCHEMA)[0] || '', columnIndices: [] }
            ];
        }
        renderAssignPage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderAssignPage() {
        const allAssigned = new Set(); tableAssignments.forEach(a => a.columnIndices.forEach(i => allAssigned.add(i)));
        const availableCount = parsedHeaders.length - allAssigned.size;
        csvColCount.textContent = parsedHeaders.length + ' columns';

        // Select-all checkbox row + column items
        let leftHtml = `<div class="csv-col-select-all"><label class="select-all-label"><input type="checkbox" id="select-all-cb" /><span>Select All</span></label></div>`;
        parsedHeaders.forEach((h, i) => {
            const p = columnProfiles[i]; const isAssigned = allAssigned.has(i);
            const typeColor = { 'Integer': 'rgba(14,165,233,.1); color:#0ea5e9', 'URL': 'rgba(139,92,246,.1); color:#8b5cf6', 'Email': 'rgba(245,158,11,.1); color:#f59e0b', 'Text': 'rgba(16,185,129,.1); color:#10b981' }[p.inferredType] || 'rgba(100,116,139,.1); color:#64748b';
            leftHtml += `<div class="csv-col-item${isAssigned ? ' assigned' : ''}" data-idx="${i}"><input type="checkbox" data-idx="${i}" ${isAssigned ? 'disabled' : ''}/><span class="col-letter">${colLetter(i)}</span><span class="csv-col-item-name">${escHtml(h)}</span><span class="csv-col-item-type" style="background:${typeColor}">${p.inferredType}</span></div>`;
        });
        csvColList.innerHTML = leftHtml;

        let rightHtml = '';
        const tableKeys = Object.keys(DB_SCHEMA);
        tableAssignments.forEach((a, tIdx) => {
            let opts = '<option value="" disabled>Select table…</option>';
            tableKeys.forEach(k => { opts += `<option value="${k}"${k === a.tableName ? ' selected' : ''}>${k}</option>`; });
            let chips = '';
            a.columnIndices.forEach(ci => { chips += `<span class="assigned-chip" data-tidx="${tIdx}" data-cidx="${ci}">${colLetter(ci)}: ${escHtml(parsedHeaders[ci])}<button class="chip-remove" data-tidx="${tIdx}" data-cidx="${ci}">✕</button></span>`; });
            rightHtml += `<div class="table-drop-box" data-tidx="${tIdx}"><div class="table-drop-header"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg><select class="table-select" data-tidx="${tIdx}">${opts}</select>${tableAssignments.length > 2 ? `<button class="btn-icon-sm btn-remove-table" data-tidx="${tIdx}" aria-label="Remove table"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}</div><div class="table-drop-zone${a.columnIndices.length === 0 ? ' empty' : ''}" data-tidx="${tIdx}">${chips || '<span class="drop-hint">Drop columns here…</span>'}</div></div>`;
        });
        assignRight.innerHTML = rightHtml;
        attachAssignListeners();
    }

    function getCheckedIndices() {
        return [...csvColList.querySelectorAll('.csv-col-item:not(.assigned) input[type="checkbox"]:checked')]
            .map(cb => parseInt(cb.dataset.idx))
            .filter(idx => !isNaN(idx));
    }

    function assignColumnsToTable(tIdx, colIndices) {
        tableAssignments.forEach(a => { a.columnIndices = a.columnIndices.filter(i => !colIndices.includes(i)); });
        colIndices.forEach(i => { if (!tableAssignments[tIdx].columnIndices.includes(i)) tableAssignments[tIdx].columnIndices.push(i); });
        tableAssignments[tIdx].columnIndices.sort((a, b) => a - b);
        renderAssignPage();
    }

    /* ══════════════════════════════════════════════════════════════════
       Drag-and-drop state machine (registered once, never accumulates)
       States: null → 'pending' → 'dragging-to-table' | 'selecting'
       If mouseup while still 'pending' = simple click = toggle checkbox
       ══════════════════════════════════════════════════════════════════ */
    let _dragState = null;       // null | 'pending' | 'selecting' | 'dragging-to-table'
    let _dragSelectVal = true;
    let _dragStartX = 0, _dragStartY = 0;
    let _dragGhost = null;
    let _dragIndices = [];
    let _dragStartItem = null;   // the .csv-col-item that received mousedown
    const _DEAD_ZONE = 8;        // px in either direction before committing to a mode
    let _dragListenersAttached = false;

    function ensureDragDocumentListeners() {
        if (_dragListenersAttached) return;
        _dragListenersAttached = true;

        document.addEventListener('mousemove', e => {
            if (!_dragState) return;

            if (_dragState === 'pending') {
                const adx = Math.abs(e.clientX - _dragStartX);
                const ady = Math.abs(e.clientY - _dragStartY);
                if (adx < _DEAD_ZONE && ady < _DEAD_ZONE) return; // still in dead zone

                // Crossed dead zone — commit based on dominant direction
                if (adx >= ady) {
                    // Horizontal = drag-to-table
                    // Ensure the start item is checked before dragging
                    if (_dragStartItem) {
                        const cb = _dragStartItem.querySelector('input[type="checkbox"]');
                        if (cb && !cb.checked) { cb.checked = true; _dragStartItem.classList.add('selected'); }
                    }
                    _dragState = 'dragging-to-table';
                    _dragIndices = getCheckedIndices();
                    if (_dragIndices.length > 0 && !_dragGhost) {
                        _dragGhost = document.createElement('div');
                        _dragGhost.className = 'drag-ghost';
                        _dragGhost.textContent = _dragIndices.length + ' column' + (_dragIndices.length > 1 ? 's' : '');
                        document.body.appendChild(_dragGhost);
                    }
                } else {
                    // Vertical = multi-select sweep
                    // Check the start item and begin selecting
                    if (_dragStartItem) {
                        const cb = _dragStartItem.querySelector('input[type="checkbox"]');
                        if (cb && !cb.checked) { cb.checked = true; _dragStartItem.classList.add('selected'); }
                    }
                    _dragState = 'selecting';
                    _dragSelectVal = true;
                }
            }

            if (_dragState === 'selecting') {
                const item = e.target.closest ? e.target.closest('.csv-col-item:not(.assigned)') : null;
                if (item) {
                    const cb = item.querySelector('input[type="checkbox"]');
                    if (cb && cb.checked !== _dragSelectVal) {
                        cb.checked = _dragSelectVal;
                        item.classList.toggle('selected', _dragSelectVal);
                    }
                }
            }

            if (_dragState === 'dragging-to-table' && _dragGhost) {
                _dragGhost.style.left = (e.clientX + 12) + 'px';
                _dragGhost.style.top = (e.clientY - 12) + 'px';
                assignRight.querySelectorAll('.table-drop-box').forEach(box => {
                    const r = box.getBoundingClientRect();
                    box.classList.toggle('drag-over', e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
                });
            }
        });

        document.addEventListener('mouseup', e => {
            if (_dragState === 'pending' && _dragStartItem) {
                // No significant movement = simple click → toggle checkbox
                const cb = _dragStartItem.querySelector('input[type="checkbox"]');
                if (cb && !cb.disabled) {
                    cb.checked = !cb.checked;
                    _dragStartItem.classList.toggle('selected', cb.checked);
                }
                updateSelectAllCheckbox();
            }

            if (_dragState === 'dragging-to-table') {
                const dropBox = assignRight.querySelector('.table-drop-box.drag-over');
                if (dropBox) {
                    const tIdx = parseInt(dropBox.dataset.tidx);
                    assignColumnsToTable(tIdx, _dragIndices);
                }
                assignRight.querySelectorAll('.table-drop-box').forEach(b => b.classList.remove('drag-over'));
            }

            if (_dragState === 'selecting') {
                updateSelectAllCheckbox();
            }

            if (_dragGhost) { _dragGhost.remove(); _dragGhost = null; }
            _dragState = null;
            _dragIndices = [];
            _dragStartItem = null;
        });

        /* ── mousedown on csv-col-list (registered once — csvColList persists across renders) ── */
        csvColList.addEventListener('mousedown', e => {
            // Skip clicks on the select-all row or actual checkbox inputs
            if (e.target.closest('.csv-col-select-all')) return;
            const item = e.target.closest('.csv-col-item:not(.assigned)');
            if (!item || e.target.tagName === 'INPUT') return;
            _dragStartX = e.clientX;
            _dragStartY = e.clientY;
            _dragStartItem = item;
            _dragState = 'pending'; // wait for movement to decide action
            e.preventDefault();
        });
    }

    function updateSelectAllCheckbox() {
        const selectAllCb = document.getElementById('select-all-cb');
        if (!selectAllCb) return;
        const allCbs = csvColList.querySelectorAll('.csv-col-item:not(.assigned) input[type="checkbox"]');
        const checkedCbs = csvColList.querySelectorAll('.csv-col-item:not(.assigned) input[type="checkbox"]:checked');
        selectAllCb.checked = allCbs.length > 0 && checkedCbs.length === allCbs.length;
        selectAllCb.indeterminate = checkedCbs.length > 0 && checkedCbs.length < allCbs.length;
    }

    function attachAssignListeners() {
        // Register document-level drag listeners exactly once
        ensureDragDocumentListeners();

        // Select All checkbox
        const selectAllCb = document.getElementById('select-all-cb');
        if (selectAllCb) {
            selectAllCb.addEventListener('change', () => {
                const shouldCheck = selectAllCb.checked;
                csvColList.querySelectorAll('.csv-col-item:not(.assigned) input[type="checkbox"]').forEach(cb => {
                    cb.checked = shouldCheck;
                    cb.closest('.csv-col-item').classList.toggle('selected', shouldCheck);
                });
            });
        }

        // Table select
        assignRight.querySelectorAll('.table-select').forEach(s => s.addEventListener('change', e => { tableAssignments[parseInt(e.target.dataset.tidx)].tableName = e.target.value; }));
        // Remove table
        assignRight.querySelectorAll('.btn-remove-table').forEach(b => b.addEventListener('click', e => {
            const idx = parseInt(e.currentTarget.dataset.tidx); tableAssignments.splice(idx, 1); renderAssignPage();
        }));
        // Remove chip
        assignRight.querySelectorAll('.chip-remove').forEach(b => b.addEventListener('click', e => {
            e.stopPropagation();
            const tIdx = parseInt(e.currentTarget.dataset.tidx), cIdx = parseInt(e.currentTarget.dataset.cidx);
            tableAssignments[tIdx].columnIndices = tableAssignments[tIdx].columnIndices.filter(i => i !== cIdx);
            renderAssignPage();
        }));
        // Per-item checkbox direct clicks: sync highlight + select-all state
        csvColList.querySelectorAll('.csv-col-item:not(.assigned) input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                cb.closest('.csv-col-item').classList.toggle('selected', cb.checked);
                updateSelectAllCheckbox();
            });
        });
    }

    btnAddTable.addEventListener('click', () => {
        const used = new Set(tableAssignments.map(a => a.tableName));
        const avail = Object.keys(DB_SCHEMA).find(k => !used.has(k)) || Object.keys(DB_SCHEMA)[0] || '';
        tableAssignments.push({ tableName: avail, columnIndices: [] }); renderAssignPage();
    });

    btnAssignBack.addEventListener('click', () => {
        assignSection.classList.add('hidden'); mainContent.style.display = ''; updateSteps(3);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    btnAssignContinue.addEventListener('click', () => {
        try {
            const valid = tableAssignments.filter(a => a.tableName && a.columnIndices.length > 0);
            console.log('[Continue] valid tables:', valid.length, JSON.stringify(valid.map(v => ({ t: v.tableName, n: v.columnIndices.length }))));
            if (valid.length === 0) { alert('Please assign at least some columns to a table.'); return; }
            
            const proceed = () => {
                tableAssignments = valid;
                currentTableIdx = 0; allTableMappings = []; allTableProfiles = [];
                console.log('[Continue] calling showValidationPage:', tableAssignments[0].tableName);
                showValidationPage(tableAssignments[0].tableName, true);
                console.log('[Continue] done');
            };

            const allAssignedCount = valid.reduce((s, a) => s + a.columnIndices.length, 0);
            if (allAssignedCount < parsedHeaders.length) {
                const n = parsedHeaders.length - allAssignedCount;
                const modal = document.getElementById('confirm-modal');
                const msg = document.getElementById('confirm-modal-message');
                const btnCancel = document.getElementById('confirm-modal-cancel');
                const btnOk = document.getElementById('confirm-modal-ok');
                
                msg.textContent = `${n} column(s) not assigned. Proceed anyway?`;
                modal.classList.remove('hidden');
                
                const cleanup = () => {
                    modal.classList.add('hidden');
                    btnCancel.removeEventListener('click', onCancel);
                    btnOk.removeEventListener('click', onOk);
                };
                
                const onCancel = () => cleanup();
                const onOk = () => { cleanup(); proceed(); };
                
                btnCancel.addEventListener('click', onCancel);
                btnOk.addEventListener('click', onOk);
            } else {
                proceed();
            }
        } catch (err) {
            console.error('[Continue] ERROR:', err);
        }
    });

    /* ═══════════════════════════════════════ NAVIGATION ═══════════════════════════════════════ */
    btnBackEdit.addEventListener('click', () => {
        if (multiTableMode && currentTableIdx === 0) { validationSection.classList.add('hidden'); showAssignPage(); }
        else { validationSection.classList.add('hidden'); outputSection.classList.add('hidden'); mainContent.style.display = ''; updateSteps(3); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });

    btnPrevTable.addEventListener('click', () => {
        if (currentTableIdx > 0) {
            allTableMappings[currentTableIdx] = JSON.parse(JSON.stringify(columnMapping));
            currentTableIdx--;
            columnMapping = allTableMappings[currentTableIdx] || [];
            showValidationPage(tableAssignments[currentTableIdx].tableName, true);
            if (allTableMappings[currentTableIdx]) { renderMapping(); renderPreview(); renderSummary(); }
        }
    });

    /* ═══════════════════════════════════════ COMMIT / NEXT TABLE ═══════════════════════════════════════ */
    btnCommit.addEventListener('click', () => {
        const mapped = columnMapping.filter(m => m.isMapped);
        if (!mapped.length) { alert('No columns are mapped.'); return; }

        if (multiTableMode) {
            allTableMappings[currentTableIdx] = JSON.parse(JSON.stringify(columnMapping));
            if (currentTableIdx < tableAssignments.length - 1) {
                currentTableIdx++;
                if (allTableMappings[currentTableIdx]) { columnMapping = allTableMappings[currentTableIdx]; }
                showValidationPage(tableAssignments[currentTableIdx].tableName, true);
                if (allTableMappings[currentTableIdx]) { renderMapping(); renderPreview(); renderSummary(); }
                return;
            }
            // Last table — generate combined JSON
            const result = {};
            tableAssignments.forEach((a, idx) => {
                const m = allTableMappings[idx].filter(mm => mm.isMapped);
                result[a.tableName] = parsedRows.map(row => buildRowObj(row, m));
            });
            jsonOutput.innerHTML = syntaxHighlight(JSON.stringify(result, null, 2));
        } else {
            const result = parsedRows.map(row => buildRowObj(row, mapped));
            jsonOutput.innerHTML = syntaxHighlight(JSON.stringify(result, null, 2));
        }
        validationSection.classList.add('hidden'); outputSection.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    function buildRowObj(row, mapped) {
        const obj = {};
        mapped.forEach(map => {
            let val = map.csvIndex < row.length ? row[map.csvIndex] : null;
            if (val === '') val = null;
            if (val === null && map.nullReplacement) val = map.nullReplacement;
            if (val === null && map.defaultValue && !map.identity) val = map.defaultValue;
            if (val !== null) {
                if (['int', 'bigint', 'smallint', 'tinyint'].includes(map.datatype)) { const p = parseInt(val, 10); val = isNaN(p) ? val : p; }
                else if (['decimal', 'numeric', 'float', 'real', 'money'].includes(map.datatype)) { const p = parseFloat(val); val = isNaN(p) ? val : p; }
                else if (map.datatype === 'bit') { val = val === '1' || val === 'true' || val === 'True'; }
            }
            obj[map.dbColName] = val;
        });
        return obj;
    }

    function syntaxHighlight(json) {
        return json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
                m => { let c = 'json-number'; if (/^"/.test(m)) c = /:$/.test(m) ? 'json-key' : 'json-string'; else if (/true|false/.test(m)) c = 'json-boolean'; else if (/null/.test(m)) c = 'json-null'; return `<span class="${c}">${m}</span>`; });
    }

    /* ═══════════════════════════════════════ MISC ═══════════════════════════════════════ */
    const style = document.createElement('style');
    style.textContent = `.json-key{color:#7dd3fc}.json-string{color:#86efac}.json-number{color:#fbbf24}.json-boolean{color:#c084fc}.json-null{color:#fb7185;font-style:italic}.mapping-select{padding:.35rem .5rem;border-radius:8px;border:1px solid #e2e8f0;background:#fff;color:#1e293b;font-family:'Inter',system-ui,sans-serif;font-size:.75rem;font-weight:500;cursor:pointer;transition:border-color .15s,box-shadow .15s;max-width:220px;width:100%}.mapping-select:focus{outline:none;border-color:#0ea5e9;box-shadow:0 0 0 3px rgba(14,165,233,.15)}.mapping-select:disabled{opacity:.4;cursor:not-allowed}.default-input,.null-input{width:120px;padding:.35rem .55rem;border-radius:8px;border:1px solid #e2e8f0;font-family:'Inter',system-ui,sans-serif;font-size:.75rem;color:#1e293b;background:#fff;transition:border-color .15s,box-shadow .15s}.default-input:focus,.null-input:focus{outline:none;border-color:#0ea5e9;box-shadow:0 0 0 3px rgba(14,165,233,.15)}.default-input:disabled{opacity:.4;cursor:not-allowed}.default-input.constraint-locked{background:#f1f5f9;color:#94a3b8;border-color:#e2e8f0;cursor:not-allowed;font-style:italic;opacity:.7}.default-input.constraint-locked:focus{box-shadow:none;border-color:#e2e8f0}`;
    document.head.appendChild(style);

    btnCopyJson.addEventListener('click', () => {
        navigator.clipboard.writeText(jsonOutput.textContent).then(() => {
            const o = btnCopyJson.innerHTML; btnCopyJson.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
            setTimeout(() => { btnCopyJson.innerHTML = o; }, 1500);
        });
    });

    btnNewImport.addEventListener('click', () => {
        outputSection.classList.add('hidden'); validationSection.classList.remove('hidden'); updateSteps(4);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    btnReset.addEventListener('click', resetAll);
    function resetAll() {
        form.reset(); currentFile = null; parsedHeaders = []; parsedRows = []; columnProfiles = []; columnMapping = [];
        multiTableMode = false; tableAssignments = []; currentTableIdx = 0; allTableMappings = []; allTableProfiles = [];
        fileInput.value = ''; filePreview.classList.add('hidden'); dropzone.style.display = '';
        document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('selected'));
        document.querySelector('.radio-card[for="header-yes"]').classList.add('selected'); $('header-yes').checked = true;
        document.querySelector('.radio-card[for="mode-single"]').classList.add('selected'); $('mode-single').checked = true;
        singleControls.classList.remove('hidden'); multiHint.classList.add('hidden');
        btnValidateLabel.textContent = 'Validate & Map';
        chipSep.textContent = ','; chipSep.classList.add('active'); customWrapper.classList.add('hidden');
        validationSection.classList.add('hidden'); outputSection.classList.add('hidden'); assignSection.classList.add('hidden');
        mainContent.style.display = ''; updateSteps(1); btnValidate.disabled = true;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    updateSteps(1); checkValidateReady();

    // Dev shortcut: ?demo auto-loads test data and opens assign page
    if (location.search.includes('demo')) {
        const csv = "testACC,testLastname,testCountries,testWebsite,testContactEmail,testInfo,testNote,testExtra\n1,Smith,USA,http://example.com,smith@test.com,info1,note1,extra1\n2,Jones,UK,http://jones.com,jones@test.com,info2,note2,extra2\n3,Brown,Canada,http://brown.com,brown@test.com,info3,note3,extra3";
        const blob = new Blob([csv], { type: 'text/csv' });
        currentFile = new File([blob], 'demo.csv', { type: 'text/csv' });
        fileNameEl.textContent = 'demo.csv'; fileSizeEl.textContent = formatBytes(csv.length);
        dropzone.style.display = 'none'; filePreview.classList.remove('hidden');
        multiTableMode = true; $('mode-multi').checked = true;
        document.querySelector('label[for="mode-multi"]').classList.add('selected');
        singleControls.classList.add('hidden'); multiHint.classList.remove('hidden');
        btnValidateLabel.textContent = 'Assign Columns';
        updateSteps(2); checkValidateReady();
        setTimeout(() => { btnValidate.click(); }, 200);
    }
})();
