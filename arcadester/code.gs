const SHEET_GAMES = 'games';
const SHEET_EXPENSES = 'expenses';
const SHEET_NOTES = 'notes';
const SHEET_USERS = 'user';

function getOptionalParam_(e, name) {
  if (!e || !e.parameter) return '';

  const target = String(name).toLowerCase();
  const keys = Object.keys(e.parameter);

  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i]).toLowerCase() === target) {
      return e.parameter[keys[i]];
    }
  }

  return '';
}

function doGet(e) {
  try {
    const resource = getParam_(e, 'resource');

    if (resource === 'games') {
      return jsonOut_({
        ok: true,
        data: getAllRows_(SHEET_GAMES)
      });
    }

    if (resource === 'game') {
      const id = getParam_(e, 'id');
      const game = findRowByKey_(SHEET_GAMES, 'ID', id);
      const expenses = getRowsByMatch_(SHEET_EXPENSES, 'gameID', id);
      const notes = getRowsByMatch_(SHEET_NOTES, 'gameID', id);

      return jsonOut_({
        ok: true,
        data: {
          game: game,
          expenses: expenses,
          notes: notes,
          totalExpenses: sumBy_(expenses, 'amount'),
          totalCost: num_(game ? game.purchasePrice : 0) + sumBy_(expenses, 'amount')
        }
      });
    }

    if (resource === 'expenses') {
      const gameID = getOptionalParam_(e, 'gameID');
      const all = getAllRows_(SHEET_EXPENSES);
      const data = gameID
        ? getRowsByMatch_(SHEET_EXPENSES, 'gameID', gameID)
        : all;

      return jsonOut_({
        ok: true,
        debug: {
          params: e && e.parameter ? e.parameter : {},
          gameID_param: gameID,
          total_rows: all.length,
          matched_count: data.length
        },
        data: data
      });
    }

    if (resource === 'notes') {
      const gameID = getOptionalParam_(e, 'gameID');
      const data = gameID
        ? getRowsByMatch_(SHEET_NOTES, 'gameID', gameID)
        : getAllRows_(SHEET_NOTES);

      return jsonOut_({
        ok: true,
        data: data
      });
    }

    if (resource === 'users') {
      return jsonOut_({
        ok: true,
        data: getAllRows_(SHEET_USERS)
      });
    }

    return jsonOut_({
      ok: false,
      error: 'Unknown resource'
    });

  } catch (err) {
    return jsonOut_({
      ok: false,
      error: err.message
    });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action;
    const data = body.data || {};

    if (action === 'createGame') {
      const row = appendRowObject_(SHEET_GAMES, {
        ID: data.ID || makeId_('game'),
        title: data.title || '',
        location: data.location || '',
        condition: data.condition || '',
        purchaseDate: data.purchaseDate || '',
        pgID: data.pgID || '',
        photo: data.photo || '',
        notes: data.notes || '',
        purchasePrice: data.purchasePrice || '',
        purchaseFrom: data.purchaseFrom || '',
        soldDate: data.soldDate || '',
        soldPrice: data.soldPrice || '',
        soldTo: data.soldTo || ''
      });

      return jsonOut_({
        ok: true,
        data: row
      });
    }

    if (action === 'updateGame') {
      requireField_(data, 'ID');
      const row = updateRowByKey_(SHEET_GAMES, 'ID', data.ID, data);

      return jsonOut_({
        ok: true,
        data: row
      });
    }

    if (action === 'deleteGame') {
      requireField_(data, 'ID');
      deleteRowByKey_(SHEET_GAMES, 'ID', data.ID);

      return jsonOut_({
        ok: true
      });
    }

    if (action === 'createExpense') {
      requireField_(data, 'gameID');

      const row = appendRowObject_(SHEET_EXPENSES, {
        expenseID: data.expenseID || makeId_('exp'),
        gameID: data.gameID,
        date: data.date || '',
        category: data.category || '',
        vendor: data.vendor || '',
        description: data.description || '',
        amount: data.amount || '',
        note: data.note || ''
      });

      return jsonOut_({
        ok: true,
        data: row
      });
    }

    if (action === 'updateExpense') {
      requireField_(data, 'expenseID');
      const row = updateRowByKey_(SHEET_EXPENSES, 'expenseID', data.expenseID, data);

      return jsonOut_({
        ok: true,
        data: row
      });
    }

    if (action === 'deleteExpense') {
      requireField_(data, 'expenseID');
      deleteRowByKey_(SHEET_EXPENSES, 'expenseID', data.expenseID);

      return jsonOut_({
        ok: true
      });
    }

    if (action === 'createNote') {
      requireField_(data, 'gameID');

      const row = appendRowObject_(SHEET_NOTES, {
        noteID: data.noteID || makeId_('note'),
        gameID: data.gameID,
        date: data.date || '',
        category: data.category || '',
        note: data.note || ''
      });

      return jsonOut_({
        ok: true,
        data: row
      });
    }

    if (action === 'updateNote') {
      requireField_(data, 'noteID');
      const row = updateRowByKey_(SHEET_NOTES, 'noteID', data.noteID, data);

      return jsonOut_({
        ok: true,
        data: row
      });
    }

    if (action === 'deleteNote') {
      requireField_(data, 'noteID');
      deleteRowByKey_(SHEET_NOTES, 'noteID', data.noteID);

      return jsonOut_({
        ok: true
      });
    }

    return jsonOut_({
      ok: false,
      error: 'Unknown action'
    });

  } catch (err) {
    return jsonOut_({
      ok: false,
      error: err.message
    });
  }
}

function getAllRows_(sheetName) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();

  if (values.length < 1) {
    return [];
  }

  const headers = values[0];
  const rows = values.slice(1).filter(function (row) {
    return row.some(function (cell) {
      return cell !== '';
    });
  });

  return rows.map(function (row) {
    return rowToObject_(headers, row);
  });
}

function getRowsByMatch_(sheetName, key, value) {
  return getAllRows_(sheetName).filter(function (row) {
    return String(row[key]) === String(value);
  });
}

function findRowByKey_(sheetName, key, value) {
  const rows = getAllRows_(sheetName);

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][key]) === String(value)) {
      return rows[i];
    }
  }

  return null;
}

function appendRowObject_(sheetName, obj) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  const row = headers.map(function (header) {
    return obj[header] !== undefined ? obj[header] : '';
  });

  sheet.appendRow(row);
  return rowToObject_(headers, row);
}

function updateRowByKey_(sheetName, key, value, updates) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    throw new Error('No data rows found in sheet: ' + sheetName);
  }

  const headers = values[0];

  for (var i = 1; i < values.length; i++) {
    const obj = rowToObject_(headers, values[i]);

    if (String(obj[key]) === String(value)) {
      const merged = Object.assign({}, obj, updates);
      const newRow = headers.map(function (header) {
        return merged[header] !== undefined ? merged[header] : '';
      });

      sheet.getRange(i + 1, 1, 1, headers.length).setValues([newRow]);
      return rowToObject_(headers, newRow);
    }
  }

  throw new Error(sheetName + ': row not found for ' + key + '=' + value);
}

function deleteRowByKey_(sheetName, key, value) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    throw new Error('No data rows found in sheet: ' + sheetName);
  }

  const headers = values[0];

  for (var i = 1; i < values.length; i++) {
    const obj = rowToObject_(headers, values[i]);

    if (String(obj[key]) === String(value)) {
      sheet.deleteRow(i + 1);
      return;
    }
  }

  throw new Error(sheetName + ': row not found for ' + key + '=' + value);
}

function getSheet_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Missing sheet: ' + sheetName);
  }
  return sheet;
}

function getHeaders_(sheet) {
  if (sheet.getLastColumn() === 0) {
    throw new Error('Sheet has no headers: ' + sheet.getName());
  }

  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach(function (header, i) {
    obj[header] = row[i];
  });
  return obj;
}

function getParam_(e, name) {
  const value = e && e.parameter ? e.parameter[name] : '';
  if (value === undefined || value === null || value === '') {
    throw new Error('Missing parameter: ' + name);
  }
  return value;
}

function requireField_(obj, fieldName) {
  if (obj[fieldName] === undefined || obj[fieldName] === null || obj[fieldName] === '') {
    throw new Error('Missing field: ' + fieldName);
  }
}

function sumBy_(rows, fieldName) {
  return rows.reduce(function (sum, row) {
    return sum + num_(row[fieldName]);
  }, 0);
}

function num_(value) {
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

function makeId_(prefix) {
  return prefix + '_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000);
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}