/**
 * スマブラ記録 中継Worker
 * ブラウザ(GitHub Pages) → このWorker → Notion API
 * Notionトークンはここ（Secret）にだけ置く。ブラウザには出さない。
 *
 * POST /log   … 対戦 or メモを追加
 * GET  /meta  … ファイターのアイコンURL＋直近100戦の使用回数を返す
 */

const V = '2022-06-28';
const DB = {
  match:   '',  // env.MATCH_DB_ID
  memo:    '',  // env.MEMO_DB_ID
  fighter: '97ca75a8-74d9-4a3e-bf87-bae775e9db14', // 👤 ファイター（スマブラSP）
};
const RECENT = 100; // 使用率を数える直近の対戦数

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
    const allowOrigin = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    const json = (o, s = 200) =>
      new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (env.APP_TOKEN && request.headers.get('X-App-Token') !== env.APP_TOKEN)
      return json({ error: 'unauthorized' }, 401);

    const path = new URL(request.url).pathname.replace(/\/$/, '');
    const notion = (url, body) => fetch('https://api.notion.com/v1' + url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': V,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(r => r.json());

    const matchDb   = env.MATCH_DB_ID || DB.match;
    const memoDb    = env.MEMO_DB_ID  || DB.memo;
    const fighterDb = env.FIGHTER_DB_ID || DB.fighter;

    /* ---------- GET /meta ---------- */
    if (request.method === 'GET' && path.endsWith('/meta')) {
      const [f, m] = await Promise.all([
        notion(`/databases/${fighterDb}/query`, { page_size: 100 }),
        notion(`/databases/${matchDb}/query`, {
          page_size: RECENT,
          sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        }),
      ]);
      const icons = {};
      for (const p of f.results || []) {
        const ic = p.icon;
        const url = ic?.type === 'file' ? ic.file.url : ic?.type === 'external' ? ic.external.url : null;
        if (url) icons[p.id] = url;
      }
      const counts = {};
      for (const p of m.results || []) {
        for (const r of p.properties?.['自分']?.relation || []) counts[r.id] = (counts[r.id] || 0) + 1;
      }
      return json({ icons, counts, sampled: (m.results || []).length });
    }

    /* ---------- POST /log ---------- */
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

    let b;
    try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

    let payload;
    if (b.type === 'match') {
      if (!b.meId || !b.vsId || !b.result) return json({ error: '自分/相手/勝敗が必要です' }, 400);
      payload = {
        parent: { database_id: matchDb },
        properties: {
          'メモ': { title: [{ text: { content: (b.memo || '（メモなし）').slice(0, 2000) } }] },
          '勝敗': { select: { name: b.result } },
          '自分': { relation: [{ id: b.meId }] },
          '相手': { relation: [{ id: b.vsId }] },
        },
      };
    } else if (b.type === 'memo') {
      if (!b.memo) return json({ error: 'メモが空です' }, 400);
      payload = {
        parent: { database_id: memoDb },
        properties: {
          'メモ': { title: [{ text: { content: b.memo.slice(0, 2000) } }] },
          '日付': { date: { start: b.date || new Date().toISOString().slice(0, 10) } },
        },
      };
    } else {
      return json({ error: 'unknown type' }, 400);
    }

    const data = await notion('/pages', payload);
    if (data.object === 'error') return json({ error: data.message || 'notion error' }, 400);
    return json({ ok: true, url: data.url });
  },
};
