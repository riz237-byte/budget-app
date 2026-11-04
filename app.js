const API_BASE = (window.BUDGET_API_URL || '').replace(/\/$/, '');
const $ = (id) => document.getElementById(id);
const euro = (value) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);
const maybeEuro = (value) => value == null ? '—' : euro(value);
const monthNames = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const now = new Date();
let year = now.getFullYear();
let month = now.getMonth();

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function monthKey(item) {
  const itemYear = numberOrNull(item.anno);
  const itemMonth = numberOrNull(item.mese);
  return itemYear === null || itemMonth === null ? null : itemYear * 12 + itemMonth;
}

function balanceForPeriod(saldi) {
  const requestedKey = year * 12 + month + 1;
  return (saldi || [])
    .filter((item) => monthKey(item) !== null && monthKey(item) <= requestedKey)
    .sort((a, b) => monthKey(b) - monthKey(a))[0] || null;
}

function totalBalance(balance) {
  if (!balance) return null;
  const parts = [balance.contoFinale, balance.contantiFinali, balance.investimentiFinali].map(numberOrNull);
  return parts.every((value) => value !== null) ? parts.reduce((sum, value) => sum + value, 0) : null;
}

function renderWealth(saldi) {
  const balance = balanceForPeriod(saldi);
  $('balance-period').textContent = balance
    ? `Ultimo saldo: ${monthNames[Number(balance.mese) - 1]} ${balance.anno}`
    : 'Nessun saldo registrato';
  $('total-balance').textContent = maybeEuro(totalBalance(balance));
  $('account-balance').textContent = maybeEuro(balance ? numberOrNull(balance.contoFinale) : null);
  $('cash-balance').textContent = maybeEuro(balance ? numberOrNull(balance.contantiFinali) : null);
  $('investment-balance').textContent = maybeEuro(balance ? numberOrNull(balance.investimentiFinali) : null);

  const opening = balance ? numberOrNull(balance.investimentiInizioMese) : null;
  const closing = balance ? numberOrNull(balance.investimentiFinali) : null;
  $('investment-opening').textContent = maybeEuro(opening);
  $('investment-closing').textContent = maybeEuro(closing);
  const change = opening !== null && closing !== null ? closing - opening : null;
  $('investment-change').textContent = maybeEuro(change);
  $('investment-change').className = change === null ? '' : change >= 0 ? 'positive' : 'negative';

  const requestedKey = year * 12 + month + 1;
  const history = (saldi || [])
    .filter((item) => monthKey(item) !== null && monthKey(item) <= requestedKey)
    .sort((a, b) => monthKey(b) - monthKey(a))
    .slice(0, 6);
  const body = $('investment-history');
  body.replaceChildren();
  if (!history.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty';
    cell.textContent = 'Nessun saldo storico disponibile.';
    row.append(cell);
    body.append(row);
    return;
  }
  history.forEach((item) => {
    const start = numberOrNull(item.investimentiInizioMese);
    const end = numberOrNull(item.investimentiFinali);
    const delta = start !== null && end !== null ? end - start : null;
    const row = document.createElement('tr');
    const label = document.createElement('td');
    label.textContent = `${monthNames[Number(item.mese) - 1]} ${item.anno}`;
    row.append(label);
    [start, end, delta].forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = maybeEuro(value);
      if (index === 2) {
        cell.className = `amount ${value === null ? '' : value >= 0 ? 'positive' : 'negative'}`;
      }
      row.append(cell);
    });
    body.append(row);
  });
}

function render(dashboard) {
  const movements = (dashboard.movimenti || []).filter((item) => Number(item.anno) === year && Number(item.mese) === month);
  const spent = movements.filter((item) => item.tipo === 'Uscita' && item.categoria !== 'Investimenti')
    .reduce((sum, item) => sum + (Number(item.importo) || 0), 0);
  const income = movements.filter((item) => item.tipo === 'Entrata')
    .reduce((sum, item) => sum + (Number(item.importo) || 0), 0);
  const budgets = (dashboard.budgets || [])
    .filter((item) => Number(item.anno) * 12 + Number(item.mese) - 1 <= year * 12 + month)
    .sort((a, b) => (Number(b.anno) * 12 + Number(b.mese)) - (Number(a.anno) * 12 + Number(a.mese)));
  const budget = budgets.length ? Number(budgets[0].budget) : 360;

  $('period').textContent = `${monthNames[month]} ${year}`;
  $('budget').textContent = euro(budget);
  $('spent').textContent = euro(spent);
  $('remaining').textContent = euro(budget - spent);
  $('remaining-note').textContent = budget >= spent ? 'Disponibilità residua del budget' : 'Hai superato il budget';
  $('budget-progress').style.width = `${Math.min(100, budget ? spent / budget * 100 : 0)}%`;
  $('income').textContent = euro(income);
  $('expense').textContent = euro(spent);
  renderWealth(dashboard.saldi || []);

  $('movement-list').className = movements.length ? '' : 'empty';
  $('movement-list').innerHTML = movements.slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 8)
    .map((item) => `<div class="movement-row"><span>${escapeHtml(item.descrizione)}<small>${escapeHtml(item.data)} · ${escapeHtml(item.conto || '—')}</small></span><span>${escapeHtml(item.categoria || 'Altro')}</span><span class="amount ${item.tipo === 'Entrata' ? 'positive' : 'negative'}">${item.tipo === 'Entrata' ? '+' : '−'} ${euro(item.importo)}</span></div>`)
    .join('') || 'Nessun movimento in questo mese.';
  $('connection').textContent = 'Collegato';
  $('notice').textContent = 'Dati caricati dal tuo Google Sheet.';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

async function load() {
  $('period').textContent = `${monthNames[month]} ${year}`;
  if (!API_BASE) {
    $('notice').textContent = 'Backend non configurato. Segui docs/SETUP.md per collegare Google Sheets.';
    return;
  }
  $('connection').textContent = 'Connessione…';
  try {
    const response = await fetch(`${API_BASE}/api/bootstrap`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    $('connection').textContent = 'Errore';
    $('notice').textContent = 'Impossibile caricare i dati. Verifica il backend.';
    console.error(error);
  }
}

$('prev-month').onclick = () => { if (--month < 0) { month = 11; year--; } load(); };
$('next-month').onclick = () => { if (++month > 11) { month = 0; year++; } load(); };
$('add-movement').onclick = () => alert('Il modulo per aggiungere movimenti sarà attivato dopo il collegamento sicuro al foglio.');
load();

