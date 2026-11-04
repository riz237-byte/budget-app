const API_BASE = (window.BUDGET_API_URL || '').replace(/\/$/, '');
const $ = (id) => document.getElementById(id);
const euro = (value) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);
const maybeEuro = (value) => value == null ? '—' : euro(value);
const monthNames = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const now = new Date();
let year = now.getFullYear();
let month = now.getMonth();
let dashboardData = null;
let editingMovement = null;
let authToken = sessionStorage.getItem('budget-auth-token') || '';
let refreshToken = sessionStorage.getItem('budget-refresh-token') || '';
let setupMode = false;

function saveSession(session) {
  authToken = session.access_token || '';
  refreshToken = session.refresh_token || '';
  if (authToken) sessionStorage.setItem('budget-auth-token', authToken);
  if (refreshToken) sessionStorage.setItem('budget-refresh-token', refreshToken);
}

function clearSession() {
  authToken = '';
  refreshToken = '';
  sessionStorage.removeItem('budget-auth-token');
  sessionStorage.removeItem('budget-refresh-token');
}

async function refreshSession() {
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }), cache: 'no-store',
    });
    const session = await response.json();
    if (!response.ok || !session.access_token) return false;
    saveSession(session);
    return true;
  } catch (error) { return false; }
}

async function apiFetch(path, options = {}, retried = false) {
  const headers = new Headers(options.headers || {});
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, cache: 'no-store' });
  if (response.status === 401 && !retried && refreshToken && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) return apiFetch(path, options, true);
  }
  if (response.status === 401) {
    clearSession();
    showAuth(false);
  }
  return response;
}

function showAuth(setupRequired) {
  setupMode = Boolean(setupRequired);
  $('app').hidden = true;
  $('migration-screen').hidden = true;
  $('auth-screen').hidden = false;
  $('auth-eyebrow').textContent = setupMode ? 'CONFIGURAZIONE INIZIALE' : 'ACCESSO';
  $('auth-title').textContent = setupMode ? 'Crea il tuo accesso' : 'Accedi';
  $('auth-description').textContent = setupMode
    ? 'Crea l’accesso con la tua email e una password di almeno 12 caratteri. Ti invieremo un messaggio di verifica.'
    : 'Accedi al tuo spazio personale.';
  $('auth-submit').textContent = setupMode ? 'Crea account' : 'Accedi';
  $('auth-password').autocomplete = setupMode ? 'new-password' : 'current-password';
  $('setup-key-wrap').hidden = !setupMode;
  $('setup-key').required = setupMode;
  $('auth-error').hidden = true;
}

async function startAuthentication() {
  if (!API_BASE) {
    showAuth(false);
    $('auth-error').textContent = 'Backend non configurato. Completa le impostazioni Cloudflare.';
    $('auth-error').hidden = false;
    return;
  }
  try {
    acceptAuthFragment_();
    if (authToken) {
      await openAuthenticatedApp();
      return;
    }
    const statusResponse = await fetch(`${API_BASE}/api/auth/status`, { cache: 'no-store' });
    if (!statusResponse.ok) throw new Error('status unavailable');
    const status = await statusResponse.json();
    if (status.setupRequired) {
      showAuth(true);
      return;
    }
    if (!authToken) {
      showAuth(false);
      return;
    }
    await openAuthenticatedApp();
  } catch (error) {
    showAuth(false);
    $('auth-error').textContent = 'Servizio non raggiungibile. Riprova tra poco.';
    $('auth-error').hidden = false;
  }
}

function acceptAuthFragment_() {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  const accessToken = fragment.get('access_token');
  const newRefreshToken = fragment.get('refresh_token');
  if (accessToken && newRefreshToken) {
    saveSession({ access_token: accessToken, refresh_token: newRefreshToken });
    history.replaceState(null, '', location.pathname + location.search);
  }
}

async function openAuthenticatedApp() {
  const response = await apiFetch('/api/migration/status');
  if (!response.ok) throw new Error('migration status unavailable');
  const migration = await response.json();
  $('auth-screen').hidden = true;
  if (!migration.complete) {
    $('app').hidden = true;
    $('migration-screen').hidden = false;
    return;
  }
  $('migration-screen').hidden = true;
  $('app').hidden = false;
  await load();
}

async function submitAuth(event) {
  event.preventDefault();
  const button = $('auth-submit');
  button.disabled = true;
  $('auth-error').hidden = true;
  const body = { email: $('auth-email').value.trim(), password: $('auth-password').value };
  const headers = { 'Content-Type': 'application/json' };
  if (setupMode) headers['X-Setup-Key'] = $('setup-key').value;
  try {
    const response = await fetch(`${API_BASE}/api/auth/${setupMode ? 'setup' : 'login'}`, {
      method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store',
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Accesso non riuscito.');
    if (result.confirmationRequired) {
      $('auth-password').value = '';
      $('setup-key').value = '';
      showAuth(false);
      $('auth-error').textContent = 'Account creato. Apri il messaggio di Supabase e conferma l’email, poi accedi.';
      $('auth-error').hidden = false;
      return;
    }
    if (!result.access_token) throw new Error('Accesso non riuscito.');
    saveSession(result);
    $('auth-password').value = '';
    $('setup-key').value = '';
    await openAuthenticatedApp();
  } catch (error) {
    $('auth-error').textContent = error.message || 'Accesso non riuscito. Controlla i dati e riprova.';
    $('auth-error').hidden = false;
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  try { if (authToken) await apiFetch('/api/auth/logout', { method: 'POST' }); } catch (error) { /* Expired sessions are cleared locally. */ }
  clearSession();
  dashboardData = null;
  $('migration-screen').hidden = true;
  showAuth(false);
}

async function runMigration() {
  const button = $('migration-start');
  button.disabled = true;
  button.textContent = 'Copia in corso…';
  $('migration-error').hidden = true;
  try {
    const response = await apiFetch('/api/migration/import', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || !result.ok || !result.complete) throw new Error(result.error || 'Copia non completata.');
    $('migration-screen').hidden = true;
    $('app').hidden = false;
    await load();
    const counts = result.counts || {};
    $('notice').textContent = `Copia completata: ${Number(counts.movimenti) || 0} movimenti, ${Number(counts.saldi) || 0} saldi e ${Number(counts.budgets) || 0} budget trasferiti.`;
  } catch (error) {
    $('migration-error').textContent = error.message || 'Copia non riuscita. Riprova o chiedi assistenza.';
    $('migration-error').hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Copia i miei dati';
  }
}

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

function selectedBalance(saldi, targetKey = year * 12 + month + 1) {
  return (saldi || []).filter((item) => balanceMonthKey(item) !== null && balanceMonthKey(item) <= targetKey)
    .sort((a, b) => balanceMonthKey(b) - balanceMonthKey(a))[0] || null;
}

function exactBalance(saldi, targetYear = year, targetMonth = month + 1) {
  return (saldi || []).find((item) => Number(item.anno) === targetYear && Number(item.mese) === targetMonth) || null;
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

function movementsForMonth(movements, targetYear, targetMonth) {
  return (movements || []).filter((item) => Number(item.anno) === targetYear && Number(item.mese) === targetMonth);
}

function monthlyTotals(movements) {
  const income = movements.filter((item) => item.tipo === 'Entrata')
    .reduce((sum, item) => sum + (Number(item.importo) || 0), 0);
  const expense = movements.filter((item) => item.tipo === 'Uscita' && item.categoria !== 'Investimenti')
    .reduce((sum, item) => sum + (Number(item.importo) || 0), 0);
  return { income, expense, net: income - expense };
}

function budgetForMonth(budgets, targetYear, targetMonth) {
  const target = targetYear * 12 + targetMonth;
  const rows = (budgets || []).filter((item) => Number(item.anno) * 12 + Number(item.mese) - 1 <= target)
    .sort((a, b) => (Number(b.anno) * 12 + Number(b.mese)) - (Number(a.anno) * 12 + Number(a.mese)));
  return rows.length ? Number(rows[0].budget) : 360;
}

const DEFAULT_BUDGET_SPLIT = [
  { category: 'Investimenti', percentage: 45, matches: ['Investimenti'], investment: true },
  { category: 'Spese fisse', percentage: 16.2, matches: ['Abbonamenti'] },
  { category: 'Cibo', percentage: 19.4, matches: ['Cibo'] },
  { category: 'Trasporti', percentage: 5, matches: ['Trasporti'] },
  { category: 'Shopping / svago', percentage: 8.3, matches: ['Shopping', 'Intrattenimento', 'Collezionismo', 'Regali'] },
  { category: 'Imprevisti / altro', percentage: 6, matches: ['Altro', 'Salute', 'Viaggi', 'Tecnologia', 'Ricariche/commissioni'] },
];

function categoryBudgetRows(data, targetYear, targetMonth) {
  const targetKey = targetYear * 12 + targetMonth + 1;
  const total = budgetForMonth(data.budgets, targetYear, targetMonth);
  const monthMovements = movementsForMonth(data.movimenti || [], targetYear, targetMonth);
  return DEFAULT_BUDGET_SPLIT.map((definition) => {
    const saved = (data.categoryBudgets || []).filter((item) => item.categoria === definition.category &&
      Number(item.anno) * 12 + Number(item.mese) <= targetKey)
      .sort((a, b) => (Number(b.anno) * 12 + Number(b.mese)) - (Number(a.anno) * 12 + Number(a.mese)))[0];
    const percentage = saved && numberOrNull(saved.percentuale) !== null
      ? Number(saved.percentuale) : definition.percentage;
    const budget = saved && numberOrNull(saved.budget) !== null
      ? Number(saved.budget) : Math.round(total * percentage) / 100;
    const spent = monthMovements.filter((item) => definition.matches.includes(item.categoria) &&
      (definition.investment ? item.tipo === 'Uscita' : item.tipo === 'Uscita'))
      .reduce((sum, item) => sum + (Number(item.importo) || 0), 0);
    return { category: definition.category, spent, budget, percentage };
  });
}

function categoryBudgetSummary(data, targetYear, targetMonth) {
  const rows = categoryBudgetRows(data, targetYear, targetMonth);
  const configured = rows.some((row) => row.budget !== null);
  return {
    rows,
    configured,
    total: budgetForMonth(data.budgets, targetYear, targetMonth),
  };
}

function renderWealth(data) {
  const requestedKey = year * 12 + month + 1;
  const balance = selectedBalance(data.saldi, requestedKey);
  $('balance-period').textContent = balance
    ? `Ultimo saldo inserito: ${monthNames[Number(balance.mese) - 1]} ${balance.anno}`
    : 'Nessun saldo registrato';
  $('total-balance').textContent = maybeEuro(totalBalance(balance));
  $('account-balance').textContent = maybeEuro(balance ? numberOrNull(balance.contoFinale) : null);
  $('cash-balance').textContent = maybeEuro(balance ? numberOrNull(balance.contantiFinali) : null);
  $('investment-balance').textContent = maybeEuro(balance ? numberOrNull(balance.investimentiFinali) : null);

  if (!balance) {
    ['investment-period', 'investment-opening', 'investment-closing', 'invested-capital', 'monthly-gain', 'total-gain', 'monthly-withdrawals']
      .forEach((id) => { $(id).textContent = '—'; });
    return;
  }

  const referenceKey = balanceMonthKey(balance);
  const opening = numberOrNull(balance.investimentiInizioMese);
  const closing = numberOrNull(balance.investimentiFinali);
  const monthFlows = investmentFlows(data.movimenti, referenceKey, referenceKey);
  const allFlows = investmentFlows(data.movimenti, Number.MIN_SAFE_INTEGER, referenceKey);
  const investedCapital = allFlows.deposits - allFlows.withdrawals;
  const monthlyGain = opening !== null && closing !== null
    ? closing - opening - monthFlows.deposits + monthFlows.withdrawals : null;
  const totalGain = closing !== null ? closing - investedCapital : null;

  $('investment-period').textContent = `${monthNames[Number(balance.mese) - 1]} ${balance.anno}`;
  $('investment-opening').textContent = maybeEuro(opening);
  $('investment-closing').textContent = maybeEuro(closing);
  $('invested-capital').textContent = euro(investedCapital);
  $('monthly-gain').textContent = maybeEuro(monthlyGain);
  $('total-gain').textContent = maybeEuro(totalGain);
  $('monthly-withdrawals').textContent = euro(monthFlows.withdrawals);
  $('monthly-gain').className = monthlyGain === null ? '' : monthlyGain >= 0 ? 'positive' : 'negative';
  $('total-gain').className = totalGain === null ? '' : totalGain >= 0 ? 'positive' : 'negative';
}

function renderHomeBudget(data) {
  const summary = categoryBudgetSummary(data, year, month);
  const spent = summary.rows.reduce((sum, row) => sum + row.spent, 0);
  $('home-budget-total').textContent = euro(summary.total);
  $('home-budget-spent').textContent = euro(spent);
  $('home-budget-remaining').textContent = euro(summary.total - spent);
  const list = $('home-category-budgets');
  list.replaceChildren();
  summary.rows.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'home-category-row';
    const name = document.createElement('span');
    name.className = 'home-category-name';
    name.textContent = item.category;
    const progress = document.createElement('span');
    progress.className = 'category-progress';
    const fill = document.createElement('span');
    fill.style.width = item.budget > 0 ? `${Math.min(100, item.spent / item.budget * 100)}%` : '0%';
    if (item.budget !== null && item.spent > item.budget) fill.classList.add('over-budget');
    progress.append(fill);
    const spent = document.createElement('span');
    spent.className = 'category-spent';
    spent.textContent = `${euro(item.spent)} / ${item.budget === null ? '—' : euro(item.budget)}`;
    const remaining = document.createElement('span');
    remaining.className = `category-remaining ${item.budget !== null && item.budget - item.spent < 0 ? 'negative' : ''}`;
    remaining.textContent = item.budget === null ? 'Da impostare' : `Restano ${euro(item.budget - item.spent)}`;
    row.append(name, progress, spent, remaining);
    list.append(row);
  });
}

function renderHomeOverview(data) {
  const currentMovements = movementsForMonth(data.movimenti || [], year, month);
  const previousDate = new Date(year, month - 1, 1);
  const initialBalance = exactBalance(data.saldi, previousDate.getFullYear(), previousDate.getMonth() + 1);
  const finalBalance = exactBalance(data.saldi, year, month + 1);
  const initial = totalBalance(initialBalance);
  const final = totalBalance(finalBalance);
  const externalIncome = currentMovements.filter((item) => item.tipo === 'Entrata' && item.categoria !== 'Investimenti')
    .reduce((sum, item) => sum + (Number(item.importo) || 0), 0);
  const externalExpenses = currentMovements.filter((item) => item.tipo === 'Uscita' && item.categoria !== 'Investimenti')
    .reduce((sum, item) => sum + (Number(item.importo) || 0), 0);
  const expected = initial === null ? null : initial + externalIncome - externalExpenses;

  $('initial-wealth').textContent = maybeEuro(initial);
  $('initial-wealth-note').textContent = initialBalance
    ? `Saldo finale di ${monthNames[previousDate.getMonth()]} ${previousDate.getFullYear()}`
    : `Inserisci il saldo di ${monthNames[previousDate.getMonth()]}`;
  $('final-wealth').textContent = maybeEuro(final);
  $('final-wealth-note').textContent = final === null
    ? 'Da inserire con “Patrimonio finale”'
    : expected === null ? 'Saldo finale registrato' : `Scostamento dall’atteso: ${euro(final - expected)}`;
  $('final-wealth-note').className = `wealth-comparison-note ${final !== null && expected !== null && final < expected ? 'negative' : ''}`;
  $('expected-wealth').textContent = maybeEuro(expected);
  $('expected-wealth-note').textContent = expected === null
    ? 'Serve il saldo finale del mese precedente'
    : `${euro(externalIncome)} entrate − ${euro(externalExpenses)} uscite`;
  const difference = final === null || expected === null ? null : final - expected;
  $('wealth-difference').textContent = difference === null ? '—' : `${difference > 0 ? '+' : ''}${euro(difference)}`;
  $('wealth-difference').className = difference === null ? '' : difference >= 0 ? 'positive' : 'negative';
  const net = externalIncome - externalExpenses;
  $('home-income').textContent = euro(externalIncome);
  $('home-expense').textContent = euro(externalExpenses);
  $('home-net').textContent = euro(net);
  $('home-net').className = net >= 0 ? 'positive' : 'negative';
}

function renderCategoryBudgetEditor(data, rows) {
  const totalInput = $('monthly-budget-total-input');
  if (document.activeElement !== totalInput) totalInput.value = budgetForMonth(data.budgets, year, month).toFixed(2);
  const editor = $('category-budget-editor');
  editor.replaceChildren();
  rows.forEach((item) => {
    const row = document.createElement('label');
    row.className = 'category-editor-row';
    const details = document.createElement('span');
    details.className = 'category-editor-details';
    const name = document.createElement('span');
    name.textContent = item.category;
    const spent = document.createElement('small');
    spent.textContent = `Speso questo mese: ${euro(item.spent)}`;
    details.append(name, spent);
    const percentage = document.createElement('input');
    percentage.type = 'number';
    percentage.min = '0';
    percentage.step = '0.1';
    percentage.inputMode = 'decimal';
    percentage.value = item.percentage.toFixed(1);
    percentage.dataset.category = item.category;
    percentage.dataset.field = 'percentage';
    percentage.setAttribute('aria-label', `Percentuale budget per ${item.category}`);
    percentage.addEventListener('input', () => updateBudgetRow(percentage));
    const amount = document.createElement('input');
    amount.type = 'number';
    amount.min = '0';
    amount.step = '0.01';
    amount.inputMode = 'decimal';
    amount.value = item.budget.toFixed(2);
    amount.dataset.category = item.category;
    amount.dataset.field = 'budget';
    amount.setAttribute('aria-label', `Importo budget per ${item.category}`);
    amount.addEventListener('input', () => updateBudgetRow(amount));
    row.append(details, percentage, amount);
    editor.append(row);
  });
  $('category-budget-status').textContent = 'Le percentuali sono calcolate sul totale mensile. Le spese fisse includono la categoria Abbonamenti.';
  updateCategoryBudgetTotal();
}

function updateBudgetRow(changedInput) {
  const category = changedInput.dataset.category;
  const row = changedInput.closest('.category-editor-row');
  const percentage = row.querySelector('[data-field="percentage"]');
  const amount = row.querySelector('[data-field="budget"]');
  const total = Number($('monthly-budget-total-input').value) || 0;
  if (changedInput.dataset.field === 'percentage') amount.value = (total * (Number(percentage.value) || 0) / 100).toFixed(2);
  else percentage.value = total ? ((Number(amount.value) || 0) / total * 100).toFixed(2) : '0';
  updateCategoryBudgetTotal();
}

function updateBudgetValuesFromPercentages() {
  const total = Number($('monthly-budget-total-input').value) || 0;
  document.querySelectorAll('#category-budget-editor .category-editor-row').forEach((row) => {
    const percentage = row.querySelector('[data-field="percentage"]');
    const amount = row.querySelector('[data-field="budget"]');
    amount.value = (total * (Number(percentage.value) || 0) / 100).toFixed(2);
  });
  updateCategoryBudgetTotal();
}

function updateCategoryBudgetTotal() {
  const amount = [...document.querySelectorAll('#category-budget-editor [data-field="budget"]')]
    .reduce((sum, input) => sum + (Number(input.value) || 0), 0);
  const percentage = [...document.querySelectorAll('#category-budget-editor [data-field="percentage"]')]
    .reduce((sum, input) => sum + (Number(input.value) || 0), 0);
  $('category-budget-total').textContent = `${euro(amount)} · ${percentage.toFixed(1)}%`;
}

function renderMonthly(data) {
  const totals = monthlyTotals(movementsForMonth(data.movimenti || [], year, month));
  const summary = categoryBudgetSummary(data, year, month);
  const budget = summary.total;
  const budgetSpent = summary.rows.reduce((sum, row) => sum + row.spent, 0);
  $('remaining').textContent = euro(budget - budgetSpent);
  $('remaining-note').textContent = budget >= budgetSpent ? 'Disponibilità residua del budget' : 'Hai superato il budget';
  $('budget').textContent = euro(budget);
  $('spent').textContent = euro(budgetSpent);
  $('budget-progress').style.width = `${Math.min(100, budget ? budgetSpent / budget * 100 : 0)}%`;
  $('income').textContent = euro(totals.income);
  $('expense').textContent = euro(totals.expense);
  renderCategoryBudgetEditor(data, summary.rows);
}

function renderAnnual(data) {
  const rows = monthNames.map((label, index) => {
    const totals = monthlyTotals(movementsForMonth(data.movimenti || [], year, index));
    const budget = categoryBudgetSummary(data, year, index).total;
    return { label, ...totals, budget };
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

function renderMovements(movements) {
  const list = $('movement-list');
  list.replaceChildren();
  const sorted = movements.slice().sort((a, b) => b.timestamp - a.timestamp);
  if (!sorted.length) {
    list.className = 'movement-days empty';
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
    group.className = 'day-group panel';
    const heading = document.createElement('h3');
    heading.className = 'day-heading';
    heading.textContent = `${formatDay(day)} · ${items.length}`;
    group.append(heading);
    const columns = document.createElement('div');
    columns.className = 'table-head movement-columns';
    ['Descrizione', 'Categoria', 'Importo', ''].forEach((label, index) => {
      const cell = document.createElement('span');
      cell.textContent = label;
      if (index === 2) cell.className = 'amount';
      columns.append(cell);
    });
    group.append(columns);
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
  renderHomeBudget(data);
  renderHomeOverview(data);
  renderMonthly(data);
  renderAnnual(data);
  renderMovements(movementsForMonth(data.movimenti || [], year, month));
  $('connection').textContent = 'Collegato';
  $('notice').textContent = 'Dati caricati dal database Supabase.';
}

function setView(view) {
  document.querySelectorAll('.view').forEach((section) => { section.hidden = section.id !== `${view}-view`; });
  document.querySelectorAll('.bottom-nav [data-view]').forEach((link) => link.classList.toggle('active', link.dataset.view === view));
  $('page-menu').hidden = true;
  $('menu-toggle').setAttribute('aria-expanded', 'false');
  $('month-controls').hidden = view === 'annual';
  $('year-controls').hidden = view !== 'annual';
  if (view === 'home') {
    $('view-kicker').textContent = 'PATRIMONIO';
    $('view-title').textContent = 'Panoramica';
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
    const response = await apiFetch('/api/movimenti/edit', {
      method: 'POST',
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

function openBalanceForm() {
  const current = exactBalance(dashboardData.saldi);
  const previous = selectedBalance(dashboardData.saldi, year * 12 + month);
  $('balance-form-period').textContent = `${monthNames[month].toUpperCase()} ${year}`;
  $('balance-account').value = current?.contoFinale ?? previous?.contoFinale ?? '';
  $('balance-cash').value = current?.contantiFinali ?? previous?.contantiFinali ?? '';
  $('balance-investments').value = current?.investimentiFinali ?? previous?.investimentiFinali ?? '';
  $('balance-error').hidden = true;
  $('balance-dialog').showModal();
}

async function saveBalance(event) {
  event.preventDefault();
  const button = $('save-balance');
  button.disabled = true;
  $('balance-error').hidden = true;
  try {
    const response = await apiFetch('/api/saldi/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anno: year, mese: month + 1,
        contoFinale: Number($('balance-account').value),
        contantiFinali: Number($('balance-cash').value),
        investimentiFinali: Number($('balance-investments').value),
      }),
    });
    if (!response.ok) throw new Error('save failed');
    const result = await response.json();
    if (!result.ok) throw new Error('save failed');
    $('balance-dialog').close();
    await load();
  } catch (error) {
    $('balance-error').textContent = 'Saldo non salvato. Controlla l’accesso e riprova.';
    $('balance-error').hidden = false;
  } finally {
    button.disabled = false;
  }
}

async function saveCategoryBudgets() {
  const button = $('save-category-budgets');
  const rows = [...document.querySelectorAll('#category-budget-editor .category-editor-row')];
  button.disabled = true;
  $('category-budget-status').textContent = 'Salvataggio…';
  try {
    const budgets = rows.map((row) => ({
      categoria: row.querySelector('[data-field="budget"]').dataset.category,
      budget: Number(row.querySelector('[data-field="budget"]').value) || 0,
      percentuale: Number(row.querySelector('[data-field="percentage"]').value) || 0,
    }));
    const total = Number($('monthly-budget-total-input').value);
    const response = await apiFetch('/api/budgets/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anno: year, mese: month + 1, total, budgets }),
    });
    if (!response.ok) throw new Error('save failed');
    const result = await response.json();
    if (!result.ok) throw new Error('save failed');
    dashboardData.categoryBudgets = result.categoryBudgets;
    dashboardData.budgets = result.budgets;
    render(dashboardData);
    $('category-budget-status').textContent = 'Budget per categoria salvati.';
  } catch (error) {
    $('category-budget-status').textContent = 'Budget non salvati. Controlla l’accesso e riprova.';
  } finally {
    button.disabled = false;
  }
}

async function load() {
  if (!API_BASE) {
    $('notice').textContent = 'Backend non configurato. Segui docs/SETUP.md per collegare Cloudflare.';
    return;
  }
  $('connection').textContent = 'Connessione…';
  try {
    const response = await apiFetch('/api/bootstrap');
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
$('add-balance').addEventListener('click', openBalanceForm);
$('balance-form').addEventListener('submit', saveBalance);
$('close-balance').addEventListener('click', () => $('balance-dialog').close());
$('cancel-balance').addEventListener('click', () => $('balance-dialog').close());
$('save-category-budgets').addEventListener('click', saveCategoryBudgets);
$('monthly-budget-total-input').addEventListener('input', updateBudgetValuesFromPercentages);
 $('auth-form').addEventListener('submit', submitAuth);
 $('logout-button').addEventListener('click', logout);
$('migration-start').addEventListener('click', runMigration);
$('migration-logout').addEventListener('click', logout);
document.addEventListener('click', (event) => {
  if (!$('page-menu').hidden && !event.target.closest('.menu-wrap')) {
    $('page-menu').hidden = true;
    $('menu-toggle').setAttribute('aria-expanded', 'false');
  }
});
updatePeriod();
startAuthentication();

