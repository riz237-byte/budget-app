const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};
const PASSWORD_ITERATIONS = 310000;
const SESSION_DAYS = 30;
const AUTH_WINDOW_SECONDS = 900;
const AUTH_MAX_ATTEMPTS = 8;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowedOrigin = env.ALLOWED_ORIGIN;
    const cors = origin === allowedOrigin ? {
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Accept, Content-Type, Authorization, X-Setup-Key',
      'access-control-max-age': '600',
      vary: 'Origin',
    } : { vary: 'Origin' };

    if (request.method === 'OPTIONS') {
      return origin === allowedOrigin
        ? new Response(null, { status: 204, headers: { ...HEADERS, ...cors } })
        : json_({ error: 'Origin not allowed.' }, 403, cors);
    }
    if (!allowedOrigin || !env.DB || (origin && origin !== allowedOrigin)) {
      return json_({ error: 'Service is not configured.' }, 503, cors);
    }

    try {
      if (url.pathname === '/api/auth/status' && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
        return json_({ ok: true, setupRequired: Number(row?.count || 0) === 0 }, 200, cors);
      }
      if (url.pathname === '/api/auth/setup' && request.method === 'POST') {
        return await setup_(request, env, cors);
      }
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return await login_(request, env, cors);
      }
      if (!url.pathname.startsWith('/api/')) return json_({ error: 'Not found.' }, 404, cors);

      const user = await authenticate_(request, env.DB);
      if (!user) return json_({ error: 'Sessione non valida. Accedi di nuovo.' }, 401, cors);
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        const token = bearer_(request);
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256_(token)).run();
        return json_({ ok: true }, 200, cors);
      }
      if (url.pathname === '/api/migration/status' && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT value FROM app_meta WHERE key = ?').bind('sheet_migration').first();
        return json_({ ok: true, complete: Boolean(row), counts: row ? JSON.parse(row.value) : null }, 200, cors);
      }
      if (url.pathname === '/api/migration/import' && request.method === 'POST') {
        return await migrateFromSheet_(env, user.id, cors);
      }
      if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
        return json_(await bootstrap_(env.DB, user.id), 200, cors);
      }
      if (url.pathname === '/api/movimenti/edit' && request.method === 'POST') {
        return await editMovement_(request, env.DB, user.id, cors);
      }
      if (url.pathname === '/api/saldi/save' && request.method === 'POST') {
        return await saveBalance_(request, env.DB, user.id, cors);
      }
      if (url.pathname === '/api/budgets/categories' && request.method === 'POST') {
        return await saveCategoryBudgets_(request, env.DB, user.id, cors);
      }
      return json_({ error: 'Not found.' }, 404, cors);
    } catch (error) {
      return json_({ error: 'Impossibile completare la richiesta.' }, 500, cors);
    }
  },
};

async function setup_(request, env, cors) {
  if (!env.OWNER_EMAIL || !env.INITIAL_SETUP_KEY || env.INITIAL_SETUP_KEY.length < 32) return json_({ error: 'Configurazione iniziale incompleta.' }, 503, cors);
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  if (Number(row?.count || 0) !== 0) return json_({ error: 'Account già configurato.' }, 409, cors);
  const attempt = await checkRateLimit_(request, env.DB);
  if (!attempt.allowed) return json_({ error: 'Troppi tentativi. Riprova tra 15 minuti.' }, 429, cors);
  const body = await jsonBody_(request);
  const email = normalizeEmail_(body.email);
  const password = String(body.password || '');
  const setupKey = request.headers.get('X-Setup-Key') || '';
  if (!safeEqual_(setupKey, env.INITIAL_SETUP_KEY) || email !== normalizeEmail_(env.OWNER_EMAIL) || !validPassword_(password)) {
    await recordFailedAttempt_(request, env.DB);
    return json_({ error: 'Dati di configurazione non validi.' }, 400, cors);
  }
  const id = crypto.randomUUID();
  const salt = randomToken_(16);
  const hash = await passwordHash_(password, salt);
  await env.DB.prepare('INSERT INTO users (id, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, email, salt, hash, nowSeconds_()).run();
  await clearAttempts_(request, env.DB);
  return json_(await createSession_(env.DB, id), 201, cors);
}

async function login_(request, env, cors) {
  const attempt = await checkRateLimit_(request, env.DB);
  if (!attempt.allowed) return json_({ error: 'Troppi tentativi. Riprova tra 15 minuti.' }, 429, cors);
  const body = await jsonBody_(request);
  const email = normalizeEmail_(body.email);
  const password = String(body.password || '');
  const user = await env.DB.prepare('SELECT id, password_salt, password_hash FROM users WHERE email = ?')
    .bind(email).first();
  const providedHash = user ? await passwordHash_(password, user.password_salt) : await passwordHash_(password, 'budget-app-fixed-salt');
  if (!user || !safeEqual_(providedHash, user.password_hash)) {
    await recordFailedAttempt_(request, env.DB);
    return json_({ error: 'Email o password non corretti.' }, 401, cors);
  }
  await clearAttempts_(request, env.DB);
  return json_(await createSession_(env.DB, user.id), 200, cors);
}

async function authenticate_(request, db) {
  const token = bearer_(request);
  if (!token || token.length > 256) return null;
  const tokenHash = await sha256_(token);
  const row = await db.prepare(`SELECT users.id, users.email FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).bind(tokenHash, nowSeconds_()).first();
  return row || null;
}

async function createSession_(db, userId) {
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(nowSeconds_()).run();
  const token = randomToken_(32);
  const expiresAt = nowSeconds_() + SESSION_DAYS * 86400;
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256_(token), userId, expiresAt).run();
  return { ok: true, token, expiresAt };
}

async function bootstrap_(db, userId) {
  const [movementResult, budgetResult, balanceResult, categoryResult] = await Promise.all([
    db.prepare(`SELECT id, date AS data, CAST(strftime('%s', date) AS INTEGER) * 1000 AS timestamp,
      year AS anno, month - 1 AS mese, type AS tipo, description AS descrizione, amount AS importo, category AS categoria
      FROM movements WHERE user_id = ? ORDER BY date DESC, id`).bind(userId).all(),
    db.prepare('SELECT year AS anno, month AS mese, amount AS budget FROM monthly_budgets WHERE user_id = ? ORDER BY year, month').bind(userId).all(),
    db.prepare(`SELECT year AS anno, month AS mese, account_opening AS contoIniziale, cash_opening AS contantiIniziali,
      investment_opening AS investimentiInizioMese, account_final AS contoFinale, cash_final AS contantiFinali,
      investment_final AS investimentiFinali FROM balances WHERE user_id = ? ORDER BY year, month`).bind(userId).all(),
    db.prepare(`SELECT year AS anno, month AS mese, category AS categoria, amount AS budget, percentage AS percentuale
      FROM category_budgets WHERE user_id = ? ORDER BY year, month, category`).bind(userId).all(),
  ]);
  return { ok: true, movimenti: movementResult.results, budgets: budgetResult.results,
    saldi: balanceResult.results, categoryBudgets: categoryResult.results };
}

async function migrateFromSheet_(env, userId, cors) {
  const db = env.DB;
  const existing = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind('sheet_migration').first();
  if (existing) return json_({ ok: true, complete: true, counts: JSON.parse(existing.value) }, 200, cors);
  if (!env.GAS_URL || !env.API_SECRET) return json_({ error: 'Collegamento temporaneo al foglio non configurato.' }, 503, cors);

  const upstream = await fetch(env.GAS_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'bootstrap', secret: env.API_SECRET }), redirect: 'follow',
  });
  const source = await upstream.json();
  if (!upstream.ok || source?.ok !== true || !Array.isArray(source.movimenti) || !Array.isArray(source.budgets) ||
      !Array.isArray(source.saldi) || !Array.isArray(source.categoryBudgets)) {
    return json_({ error: 'Non è stato possibile leggere i dati del foglio.' }, 502, cors);
  }

  const counts = { movimenti: source.movimenti.length, budgets: source.budgets.length,
    saldi: source.saldi.length, categoryBudgets: source.categoryBudgets.length };
  const actions = [];
  for (const item of source.movimenti) {
    const id = String(item.id ?? '').trim();
    const date = String(item.data || '');
    const parsed = validateMovement_({ data: date, tipo: item.tipo, descrizione: item.descrizione,
      importo: item.importo, categoria: item.categoria || 'Altro' });
    if (!id || !parsed) throw new Error('Il foglio contiene un movimento non valido.');
    actions.push(db.prepare(`INSERT INTO movements (id, user_id, date, year, month, type, description, amount, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET date=excluded.date, year=excluded.year,
      month=excluded.month, type=excluded.type, description=excluded.description, amount=excluded.amount, category=excluded.category`)
      .bind(`sheet-${id}`, userId, parsed.date, parsed.year, parsed.month, parsed.type, parsed.description, parsed.amount, parsed.category));
  }
  for (const item of source.budgets) {
    const year = Number(item.anno); const month = Number(item.mese); const amount = Number(item.budget);
    if (!validPeriod_(year, month) || !Number.isFinite(amount) || amount < 0) throw new Error('Il foglio contiene un budget non valido.');
    actions.push(db.prepare(`INSERT INTO monthly_budgets (user_id, year, month, amount) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, year, month) DO UPDATE SET amount=excluded.amount`).bind(userId, year, month, amount));
  }
  for (const item of source.saldi) {
    const year = Number(item.anno); const month = Number(item.mese);
    if (!validPeriod_(year, month)) throw new Error('Il foglio contiene un saldo non valido.');
    const values = [item.contoIniziale, item.contantiIniziali, item.investimentiInizioMese,
      item.contoFinale, item.contantiFinali, item.investimentiFinali].map((value) => value === '' || value == null ? null : Number(value));
    if (values.some((value) => value !== null && (!Number.isFinite(value) || value < 0))) throw new Error('Il foglio contiene un saldo non valido.');
    actions.push(db.prepare(`INSERT INTO balances (user_id, year, month, account_opening, cash_opening, investment_opening,
      account_final, cash_final, investment_final) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, year, month) DO UPDATE SET account_opening=excluded.account_opening, cash_opening=excluded.cash_opening,
      investment_opening=excluded.investment_opening, account_final=excluded.account_final, cash_final=excluded.cash_final,
      investment_final=excluded.investment_final`).bind(userId, year, month, ...values));
  }
  for (const item of source.categoryBudgets) {
    const year = Number(item.anno); const month = Number(item.mese); const category = String(item.categoria || '').trim();
    const amount = Number(item.budget); const percentage = item.percentuale == null || item.percentuale === '' ? 0 : Number(item.percentuale);
    if (!validPeriod_(year, month) || !category || category.length > 80 || !Number.isFinite(amount) || amount < 0 ||
        !Number.isFinite(percentage) || percentage < 0) throw new Error('Il foglio contiene budget per categoria non validi.');
    actions.push(db.prepare(`INSERT INTO category_budgets (user_id, year, month, category, amount, percentage) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, year, month, category) DO UPDATE SET amount=excluded.amount, percentage=excluded.percentage`)
      .bind(userId, year, month, category, amount, percentage));
  }

  for (let index = 0; index < actions.length; index += 80) await db.batch(actions.slice(index, index + 80));
  await db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').bind('sheet_migration', JSON.stringify(counts)).run();
  return json_({ ok: true, complete: true, counts }, 200, cors);
}

async function editMovement_(request, db, userId, cors) {
  const body = await jsonBody_(request);
  const id = String(body.id || '');
  const changes = body.changes || {};
  const valid = validateMovement_(changes);
  if (!id || !valid) return json_({ error: 'Valori del movimento non validi.' }, 400, cors);
  const result = await db.prepare(`UPDATE movements SET date = ?, year = ?, month = ?, type = ?, description = ?, amount = ?, category = ?
    WHERE id = ? AND user_id = ?`).bind(valid.date, valid.year, valid.month, valid.type, valid.description,
      valid.amount, valid.category, id, userId).run();
  if (!result.meta.changes) return json_({ error: 'Movimento non trovato.' }, 404, cors);
  return json_({ ok: true, id }, 200, cors);
}

async function saveBalance_(request, db, userId, cors) {
  const body = await jsonBody_(request);
  const year = Number(body.anno); const month = Number(body.mese);
  const values = [Number(body.contoFinale), Number(body.contantiFinali), Number(body.investimentiFinali)];
  if (!validPeriod_(year, month) || values.some((n) => !Number.isFinite(n) || n < 0)) return json_({ error: 'Saldo non valido.' }, 400, cors);
  const prior = await db.prepare(`SELECT account_final, cash_final, investment_final FROM balances
    WHERE user_id = ? AND (year * 12 + month) < ? ORDER BY year DESC, month DESC LIMIT 1`)
    .bind(userId, year * 12 + month).first();
  const opening = prior ? [prior.account_final, prior.cash_final, prior.investment_final] : [0, 0, 0];
  await db.prepare(`INSERT INTO balances (user_id, year, month, account_opening, cash_opening, investment_opening,
    account_final, cash_final, investment_final) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, year, month) DO UPDATE SET account_final = excluded.account_final,
    cash_final = excluded.cash_final, investment_final = excluded.investment_final`)
    .bind(userId, year, month, ...opening, ...values).run();
  return json_({ ok: true, balance: { anno: year, mese: month } }, 200, cors);
}

async function saveCategoryBudgets_(request, db, userId, cors) {
  const body = await jsonBody_(request);
  const year = Number(body.anno); const month = Number(body.mese); const total = Number(body.total);
  if (!validPeriod_(year, month) || !Number.isFinite(total) || total < 0 || !Array.isArray(body.budgets) || body.budgets.length !== 6) {
    return json_({ error: 'Budget non valido.' }, 400, cors);
  }
  const categories = new Set();
  const rows = body.budgets.map((entry) => {
    const category = String(entry.categoria || '').trim();
    const amount = Number(entry.budget); const percentage = Number(entry.percentuale);
    if (!category || category.length > 80 || categories.has(category) || !Number.isFinite(amount) || amount < 0 ||
        !Number.isFinite(percentage) || percentage < 0) return null;
    categories.add(category); return { category, amount, percentage };
  });
  if (rows.some((row) => !row)) return json_({ error: 'Categorie budget non valide.' }, 400, cors);
  const statements = [db.prepare(`INSERT INTO monthly_budgets (user_id, year, month, amount) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, year, month) DO UPDATE SET amount = excluded.amount`).bind(userId, year, month, total)];
  rows.forEach((row) => statements.push(db.prepare(`INSERT INTO category_budgets (user_id, year, month, category, amount, percentage)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, year, month, category) DO UPDATE SET amount = excluded.amount,
    percentage = excluded.percentage`).bind(userId, year, month, row.category, row.amount, row.percentage)));
  await db.batch(statements);
  const [budgets, categoryBudgets] = await Promise.all([
    db.prepare('SELECT year AS anno, month AS mese, amount AS budget FROM monthly_budgets WHERE user_id = ? ORDER BY year, month').bind(userId).all(),
    db.prepare(`SELECT year AS anno, month AS mese, category AS categoria, amount AS budget, percentage AS percentuale
      FROM category_budgets WHERE user_id = ? ORDER BY year, month, category`).bind(userId).all(),
  ]);
  return json_({ ok: true, budgets: budgets.results, categoryBudgets: categoryBudgets.results }, 200, cors);
}

function validateMovement_(change) {
  const date = String(change.data || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const year = match ? Number(match[1]) : 0; const month = match ? Number(match[2]) : 0;
  const day = match ? Number(match[3]) : 0;
  const amount = Number(change.importo);
  const description = String(change.descrizione || '').trim();
  const category = String(change.categoria || '').trim();
  const type = String(change.tipo || '');
  if (!match || new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== date ||
      !['Entrata', 'Uscita'].includes(type) || !Number.isFinite(amount) || amount < 0 ||
      !description || description.length > 250 || !category || category.length > 80) return null;
  return { date, year, month, amount, description, category, type };
}

async function checkRateLimit_(request, db) {
  const key = await clientKey_(request);
  const since = nowSeconds_() - AUTH_WINDOW_SECONDS;
  const row = await db.prepare('SELECT COALESCE(SUM(attempts), 0) AS count FROM auth_attempts WHERE client_key = ? AND window_start > ?')
    .bind(key, since).first();
  return { allowed: Number(row?.count || 0) < AUTH_MAX_ATTEMPTS, key };
}

async function recordFailedAttempt_(request, db) {
  const key = await clientKey_(request); const now = nowSeconds_(); const windowStart = Math.floor(now / AUTH_WINDOW_SECONDS) * AUTH_WINDOW_SECONDS;
  await db.prepare(`INSERT INTO auth_attempts (client_key, window_start, attempts) VALUES (?, ?, 1)
    ON CONFLICT(client_key, window_start) DO UPDATE SET attempts = attempts + 1`).bind(key, windowStart).run();
  await db.prepare('DELETE FROM auth_attempts WHERE window_start < ?').bind(now - 2 * AUTH_WINDOW_SECONDS).run();
}

async function clearAttempts_(request, db) {
  await db.prepare('DELETE FROM auth_attempts WHERE client_key = ?').bind(await clientKey_(request)).run();
}

async function clientKey_(request) {
  return sha256_(request.headers.get('CF-Connecting-IP') || 'unknown');
}

async function passwordHash_(password, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' }, material, 256);
  return toBase64Url_(new Uint8Array(bits));
}

async function sha256_(text) {
  return toBase64Url_(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

function randomToken_(bytes) {
  const data = new Uint8Array(bytes); crypto.getRandomValues(data); return toBase64Url_(data);
}

function toBase64Url_(data) {
  let binary = ''; data.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function safeEqual_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return diff === 0;
}

function normalizeEmail_(value) { return String(value || '').trim().toLowerCase(); }
function validPassword_(value) { return value.length >= 12 && value.length <= 128; }
function validPeriod_(year, month) { return Number.isInteger(year) && year >= 2000 && year <= 2200 && Number.isInteger(month) && month >= 1 && month <= 12; }
function nowSeconds_() { return Math.floor(Date.now() / 1000); }
function bearer_(request) { const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || ''); return match ? match[1] : ''; }

async function jsonBody_(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 20000) throw new Error('Request too large.');
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body.');
  return body;
}

function json_(payload, status, cors) {
  return new Response(JSON.stringify(payload), { status, headers: { ...HEADERS, ...cors } });
}

