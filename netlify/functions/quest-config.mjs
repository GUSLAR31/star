import { getStore } from '@netlify/blobs';

const DEFAULT_CONFIG = {
  finalLocationText: 'ПОСЛЕДНИЙ КРИСТАЛЛ ЖДЁТ ТЕБЯ на улице Имперского Стратега, комплекс «Турболазер-7.',
  adminPin: '1234',
  missionOverrides: {},
  missionMedia: {},
  planetOverrides: null
};

// Fields inside a mission override that must NEVER reach an unauthenticated
// browser: they either ARE the correct answer (stageAnswers, resultKey) or
// reveal which QR codes are genuine vs. traps (qr.correct / qr.trap).
function redact(config) {
  const clone = JSON.parse(JSON.stringify(config));
  const overrides = clone.missionOverrides || {};
  for (const mid of Object.keys(overrides)) {
    delete overrides[mid].stageAnswers;
    delete overrides[mid].resultKey;
    delete overrides[mid].qr;
  }
  return clone;
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, x-admin-pin',
        'access-control-allow-methods': 'GET, POST, OPTIONS'
      },
      extraHeaders || {}
    )
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, x-admin-pin',
        'access-control-allow-methods': 'GET, POST, OPTIONS'
      }
    });
  }

  const store = getStore({ name: 'quest-config', consistency: 'strong' });

  if (req.method === 'GET') {
    const data = (await store.get('config', { type: 'json' })) || DEFAULT_CONFIG;
    const providedPin = req.headers.get('x-admin-pin') || '';
    const currentPin = data.adminPin || DEFAULT_CONFIG.adminPin;
    const isAdmin = providedPin && providedPin === currentPin;
    return json(isAdmin ? data : redact(data));
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json({ error: 'Некорректный JSON' }, 400);
    }

    const current = (await store.get('config', { type: 'json' })) || DEFAULT_CONFIG;
    const currentPin = current.adminPin || DEFAULT_CONFIG.adminPin;
    const providedPin = req.headers.get('x-admin-pin') || '';

    if (providedPin !== currentPin) {
      return json({ error: 'Неверный PIN-код' }, 403);
    }

    // Deep-merge per-mission fields so saving one mission never wipes another.
    const mergedMissionOverrides = Object.assign({}, current.missionOverrides || {});
    for (const [mid, val] of Object.entries(body.missionOverrides || {})) {
      mergedMissionOverrides[mid] = Object.assign({}, mergedMissionOverrides[mid] || {}, val);
    }
    const mergedMissionMedia = Object.assign({}, current.missionMedia || {});
    for (const [mid, val] of Object.entries(body.missionMedia || {})) {
      mergedMissionMedia[mid] = Object.assign({}, mergedMissionMedia[mid] || {}, val);
    }

    const merged = Object.assign({}, current, body, {
      missionOverrides: mergedMissionOverrides,
      missionMedia: mergedMissionMedia
    });

    await store.setJSON('config', merged);
    // Echo back the FULL (unredacted) config to the admin caller who just
    // authenticated with the correct PIN, so their editor stays in sync.
    return json(merged);
  }

  return json({ error: 'Метод не поддерживается' }, 405);
};

