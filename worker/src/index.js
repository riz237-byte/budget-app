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
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Accept, Content-Type',
      'access-control-max-age': '600',
      vary: 'Origin',
    } : { vary: 'Origin' };
    const url = new URL(request.url);

    if (url.pathname !== '/api/bootstrap') return json_({ error: 'Not found.' }, 404, cors);
    if (request.method === 'OPTIONS') {
      return origin === allowedOrigin
        ? new Response(null, { status: 204, headers: { ...RESPONSE_HEADERS, ...cors } })
        : json_({ error: 'Origin not allowed.' }, 403, cors);
    }
    if (request.method !== 'GET') return json_({ error: 'Method not allowed.' }, 405, { ...cors, allow: 'GET, OPTIONS' });
    if (origin && origin !== allowedOrigin) return json_({ error: 'Origin not allowed.' }, 403, cors);
    if (!env.GAS_URL || !env.API_SECRET || !allowedOrigin) return json_({ error: 'Service is not configured.' }, 503, cors);

    try {
      const upstream = await fetch(env.GAS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'bootstrap', secret: env.API_SECRET }),
        redirect: 'follow',
      });
      const payload = await upstream.json();
      if (!upstream.ok || !payload || payload.ok !== true ||
          !Array.isArray(payload.movimenti) || !Array.isArray(payload.budgets) || !Array.isArray(payload.saldi)) {
        return json_({ error: 'Unable to load budget data.' }, 502, cors);
      }
      return json_(payload, 200, cors);
    } catch (error) {
      return json_({ error: 'Unable to load budget data.' }, 502, cors);
    }
  },
};

function json_(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...RESPONSE_HEADERS, ...cors },
  });
}

