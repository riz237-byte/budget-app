const RESPONSE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigin = env.ALLOWED_ORIGIN;
    const cors = origin === allowedOrigin ? {
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
      'access-control-allow-headers': 'Accept, Content-Type, Authorization, X-Setup-Key',
      'access-control-max-age': '600',
      vary: 'Origin',
    } : { vary: 'Origin' };
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return origin === allowedOrigin
        ? new Response(null, { status: 204, headers: { ...RESPONSE_HEADERS, ...cors } })
        : json_({ error: 'Origin not allowed.' }, 403, cors);
    }
    if (!allowedOrigin || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY ||
        (origin && origin !== allowedOrigin)) {
      return json_({ error: 'Service is not configured.' }, 503, cors);
    }

    try {
      if (url.pathname === '/api/auth/status' && request.method === 'GET') {
        return json_({ ok: true, setupRequired: Boolean(env.INITIAL_SETUP_KEY) }, 200, cors);
      }
      if (url.pathname === '/api/auth/setup' && request.method === 'POST') {
        return await signUp_(request, env, cors);
      }
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return await authPost_(request, env, 'token?grant_type=password', cors);
      }
      if (url.pathname === '/api/auth/refresh' && request.method === 'POST') {
        return await authPost_(request, env, 'token?grant_type=refresh_token', cors);
      }
      if (!url.pathname.startsWith('/api/')) return json_({ error: 'Not found.' }, 404, cors);

      const user = await authenticatedUser_(request, env);
      if (!user) return json_({ error: 'Sessione scaduta. Accedi di nuovo.' }, 401, cors);
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        await supabaseFetch_(env, '/auth/v1/logout', { method: 'POST', token: user.token });
        return json_({ ok: true }, 200, cors);
      }
      if (url.pathname === '/api/migration/status' && request.method === 'GET') {
        const rows = await restRows_(env, user, 'migration_state', { select: 'counts,completed_at', user_id: `eq.${user.id}`, limit: '1' });
        return json_({ ok: true, complete: rows.length > 0, counts: rows[0]?.counts || null }, 200, cors);
      }
      if (url.pathname === '/api/migration/import' && request.method === 'POST') {
        return await migrateFromSheet_(env, user, cors);
      }
      if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
        return json_(await bootstrap_(env, user), 200, cors);
      }
      if (url.pathname === '/api/movimenti/edit' && request.method === 'POST') {
        return await editMovement_(request, env, user, cors);
      }
      if (url.pathname === '/api/saldi/save' && request.method === 'POST') {
        return await saveBalance_(request, env, user, cors);
      }
      if (url.pathname === '/api/budgets/categories' && request.method === 'POST') {
        return await saveCategoryBudgets_(request, env, user, cors);
      }
      return json_({ error: 'Not found.' }, 404, cors);
    } catch (error) {
      return json_({ error: 'Impossibile completare la richiesta.' }, 500, cors);
    }
  },
};

async function signUp_(request, env, cors) {
  if (!env.OWNER_EMAIL || !env.INITIAL_SETUP_KEY || env.INITIAL_SETUP_KEY.length < 32) {
    return json_({ error: 'La registrazione iniziale non è attiva.' }, 410, cors);
  }
  const body = await readJson_(request);
  const email = normalizeEmail_(body.email);
  const password = String(body.password || '');
  const setupKey = request.headers.get('X-Setup-Key') || '';
  if (email !== normalizeEmail_(env.OWNER_EMAIL) || !safeEqual_(setupKey, env.INITIAL_SETUP_KEY) ||
      password.length < 12 || password.length > 128) {
    return json_({ error: 'Dati di registrazione non validi.' }, 400, cors);
  }
  const redirect = encodeURIComponent(env.APP_URL || env.ALLOWED_ORIGIN);
  const result = await supabaseFetch_(env, `/auth/v1/signup?redirect_to=${redirect}`, {
    method: 'POST', body: { email, password },
  });
  if (!result.response.ok) return json_({ error: authError_(result.payload) }, result.response.status, cors);
  if (!result.payload?.access_token) {
    return json_({ ok: true, confirmationRequired: true }, 200, cors);
  }
  return json_({ ok: true, ...session_(result.payload) }, 200, cors);
}

async function authPost_(request, env, endpoint, cors) {
  const body = await readJson_(request);
  if (endpoint.endsWith('password') && (!body.email || !body.password)) {
    return json_({ error: 'Inserisci email e password.' }, 400, cors);
  }
  if (endpoint.endsWith('refresh_token') && !body.refresh_token) return json_({ error: 'Sessione non valida.' }, 400, cors);
  const result = await supabaseFetch_(env, `/auth/v1/${endpoint}`, { method: 'POST', body });
  if (!result.response.ok) return json_({ error: authError_(result.payload) }, result.response.status, cors);
  return json_({ ok: true, ...session_(result.payload) }, 200, cors);
}

function session_(payload) {
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: payload.expires_at || Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600),
    user: payload.user ? { id: payload.user.id, email: payload.user.email } : null,
  };
}

async function authenticatedUser_(request, env) {
  const token = bearer_(request);
  if (!token || token.length > 8192) return null;
  const result = await supabaseFetch_(env, '/auth/v1/user', { method: 'GET', token });
  if (!result.response.ok || !result.payload?.id ||
      normalizeEmail_(result.payload.email) !== normalizeEmail_(env.OWNER_EMAIL)) return null;
  return { id: result.payload.id, email: result.payload.email, token };
}

async function bootstrap_(env, user) {
  const [movements, budgets, balances, categoryBudgets] = await Promise.all([
    restRows_(env, user, 'movements', { select: '*', user_id: `eq.${user.id}`, order: 'date.desc,id.asc' }),
    restRows_(env, user, 'monthly_budgets', { select: '*', user_id: `eq.${user.id}`, order: 'year,month' }),
    restRows_(env, user, 'balances', { select: '*', user_id: `eq.${user.id}`, order: 'year,month' }),
    restRows_(env, user, 'category_budgets', { select: '*', user_id: `eq.${user.id}`, order: 'year,month,category' }),
  ]);
  return {
    ok: true,
    movimenti: movements.map((row) => ({ id: row.id, data: row.date, timestamp: Date.parse(`${row.date}T00:00:00Z`),
      anno: row.year, mese: row.month - 1, tipo: row.type, descrizione: row.description, importo: row.amount, categoria: row.category })),
    budgets: budgets.map((row) => ({ anno: row.year, mese: row.month, budget: row.amount })),
    saldi: balances.map((row) => ({ anno: row.year, mese: row.month, contoIniziale: row.account_opening,
      contantiIniziali: row.cash_opening, investimentiInizioMese: row.investment_opening,
      contoFinale: row.account_final, contantiFinali: row.cash_final, investimentiFinali: row.investment_final })),
    categoryBudgets: categoryBudgets.map((row) => ({ anno: row.year, mese: row.month,
      categoria: row.category, budget: row.amount, percentuale: row.percentage })),
  };
}

async function migrateFromSheet_(env, user, cors) {
  const state = await restRows_(env, user, 'migration_state', { select: 'counts', user_id: `eq.${user.id}`, limit: '1' });
  if (state.length) return json_({ ok: true, complete: true, counts: state[0].counts }, 200, cors);
  if (!env.GAS_URL || !env.API_SECRET) return json_({ error: 'Collegamento temporaneo al foglio non configurato.' }, 503, cors);

  const sourceResponse = await fetch(env.GAS_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'bootstrap', secret: env.API_SECRET }), redirect: 'follow',
  });
  const source = await sourceResponse.json();
  if (!sourceResponse.ok || source?.ok !== true || !Array.isArray(source.movimenti) || !Array.isArray(source.budgets) ||
      !Array.isArray(source.saldi) || !Array.isArray(source.categoryBudgets)) {
    return json_({ error: 'Non è stato possibile leggere i dati del foglio.' }, 502, cors);
  }

  const counts = { movimenti: source.movimenti.length, budgets: source.budgets.length,
    saldi: source.saldi.length, categoryBudgets: source.categoryBudgets.length };
  const rows = {
    movements: source.movimenti.map((item) => {
      const date = String(item.data || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !['Entrata', 'Uscita'].includes(String(item.tipo)) ||
          !Number.isFinite(Number(item.importo)) || Number(item.importo) < 0 || !String(item.descrizione || '').trim() ||
          !String(item.categoria || '').trim()) throw new Error('Movimento non valido nel foglio sorgente.');
      const parts = date.split('-').map(Number);
      return { user_id: user.id, id: `sheet-${String(item.id)}`, date, year: parts[0], month: parts[1],
        type: String(item.tipo), description: String(item.descrizione).trim(), amount: Number(item.importo), category: String(item.categoria).trim() };
    }),
    monthly_budgets: source.budgets.map((item) => ({ user_id: user.id, year: Number(item.anno), month: Number(item.mese), amount: Number(item.budget) })),
    balances: source.saldi.map((item) => ({ user_id: user.id, year: Number(item.anno), month: Number(item.mese),
      account_opening: numberOrNull_(item.contoIniziale) ?? 0, cash_opening: numberOrNull_(item.contantiIniziali) ?? 0,
      investment_opening: numberOrNull_(item.investimentiInizioMese) ?? 0,
      account_final: numberOrNull_(item.contoFinale), cash_final: numberOrNull_(item.contantiFinali),
      investment_final: numberOrNull_(item.investimentiFinali) })),
    category_budgets: source.categoryBudgets.map((item) => ({ user_id: user.id, year: Number(item.anno), month: Number(item.mese),
      category: String(item.categoria || '').trim(), amount: Number(item.budget), percentage: numberOrNull_(item.percentuale) ?? 0 })),
  };
  for (const row of rows.monthly_budgets) if (!validPeriod_(row.year, row.month) || !Number.isFinite(row.amount) || row.amount < 0) throw new Error('Budget non valido nel foglio sorgente.');
  for (const row of rows.balances) if (!validPeriod_(row.year, row.month)) throw new Error('Saldo non valido nel foglio sorgente.');
  for (const row of rows.category_budgets) if (!validPeriod_(row.year, row.month) || !row.category || !Number.isFinite(row.amount) || row.amount < 0 || row.percentage < 0) throw new Error('Budget categoria non valido nel foglio sorgente.');

  await upsertRows_(env, user, 'movements', rows.movements, 'user_id,id');
  await upsertRows_(env, user, 'monthly_budgets', rows.monthly_budgets, 'user_id,year,month');
  await upsertRows_(env, user, 'balances', rows.balances, 'user_id,year,month');
  await upsertRows_(env, user, 'category_budgets', rows.category_budgets, 'user_id,year,month,category');
  await upsertRows_(env, user, 'migration_state', [{ user_id: user.id, counts }], 'user_id');
  return json_({ ok: true, complete: true, counts }, 200, cors);
}

async function editMovement_(request, env, user, cors) {
  const body = await readJson_(request);
  const id = String(body.id || ''); const change = body.changes || {};
  const valid = validateMovement_(change);
  if (!id || !valid) return json_({ error: 'Valori del movimento non validi.' }, 400, cors);
  const result = await restRequest_(env, user, `movements?id=eq.${encodeURIComponent(id)}&user_id=eq.${user.id}`, {
    method: 'PATCH', body: { date: valid.date, year: valid.year, month: valid.month, type: valid.type,
      description: valid.description, amount: valid.amount, category: valid.category }, prefer: 'return=representation',
  });
  if (!Array.isArray(result.payload) || !result.payload.length) return json_({ error: 'Movimento non trovato.' }, 404, cors);
  return json_({ ok: true, id }, 200, cors);
}

async function saveBalance_(request, env, user, cors) {
  const body = await readJson_(request); const year = Number(body.anno); const month = Number(body.mese);
  const finals = [Number(body.contoFinale), Number(body.contantiFinali), Number(body.investimentiFinali)];
  if (!validPeriod_(year, month) || finals.some((value) => !Number.isFinite(value) || value < 0)) return json_({ error: 'Saldo non valido.' }, 400, cors);
  const query = { select: '*', user_id: `eq.${user.id}`, year: `eq.${year}`, month: `eq.${month}`, limit: '1' };
  const currentRows = await restRows_(env, user, 'balances', query);
  const priorRows = await restRows_(env, user, 'balances', { select: 'year,month,account_final,cash_final,investment_final', user_id: `eq.${user.id}`, order: 'year.desc,month.desc', limit: '50' });
  const prior = priorRows.find((row) => row.year * 12 + row.month < year * 12 + month);
  const current = currentRows[0];
  const row = { user_id: user.id, year, month,
    account_opening: current?.account_opening ?? prior?.account_final ?? 0,
    cash_opening: current?.cash_opening ?? prior?.cash_final ?? 0,
    investment_opening: current?.investment_opening ?? prior?.investment_final ?? 0,
    account_final: finals[0], cash_final: finals[1], investment_final: finals[2] };
  const result = await restRequest_(env, user, 'balances?on_conflict=user_id,year,month', {
    method: 'POST', body: [row], prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (!result.response.ok) return json_({ error: 'Saldo non salvato.' }, 502, cors);
  return json_({ ok: true, balance: { anno: year, mese: month } }, 200, cors);
}

async function saveCategoryBudgets_(request, env, user, cors) {
  const body = await readJson_(request); const year = Number(body.anno); const month = Number(body.mese); const total = Number(body.total);
  if (!validPeriod_(year, month) || !Number.isFinite(total) || total < 0 || !Array.isArray(body.budgets) || body.budgets.length !== 6) {
    return json_({ error: 'Budget non valido.' }, 400, cors);
  }
  const seen = new Set();
  const rows = body.budgets.map((item) => {
    const category = String(item.categoria || '').trim(); const amount = Number(item.budget); const percentage = Number(item.percentuale);
    if (!category || category.length > 80 || seen.has(category) || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(percentage) || percentage < 0) return null;
    seen.add(category); return { user_id: user.id, year, month, category, amount, percentage };
  });
  if (rows.some((row) => !row)) return json_({ error: 'Categorie budget non valide.' }, 400, cors);
  await upsertRows_(env, user, 'monthly_budgets', [{ user_id: user.id, year, month, amount: total }], 'user_id,year,month');
  await upsertRows_(env, user, 'category_budgets', rows, 'user_id,year,month,category');
  const [budgets, categories] = await Promise.all([
    restRows_(env, user, 'monthly_budgets', { select: '*', user_id: `eq.${user.id}`, order: 'year,month' }),
    restRows_(env, user, 'category_budgets', { select: '*', user_id: `eq.${user.id}`, order: 'year,month,category' }),
  ]);
  return json_({ ok: true, budgets: budgets.map((row) => ({ anno: row.year, mese: row.month, budget: row.amount })),
    categoryBudgets: categories.map((row) => ({ anno: row.year, mese: row.month, categoria: row.category, budget: row.amount, percentuale: row.percentage })) }, 200, cors);
}

async function restRows_(env, user, table, params) {
  const query = new URLSearchParams(params).toString();
  const result = await restRequest_(env, user, `${table}?${query}`, { method: 'GET' });
  if (!result.response.ok || !Array.isArray(result.payload)) throw new Error('Database query failed.');
  return result.payload;
}

async function upsertRows_(env, user, table, rows, conflict) {
  for (let index = 0; index < rows.length; index += 100) {
    const result = await restRequest_(env, user, `${table}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: 'POST', body: rows.slice(index, index + 100), prefer: 'resolution=merge-duplicates,return=minimal',
    });
    if (!result.response.ok) throw new Error('Database write failed.');
  }
}

async function restRequest_(env, user, path, options) {
  return supabaseFetch_(env, `/rest/v1/${path}`, { ...options, token: user.token });
}

async function supabaseFetch_(env, path, options = {}) {
  const headers = { apikey: env.SUPABASE_PUBLISHABLE_KEY, accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.prefer) headers.prefer = options.prefer;
  const response = await fetch(`${String(env.SUPABASE_URL).replace(/\/$/, '')}${path}`, {
    method: options.method || 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let payload = null;
  if (response.status !== 204) {
    const text = await response.text();
    try { payload = text ? JSON.parse(text) : null; } catch (error) { payload = null; }
  }
  return { response, payload };
}

function validateMovement_(change) {
  const date = String(change.data || ''); const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const year = match ? Number(match[1]) : 0; const month = match ? Number(match[2]) : 0; const day = match ? Number(match[3]) : 0;
  const amount = Number(change.importo); const description = String(change.descrizione || '').trim();
  const category = String(change.categoria || '').trim(); const type = String(change.tipo || '');
  if (!match || new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== date ||
      !['Entrata', 'Uscita'].includes(type) || !Number.isFinite(amount) || amount < 0 || !description || description.length > 250 ||
      !category || category.length > 80) return null;
  return { date, year, month, day, amount, description, category, type };
}

function validPeriod_(year, month) { return Number.isInteger(year) && year >= 2000 && year <= 2200 && Number.isInteger(month) && month >= 1 && month <= 12; }
function numberOrNull_(value) { if (value == null || value === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function normalizeEmail_(value) { return String(value || '').trim().toLowerCase(); }
function bearer_(request) { const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || ''); return match ? match[1] : ''; }
function safeEqual_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  let diff = left.length ^ right.length; const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return diff === 0;
}
function authError_(payload) {
  const message = String(payload?.msg || payload?.message || payload?.error_description || '');
  if (/invalid login|invalid credentials|email not confirmed/i.test(message)) return 'Email o password non corretti, oppure verifica prima la tua email.';
  if (/already registered|user already registered/i.test(message)) return 'Esiste già un account con questa email. Accedi oppure verifica il messaggio email.';
  return 'Autenticazione non riuscita. Controlla email e password e riprova.';
}
async function readJson_(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 30000) throw new Error('Request too large.');
  const data = await request.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid request.');
  return data;
}
function json_(payload, status, cors) {
  return new Response(JSON.stringify(payload), { status, headers: { ...RESPONSE_HEADERS, ...cors } });
}

