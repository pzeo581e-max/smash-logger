/**
 * スマブラ記録 中継Worker
 * ブラウザ(GitHub Pages) → このWorker → Notion API
 * Notionのトークンはここ（Secret）にだけ置く。ブラウザには出さない。
 */

const NOTION = 'https://api.notion.com/v1/pages';
const NOTION_VERSION = '2022-06-28';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
    const allowOrigin = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

    // 合言葉チェック
    if (env.APP_TOKEN && request.headers.get('X-App-Token') !== env.APP_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }

    let b;
    try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

    let payload;
    if (b.type === 'match') {
      if (!b.meId || !b.vsId || !b.result) return json({ error: '自分/相手/勝敗が必要です' }, 400);
      payload = {
        parent: { database_id: env.MATCH_DB_ID },
        properties: {
          'メモ':  { title: [{ text: { content: (b.memo || '（メモなし）').slice(0, 2000) } }] },
          '勝敗':  { select: { name: b.result } },
          '自分':  { relation: [{ id: b.meId }] },
          '相手':  { relation: [{ id: b.vsId }] },
        },
      };
    } else if (b.type === 'memo') {
      if (!b.memo) return json({ error: 'メモが空です' }, 400);
      payload = {
        parent: { database_id: env.MEMO_DB_ID },
        properties: {
          'メモ':  { title: [{ text: { content: b.memo.slice(0, 2000) } }] },
          '日付':  { date: { start: b.date || new Date().toISOString().slice(0, 10) } },
        },
      };
    } else {
      return json({ error: 'unknown type' }, 400);
    }

    const res = await fetch(NOTION, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: data.message || 'notion error' }, res.status);
    return json({ ok: true, url: data.url });
  },
};
