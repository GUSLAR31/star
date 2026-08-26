import { getStore } from '@netlify/blobs';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB per file

function withCors(headers) {
  return Object.assign(
    {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-admin-pin',
      'access-control-allow-methods': 'GET, PUT, OPTIONS'
    },
    headers || {}
  );
}
function jsonRes(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: withCors({ 'content-type': 'application/json' })
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: withCors() });
  }

  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  if (!key) return jsonRes({ error: 'Не указан key' }, 400);

  const store = getStore({ name: 'quest-media', consistency: 'strong' });

  if (req.method === 'GET') {
    const meta = await store.getMetadata(key);
    if (!meta) return new Response('Not found', { status: 404, headers: withCors() });
    const data = await store.get(key, { type: 'arrayBuffer' });
    if (!data) return new Response('Not found', { status: 404, headers: withCors() });
    return new Response(data, {
      status: 200,
      headers: withCors({
        'content-type': (meta.metadata && meta.metadata.contentType) || 'application/octet-stream',
        'cache-control': 'public, max-age=86400'
      })
    });
  }

  if (req.method === 'PUT') {
    const configStore = getStore({ name: 'quest-config', consistency: 'strong' });
    const cfg = await configStore.get('config', { type: 'json' });
    const currentPin = (cfg && cfg.adminPin) || '1234';
    const providedPin = req.headers.get('x-admin-pin') || '';
    if (providedPin !== currentPin) {
      return jsonRes({ error: 'Неверный PIN-код' }, 403);
    }

    const contentType = req.headers.get('content-type') || 'application/octet-stream';
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return jsonRes({ error: 'Файл слишком большой (максимум 20 МБ)' }, 413);
    }
    await store.set(key, buf, { metadata: { contentType } });
    return jsonRes({
      ok: true,
      key,
      url: '/.netlify/functions/quest-asset?key=' + encodeURIComponent(key)
    });
  }

  return jsonRes({ error: 'Метод не поддерживается' }, 405);
};
