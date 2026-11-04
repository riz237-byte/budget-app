/** Read-only bootstrap endpoint for budget-app. */
function doPost(e) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const expectedSecret = properties.getProperty('API_SECRET');
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
    if (!expectedSecret || !spreadsheetId) {
      return jsonResponse_({ ok: false, error: 'Backend configuration is incomplete.' });
    }
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!constantTimeEqual_(String(body.secret || ''), expectedSecret) || body.action !== 'bootstrap') {
      return jsonResponse_({ ok: false, error: 'Unauthorized.' });
    }

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
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
      const date = row.Data instanceof Date
        ? Utilities.formatDate(row.Data, timezone, 'yyyy-MM-dd')
        : String(row.Data || '').slice(0, 10);
      const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      const year = parts ? Number(parts[1]) : null;
      const month = parts ? Number(parts[2]) - 1 : null;
      return {
        data: date,
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
  return values.slice(1).filter(function (valuesRow) {
    return valuesRow.some(function (value) { return value !== '' && value !== null; });
  }).map(function (valuesRow) {
    const record = {};
    headers.forEach(function (header, index) {
      if (header) record[header] = valuesRow[index];
    });
    return record;
  });
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

