/* ════════════════════════════════════════════════════════════
   datamig — Application Logic
   Flat file parsing, data profiling, column mapping, multi-table, JSON output
   Now with MySQL backend integration via Express API
   ════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    /* ═══════════════════════════════════════ API CONFIG ═══════════════════════════════════════ */
    const API_BASE = window.location.origin; // Express serves both static files and API

    /* ═══════════════════════════════════════ DB SCHEMA ═══════════════════════════════════════ */
    // Schema is loaded dynamically from the API, with a hardcoded fallback
    let DB_SCHEMA = {
        Brands: {
            tableName: 'Brands',
            columns: [
                { name: 'br_ID', datatype: 'int', nullable: false, identity: true, defaultValue: 'AUTO_INCREMENT' },
                { name: 'br_Name', datatype: 'varchar(100)', nullable: false, identity: false, defaultValue: null },
                { name: 'br_Description', datatype: 'varchar(500)', nullable: true, identity: false, defaultValue: null },
                { name: 'br_Countries_ID', datatype: 'int', nullable: true, identity: false, defaultValue: null },
                { name: 'br_Website', datatype: 'varchar(255)', nullable: true, identity: false, defaultValue: null },
                { name: 'br_ContactEmail', datatype: 'varchar(255)', nullable: true, identity: false, defaultValue: null },
            ]
        },
        Countries: {
            tableName: 'Countries',
            columns: [
                { name: 'ct_ID', datatype: 'int', nullable: false, identity: true, defaultValue: 'AUTO_INCREMENT' },
                { name: 'ct_Name', datatype: 'varchar(100)', nullable: false, identity: false, defaultValue: null },
                { name: 'ct_Code', datatype: 'varchar(5)', nullable: true, identity: false, defaultValue: null },
            ]
        }
    };

    let apiConnected = false;

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

    function friendlyDbType(dt) {
        if (!dt) return '—';
        const d = dt.toLowerCase().replace(/\(.*\)/, '').trim();
        if (['int', 'bigint', 'smallint', 'tinyint', 'mediumint', 'serial'].includes(d)) return 'Number';
        if (['decimal', 'numeric', 'float', 'double', 'real', 'money', 'smallmoney'].includes(d)) return 'Decimal';
        if (['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext', 'longtext', 'mediumtext', 'tinytext', 'clob'].includes(d)) return 'Text';
        if (['date', 'datetime', 'datetime2', 'smalldatetime', 'timestamp', 'time'].includes(d)) return 'Date';
        if (['bit', 'boolean', 'bool'].includes(d)) return 'Boolean';
        if (['uniqueidentifier', 'uuid'].includes(d)) return 'UUID';
        if (['blob', 'binary', 'varbinary', 'image', 'longblob'].includes(d)) return 'Binary';
        return dt; // fallback: show raw type
    }

    function isTypeMatch(inferredType, dbType) {
        const fdb = friendlyDbType(dbType);
        if (inferredType === 'Number' && (fdb === 'Number' || fdb === 'Decimal')) return true;
        if (inferredType === 'Text' && fdb === 'Text') return true;
        if (inferredType === 'Date' && fdb === 'Date') return true;
        // Number can safely widen into Text
        if (inferredType === 'Number' && fdb === 'Text') return true;
        // Date can go into Text
        if (inferredType === 'Date' && fdb === 'Text') return true;
        // Everything else is a mismatch (e.g., Text→Number, Text→Date)
        return false;
    }

    /** Show a blocking info/warning modal using #confirm-modal. Resolves when user clicks OK. */
    function showBlockingModal(titleText, messageHtml) {
        return new Promise(resolve => {
            const modalEl = $('confirm-modal');
            const msgEl = $('confirm-modal-message');
            const okBtn = $('confirm-modal-ok');
            const cancelBtn = $('confirm-modal-cancel');
            modalEl.querySelector('.modal-title').textContent = titleText;
            msgEl.innerHTML = messageHtml;
            okBtn.textContent = 'OK';
            cancelBtn.style.display = 'none';
            modalEl.classList.remove('hidden');
            const cleanup = () => { modalEl.classList.add('hidden'); cancelBtn.style.display = ''; okBtn.removeEventListener('click', onOk); };
            const onOk = () => { cleanup(); resolve(); };
            okBtn.addEventListener('click', onOk);
        });
    }

    /** Parse raw DB error into a user-friendly message */
    function friendlyError(raw) {
        if (!raw) return 'Unknown error';
        const s = String(raw);
        // Field doesn't have a default value
        let m = s.match(/Field '([^']+)' doesn't have a default value/i);
        if (m) return `Column "${m[1]}" requires a value but none was provided. Map this column or set a NULL replacement.`;
        // Duplicate entry
        m = s.match(/Duplicate entry '([^']+)' for key '([^']+)'/i);
        if (m) return `Duplicate value "${m[1]}" for "${m[2]}". This row already exists in the table.`;
        // Data truncated
        m = s.match(/Data truncated for column '([^']+)'/i);
        if (m) return `Data too long or wrong format for column "${m[1]}". Check the data type.`;
        // Incorrect value
        m = s.match(/Incorrect (\w+) value: '([^']*)' for column '([^']+)'/i);
        if (m) return `Invalid ${m[1]} value "${m[2]}" for column "${m[3]}".`;
        // Cannot be null
        m = s.match(/Column '([^']+)' cannot be null/i);
        if (m) return `Column "${m[1]}" cannot be NULL. Provide a value or set a NULL replacement.`;
        // Foreign key constraint
        if (/foreign key constraint/i.test(s)) return 'Foreign key constraint failed. The referenced value does not exist in the related table.';
        // Table doesn't exist
        m = s.match(/Table '([^']+)' doesn't exist/i);
        if (m) return `Table "${m[1]}" does not exist in the database.`;
        // Generic: strip Python class prefix and SQL details
        const cleaned = s.replace(/\(pymysql\.err\.\w+\)\s*/gi, '').replace(/\[SQL:.*$/s, '').replace(/\(Background on.*$/s, '').trim();
        return cleaned.length > 200 ? cleaned.substring(0, 200) + '…' : cleaned;
    }

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
    let sessionId = null; // Session ID from /api/connect for dynamic DB connections
    let currentFile = null, parsedHeaders = [], parsedRows = [], columnProfiles = [], columnMapping = [];
    let totalFileRows = null; // actual total rows in the file (may be more than parsedRows for large files)
    let multiTableMode = false;
    // Multi-table state
    let tableAssignments = []; // [{tableName:'Brands', columnIndices:[0,1,2]}, ...]
    let currentTableIdx = 0;
    let allTableMappings = []; // saved mapping per table
    let allTableProfiles = []; // saved profiles per table
    const PREVIEW_ROW_LIMIT = 500; // max rows to parse in the browser for preview/mapping

    /* ═══════════════════════════════════════ HELPERS ═══════════════════════════════════════ */
    function formatBytes(b) {
        if (b === 0) return '0 B';
        const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(b) / Math.log(k));
        return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
    }
    function colLetter(n) { let s = ''; while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } return s; }
    function getSeparator() {
        const sepInput = $('sep-input');
        // Auto-detect from file extension
        if (currentFile) {
            const ext = currentFile.name.split('.').pop().toLowerCase();
            if (ext === 'tsv') return '\t';
            if (ext === 'pipe' || ext === 'psv') return '|';
        }
        if (sepInput && sepInput.value) {
            // Handle visual \t display
            if (sepInput.value === '\\t') return '\t';
            return sepInput.value;
        }
        return customToggle.checked && customInput.value ? customInput.value : ',';
    }
    function hasHeader() {
        const toggleCb = $('header-toggle-cb');
        if (toggleCb) return toggleCb.checked;
        return $('header-yes').checked;
    }
    function getSelectedTable() { return $('db-table-select').value; }
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function isConstraintDefault(val) {
        if (!val) return false;
        const u = val.toUpperCase().trim();
        return u.startsWith('IDENTITY') || u.startsWith('AUTO_INCREMENT') || u.startsWith('NEWID') || u.startsWith('NEWSEQUENTIALID') || u.startsWith('GETDATE') || u.startsWith('GETUTCDATE') || u.startsWith('SYSDATETIME');
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
        if (allInt && nonEmpty > 0) { inferredType = 'Number'; typeIcon = '#'; typeClass = 'type-icon-number'; }
        else if (allNumeric && nonEmpty > 0) { inferredType = 'Number'; typeIcon = '#'; typeClass = 'type-icon-number'; }
        else if (hasDates && nonEmpty > 0) { inferredType = 'Date'; typeIcon = '📅'; typeClass = 'type-icon-date'; }
        else if (hasEmails || hasUrls) { inferredType = 'Text'; typeIcon = 'A'; typeClass = 'type-icon-text'; }
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

    /* ═══════════════════════════════════════ FILE PARSER ═══════════════════════════════════════ */
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

        // Content-based separator auto-detection
        const reader = new FileReader();
        reader.onload = function(e) {
            const text = e.target.result;
            const detected = sniffSeparator(text, file.name);
            const si = $('sep-input');
            if (si) si.value = (detected === '\t') ? '\\t' : detected;
        };
        // Read only first 4KB for sniffing performance
        const blob = file.slice(0, 4096);
        reader.readAsText(blob);
    }

    /** Sniff separator from file content by counting candidates across lines */
    function sniffSeparator(text, fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        // Hard extension overrides
        if (ext === 'tsv') return '\t';

        const candidates = ['\t', '|', ';', ':', ','];
        const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 10);
        if (lines.length === 0) return ',';

        // Count how many times each candidate appears per line
        let best = ',', bestScore = -1;
        for (const sep of candidates) {
            const counts = lines.map(l => l.split(sep).length - 1);
            const min = Math.min(...counts);
            const max = Math.max(...counts);
            // Good separator: consistent count across lines, and count > 0
            if (min > 0 && min === max && min > bestScore) {
                bestScore = min;
                best = sep;
            } else if (min > 0 && max - min <= 1 && min > bestScore) {
                // Allow slight variance (e.g. data with quotes)
                bestScore = min;
                best = sep;
            }
        }
        return best;
    }
    btnRemove.addEventListener('click', () => { fileInput.value = ''; currentFile = null; filePreview.classList.add('hidden'); dropzone.style.display = ''; updateSteps(1); checkValidateReady(); });

    radioCards.forEach(c => c.addEventListener('click', () => {
        c.closest('.radio-group').querySelectorAll('.radio-card').forEach(r => r.classList.remove('selected'));
        c.classList.add('selected'); c.querySelector('input').checked = true;
    }));

    /* ─── Table mode toggle (new compact segmented control) ─── */
    document.querySelectorAll('#table-mode-group .mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#table-mode-group .mode-btn').forEach(b => b.classList.remove('mode-btn--active'));
            btn.classList.add('mode-btn--active');
            btn.querySelector('input').checked = true;
            multiTableMode = isMultiMode();
            singleControls.classList.toggle('hidden', multiTableMode);
            multiHint.classList.toggle('hidden', !multiTableMode);
            btnValidateLabel.textContent = multiTableMode ? 'Assign Columns' : 'Validate & Map';
            checkValidateReady();
        });
    });
    /* legacy radio-card toggle (still works if old HTML is used) */
    document.querySelectorAll('#table-mode-group .radio-card').forEach(c => c.addEventListener('click', () => {
        multiTableMode = isMultiMode();
        singleControls.classList.toggle('hidden', multiTableMode);
        multiHint.classList.toggle('hidden', !multiTableMode);
        btnValidateLabel.textContent = multiTableMode ? 'Assign Columns' : 'Validate & Map';
        checkValidateReady();
    }));

    /* ─── Separator ─── */
    /* ─── Separator ─── */
    customToggle.addEventListener('change', () => {
        const on = customToggle.checked; customWrapper.classList.toggle('hidden', !on);
        if (on) { chipSep.classList.remove('active'); customInput.focus(); } else { chipSep.classList.add('active'); chipSep.textContent = ','; }
    });
    customInput.addEventListener('input', () => {
        const v = customInput.value;
        if (v) { chipSep.textContent = v; chipSep.classList.add('active'); } else { chipSep.textContent = ','; chipSep.classList.remove('active'); }
    });
    /* ─── New inline header toggle sync ─── */
    const headerToggleCb = $('header-toggle-cb');
    if (headerToggleCb) {
        headerToggleCb.addEventListener('change', () => {
            $('header-yes').checked = headerToggleCb.checked;
            $('header-no').checked = !headerToggleCb.checked;
        });
    }
    /* ─── New inline sep-input sync ─── */
    const sepInput = $('sep-input');
    if (sepInput) {
        sepInput.addEventListener('input', () => {
            if (chipSep) { chipSep.textContent = sepInput.value || ','; }
        });
    }
    $('db-table-select').addEventListener('change', () => { updateSteps(3); checkValidateReady(); });
    $('operation-select').addEventListener('change', () => { if (!validationSection.classList.contains('hidden')) renderMapping(); });

    /* ═══════════════════════════════════════ VALIDATE & MAP ═══════════════════════════════════════ */
    btnValidate.addEventListener('click', () => {
        if (!currentFile) return;
        const reader = new FileReader();
        reader.onload = e => {
            const allRows = parseCSV(e.target.result, getSeparator());
            if (!allRows.length) { alert('File appears empty.'); return; }
            if (hasHeader()) {
                parsedHeaders = allRows[0];
                const dataRows = allRows.slice(1);
                totalFileRows = dataRows.length;
                // Limit rows for preview/profiling to avoid crashing browser on huge files
                parsedRows = dataRows.length > PREVIEW_ROW_LIMIT ? dataRows.slice(0, PREVIEW_ROW_LIMIT) : dataRows;
            } else {
                parsedHeaders = allRows[0].map((_, i) => 'Column ' + (i + 1));
                totalFileRows = allRows.length;
                parsedRows = allRows.length > PREVIEW_ROW_LIMIT ? allRows.slice(0, PREVIEW_ROW_LIMIT) : allRows;
            }
            if (totalFileRows > PREVIEW_ROW_LIMIT) {
                console.log(`[Preview] Showing ${PREVIEW_ROW_LIMIT} of ${totalFileRows.toLocaleString()} rows for profiling`);
            }
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
        validationSubtitle.textContent = isMulti ? `Table ${currentTableIdx + 1} of ${tableAssignments.length} — Review mapping for ${tableName}` : 'Review how source columns map to database columns. Fill in replacement values for NULLs.';
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
        // Conditionally build quality stat items
        const qualityStats = [];
        qualityStats.push(`<span class="summary-stat-label"><span class="quality-dot dot-valid"></span> Valid ${tV.toLocaleString()} (${vP}%)</span>`);
        if (tW > 0) qualityStats.push(`<span class="summary-stat-label"><span class="quality-dot dot-weird"></span> Weird ${tW.toLocaleString()} (${wP}%)</span>`);
        if (tMiss > 0) qualityStats.push(`<span class="summary-stat-label"><span class="quality-dot dot-missing"></span> Missing ${tMiss.toLocaleString()} (${mP}%)</span>`);
        summaryEl.innerHTML = `<div class="summary-banner"><div class="summary-stat-block"><span class="summary-stat-label">Total Rows</span><span class="summary-stat-value">${tR.toLocaleString()}</span></div><div class="summary-stat-block"><span class="summary-stat-label">Columns</span><span class="summary-stat-value">${tC}</span></div><div class="summary-stat-block"><span class="summary-stat-label">Mapped</span><span class="summary-stat-value">${tM} / ${columnMapping.length}</span></div><div class="summary-bar-section"><div class="quality-bar"><div class="quality-bar-valid" style="width:${vP}%"></div><div class="quality-bar-weird" style="width:${wP}%"></div><div class="quality-bar-missing" style="width:${mP}%"></div></div><div style="display:flex;gap:1.25rem;font-size:.72rem;">${qualityStats.join('')}</div></div></div>`;
    }

    function renderDataCards() {
        const ap = getActiveProfiles();
        let html = '';
        ap.forEach((p, idx) => {
            const t = p.total || 1;
            const filledPct = ((p.nonEmpty / t) * 100).toFixed(0);
            const letter = colLetter(p.colIdx);
            const num = p.colIdx + 1;
            const typeColor = { 'Number': '#0ea5e9', 'Date': '#6366f1', 'Text': '#10b981' }[p.inferredType] || '#64748b';

            // Gather up to 4 sample values
            const samples = [];
            for (let r = 0; r < Math.min(parsedRows.length, 20) && samples.length < 4; r++) {
                const v = parsedRows[r][p.colIdx];
                if (v && v.trim()) {
                    const display = v.length > 25 ? v.substring(0, 22) + '…' : v;
                    if (!samples.includes(display)) samples.push(display);
                }
            }
            const sampleHtml = samples.length 
                ? `<span class="strip-samples">${samples.map(s => `<code>${escHtml(s)}</code>`).join(' ')}</span>` 
                : '';

            // ── Collect column values for profiling ──
            const allVals = [], numVals = [];
            const freq = {};
            for (let r = 0; r < parsedRows.length; r++) {
                const v = (parsedRows[r][p.colIdx] || '').trim();
                if (v) { allVals.push(v); freq[v] = (freq[v] || 0) + 1; }
                if (p.inferredType === 'Number') { const n = parseFloat(v); if (!isNaN(n)) numVals.push(n); }
            }
            const uniqueCount = new Set(allVals).size;
            const dupes = allVals.length - uniqueCount;

            // ── Build sparkline + stats by type ──
            let statsHtml = '';
            const SPARK_BARS = '▁▂▃▄▅▆▇█';

            if (p.inferredType === 'Number' && p.numStats && numVals.length > 1) {
                // Sparkline: Unicode block chars showing distribution
                const mn = p.numStats.min, mx = p.numStats.max;
                const range = mx - mn || 1;
                const BINS = 10;
                const buckets = new Array(BINS).fill(0);
                numVals.forEach(v => { const b = Math.min(Math.floor(((v - mn) / range) * BINS), BINS - 1); buckets[b]++; });
                const maxB = Math.max(...buckets, 1);
                const sparkline = buckets.map(b => SPARK_BARS[Math.min(Math.round((b / maxB) * 7), 7)]).join('');
                // Mean & Std Dev
                const mean = numVals.reduce((a, b) => a + b, 0) / numVals.length;
                const stdDev = Math.sqrt(numVals.reduce((s, v) => s + (v - mean) ** 2, 0) / numVals.length);
                const fmtMean = mean % 1 === 0 ? mean.toLocaleString() : mean.toFixed(1);
                const fmtStd = stdDev % 1 === 0 ? stdDev.toLocaleString() : stdDev.toFixed(1);
                statsHtml = `<span class="strip-stat">${p.numStats.min.toLocaleString()} → ${p.numStats.max.toLocaleString()}</span>`
                    + `<span class="strip-sparkline" title="Distribution: min=${mn}, max=${mx}, μ=${fmtMean}, σ=${fmtStd}" style="color:${typeColor}">${sparkline}</span>`
                    + `<span class="strip-stat-detail">μ ${fmtMean} · σ ${fmtStd} · ${uniqueCount} uniq</span>`;
            } else if (p.inferredType === 'Number' && p.numStats) {
                statsHtml = `<span class="strip-stat">${p.numStats.min.toLocaleString()} → ${p.numStats.max.toLocaleString()} · ${uniqueCount} uniq</span>`;
            } else if (p.nonEmpty > 0) {
                // Text: top value + frequency sparkline
                const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
                const topVal = sorted[0] ? sorted[0][0] : '';
                const topCount = sorted[0] ? sorted[0][1] : 0;
                const topPct = ((topCount / allVals.length) * 100).toFixed(0);
                const topDisplay = topVal.length > 15 ? topVal.substring(0, 12) + '…' : topVal;
                // Build freq sparkline from top 10  
                const topN = sorted.slice(0, 10);
                const maxF = topN[0] ? topN[0][1] : 1;
                const sparkline = topN.map(([, c]) => SPARK_BARS[Math.min(Math.round((c / maxF) * 7), 7)]).join('');
                statsHtml = `<span class="strip-stat">${uniqueCount} uniq · ${dupes} dupe</span>`
                    + `<span class="strip-sparkline" title="Frequency of top ${topN.length} values" style="color:${typeColor}">${sparkline}</span>`
                    + `<span class="strip-stat-detail">top: "${escHtml(topDisplay)}" ${topPct}%</span>`;
            }

            // Quality warnings
            let qualityHtml = '';
            if (p.missing > 0) qualityHtml += `<span class="strip-warn strip-warn-missing" title="${p.missing} missing values">${p.missing} null</span>`;
            if (p.weird > 0) qualityHtml += `<span class="strip-warn strip-warn-weird" title="${p.weird} weird/non-ASCII values">${p.weird} weird</span>`;

            html += `<div class="profile-strip">
                <div class="strip-col"><span class="strip-id">${letter}-${num}</span> <span class="strip-name" title="${escHtml(p.name)}">${escHtml(p.name)}</span></div>
                <span class="strip-type" style="color:${typeColor}">${p.inferredType}</span>
                <div class="strip-fill-wrap"><div class="strip-fill-bar"><div class="strip-fill-bar-inner" style="width:${filledPct}%; background:${typeColor}"></div></div><span class="strip-fill-pct">${filledPct}%</span></div>
                ${statsHtml}
                ${qualityHtml}
                ${sampleHtml}
            </div>`;
        });
        dataCardsEl.innerHTML = html;
    }

    function renderMapping(schemaOverride) {
        const tbl = multiTableMode && tableAssignments.length ? tableAssignments[currentTableIdx].tableName : getSelectedTable();
        const schema = schemaOverride || DB_SCHEMA[tbl]; if (!schema) return;
        const op = document.getElementById('operation-select').value;
        let html = '';
        columnMapping.forEach((map, i) => {
            const letter = colLetter(map.csvIndex), num = map.csvIndex + 1;
            const profile = columnProfiles.find(p => p.colIdx === map.csvIndex) || columnProfiles[0];
            const isMapped = map.isMapped, rowClass = isMapped ? '' : 'unmapped-row', hasCon = isConstraintDefault(map.defaultValue);
            const inferColor = { 'Number': 'rgba(14,165,233,.1); color:#0ea5e9', 'Date': 'rgba(99,102,241,.1); color:#6366f1', 'Text': 'rgba(16,185,129,.1); color:#10b981' }[profile.inferredType] || 'rgba(100,116,139,.1); color:#64748b';

            // Filter auto-increment columns for INSERT mode
            let dbSel = `<select class="mapping-select db-col-map-select" data-row="${i}"><option value="">— not mapped —</option>`;
            schema.columns.forEach(c => {
                const isAuto = c.identity || (c.autoincrement && c.name === schema.columns.find(pk => pk.primaryKey)?.name);
                if (op === 'insert' && isAuto && c.name !== map.dbColName) return; // hide auto-inc for insert unless already mapped
                const isIdentityHighlight = (op === 'update' || op === 'upsert') && isAuto;
                dbSel += `<option value="${c.name}"${c.name === map.dbColName ? ' selected' : ''}${isIdentityHighlight ? ' class="identity-option"' : ''}>${c.name}${isIdentityHighlight ? ' 🔑' : ''}</option>`;
            });
            dbSel += '</select>';

            let matchKeyHtml = '';
            if (op === 'update' || op === 'upsert') {
                matchKeyHtml = `<div style="margin-top:6px; padding:4px; background:rgba(245,158,11,0.05); border:1px solid rgba(245,158,11,0.2); border-radius:4px;"><label style="font-size:0.75rem; color:#b45309; display:flex; align-items:center; gap:4px; cursor:pointer;"><input type="checkbox" class="cb-match-key" data-row="${i}" ${map.isMatchKey ? 'checked' : ''}> Use as Match Key</label></div>`;
            }

            // FK Lookup indicator — appears when column maps to a FK column in multi-table mode
            let fkLookupHtml = '';
            if (isMapped && map.isForeignKey && map.fkReferredTable && multiTableMode) {
                const parentTbl = map.fkReferredTable;
                const parentSchema = DB_SCHEMA[parentTbl];
                const isParentInSession = tableAssignments.some(a => a.tableName === parentTbl);
                if (isParentInSession && parentSchema) {
                    // Build dropdown of parent table columns to match against
                    let matchOpts = '<option value="">— select match column —</option>';
                    parentSchema.columns.forEach(pc => {
                        if (!pc.identity) {
                            matchOpts += `<option value="${pc.name}"${pc.name === map.lookupMatchColumn ? ' selected' : ''}>${pc.name}</option>`;
                        }
                    });
                    // Find the parent PK (referred column from FK definition)
                    const fkDef = DB_SCHEMA[tbl]?.foreignKeys?.find(f => f.column === map.dbColName);
                    const parentPK = fkDef ? fkDef.referredColumn : '';
                    fkLookupHtml = `<div style="margin-top:6px; padding:6px 8px; background:rgba(99,102,241,0.06); border:1px solid rgba(99,102,241,0.2); border-radius:4px;">
                        <div style="font-size:0.72rem; color:#4f46e5; display:flex; align-items:center; gap:4px; margin-bottom:4px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                            🔗 FK Lookup → <b>${escHtml(parentTbl)}</b>.${escHtml(parentPK)}
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="font-size:0.68rem; color:#6366f1; white-space:nowrap;">Match by:</span>
                            <select class="fk-match-select" data-row="${i}" data-parent-table="${escHtml(parentTbl)}" data-parent-pk="${escHtml(parentPK)}" style="font-size:0.72rem; padding:2px 4px; border:1px solid rgba(99,102,241,0.3); border-radius:3px; background:#fff; flex:1;">${matchOpts}</select>
                        </div>
                    </div>`;
                }
            }

            // DB Type — read-only span, red on mismatch
            const dbTypeDisplay = isMapped ? friendlyDbType(map.datatype) : '—';
            // Fix #4: FK lookup columns bypass type mismatch — subquery resolves the correct type
            const mismatch = isMapped && map.datatype && !map.isForeignKey && !isTypeMatch(profile.inferredType, map.datatype);
            const dbTypeClass = map.isForeignKey ? 'db-type-badge' : (mismatch ? 'db-type-badge db-type-mismatch' : 'db-type-badge');
            const dbTypeFinal = map.isForeignKey && isMapped ? '<span class="db-type-badge" style="background:rgba(99,102,241,0.1); color:#6366f1;">FK Lookup</span>' : `<span class="${dbTypeClass}">${dbTypeDisplay}</span>`;

            const dDis = !isMapped ? ' disabled' : '', dCls = hasCon ? 'default-input constraint-locked' : 'default-input', dRo = hasCon ? ' readonly' : '';
            html += `<tr class="${rowClass}"><td><span class="col-combined"><span class="col-letter">${letter}-${num}</span> <span class="col-name-inline">${escHtml(map.csvName)}</span></span></td><td><span class="inferred-type-badge" style="background:${inferColor}">${profile.inferredType}</span></td><td class="arrow-col">→</td><td>${dbSel}${matchKeyHtml}${fkLookupHtml}</td><td>${dbTypeFinal}</td><td><input type="text" class="${dCls}" data-row="${i}" value="${escHtml(map.defaultValue)}" placeholder="None"${dDis}${dRo} /></td><td>${map.nullable ? `<input type="text" class="null-input" data-row="${i}" value="${escHtml(map.nullReplacement)}" placeholder="Value for NULL…" />` : '<span class="nullable-no">NOT NULL</span>'}</td></tr>`;
        });
        mappingTbody.innerHTML = html;
        mappingTbody.querySelectorAll('.db-col-map-select').forEach(s => s.addEventListener('change', onDbColumnChange));

        mappingTbody.querySelectorAll('.cb-match-key').forEach(s => s.addEventListener('change', e => { 
            columnMapping[parseInt(e.target.dataset.row)].isMatchKey = e.target.checked; 
        }));
        // FK Lookup match column selector
        mappingTbody.querySelectorAll('.fk-match-select').forEach(s => s.addEventListener('change', e => {
            const row = parseInt(e.target.dataset.row);
            columnMapping[row].lookupMatchColumn = e.target.value;
            columnMapping[row].fkParentPK = e.target.dataset.parentPk;
        }));
        mappingTbody.querySelectorAll('.default-input:not(.constraint-locked)').forEach(s => s.addEventListener('input', e => { columnMapping[parseInt(e.target.dataset.row)].defaultValue = e.target.value; renderPreview(); }));
        mappingTbody.querySelectorAll('.null-input').forEach(s => s.addEventListener('input', e => { columnMapping[parseInt(e.target.dataset.row)].nullReplacement = e.target.value; renderPreview(); }));
    }

    function onDbColumnChange(e) {
        const row = parseInt(e.target.dataset.row), newVal = e.target.value || null, csvN = columnMapping[row].csvName, prev = columnMapping[row].dbColName;
        if (newVal) {
            const eIdx = columnMapping.findIndex((m, idx) => idx !== row && m.dbColName === newVal && m.isMapped);
            if (eIdx >= 0) {
                const eCsv = columnMapping[eIdx].csvName, eLtr = colLetter(columnMapping[eIdx].csvIndex);
                // Use custom modal instead of confirm() to prevent flash dismiss
                const modalEl = $('confirm-modal');
                const msgEl = $('confirm-modal-message');
                const okBtn = $('confirm-modal-ok');
                const cancelBtn = $('confirm-modal-cancel');
                msgEl.innerHTML = '"<b>' + escHtml(newVal) + '</b>" is already mapped to column "<b>' + escHtml(eCsv) + '</b>" (Column ' + eLtr + ').<br><br>Overwrite will remove the existing mapping and assign to "<b>' + escHtml(csvN) + '</b>".';
                modalEl.querySelector('.modal-title').textContent = 'Duplicate Mapping Detected';
                okBtn.textContent = 'Overwrite';
                modalEl.classList.remove('hidden');
                const cleanup = () => { modalEl.classList.add('hidden'); okBtn.removeEventListener('click', onOk); cancelBtn.removeEventListener('click', onCancel); };
                const onOk = () => { cleanup(); columnMapping[eIdx].dbColName = null; columnMapping[eIdx].isMapped = false; columnMapping[eIdx].datatype = ''; columnMapping[eIdx].nullable = true; columnMapping[eIdx].identity = false; columnMapping[eIdx].defaultValue = ''; applyDbMapping(row, newVal); renderMapping(); renderPreview(); renderSummary(); };
                const onCancel = () => { cleanup(); columnMapping[row].dbColName = prev; e.target.value = prev || ''; renderMapping(); renderPreview(); renderSummary(); };
                okBtn.addEventListener('click', onOk);
                cancelBtn.addEventListener('click', onCancel);
                return;
            }
        }
        applyDbMapping(row, newVal); renderMapping(); renderPreview(); renderSummary();
    }

    function applyDbMapping(row, dbColName) {
        const tbl = multiTableMode && tableAssignments.length ? tableAssignments[currentTableIdx].tableName : getSelectedTable();
        columnMapping[row].dbColName = dbColName; columnMapping[row].isMapped = !!dbColName;
        if (dbColName) {
            const schema = DB_SCHEMA[tbl]; const d = schema ? schema.columns.find(c => c.name === dbColName) : null;
            if (d) { 
                columnMapping[row].datatype = d.datatype; 
                columnMapping[row].nullable = d.nullable; 
                columnMapping[row].identity = d.identity; 
                columnMapping[row].defaultValue = d.identity ? 'IDENTITY(1,1)' : (d.defaultValue || ''); 

                const fk = schema.foreignKeys ? schema.foreignKeys.find(f => f.column === dbColName) : null;
                if (fk) {
                    columnMapping[row].isForeignKey = true;
                    columnMapping[row].fkReferredTable = fk.referredTable;
                    columnMapping[row].isLookup = true;
                    columnMapping[row].lookupTable = fk.referredTable;
                    columnMapping[row].lookupMatchColumn = ""; 
                } else {
                    columnMapping[row].isForeignKey = false;
                    columnMapping[row].isLookup = false;
                    columnMapping[row].lookupTable = null;
                    columnMapping[row].lookupMatchColumn = null;
                }
            }
        } else { 
            columnMapping[row].datatype = ''; columnMapping[row].nullable = true; columnMapping[row].identity = false; columnMapping[row].defaultValue = ''; 
            columnMapping[row].isForeignKey = false; columnMapping[row].isLookup = false; columnMapping[row].lookupTable = null; columnMapping[row].lookupMatchColumn = null;
        }
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
            const p = columnProfiles[i];
            // Count how many tables this column is assigned to (allow multi-assignment)
            const assignedCount = tableAssignments.filter(a => a.columnIndices.includes(i)).length;
            const isAssigned = assignedCount > 0;
            const typeColor = { 'Number': 'rgba(14,165,233,.1); color:#0ea5e9', 'Date': 'rgba(99,102,241,.1); color:#6366f1', 'Text': 'rgba(16,185,129,.1); color:#10b981' }[p.inferredType] || 'rgba(100,116,139,.1); color:#64748b';
            const assignedBadge = assignedCount > 0 ? `<span style="font-size:0.6rem; background:rgba(14,165,233,0.15); color:#0284c7; padding:1px 5px; border-radius:8px; margin-left:4px;">${assignedCount}x</span>` : '';
            leftHtml += `<div class="csv-col-item${isAssigned ? ' assigned' : ''}" data-idx="${i}"><input type="checkbox" data-idx="${i}" /><span class="col-letter">${colLetter(i)}-${i + 1}</span><span class="csv-col-item-name">${escHtml(h)}</span>${assignedBadge}<span class="csv-col-item-type" style="background:${typeColor}">${p.inferredType}</span></div>`;
        });
        csvColList.innerHTML = leftHtml;

        let rightHtml = '';
        const tableKeys = Object.keys(DB_SCHEMA);
        tableAssignments.forEach((a, tIdx) => {
            let opts = '<option value="" disabled>Select table…</option>';
            tableKeys.forEach(k => { opts += `<option value="${k}"${k === a.tableName ? ' selected' : ''}>${k}</option>`; });
            let chips = '';
            a.columnIndices.forEach(ci => { chips += `<span class="assigned-chip" draggable="true" data-tidx="${tIdx}" data-cidx="${ci}">${colLetter(ci)}: ${escHtml(parsedHeaders[ci])}<button class="chip-remove" data-tidx="${tIdx}" data-cidx="${ci}">✕</button></span>`; });
            rightHtml += `<div class="table-drop-box" data-tidx="${tIdx}"><div class="table-drop-header"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg><select class="table-select" data-tidx="${tIdx}">${opts}</select><div style="display:flex; gap: 4px; margin-left:auto"><button class="btn-icon-sm btn-move-table-up" data-tidx="${tIdx}" ${tIdx === 0 ? 'disabled style="opacity: 0.3; cursor: default;"' : ''} aria-label="Move table up" title="Execute this table earlier"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg></button><button class="btn-icon-sm btn-move-table-down" data-tidx="${tIdx}" ${tIdx === tableAssignments.length - 1 ? 'disabled style="opacity: 0.3; cursor: default;"' : ''} aria-label="Move table down" title="Execute this table later"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></button>${tableAssignments.length > 2 ? `<button class="btn-icon-sm btn-remove-table" data-tidx="${tIdx}" aria-label="Remove table"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}</div></div><div class="table-drop-zone${a.columnIndices.length === 0 ? ' empty' : ''}" data-tidx="${tIdx}">${chips || '<span class="drop-hint">Drop columns here…</span>'}</div></div>`;
        });
        assignRight.innerHTML = rightHtml;
        attachAssignListeners();
    }

    function getCheckedIndices() {
        return [...csvColList.querySelectorAll('.csv-col-item input[type="checkbox"]:checked')]
            .map(cb => parseInt(cb.dataset.idx))
            .filter(idx => !isNaN(idx));
    }

    function assignColumnsToTable(tIdx, colIndices, keepOtherAssignments) {
        // If not keeping other assignments, remove from all other tables first
        if (!keepOtherAssignments) {
            tableAssignments.forEach(a => { a.columnIndices = a.columnIndices.filter(i => !colIndices.includes(i)); });
        }
        // Add to target table, preventing duplicates within the same table
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
                const item = e.target.closest ? e.target.closest('.csv-col-item') : null;
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
            const item = e.target.closest('.csv-col-item');
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
        const allCbs = csvColList.querySelectorAll('.csv-col-item input[type="checkbox"]');
        const checkedCbs = csvColList.querySelectorAll('.csv-col-item input[type="checkbox"]:checked');
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
                csvColList.querySelectorAll('.csv-col-item input[type="checkbox"]').forEach(cb => {
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
        // Move table up
        assignRight.querySelectorAll('.btn-move-table-up').forEach(b => b.addEventListener('click', e => {
            const idx = parseInt(e.currentTarget.dataset.tidx);
            if (idx > 0) {
                const temp = tableAssignments[idx];
                tableAssignments[idx] = tableAssignments[idx - 1];
                tableAssignments[idx - 1] = temp;
                renderAssignPage();
            }
        }));
        // Move table down
        assignRight.querySelectorAll('.btn-move-table-down').forEach(b => b.addEventListener('click', e => {
            const idx = parseInt(e.currentTarget.dataset.tidx);
            if (idx < tableAssignments.length - 1) {
                const temp = tableAssignments[idx];
                tableAssignments[idx] = tableAssignments[idx + 1];
                tableAssignments[idx + 1] = temp;
                renderAssignPage();
            }
        }));
        // Chip drag-to-move between tables (native HTML5 drag-and-drop)
        assignRight.querySelectorAll('.assigned-chip[draggable]').forEach(chip => {
            chip.addEventListener('dragstart', e => {
                e.dataTransfer.setData('text/plain', JSON.stringify({
                    fromTIdx: parseInt(chip.dataset.tidx),
                    cIdx: parseInt(chip.dataset.cidx)
                }));
                e.dataTransfer.effectAllowed = 'move';
                chip.style.opacity = '0.5';
            });
            chip.addEventListener('dragend', () => { chip.style.opacity = ''; });
        });
        assignRight.querySelectorAll('.table-drop-zone').forEach(zone => {
            zone.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                zone.closest('.table-drop-box').classList.add('drag-over');
            });
            zone.addEventListener('dragleave', e => {
                zone.closest('.table-drop-box').classList.remove('drag-over');
            });
            zone.addEventListener('drop', e => {
                e.preventDefault();
                zone.closest('.table-drop-box').classList.remove('drag-over');
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    const toTIdx = parseInt(zone.closest('.table-drop-box').dataset.tidx);
                    if (data.fromTIdx !== toTIdx) {
                        // Remove from source table
                        tableAssignments[data.fromTIdx].columnIndices = tableAssignments[data.fromTIdx].columnIndices.filter(i => i !== data.cIdx);
                        // Add to destination table (with dedup)
                        if (!tableAssignments[toTIdx].columnIndices.includes(data.cIdx)) {
                            tableAssignments[toTIdx].columnIndices.push(data.cIdx);
                            tableAssignments[toTIdx].columnIndices.sort((a, b) => a - b);
                        }
                        renderAssignPage();
                    }
                } catch (err) { /* ignore non-chip drops */ }
            });
        });
        // Per-item checkbox direct clicks: sync highlight + select-all state
        csvColList.querySelectorAll('.csv-col-item input[type="checkbox"]').forEach(cb => {
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

    /**
     * Sort table assignments so parent tables come before child tables.
     * Uses FK relationships from DB_SCHEMA to build a dependency graph and topological sort.
     */
    function sortTablesByFKDependency(assignments) {
        if (assignments.length <= 1) return assignments;
        const tableNames = new Set(assignments.map(a => a.tableName));
        // Build dependency map: childTable -> Set of parentTables it depends on
        const deps = {};
        assignments.forEach(a => { deps[a.tableName] = new Set(); });
        for (const a of assignments) {
            const schema = DB_SCHEMA[a.tableName];
            if (schema && schema.foreignKeys) {
                for (const fk of schema.foreignKeys) {
                    if (tableNames.has(fk.referredTable) && fk.referredTable !== a.tableName) {
                        deps[a.tableName].add(fk.referredTable);
                    }
                }
            }
        }
        // Topological sort (Kahn's algorithm)
        const sorted = [];
        const remaining = [...assignments];
        let safety = remaining.length + 1;
        while (remaining.length > 0 && safety-- > 0) {
            const idx = remaining.findIndex(a => deps[a.tableName].size === 0);
            if (idx === -1) break; // circular dependency, keep original order
            const item = remaining.splice(idx, 1)[0];
            sorted.push(item);
            for (const key of Object.keys(deps)) {
                deps[key].delete(item.tableName);
            }
        }
        sorted.push(...remaining);
        if (sorted.length > 0) {
            console.log('[FK Sort] Table order:', sorted.map(s => s.tableName).join(' -> '));
        }
        return sorted;
    }

    btnAssignContinue.addEventListener('click', () => {
        try {
            const valid = tableAssignments.filter(a => a.tableName && a.columnIndices.length > 0);
            console.log('[Continue] valid tables:', valid.length, JSON.stringify(valid.map(v => ({ t: v.tableName, n: v.columnIndices.length }))));
            if (valid.length === 0) { alert('Please assign at least some columns to a table.'); return; }
            
            const proceed = () => {
                // Auto-sort tables: parents before children based on FK relationships
                const sorted = sortTablesByFKDependency(valid);
                tableAssignments = sorted;
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

    /**
     * Build the mapping_config JSON for the ETL endpoint.
     * Shape: { separator, hasHeader, tables: { TableName: { mappings: [{csvColumn, dbColumn}] } } }
     */
    function buildMappingConfig(tableMappings) {
        const tables = {};
        const op = document.getElementById('operation-select').value;
        for (const [tblName, mappedCols] of Object.entries(tableMappings)) {
            tables[tblName] = {
                operation: op,
                matchKeys: mappedCols.filter(m => m.isMapped && m.isMatchKey).map(m => m.dbColName),
                mappings: mappedCols
                    .filter(m => m.isMapped)
                    .map(m => {
                        let obj = { csvColumn: m.csvName, dbColumn: m.dbColName };
                        if (m.isForeignKey && m.lookupMatchColumn && m.fkReferredTable) {
                            // FK Lookup: resolve FK value via parent table subquery
                            obj.fkLookup = {
                                parentTable: m.fkReferredTable,
                                matchColumn: m.lookupMatchColumn,
                                parentPK: m.fkParentPK || ''
                            };
                        }
                        return obj;
                    })
            };
        }
        return {
            separator: getSeparator(),
            hasHeader: hasHeader(),
            tables,
        };
    }

    /**
     * Send file + mapping config to the ETL endpoint via FormData.
     * Returns the parsed API response.
     */
    async function submitETL(mappingConfig) {
        const formData = new FormData();
        formData.append('file', currentFile);
        formData.append('mapping_config', JSON.stringify(mappingConfig));
        const headers = {};
        if (sessionId) headers['x-session-id'] = sessionId;
        const resp = await fetch(`${API_BASE}/api/etl-upload`, {
            method: 'POST',
            headers,
            body: formData,
        });
        const data = await resp.json();
        return { ...data, httpOk: resp.ok };
    }

    btnCommit.addEventListener('click', async () => {
        const mapped = columnMapping.filter(m => m.isMapped);
        if (!mapped.length) { await showBlockingModal('No Columns Mapped', 'Please map at least one source column to a database column before committing.'); return; }

        // Block commit if type mismatches exist
        const mismatches = mapped.filter(m => {
            // Fix #4: FK lookup columns are exempt from type mismatch — subquery resolves to correct type
            if (m.isForeignKey) return false;
            const profile = columnProfiles.find(p => p.colIdx === m.csvIndex);
            return profile && m.datatype && !isTypeMatch(profile.inferredType, m.datatype);
        });
        if (mismatches.length > 0) {
            const rows = mismatches.map(m => `<b>${escHtml(m.csvName)}</b> (${columnProfiles.find(p=>p.colIdx===m.csvIndex)?.inferredType || '?'}) → <b>${escHtml(m.dbColName)}</b> (${friendlyDbType(m.datatype)})`).join('<br>');
            await showBlockingModal('Type Mismatch', `The following columns have incompatible data types:<br><br>${rows}<br><br>Please fix the mapping or change the target column before committing.`);
            return;
        }
        const op = document.getElementById('operation-select').value;
        if (op === 'update' || op === 'upsert') {
            if (!mapped.some(m => m.isMatchKey)) {
                await showBlockingModal('Match Key Required', 'For an Update/Upsert operation, you must select at least one <b>Match Key</b> column to identify which rows to update.');
                return;
            }
        }

        if (multiTableMode) {
            allTableMappings[currentTableIdx] = JSON.parse(JSON.stringify(columnMapping));
            if (currentTableIdx < tableAssignments.length - 1) {
                currentTableIdx++;
                if (allTableMappings[currentTableIdx]) { columnMapping = allTableMappings[currentTableIdx]; }
                showValidationPage(tableAssignments[currentTableIdx].tableName, true);
                if (allTableMappings[currentTableIdx]) { renderMapping(); renderPreview(); renderSummary(); }
                return;
            }
            // Last table — build preview JSON (from preview rows only) and show it
            const previewResult = {};
            tableAssignments.forEach((a, idx) => {
                const m = allTableMappings[idx].filter(mm => mm.isMapped);
                previewResult[a.tableName] = parsedRows.slice(0, 5).map(row => buildRowObj(row, m));
            });
            jsonOutput.innerHTML = syntaxHighlight(JSON.stringify(previewResult, null, 2));
            validationSection.classList.add('hidden'); outputSection.classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });

            // ETL file upload for all tables
            if (apiConnected) {
                setBtnLoading(btnCommit, true);
                try {
                    const tableMaps = {};
                    tableAssignments.forEach((a, idx) => {
                        tableMaps[a.tableName] = allTableMappings[idx];
                    });
                    const config = buildMappingConfig(tableMaps);
                    const etlResult = await submitETL(config);
                    setBtnLoading(btnCommit, false);
                    // Convert ETL response to the shape showInsertResults expects
                    const modalResults = (etlResult.tables || []).map(t => ({
                        table: t.table,
                        inserted: t.inserted || 0,
                        error: t.error || undefined,
                        httpOk: !t.error,
                    }));
                    showInsertResults(modalResults, etlResult.staged_rows);
                } catch (err) {
                    setBtnLoading(btnCommit, false);
                    showInsertResults([{ table: '(all)', error: err.message, httpOk: false }]);
                }
            }
        } else {
            const tblName = getSelectedTable();
            // Show preview JSON (first 5 rows only, not the full file)
            const previewResult = parsedRows.slice(0, 5).map(row => buildRowObj(row, mapped));
            jsonOutput.innerHTML = syntaxHighlight(JSON.stringify(previewResult, null, 2));
            validationSection.classList.add('hidden'); outputSection.classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });

            // ETL file upload
            if (apiConnected) {
                setBtnLoading(btnCommit, true);
                try {
                    const config = buildMappingConfig({ [tblName]: mapped });
                    const etlResult = await submitETL(config);
                    setBtnLoading(btnCommit, false);
                    const modalResults = (etlResult.tables || []).map(t => ({
                        table: t.table,
                        inserted: t.inserted || 0,
                        error: t.error || undefined,
                        httpOk: !t.error,
                    }));
                    showInsertResults(modalResults, etlResult.staged_rows);
                } catch (err) {
                    setBtnLoading(btnCommit, false);
                    showInsertResults([{ table: tblName, error: err.message, httpOk: false }]);
                }
            }
        }
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
    const btnOutputStartover = $('btn-output-startover');
    if (btnOutputStartover) btnOutputStartover.addEventListener('click', goToImportPage);
    /* ═══════════════════════════════════════ GO TO IMPORT (Start Over) ═══════════════════════════════════════ */
    function goToImportPage() {
        // 1. Hide ALL non-import sections FIRST (before resetAll which may throw)
        const _os = document.getElementById('output-section');
        const _vs = document.getElementById('validation-section');
        const _as = document.getElementById('assign-section');
        const _sp = document.getElementById('settings-page');
        const _hp = document.getElementById('history-page');
        const _mc = document.querySelector('.main-content');
        const _ip = document.getElementById('migration-form');
        const _modal = document.getElementById('insert-result-modal');

        if (_os) _os.classList.add('hidden');
        if (_vs) _vs.classList.add('hidden');
        if (_as) _as.classList.add('hidden');
        if (_sp) _sp.classList.add('hidden');
        if (_hp) _hp.classList.add('hidden');
        if (_modal) _modal.classList.add('hidden');

        // 2. Show import page
        if (_mc) _mc.style.display = '';
        if (_ip) { _ip.classList.remove('hidden'); _ip.style.display = ''; }

        // 3. Update nav state
        document.querySelectorAll('.topbar-nav .nav-link').forEach(l => {
            l.classList.remove('active');
            if (l.textContent.trim() === 'Import') l.classList.add('active');
        });

        // 4. Reset form state (wrapped in try-catch so navigation always works)
        try { resetAll(); } catch (e) { console.warn('resetAll error:', e); }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function resetAll() {
        form.reset(); currentFile = null; parsedHeaders = []; parsedRows = []; columnProfiles = []; columnMapping = []; totalFileRows = null;
        multiTableMode = false; tableAssignments = []; currentTableIdx = 0; allTableMappings = []; allTableProfiles = [];
        fileInput.value = ''; filePreview.classList.add('hidden'); dropzone.style.display = '';
        document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('selected'));
        const headerYesCard = document.querySelector('.radio-card[for="header-yes"]');
        if (headerYesCard) headerYesCard.classList.add('selected');
        $('header-yes').checked = true;
        const singleCard = document.querySelector('.radio-card[for="mode-single"]');
        if (singleCard) singleCard.classList.add('selected');
        $('mode-single').checked = true;
        // Reset new compact controls
        const htcb = $('header-toggle-cb'); if (htcb) htcb.checked = true;
        const si = $('sep-input'); if (si) si.value = ',';
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('mode-btn--active'));
        const singleBtn = document.querySelector('.mode-btn:first-child');
        if (singleBtn) singleBtn.classList.add('mode-btn--active');
        singleControls.classList.remove('hidden'); multiHint.classList.add('hidden');
        btnValidateLabel.textContent = 'Validate & Map';
        chipSep.textContent = ','; chipSep.classList.add('active'); customWrapper.classList.add('hidden');
        validationSection.classList.add('hidden'); outputSection.classList.add('hidden'); assignSection.classList.add('hidden');
        mainContent.style.display = ''; updateSteps(1); btnValidate.disabled = true;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ═══════════════════════════════════════ TOAST SYSTEM ═══════════════════════════════════════ */
    function showToast(type, title, message, duration) {
        duration = duration || 4000;
        const container = document.getElementById('toast-container');
        const icons = { success: '✓', error: '✕', info: 'ℹ' };
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<div class="toast-icon">${icons[type] || 'ℹ'}</div><div class="toast-body"><div class="toast-title">${title}</div><div class="toast-message">${message}</div></div><button class="toast-close" aria-label="Close">×</button>`;
        container.appendChild(toast);
        const close = () => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 300); };
        toast.querySelector('.toast-close').addEventListener('click', close);
        setTimeout(close, duration);
    }

    /* ═══════════════════════════════════════ HISTORY SYSTEM ═══════════════════════════════════════ */
    let migrationHistory = [];

    function addHistoryEntry(entry) {
        migrationHistory.unshift(entry);
        renderHistory();
    }

    function renderHistory() {
        const list = $('history-list');
        const empty = $('history-empty');
        if (!list) return;
        if (migrationHistory.length === 0) {
            if (empty) empty.style.display = '';
            // Remove all entries but keep the empty placeholder
            list.querySelectorAll('.history-entry').forEach(el => el.remove());
            return;
        }
        if (empty) empty.style.display = 'none';
        // Rebuild
        list.querySelectorAll('.history-entry').forEach(el => el.remove());
        migrationHistory.forEach(h => {
            const div = document.createElement('div');
            div.className = 'history-entry';
            const iconClass = h.success ? 'success' : 'error';
            const iconChar = h.success ? '✓' : '✗';
            div.innerHTML = `
                <div class="history-icon ${iconClass}">${iconChar}</div>
                <div class="history-body">
                    <div class="history-title">${escHtml(h.file)} → ${h.tables.map(t => escHtml(t)).join(', ')}</div>
                    <div class="history-meta">
                        <span>${h.operation.toUpperCase()}</span>
                        <span>${h.rows.toLocaleString()} rows</span>
                        <span>${h.success ? 'Success' : 'Failed'}</span>
                    </div>
                </div>
                <div class="history-time">${h.time}</div>
            `;
            list.appendChild(div);
        });
    }

    const btnClearHistory = $('btn-clear-history');
    if (btnClearHistory) {
        btnClearHistory.addEventListener('click', () => {
            migrationHistory = [];
            renderHistory();
        });
    }

    /* ═══════════════════════════════════════ INSERT RESULT MODAL ═══════════════════════════════════════ */
    function showInsertResults(results, stagedRows) {
        const modal = document.getElementById('insert-result-modal');
        const icon = document.getElementById('insert-result-icon');
        const title = document.getElementById('insert-result-title');
        const msg = document.getElementById('insert-result-message');
        const details = document.getElementById('insert-result-details');
        const okBtn = document.getElementById('insert-result-ok');
        const homeBtn = document.getElementById('insert-result-home');

        const totalInserted = results.reduce((s, r) => s + (r.inserted || 0), 0);
        const totalErrors = results.reduce((s, r) => s + ((r.errors && r.errors.length) || 0), 0);
        const anyFailed = results.some(r => !r.httpOk || r.error);

        if (anyFailed) {
            icon.className = 'insert-result-icon error';
            icon.textContent = '✕';
            title.textContent = 'Failed — Rolled Back';
            const errorMsgs = results.filter(r => r.error).map(r => friendlyError(r.error));
            msg.textContent = 'No data was committed. All changes have been rolled back.';
        } else if (totalErrors > 0) {
            icon.className = 'insert-result-icon error';
            icon.textContent = '✕';
            title.textContent = 'Failed — Rolled Back';
            msg.textContent = `No data was committed. ${totalErrors} error(s) caused a full rollback.`;
        } else {
            icon.className = 'insert-result-icon success';
            icon.textContent = '✓';
            title.textContent = 'Insert Successful!';
            const stagedInfo = stagedRows ? ` (${stagedRows.toLocaleString()} rows staged from file)` : '';
            msg.textContent = `${totalInserted.toLocaleString()} row(s) inserted across ${results.length} table(s).${stagedInfo}`;
        }

        // Log to history
        const tableNames = results.map(r => r.table);
        const op = document.getElementById('operation-select')?.value || 'insert';
        addHistoryEntry({
            file: currentFile ? currentFile.name : 'Unknown',
            tables: tableNames,
            operation: op,
            rows: totalInserted,
            success: !anyFailed && totalErrors === 0,
            time: new Date().toLocaleTimeString(),
        });

        // Build details table
        let dHtml = '<table><thead><tr><th>Table</th><th>Inserted</th><th>Errors</th></tr></thead><tbody>';
        results.forEach(r => {
            const errCount = r.errors ? r.errors.length : (r.httpOk ? 0 : 1);
            dHtml += `<tr><td>${r.table}</td><td>${r.inserted || 0}</td><td>${errCount}</td></tr>`;
            if (r.errors) {
                r.errors.forEach(e => {
                    dHtml += `<tr><td></td><td colspan="2" style="color:var(--c-danger);font-size:.78rem">${escHtml(friendlyError(e.error))}</td></tr>`;
                });
            }
            if (r.error && !r.errors) {
                dHtml += `<tr><td></td><td colspan="2" style="color:var(--c-danger);font-size:.78rem">${escHtml(friendlyError(r.error))}</td></tr>`;
            }
        });
        dHtml += '</tbody></table>';
        details.innerHTML = dHtml;

        modal.classList.remove('hidden');
        const cleanup = () => modal.classList.add('hidden');
        okBtn.onclick = cleanup;
        // Start Over button — reset and go back to import page
        if (homeBtn) {
            homeBtn.onclick = () => {
                cleanup();
                goToImportPage();
            };
        }
    }

    function setBtnLoading(btn, loading) {
        if (loading) {
            btn._origHTML = btn.innerHTML;
            btn.classList.add('loading');
            btn.innerHTML = '<span class="btn-spinner"></span> Inserting…';
        } else {
            btn.classList.remove('loading');
            if (btn._origHTML) btn.innerHTML = btn._origHTML;
        }
    }

    /* ═══════════════════════════════════════ API: LOAD SCHEMA ═══════════════════════════════════════ */
    async function loadSchemaFromAPI() {
        const statusEl = document.getElementById('api-status');
        const statusText = statusEl ? statusEl.querySelector('.api-status-text') : null;
        const apiDot = document.querySelector('.api-dot');
        try {
            const headers = {};
            if (sessionId) headers['x-session-id'] = sessionId;
            const resp = await fetch(`${API_BASE}/api/schema`, { headers });
            if (!resp.ok) throw new Error('Schema fetch failed');
            const schema = await resp.json();
            if (Object.keys(schema).length > 0) {
                DB_SCHEMA = schema;
                apiConnected = true;
                populateTableDropdown();
                updateSettingsTablesPreview();
                updateConnectOverlay();
                if (statusEl) { statusEl.className = 'api-status connected'; }
                if (statusText) { statusText.textContent = 'Connected'; }
                if (apiDot) { apiDot.style.background = 'var(--c-success)'; }
                showToast('success', 'Database Connected', `Loaded ${Object.keys(schema).length} table(s).`);
                console.log('[API] Schema loaded:', Object.keys(schema));
            }
        } catch (err) {
            console.warn('[API] Could not load schema, using fallback:', err.message);
            apiConnected = false;
            updateConnectOverlay();
            if (statusEl) { statusEl.className = 'api-status disconnected'; }
            if (statusText) { statusText.textContent = 'Offline'; }
            if (apiDot) { apiDot.style.background = 'var(--c-danger)'; }
        }
    }

    /* ═══════════════════════════════════════ CONNECT-FIRST OVERLAY ═══════════════════════════════════════ */
    function updateConnectOverlay() {
        const overlay = $('connect-first-overlay');
        if (!overlay) return;
        // Dismiss overlay when DB schema is loaded (either via auto-connect or explicit session)
        if (apiConnected && Object.keys(DB_SCHEMA).length > 0) {
            overlay.classList.add('hidden');
        } else {
            overlay.classList.remove('hidden');
        }
    }

    // "Go to Settings" button inside the overlay
    const btnGoSettings = $('btn-go-settings');
    if (btnGoSettings) {
        btnGoSettings.addEventListener('click', () => {
            // Simulate clicking the Settings nav link
            const settingsLink = [...navLinks].find(l => l.textContent.trim() === 'Settings');
            if (settingsLink) settingsLink.click();
        });
    }

    function populateTableDropdown() {
        const sel = document.getElementById('db-table-select');
        if (!sel) return;
        const currentVal = sel.value;
        // Keep the placeholder
        sel.innerHTML = '<option value="" disabled selected>Select a table…</option>';
        Object.keys(DB_SCHEMA).forEach(tbl => {
            const opt = document.createElement('option');
            opt.value = tbl;
            opt.textContent = tbl;
            sel.appendChild(opt);
        });
        if (currentVal && DB_SCHEMA[currentVal]) sel.value = currentVal;
    }

    /* ═══════════════════════════════════════ SETTINGS: Tables Preview ═══════════════════════════════════════ */
    function updateSettingsTablesPreview() {
        const preview = $('db-tables-preview');
        const list = $('db-tables-list');
        if (!preview || !list) return;
        const tables = Object.keys(DB_SCHEMA);
        if (tables.length === 0) { preview.classList.add('hidden'); return; }
        preview.classList.remove('hidden');
        list.innerHTML = tables.map(t => {
            const colCount = DB_SCHEMA[t].columns ? DB_SCHEMA[t].columns.length : 0;
            return `<span class="db-table-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>${t} <small style="color:var(--c-text-light);">(${colCount} cols)</small></span>`;
        }).join('');
    }

    /* ═══════════════════════════════════════ SETTINGS: DB Connect ═══════════════════════════════════════ */
    const btnDbConnect = $('btn-db-connect');
    if (btnDbConnect) {
        btnDbConnect.addEventListener('click', async () => {
            const btn = btnDbConnect;
            const origHTML = btn.innerHTML;
            btn.innerHTML = '<div class="btn-spinner" style="width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;display:inline-block;"></div> Connecting…';
            btn.disabled = true;
            const statusSpan = $('db-connection-status');
            const badge = $('db-connection-badge');
            try {
                const creds = {
                    dialect: $('db-dialect').value,
                    host: $('db-host').value,
                    port: $('db-port').value,
                    username: $('db-user').value,
                    password: $('db-pass').value,
                    dbname: $('db-name').value
                };
                const resp = await fetch(`${API_BASE}/api/connect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(creds)
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.detail || 'Connection failed');

                sessionId = data.session_id;
                if (statusSpan) { statusSpan.textContent = '✓ Connected — ' + data.dialect; statusSpan.className = 'status-success'; }
                if (badge) { badge.textContent = '● Connected'; badge.className = 'badge connected'; }
                showToast('success', 'Database Connected', 'Loading schema…');
                await loadSchemaFromAPI();
            } catch (err) {
                if (statusSpan) { statusSpan.textContent = '✗ ' + friendlyError(err.message); statusSpan.className = 'status-fail'; }
                if (badge) { badge.textContent = 'Not Connected'; badge.className = ''; badge.style.cssText = 'background:#fef2f2; color:#991b1b; font-size:0.75rem; padding:4px 10px; border-radius:20px;'; }
                sessionId = null;
                showToast('error', 'Connection Error', friendlyError(err.message), 6000);
            } finally {
                btn.innerHTML = origHTML;
                btn.disabled = false;
            }
        });
    }

    /* ═══════════════════════════════════════ NAV: Page Switching ═══════════════════════════════════════ */
    const navLinks = document.querySelectorAll('.topbar-nav .nav-link');
    const importPage = $('migration-form');
    const settingsPage = $('settings-page');
    const historyPage = $('history-page');
    // All "pages" managed by nav
    const allPages = [
        { key: 'Import', el: importPage },
        { key: 'History', el: historyPage },
        { key: 'Settings', el: settingsPage },
    ];
    // Also hide non-import sections when switching
    const importRelatedSections = [validationSection, assignSection, outputSection];

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const label = link.textContent.trim();
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Hide everything first
            allPages.forEach(p => { if (p.el) p.el.classList.add('hidden'); });
            importRelatedSections.forEach(s => { if (s) s.classList.add('hidden'); });
            if (importPage) importPage.style.display = 'none';
            mainContent.style.display = 'none';

            if (label === 'Import') {
                mainContent.style.display = '';
                if (importPage) { importPage.classList.remove('hidden'); importPage.style.display = ''; }
            } else if (label === 'History') {
                mainContent.style.display = 'none';
                if (historyPage) historyPage.classList.remove('hidden');
                renderHistory();
            } else if (label === 'Settings') {
                mainContent.style.display = 'none';
                if (settingsPage) settingsPage.classList.remove('hidden');
            }
        });
    });

    /* ═══════════════════════════════════════ SETTINGS: Dialect Toggle ═══════════════════════════════════════ */
    const dialectSelect = $('db-dialect');
    if (dialectSelect) {
        dialectSelect.addEventListener('change', () => {
            const isSqlite = dialectSelect.value === 'sqlite';
            const hostRow = $('db-host-row');
            const credRow = $('db-cred-row');
            if (hostRow) hostRow.style.display = isSqlite ? 'none' : 'grid';
            if (credRow) credRow.style.display = isSqlite ? 'none' : 'grid';
        });
    }

    /* ═══════════════════════════════════════ INIT ═══════════════════════════════════════ */
    updateSteps(1); checkValidateReady();

    // Load schema from API on page load (uses default engine)
    loadSchemaFromAPI();

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
