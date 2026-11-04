const API_BASE = (window.BUDGET_API_URL || '').replace(/\/$/, '');
const $ = (id) => document.getElementById(id);
const euro = (value) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);
const maybeEuro = (value) => value == null ? '—' : euro(value);
const monthNames = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const now = new Date();
let year = now.getFullYear();
let month = now.getMonth();
let activeView = 'home';
let dashboardData = null;
let editingMovement = null;

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function balanceMonthKey(item) {
  const itemYear = numberOrNull(item.anno);
  const itemMonth = numberOrNull(item.mese);
  return itemYear === null || itemMonth === null ? null : itemYear * 12 + itemMonth;
}

function movementMonthKey(item) {
  const itemYear = numberOrNull(item.anno);
  const itemMonth = numberOrNull(item.mese);
  return itemYear === null || itemMonth === null ? null : itemYear * 12 + itemMonth + 1;
}

function selectedBalance(saldi) {
  const requested = year * 12 + month + 1;
  return (saldi || []).filter((item) => balanceMonthKey(item) !== null && balanceMonthKey(item) <= requested)
    .sort((a, b) => balanceMonthKey(b) - balanceMonthKey(a))[0] || null;
}

function investmentFlows(movements, minKey, maxKey) {
  return (movements || []).reduce((totals, item) => {
    const key = movementMonthKey(item);
    if (key === null || key < minKey || key > maxKey || item.categoria !== 'Investimenti') return totals;
    const amount = Number(item.importo) || 0;
    if (item.tipo === 'Uscita') totals.deposits += amount;
    if (item.tipo === 'Entrata') totals.withdrawals += amount;
    return totals;
  }, { deposits: 0, withdrawals: 0 });
}

function totalBalance(balance) {
  if (!balance) return null;
  const parts = [balance.contoFinale, balance.contantiFinali, balance.investimentiFinali].map(numberOrNull);
  return parts.every((value) => value !== null) ? parts.reduce((sum, value) => sum + value, 0) : null;
}

function renderWealth(data) {
  const balance = selectedBalance(data.saldi);
  $('balance-period').textContent = balance
    ? `Ultimo saldo inserito: ${monthNames[Number(balance.mese) - 1]} ${balance.anno}`
    : 'Nessun saldo registrato';
  $('total-balance').textContent = maybeEuro(totalBalance(balance));
  $('account-balance').textContent = maybeEuro(balance ? numberOrNull(balance.contoFinale) : null);
  $('cash-balance').textContent = maybeEuro(balance ? numberOrNull(balance.contantiFinali) : null);
  $('investment-balance').textContent = maybeEuro(balance ? numberOrNull(balance.investimentiFinali) : null);

  if (!balance) {
    ['investment-period', 'investment-opening', 'investment-closing', 'invested-capital', 'monthly-gain', 'total-gain', 'monthly-deposits', 'monthly-withdrawals']
      .forEach((id) => { $(id).textContent = '—'; });
    return;
  }

  const referenceKey = balanceMonthKey(balance);
  const investmentMonths = (data.saldi || []).filter((item) => balanceMonthKey(item) !== null && balanceMonthKey(item) <= referenceKey)
    .sort((a, b) => balanceMonthKey(a) - balanceMonthKey(b));
  const firstMonth = investmentMonths[0];
  const firstKey = balanceMonthKey(firstMonth);
  const opening = numberOrNull(balance.investimentiInizioMese);
  const closing = numberOrNull(balance.investimentiFinali);
  const monthFlows = investmentFlows(data.movimenti, referenceKey, referenceKey);
  const allFlows = investmentFlows(data.movimenti, firstKey, referenceKey);
  const initialCapital = numberOrNull(firstMonth.investimentiInizioMese);
  const investedCapital = initialCapital === null ? null : initialCapital + allFlows.deposits - allFlows.withdrawals;
  const monthlyGain = opening !== null && closing !== null
    ? closing - opening - monthFlows.deposits + monthFlows.withdrawals : null;
  const totalGain = closing !== null && investedCapital !== null ? closing - investedCapital : null;

  $('investment-period').textContent = `${monthNames[Number(balance.mese) - 1]} ${balance.anno}`;
  $('investment-opening').textContent = maybeEuro(opening);
  $('investment-closing').textContent = maybeEuro(closing);
  $('invested-capital').textContent = maybeEuro(investedCapital);
  $('monthly-gain').textContent = maybeEuro(monthlyGain);
  $('total-gain').textContent = maybeEuro(totalGain);
  $('monthly-deposits').textContent = euro(monthFlows.deposits);
  $('monthly-withdrawals').textContent = euro(monthFlows.withdrawals);
  $('monthly-gain').className = monthlyGain === null ? '' : monthlyGain >= 0 ? 'positive' : 'negative';
  $('total-gain').className = totalGain === null ? '' : totalGain >= 0 ? 'positive' : 'negative';
}

function budgetForMonth(budgets, targetYear, targetMonth) {
  const target = targetYear * 12 + targetMonth;
  const rows = (budgets || []).filter((item) => Number(item.anno) * 12 + Number(item.mese) - 1 <= target)
    .sort((a, b) => (Number(b.anno) * 12 + Number(b.mese)) - (Number(a.anno) * 12 + Number(a.mese)));
  return rows.length ? Number(rows[0].budget) : 360;
}

function movementsForMonth(movements, targetYear, targetMonth) {
  return (movements || []).filter((item) => Number(item.anno) === targetYear && Number(item.mese) === targetMonth);
}

function monthlyTotals(movements) {
  const income = movements.filter((item) => item.tipo === 'Entrata')
    .reduce((sum, item) => sum + (Number(item.importo) || 0), 0);
  const expense = movements.filter((item) => item.tipo === 'Uscita' && item.categoria !== 'Investimenti')
    .reduce((sum, item) => sum + (Number(item.importo) || 0), 0);
  return { income, expense };
}

function renderMonthly(data) {
  const totals = monthlyTotals(movementsForMonth(data.movimenti, year, month));
  const budget = budgetForMonth(data.budgets, year, month);
  $('remaining').textContent = euro(budget - totals.expense);
  $('remaining-note').textContent = budget >= totals.expense ? 'Disponibilità residua del budget' : 'Hai superato il budget';
  $('budget').textContent = euro(budget);
  $('spent').textContent = euro(totals.expense);
  $('budget-progress').style.width = `${Math.min(100, budget ? totals.expense / budget * 100 : 0)}%`;
  $('income').textContent = euro(totals.income);
  $('expense').textContent = euro(totals.expense);
}

function renderAnnual(data) {
  const rows = monthNames.map((label, index) => {
    const totals = monthlyTotals(movementsForMonth(data.movimenti, year, index));
    const budget = budgetForMonth(data.budgets, year, index);
    return { label, ...totals, budget, net: totals.income - totals.expense };
  });
  $('annual-year').textContent = year;
  $('annual-income').textContent = euro(rows.reduce((sum, row) => sum + row.income, 0));
  $('annual-expense').textContent = euro(rows.reduce((sum, row) => sum + row.expense, 0));
  $('annual-net').textContent = euro(rows.reduce((sum, row) => sum + row.net, 0));
  const body = $('annual-months');
  body.replaceChildren();
  rows.forEach((item) => {
    const row = document.createElement('tr');
    [item.label, euro(item.income), euro(item.expense), euro(item.budget), euro(item.net)].forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 4) cell.className = `amount ${item.net >= 0 ? 'positive' : 'negative'}`;
      row.append(cell);
    });
    body.append(row);
  });
}

function formatDay(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!match) return String(isoDate || 'Data non indicata');
  return new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00`));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function renderMovements(movements) {
  const list = $('movement-list');
  list.replaceChildren();
  const sorted = movements.slice().sort((a, b) => b.timestamp - a.timestamp);
  if (!sorted.length) {
    list.className = 'empty';
    list.textContent = 'Nessun movimento in questo mese.';
    return;
  }
  list.className = 'movement-days';
  const groups = new Map();
  sorted.forEach((item) => {
    const key = item.data || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  groups.forEach((items, day) => {
    const group = document.createElement('section');
    group.className = 'day-group';
    const heading = document.createElement('h3');
    heading.className = 'day-heading';
    heading.textContent = `${formatDay(day)} · ${items.length}`;
    group.append(heading);
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'movement-row';
      const description = document.createElement('span');
      description.className = 'movement-description';
      description.textContent = item.descrizione || '';
      const category = document.createElement('span');
      category.className = 'category-cell';
      const badge = document.createElement('span');
      badge.className = 'category-badge';
      badge.textContent = item.categoria || 'Altro';
      category.append(badge);
      const amount = document.createElement('span');
      amount.className = `amount ${item.tipo === 'Entrata' ? 'positive' : 'negative'}`;
      amount.textContent = `${item.tipo === 'Entrata' ? '+' : '−'} ${euro(item.importo)}`;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'edit-button';
      edit.setAttribute('aria-label', 'Modifica movimento');
      edit.textContent = '✎';
      edit.disabled = item.id == null;
      edit.addEventListener('click', () => openEdit(item));
      row.append(description, category, amount, edit);
      group.append(row);
    });
    list.append(group);
  });
}

function render(data) {
  dashboardData = data;
  $('period').textContent = `${monthNames[month]} ${year}`;
  $('movement-period').textContent = `${monthNames[month]} ${year}`;
  renderWealth(data);
  renderMonthly(data);
  renderAnnual(data);
  renderMovements(movementsForMonth(data.movimenti || [], year, month));
  $('connection').textContent = 'Collegato';
  $('notice').textContent = 'Dati caricati dal tuo Google Sheet.';
}

function setView(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach((section) => { section.hidden = section.id !== `${view}-view`; });
  document.querySelectorAll('.bottom-nav [data-view]').forEach((link) => link.classList.toggle('active', link.dataset.view === view));
  $('page-menu').hidden = true;
  $('menu-toggle').setAttribute('aria-expanded', 'false');
  $('month-controls').hidden = view === 'annual';
  $('year-controls').hidden = view !== 'annual';
  if (view === 'home') {
    $('view-kicker').textContent = 'PATRIMONIO';
    $('view-title').innerHTML = 'Il tuo denaro,<br><span>sotto controllo.</span>';
  } else if (view === 'monthly') {
    $('view-kicker').textContent = 'BUDGET MENSILE';
    $('view-title').textContent = 'Budget mensile';
  } else {
    $('view-kicker').textContent = 'RIEPILOGO ANNUALE';
    $('view-title').textContent = 'Riepilogo annuale';
  }
}

function updatePeriod() {
  $('period').textContent = `${monthNames[month]} ${year}`;
  $('annual-year').textContent = year;
  if (dashboardData) render(dashboardData);
}

function openEdit(item) {
  editingMovement = item;
  $('edit-date').value = item.data || '';
  $('edit-description').value = item.descrizione || '';
  $('edit-type').value = item.tipo || 'Uscita';
  $('edit-amount').value = item.importo ?? '';
  const categories = [...new Set((dashboardData?.movimenti || []).map((movement) => movement.categoria).filter(Boolean))];
  if (item.categoria && !categories.includes(item.categoria)) categories.push(item.categoria);
  const select = $('edit-category');
  select.replaceChildren(...categories.map((categoryName) => {
    const option = document.createElement('option');
    option.value = categoryName;
    option.textContent = categoryName;
    return option;
  }));
  select.value = item.categoria || categories[0] || '';
  $('edit-error').hidden = true;
  $('edit-dialog').showModal();
}

async function saveEdit(event) {
  event.preventDefault();
  if (!editingMovement || !API_BASE) return;
  const saveButton = $('save-edit');
  saveButton.disabled = true;
  $('edit-error').hidden = true;
  const changes = {
    data: $('edit-date').value,
    descrizione: $('edit-description').value.trim(),
    categoria: $('edit-category').value,
    tipo: $('edit-type').value,
    importo: Number($('edit-amount').value),
  };
  try {
    const response = await fetch(`${API_BASE}/api/movimenti/edit`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingMovement.id, changes }),
    });
    if (!response.ok) throw new Error('save failed');
    const result = await response.json();
    if (!result.ok) throw new Error('save failed');
    $('edit-dialog').close();
    await load();
  } catch (error) {
    $('edit-error').textContent = 'Modifica non salvata. Controlla l’accesso e riprova.';
    $('edit-error').hidden = false;
  } finally {
    saveButton.disabled = false;
  }
}

async function load() {
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

$('menu-toggle').addEventListener('click', () => {
  const menu = $('page-menu');
  menu.hidden = !menu.hidden;
  $('menu-toggle').setAttribute('aria-expanded', String(!menu.hidden));
});
document.querySelectorAll('[data-view]').forEach((control) => {
  control.addEventListener('click', (event) => {
    event.preventDefault();
    setView(control.dataset.view);
  });
});
$('prev-month').addEventListener('click', () => { if (--month < 0) { month = 11; year--; } updatePeriod(); });
$('next-month').addEventListener('click', () => { if (++month > 11) { month = 0; year++; } updatePeriod(); });
$('prev-year').addEventListener('click', () => { year--; updatePeriod(); });
$('next-year').addEventListener('click', () => { year++; updatePeriod(); });
$('edit-form').addEventListener('submit', saveEdit);
$('close-edit').addEventListener('click', () => $('edit-dialog').close());
$('cancel-edit').addEventListener('click', () => $('edit-dialog').close());
document.addEventListener('click', (event) => {
  if (!$('page-menu').hidden && !event.target.closest('.menu-wrap')) {
    $('page-menu').hidden = true;
    $('menu-toggle').setAttribute('aria-expanded', 'false');
  }
});
updatePeriod();
load();

