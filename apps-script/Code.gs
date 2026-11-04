/** Bootstrap plus explicit single-movement edits for budget-app. */
function doPost(e) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const expectedSecret = properties.getProperty('API_SECRET');
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    if (!expectedSecret || !spreadsheetId) {
      return jsonResponse_({ ok: false, error: 'Backend configuration is incomplete.' });
    }
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!constantTimeEqual_(String(body.secret || ''), expectedSecret)) {
      return jsonResponse_({ ok: false, error: 'Unauthorized.' });
    }

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    if (body.action === 'editMovement') {
      return jsonResponse_({ ok: true, id: editMovement_(spreadsheet, body) });
    }
    if (body.action !== 'bootstrap') return jsonResponse_({ ok: false, error: 'Unsupported action.' });

    const timezone = spreadsheet.getSpreadsheetTimeZone();
    return jsonResponse_({
      ok: true,
      movimenti: readTransactions_(spreadsheet, timezone),
      budgets: readBudgets_(spreadsheet),
      saldi: readBalances_(spreadsheet)
    });
  } catch (error) {
    return jsonResponse_({ ok: false, error: 'Unable to read the configured spreadsheet.' });
  }
}

function readTransactions_(spreadsheet, timezone) {
  return rows_(spreadsheet, 'Movimenti', ['Data', 'Tipo', 'Descrizione', 'Importo', 'Conto', 'Categoria'])
    .map(function (row) {
      const date = transactionDate_(row.Data, timezone);
      const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      if (!parts) throw new Error('A transaction date could not be parsed.');
      const year = parts ? Number(parts[1]) : null;
      const month = parts ? Number(parts[2]) - 1 : null;
      return {
        data: date,
        id: row.__row,
        timestamp: parts ? Date.UTC(year, month, Number(parts[3])) : 0,
        anno: year,
        mese: month,
        tipo: row.Tipo,
        descrizione: row.Descrizione,
        importo: row.Importo,
        conto: row.Conto,
        categoria: row.Categoria
      };
    });
}

function transactionDate_(value, timezone) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
  }
  const text = String(value || '').trim();
  let parts = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (parts) return parts[1] + '-' + pad2_(parts[2]) + '-' + pad2_(parts[3]);

  // Apps Script may stringify a date as "Tue May 20 2025 ...". Keep the year
  // while parsing instead of truncating the string to its first ten characters.
  parts = /^(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/.exec(text);
  if (parts) {
    const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    if (months[parts[1]]) return parts[3] + '-' + months[parts[1]] + '-' + pad2_(parts[2]);
  }
  return '';
}

function pad2_(value) {
  return ('0' + value).slice(-2);
}

function readBudgets_(spreadsheet) {
  return rows_(spreadsheet, 'BudgetMensili', ['Anno', 'Mese', 'Budget mensile'])
    .map(function (row) {
      return { anno: row.Anno, mese: row.Mese, budget: row['Budget mensile'] };
    });
}

function readBalances_(spreadsheet) {
  return rows_(spreadsheet, 'SaldiMensili', [
    'Anno', 'Mese', 'Conto iniziale', 'Contanti iniziali', 'Investimenti inizio mese',
    'Conto finale', 'Contanti finali', 'Investimenti fine mese'
  ]).map(function (row) {
    return {
      anno: row.Anno,
      mese: row.Mese,
      contoIniziale: row['Conto iniziale'],
      contantiIniziali: row['Contanti iniziali'],
      investimentiInizioMese: row['Investimenti inizio mese'],
      contoFinale: row['Conto finale'],
      contantiFinali: row['Contanti finali'],
      investimentiFinali: row['Investimenti fine mese']
    };
  });
}

function rows_(spreadsheet, sheetName, requiredHeaders) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('Required sheet is missing.');
  const values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error('Required sheet is empty.');
  const headers = values[0].map(function (value) { return String(value).trim(); });
  if (!requiredHeaders.every(function (header) { return headers.indexOf(header) !== -1; })) {
    throw new Error('Required columns are missing.');
  }
  return values.slice(1).map(function (valuesRow, index) {
    return { values: valuesRow, rowNumber: index + 2 };
  }).filter(function (entry) {
    return entry.values.some(function (value) { return value !== '' && value !== null; });
  }).map(function (entry) {
    const record = {};
    headers.forEach(function (header, index) {
      if (header) record[header] = entry.values[index];
    });
    record.__row = entry.rowNumber;
    return record;
  });
}

function editMovement_(spreadsheet, body) {
  const sheet = spreadsheet.getSheetByName('Movimenti');
  const rowNumber = Number(body.id);
  if (!sheet || !Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > sheet.getLastRow()) {
    throw new Error('Invalid movement row.');
  }
  const changes = body.changes || {};
  const date = transactionDate_(changes.data, spreadsheet.getSpreadsheetTimeZone());
  const amount = Number(changes.importo);
  const description = String(changes.descrizione || '').trim();
  const category = String(changes.categoria || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      ['Entrata', 'Uscita'].indexOf(changes.tipo) === -1 ||
      !Number.isFinite(amount) || amount < 0 ||
      !description || description.length > 250 ||
      !category || category.length > 80) {
    throw new Error('Invalid movement values.');
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (value) { return String(value).trim(); });
  const fields = {
    Data: Utilities.parseDate(date, spreadsheet.getSpreadsheetTimeZone(), 'yyyy-MM-dd'),
    Tipo: changes.tipo,
    Descrizione: description,
    Importo: amount,
    Categoria: category
  };
  Object.keys(fields).forEach(function (header) {
    const column = headers.indexOf(header);
    if (column === -1) throw new Error('Movement column is missing.');
    sheet.getRange(rowNumber, column + 1).setValue(fields[header]);
  });
  return rowNumber;
}

function constantTimeEqual_(left, right) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    difference |= (left.charCodeAt(index % (left.length || 1)) || 0) ^
      (right.charCodeAt(index % (right.length || 1)) || 0);
  }
  return difference === 0;
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

