const RESPONSE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigin = env.ALLOWED_ORIGIN;
    const cors = origin && origin === allowedOrigin ? {
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Accept, Content-Type',
      'access-control-max-age': '600',
      vary: 'Origin',
    } : { vary: 'Origin' };
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return origin === allowedOrigin
        ? new Response(null, { status: 204, headers: { ...RESPONSE_HEADERS, ...cors } })
        : json_({ error: 'Origin not allowed.' }, 403, cors);
    }
    if (origin && origin !== allowedOrigin) return json_({ error: 'Origin not allowed.' }, 403, cors);
    if (!env.GAS_URL || !env.API_SECRET || !allowedOrigin) return json_({ error: 'Service is not configured.' }, 503, cors);

    let action;
    let gasRequest;
    if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
      action = 'bootstrap';
      gasRequest = { action, secret: env.API_SECRET };
    } else if (url.pathname === '/api/movimenti/edit' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (!body || !body.changes) return json_({ error: 'Invalid edit request.' }, 400, cors);
        action = 'editMovement';
        gasRequest = { action, secret: env.API_SECRET, id: body.id, changes: body.changes };
      } catch (error) {
        return json_({ error: 'Invalid edit request.' }, 400, cors);
      }
    } else if (url.pathname === '/api/saldi/save' && request.method === 'POST') {
      try {
        const body = await request.json();
        action = 'saveBalance';
        gasRequest = {
          action,
          secret: env.API_SECRET,
          anno: body.anno,
          mese: body.mese,
          contoFinale: body.contoFinale,
          contantiFinali: body.contantiFinali,
          investimentiFinali: body.investimentiFinali,
        };
      } catch (error) {
        return json_({ error: 'Invalid balance request.' }, 400, cors);
      }
    } else if (url.pathname === '/api/budgets/categories' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (!Array.isArray(body.budgets)) return json_({ error: 'Invalid category budget request.' }, 400, cors);
        action = 'saveCategoryBudgets';
        gasRequest = { action, secret: env.API_SECRET, anno: body.anno, mese: body.mese, total: body.total, budgets: body.budgets };
      } catch (error) {
        return json_({ error: 'Invalid category budget request.' }, 400, cors);
      }
    } else if (url.pathname.startsWith('/api/')) {
      return json_({ error: 'Method not allowed.' }, 405, { ...cors, allow: 'GET /api/bootstrap, POST /api/movimenti/edit, POST /api/saldi/save, POST /api/budgets/categories, OPTIONS' });
    } else {
      return json_({ error: 'Not found.' }, 404, cors);
    }

    try {
      const upstream = await fetch(env.GAS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(gasRequest),
        redirect: 'follow',
      });
      const payload = await upstream.json();
      if (!upstream.ok || !payload || payload.ok !== true) {
        return json_({ error: 'Unable to complete the request.' }, 502, cors);
      }
      if (action === 'bootstrap' &&
          (!Array.isArray(payload.movimenti) || !Array.isArray(payload.budgets) ||
           !Array.isArray(payload.saldi) || !Array.isArray(payload.categoryBudgets))) {
        return json_({ error: 'Invalid bootstrap response.' }, 502, cors);
      }
      return json_(payload, 200, cors);
    } catch (error) {
      return json_({ error: 'Unable to complete the request.' }, 502, cors);
    }
  },
};

function json_(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...RESPONSE_HEADERS, ...cors },
  });
}
