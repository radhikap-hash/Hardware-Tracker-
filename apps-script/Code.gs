/**
 * PCB Tracker — Apps Script backend
 * Bound to the PCB_Tracker_Completed_and_Active spreadsheet.
 *
 * Reads the COMPLETED and ACTIVE sheets, serves a live dashboard, and writes
 * board updates back. A board is routed to the right sheet automatically:
 * the sheet's own Overall Status formula decides, so there is one source of truth.
 */

const SH_DONE   = 'COMPLETED';
const SH_ACTIVE = 'ACTIVE';
const SH_LISTS  = 'LISTS';

const STAGES = [
  { key: 'S1', short: 'Schematic', full: 'S1 Schematic' },
  { key: 'S2', short: 'BOM',       full: 'S2 BOM Procurement' },
  { key: 'S3', short: 'Layout',    full: 'S3 PCB Layout' },
  { key: 'S4', short: 'SI & PI',   full: 'S4 SI & PI' },
  { key: 'S5', short: 'Fab',       full: 'S5 Bare-PCB Fab' },
  { key: 'S6', short: 'Assembly',  full: 'S6 Assembly' },
  { key: 'S7', short: 'Bring-up',  full: 'S7 Bring-up' }
];

const STATUSES = ['Completed', 'In Progress', 'On Hold', 'Not Started', 'NA', 'Cancelled'];

/* ------------------------------------------------------------------ menu */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('PCB Tracker')
    .addItem('Add or edit a board', 'openBoardForm')
    .addItem('Open dashboard', 'openDashboardDialog')
    .addSeparator()
    .addItem('Re-check every board', 'recheckAll')
    .addToUi();
}

function openBoardForm() {
  const html = HtmlService.createTemplateFromFile('BoardForm')
    .evaluate().setWidth(760).setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Board details');
}

function openDashboardDialog() {
  const html = HtmlService.createTemplateFromFile('Dashboard')
    .evaluate().setWidth(1400).setHeight(880);
  SpreadsheetApp.getUi().showModalDialog(html, 'PCB Tracker');
}

/* ------------------------------------------------------- web app + includes */

function doGet() {
  return HtmlService.createTemplateFromFile('Dashboard')
    .evaluate()
    .setTitle('PCB Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* --------------------------------------------------------- sheet geometry */

/**
 * Finds the header row and every column we care about by reading the sheet
 * itself, so inserting or moving a column does not break the script.
 */
function layout_(sheet) {
  const cache = layout_._c || (layout_._c = {});
  const key = sheet.getSheetName();
  if (cache[key]) return cache[key];

  const scan = sheet.getRange(1, 1, Math.min(30, sheet.getMaxRows()), sheet.getMaxColumns()).getValues();
  let headerRow = -1;
  for (let r = 0; r < scan.length; r++) {
    if (scan[r].some(v => String(v).trim() === 'Project / Board')) { headerRow = r + 1; break; }
  }
  if (headerRow < 0) throw new Error('Could not find the header row on ' + key + '. Look for a cell reading "Project / Board".');

  const head  = scan[headerRow - 1].map(v => String(v).trim());
  const group = scan[headerRow - 2].map(v => String(v).trim());

  const col = {};
  const byName = n => { const i = head.indexOf(n); return i < 0 ? 0 : i + 1; };
  col.customer = byName('Customer');
  col.project  = byName('Project / Board');
  col.manager  = byName('Project Manager');
  col.current  = byName('Current Stage');
  col.overall  = byName('Overall Status');
  col.delay    = byName('Delay (days)');
  col.pct      = byName('% Through Process');
  col.comment  = byName('Latest Comment');
  col.notes    = byName('Notes / Data Check');
  col.respin   = byName('Respin Needed?');
  col.reentry  = byName('Re-entry Stage') || byName('Re-entered At');
  col.reason   = byName('Respin Reason');
  col.raised   = byName('Raised On');
  col.rev      = byName('Rev / Respin No.');
  col.action   = byName('ACTION');

  // Stage blocks are located from the merged group header above the field row.
  col.stage = {};
  STAGES.forEach(function (s) {
    let start = -1;
    for (let i = 0; i < group.length; i++) {
      if (group[i] && group[i].toUpperCase().indexOf(s.full.toUpperCase()) === 0) { start = i + 1; break; }
    }
    if (start < 0) throw new Error('Could not find the "' + s.full + '" block on ' + key + '.');
    col.stage[s.key] = { owner: start, status: start + 1, target: start + 2 };
  });

  const out = { headerRow: headerRow, firstRow: headerRow + 1, col: col, nCol: head.length };
  cache[key] = out;
  return out;
}

function lastDataRow_(sheet, L) {
  const n = sheet.getLastRow();
  if (n < L.firstRow) return L.firstRow - 1;
  const vals = sheet.getRange(L.firstRow, L.col.project, n - L.firstRow + 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]).trim()) return L.firstRow + i;
  return L.firstRow - 1;
}

function findRow_(sheet, L, project) {
  const last = lastDataRow_(sheet, L);
  if (last < L.firstRow) return -1;
  const vals = sheet.getRange(L.firstRow, L.col.project, last - L.firstRow + 1, 1).getValues();
  const want = String(project).trim().toLowerCase();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim().toLowerCase() === want) return L.firstRow + i;
  }
  return -1;
}

function iso_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v);
}

/* ------------------------------------------------------------------- read */

function getBoards() {
  const ss = SpreadsheetApp.getActive();
  const out = [];
  [SH_DONE, SH_ACTIVE].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('Sheet "' + name + '" is missing.');
    const L = layout_(sheet);
    const last = lastDataRow_(sheet, L);
    if (last < L.firstRow) return;
    const vals = sheet.getRange(L.firstRow, 1, last - L.firstRow + 1, L.nCol).getValues();
    const c = L.col;
    vals.forEach(function (row, i) {
      const project = String(row[c.project - 1] || '').trim();
      if (!project) return;
      const b = {
        sheet: name,
        row: L.firstRow + i,
        project: project,
        customer: String(row[c.customer - 1] || 'Not set').trim(),
        manager: String(row[c.manager - 1] || '').trim(),
        current: String(row[c.current - 1] || '').trim(),
        overall: String(row[c.overall - 1] || '').trim(),
        delay: row[c.delay - 1],
        pct: row[c.pct - 1],
        comment: String(row[c.comment - 1] || '').trim(),
        notes: String(row[c.notes - 1] || '').trim(),
        respin: c.respin ? String(row[c.respin - 1] || 'No').trim() : 'No',
        reentry: c.reentry ? String(row[c.reentry - 1] || '').trim() : '',
        reason: c.reason ? String(row[c.reason - 1] || '').trim() : '',
        raised: c.raised ? iso_(row[c.raised - 1]) : '',
        rev: c.rev ? row[c.rev - 1] : '',
        stages: {}
      };
      STAGES.forEach(function (s) {
        const sc = c.stage[s.key];
        b.stages[s.key] = {
          owner: String(row[sc.owner - 1] || '').trim(),
          status: String(row[sc.status - 1] || '').trim(),
          target: iso_(row[sc.target - 1])
        };
      });
      out.push(b);
    });
  });
  return { boards: out, lists: getLists(), fetched: new Date().toISOString() };
}

function getLists() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SH_LISTS);
  const col = n => {
    if (!sheet) return [];
    const v = sheet.getRange(2, n, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
    return v.map(r => String(r[0]).trim()).filter(String);
  };
  return {
    statuses: col(1).length ? col(1) : STATUSES,
    stages: STAGES.map(s => s.full),
    reasons: col(3),
    customers: col(5)
  };
}

/* ------------------------------------------------------------------ write */

/**
 * Creates or updates one board, then puts it on whichever sheet its
 * Overall Status says it belongs on.
 * payload: { project, customer, manager, comment, notes, stages:{S1:{owner,status,target}...},
 *            respin, reentry, reason, raised, rev, originalProject }
 */
function saveBoard(payload) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    const done = ss.getSheetByName(SH_DONE);
    const active = ss.getSheetByName(SH_ACTIVE);
    const lookFor = payload.originalProject || payload.project;

    let sheet = done, row = findRow_(done, layout_(done), lookFor);
    if (row < 0) { sheet = active; row = findRow_(active, layout_(active), lookFor); }
    if (row < 0) { sheet = active; row = appendTemplateRow_(active); }

    writeRow_(sheet, row, payload);
    SpreadsheetApp.flush();

    const moved = rerouteRow_(sheet, row);
    SpreadsheetApp.flush();
    return { ok: true, project: payload.project, sheet: moved.sheet, moved: moved.moved };
  } finally {
    lock.releaseLock();
  }
}

function writeRow_(sheet, row, p) {
  const L = layout_(sheet), c = L.col;
  const set = (col, val) => { if (col) sheet.getRange(row, col).setValue(val); };
  set(c.project, p.project);
  set(c.customer, p.customer || 'Not set');
  set(c.manager, p.manager || '');
  set(c.comment, p.comment || '');
  set(c.notes, p.notes || '');
  STAGES.forEach(function (s) {
    const sc = c.stage[s.key], v = (p.stages && p.stages[s.key]) || {};
    sheet.getRange(row, sc.owner).setValue(v.owner || '');
    sheet.getRange(row, sc.status).setValue(v.status || 'NA');
    sheet.getRange(row, sc.target).setValue(v.target ? new Date(v.target + 'T00:00:00') : '');
  });
  if (sheet.getSheetName() === SH_DONE) {
    set(c.respin, p.respin || 'No');
    set(c.reentry, p.reentry || '');
    set(c.reason, p.reason || '');
    set(c.raised, p.raised ? new Date(p.raised + 'T00:00:00') : '');
  } else {
    set(c.rev, p.rev || '');
    set(c.reentry, p.reentry || '');
    set(c.reason, p.reason || '');
    set(c.raised, p.raised ? new Date(p.raised + 'T00:00:00') : '');
  }
}

/** Adds a row at the bottom of a sheet, cloned from the last row so it keeps
 *  the formulas, dropdowns, colour rules and number formats. */
function appendTemplateRow_(sheet) {
  const L = layout_(sheet);
  const last = lastDataRow_(sheet, L);
  const template = last >= L.firstRow ? last : L.firstRow;
  const newRow = template + 1;
  sheet.insertRowAfter(template);
  sheet.getRange(template, 1, 1, L.nCol).copyTo(sheet.getRange(newRow, 1, 1, L.nCol));
  // clear the cloned values but keep the formulas in the roll-up block
  const c = L.col;
  [c.project, c.customer, c.manager, c.comment, c.notes, c.respin, c.reentry, c.reason, c.raised, c.rev]
    .forEach(col => { if (col) sheet.getRange(newRow, col).clearContent(); });
  STAGES.forEach(function (s) {
    const sc = c.stage[s.key];
    sheet.getRange(newRow, sc.owner).clearContent();
    sheet.getRange(newRow, sc.target).clearContent();
    sheet.getRange(newRow, sc.status).setValue('NA');
  });
  sheet.getRange(newRow, 1).setValue(newRow - L.firstRow + 1);
  return newRow;
}

/** Moves a row to the sheet its Overall Status calls for. Returns where it ended up. */
function rerouteRow_(sheet, row) {
  const ss = SpreadsheetApp.getActive();
  const L = layout_(sheet);
  const overall = String(sheet.getRange(row, L.col.overall).getValue()).trim();
  const belongs = (overall === 'Completed' || overall === 'Cancelled') ? SH_DONE : SH_ACTIVE;
  if (belongs === sheet.getSheetName()) return { sheet: belongs, moved: false };

  const target = ss.getSheetByName(belongs);
  const TL = layout_(target);
  const newRow = appendTemplateRow_(target);

  const c = L.col, tc = TL.col;
  const copy = (from, to) => { if (from && to) target.getRange(newRow, to).setValue(sheet.getRange(row, from).getValue()); };
  copy(c.project, tc.project); copy(c.customer, tc.customer); copy(c.manager, tc.manager);
  copy(c.comment, tc.comment); copy(c.notes, tc.notes);
  copy(c.reason, tc.reason); copy(c.raised, tc.raised);
  STAGES.forEach(function (s) {
    const a = c.stage[s.key], b = tc.stage[s.key];
    target.getRange(newRow, b.owner).setValue(sheet.getRange(row, a.owner).getValue());
    target.getRange(newRow, b.status).setValue(sheet.getRange(row, a.status).getValue());
    target.getRange(newRow, b.target).setValue(sheet.getRange(row, a.target).getValue());
  });
  if (belongs === SH_ACTIVE) {
    const prev = c.rev ? sheet.getRange(row, c.rev).getValue() : '';
    const reentry = c.reentry ? sheet.getRange(row, c.reentry).getValue() : '';
    if (tc.rev) target.getRange(newRow, tc.rev).setValue(Number(prev || 0) + 1);
    if (tc.reentry) target.getRange(newRow, tc.reentry).setValue(reentry);
  } else if (tc.respin) {
    target.getRange(newRow, tc.respin).setValue('No');
  }
  sheet.deleteRow(row);
  layout_._c = {};
  renumber_(target);
  renumber_(sheet);
  return { sheet: belongs, moved: true };
}

function renumber_(sheet) {
  const L = layout_(sheet);
  const last = lastDataRow_(sheet, L);
  if (last < L.firstRow) return;
  const n = last - L.firstRow + 1;
  sheet.getRange(L.firstRow, 1, n, 1).setValues(Array.from({ length: n }, (_, i) => [i + 1]));
}

/**
 * Sends a completed board back into the workflow. Resets the re-entry stage
 * and everything after it, then moves the row to ACTIVE.
 */
function respinBoard(req) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    const done = ss.getSheetByName(SH_DONE);
    const L = layout_(done);
    const row = findRow_(done, L, req.project);
    if (row < 0) throw new Error(req.project + ' is not on the COMPLETED sheet.');
    if (!req.reentry) throw new Error('Pick the stage the board re-enters at.');

    const from = STAGES.findIndex(s => s.full === req.reentry);
    if (from < 0) throw new Error('Unknown stage: ' + req.reentry);

    STAGES.forEach(function (s, i) {
      if (i < from) return;
      const sc = L.col.stage[s.key];
      const cur = String(done.getRange(row, sc.status).getValue()).trim();
      if (cur === 'NA') return;                       // stage does not apply to this board
      done.getRange(row, sc.status).setValue(i === from ? 'In Progress' : 'Not Started');
      done.getRange(row, sc.target).clearContent();
    });
    if (L.col.respin)  done.getRange(row, L.col.respin).setValue('Yes');
    if (L.col.reentry) done.getRange(row, L.col.reentry).setValue(req.reentry);
    if (L.col.reason)  done.getRange(row, L.col.reason).setValue(req.reason || '');
    if (L.col.raised)  done.getRange(row, L.col.raised).setValue(req.raised ? new Date(req.raised + 'T00:00:00') : new Date());
    if (req.comment)   done.getRange(row, L.col.comment).setValue(req.comment);
    SpreadsheetApp.flush();

    const moved = rerouteRow_(done, row);
    SpreadsheetApp.flush();
    return { ok: true, project: req.project, sheet: moved.sheet };
  } finally {
    lock.releaseLock();
  }
}

/** Sweeps both sheets and moves anything sitting on the wrong one. */
function recheckAll() {
  const ss = SpreadsheetApp.getActive();
  let moved = 0;
  [SH_DONE, SH_ACTIVE].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    const L = layout_(sheet);
    for (let row = lastDataRow_(sheet, L); row >= L.firstRow; row--) {
      if (!String(sheet.getRange(row, L.col.project).getValue()).trim()) continue;
      if (rerouteRow_(sheet, row).moved) moved++;
    }
  });
  SpreadsheetApp.getUi().alert(moved
    ? moved + ' board(s) moved to the sheet their stage entries call for.'
    : 'Every board is already on the right sheet.');
}
