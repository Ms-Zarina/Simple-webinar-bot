const SHEET_NAME = 'Telegram Webinar Bot';

// 1-based index of "Telegram ID" inside HEADERS. Used as the upsert key.
const TELEGRAM_ID_COLUMN = 4;
// 0-based indices needing special merge handling.
const DATE_INDEX = 0;        // always set to "now" on every write
const CREATED_AT_INDEX = 12; // never overwritten once a row exists

const HEADERS = [
  'Date',
  'Source',
  'Event',
  'Telegram ID',
  'Telegram Username',
  'First Name',
  'Last Name',
  'Goal',
  'Level',
  'Stage',
  'Webinar Title',
  'Webinar Date',
  'Created At',
  'Updated At',
  'Zoom Registrant ID',
  'Zoom Join URL',
  'Zoom Attendance Status',
  'Zoom Join Time',
  'Zoom Leave Time',
  'Zoom Duration Minutes',
  'Follow Up Segment',
  'Follow Up Sent At'
];

function doPost(e) {
  // Serialize concurrent webhook calls. The bot fires several syncs in quick
  // succession (start, goal, level, zoom registration), so without a lock the
  // read-merge-write upsert could race and create duplicates or lose updates.
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(30000);

    const payload = parsePayload_(e);
    const sheet = getTargetSheet_();
    ensureHeaders_(sheet);

    const incoming = buildRowFromPayload_(payload);
    const telegramId = String(payload.telegramId || '');
    const existingRowNum = telegramId ? findRowByTelegramId_(sheet, telegramId) : -1;

    let action;
    if (existingRowNum > 0) {
      const existing = sheet.getRange(existingRowNum, 1, 1, HEADERS.length).getValues()[0];
      const merged = mergeRow_(existing, incoming);
      sheet.getRange(existingRowNum, 1, 1, HEADERS.length).setValues([merged]);
      action = 'updated';
    } else {
      sheet.appendRow(incoming);
      action = 'appended';
    }

    // Echo what happened so callers can verify without reading the sheet.
    return jsonResponse_({
      ok: true,
      action: action,
      telegramId: telegramId,
      writtenColumns: HEADERS.length,
      headerColumns: sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].filter(String).length
    });
  } catch (error) {
    console.error('[telegram-webinar-bot] Apps Script error:', error);
    return jsonResponse_({ ok: false, error: String(error) });
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

// Builds the full 22-cell row for a payload. Absent fields become ''. Column 1
// (Date) is always the current time.
function buildRowFromPayload_(payload) {
  return [
    new Date(),
    payload.source || '',
    payload.event || '',
    payload.telegramId || '',
    payload.telegramUsername || '',
    payload.firstName || '',
    payload.lastName || '',
    payload.goal || '',
    payload.level || '',
    payload.stage || '',
    payload.webinarTitle || '',
    payload.webinarDate || '',
    payload.createdAt || '',
    payload.updatedAt || '',
    payload.zoomRegistrantId || '',
    payload.zoomJoinUrl || '',
    payload.zoomAttendanceStatus || '',
    payload.zoomJoinTime || '',
    payload.zoomLeaveTime || '',
    payload.zoomDurationMinutes === undefined || payload.zoomDurationMinutes === null ? '' : payload.zoomDurationMinutes,
    payload.followUpSegment || '',
    payload.followUpSentAt || ''
  ];
}

// Merges incoming values over an existing row WITHOUT clearing fields the
// current event does not carry. This is what keeps the Zoom columns (O-V)
// intact when a later, Zoom-less event (e.g. a funnel update) arrives, and
// vice-versa. Rules:
//   - Date (col 1): always refreshed to the incoming "now".
//   - Created At (col 13): preserved once the row exists.
//   - every other column: take the incoming value only if it is non-empty,
//     otherwise keep what is already there. (0 counts as a real value, so
//     Zoom Duration Minutes = 0 is written.)
function mergeRow_(existing, incoming) {
  const merged = existing.slice();

  for (let i = 0; i < HEADERS.length; i++) {
    if (i === DATE_INDEX) {
      merged[i] = incoming[i];
      continue;
    }
    if (i === CREATED_AT_INDEX) {
      merged[i] = isEmpty_(existing[i]) ? incoming[i] : existing[i];
      continue;
    }
    merged[i] = isEmpty_(incoming[i]) ? existing[i] : incoming[i];
  }

  return merged;
}

function isEmpty_(value) {
  return value === '' || value === null || value === undefined;
}

// Returns the 1-based row number whose Telegram ID matches, or -1. Matches the
// first occurrence (older duplicate rows, if any, are left untouched).
function findRowByTelegramId_(sheet, telegramId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const ids = sheet.getRange(2, TELEGRAM_ID_COLUMN, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(telegramId)) {
      return i + 2;
    }
  }
  return -1;
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Missing POST body');
  }

  return JSON.parse(e.postData.contents);
}

function getTargetSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  return sheet;
}

function ensureHeaders_(sheet) {
  // Make sure the sheet physically has at least HEADERS.length columns. A sheet
  // trimmed to exactly 14 columns would otherwise make getRange/setValues throw.
  if (sheet.getMaxColumns() < HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  }

  const existingHeaders = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  // Repairs the header row idempotently. This also migrates older sheets that
  // only had the original 14 columns up to the full Zoom-aware header set,
  // without touching any existing data rows.
  const matches = HEADERS.every((header, index) => existingHeaders[index] === header);

  if (!matches) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
}

// Run this MANUALLY from the Apps Script editor (Run -> forceHeaderMigration)
// to set the 22-column header row immediately, using the latest SAVED code.
// This bypasses web-app deployment/versioning, so it works even if the /exec
// URL is still serving an older deployed version. Existing data rows are left
// untouched. Returns a short status string visible in the execution log.
function forceHeaderMigration() {
  const sheet = getTargetSheet_();

  if (sheet.getMaxColumns() < HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  }

  const before = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0].filter(String).length;
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);

  const message = `Header row set to ${HEADERS.length} columns (was ${before}).`;
  console.log('[telegram-webinar-bot] ' + message);
  return message;
}

// ONE-TIME CLEANUP — run MANUALLY from the Apps Script editor
// (Run -> dedupeByTelegramId) AFTER migrating to the upsert version. This is NOT
// called from doPost. It collapses legacy duplicate rows created by the old
// append-only behavior into a single row per Telegram ID. Safe to re-run.
//
// For each Telegram ID with more than one row it keeps the "most complete" row
// (most non-empty cells; ties broken by the latest/lowest row), fills that row's
// empty cells with non-empty values from the duplicates (never overwriting an
// existing value), then deletes the leftover duplicate rows. Rows whose Telegram
// ID is empty are never grouped and never deleted. The 22 headers are preserved.
function dedupeByTelegramId() {
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(30000);

    const sheet = getTargetSheet_();
    ensureHeaders_(sheet);

    const lastRow = sheet.getLastRow();
    if (lastRow < 3) {
      const msg = 'Nothing to dedupe (fewer than 2 data rows).';
      console.log('[telegram-webinar-bot] ' + msg);
      return msg;
    }

    const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();

    // Group physical row numbers by Telegram ID. Skip empty IDs entirely.
    const groups = {};
    for (let i = 0; i < data.length; i++) {
      const telegramId = String(data[i][TELEGRAM_ID_COLUMN - 1] || '').trim();
      if (!telegramId) continue; // never touch rows without a Telegram ID
      const rowNumber = i + 2;
      if (!groups[telegramId]) groups[telegramId] = [];
      groups[telegramId].push(rowNumber);
    }

    const rowsToDelete = [];
    let groupsDeduped = 0;

    Object.keys(groups).forEach((telegramId) => {
      const rowNumbers = groups[telegramId];
      if (rowNumbers.length < 2) return;

      // Pick the kept row: most non-empty cells, ties broken by latest row.
      let keptRow = rowNumbers[0];
      let keptScore = countNonEmpty_(data[keptRow - 2]);
      for (let k = 1; k < rowNumbers.length; k++) {
        const candidateRow = rowNumbers[k];
        const score = countNonEmpty_(data[candidateRow - 2]);
        if (score > keptScore || (score === keptScore && candidateRow > keptRow)) {
          keptRow = candidateRow;
          keptScore = score;
        }
      }

      // Fill only the kept row's empty cells from duplicates (latest first), so
      // an existing value is never overwritten.
      const keptValues = data[keptRow - 2].slice();
      const others = rowNumbers.filter((r) => r !== keptRow).sort((a, b) => b - a);
      for (let c = 0; c < HEADERS.length; c++) {
        if (!isEmpty_(keptValues[c])) continue;
        for (let o = 0; o < others.length; o++) {
          const candidate = data[others[o] - 2][c];
          if (!isEmpty_(candidate)) {
            keptValues[c] = candidate;
            break;
          }
        }
      }

      // Write the merged values back before any deletion (indices still valid).
      sheet.getRange(keptRow, 1, 1, HEADERS.length).setValues([keptValues]);

      others.forEach((r) => rowsToDelete.push(r));
      groupsDeduped++;
      console.log(`[telegram-webinar-bot] dedupe telegramId=${telegramId} keptRow=${keptRow} deletedRows=${others.length}`);
    });

    // Delete duplicate rows bottom-up so earlier row numbers stay valid.
    rowsToDelete.sort((a, b) => b - a).forEach((r) => sheet.deleteRow(r));

    const message = `Dedupe complete: ${groupsDeduped} Telegram ID(s) deduped, ${rowsToDelete.length} duplicate row(s) deleted.`;
    console.log('[telegram-webinar-bot] ' + message);
    return message;
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

function countNonEmpty_(rowValues) {
  let count = 0;
  for (let i = 0; i < rowValues.length; i++) {
    if (!isEmpty_(rowValues[i])) count++;
  }
  return count;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
