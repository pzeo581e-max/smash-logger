/**
 * スマブラ記録 中継Worker
 * ブラウザ(GitHub Pages) → このWorker → Notion API
 * Notionトークンはここ（Secret）にだけ置く。ブラウザには出さない。
 *
 * POST /log   … 対戦 or メモを追加
 * GET  /meta  … アイコンを持つファイターの一覧＋直近100戦の使用回数を返す
 * GET  /icon?id=<pageId> … アイコン画像を中継して返す（Notionの署名URLは5分で切れるため）
 *                           画像を返すだけなので合言葉は不要（書き込みは一切できない）
 */

const V = '2022-06-28';
const DB = {
  match:   '',  // env.MATCH_DB_ID
  memo:    '',  // env.MEMO_DB_ID
  fighter: '97ca75a8-74d9-4a3e-bf87-bae775e9db14', // 👤 ファイター（スマブラSP）
};
const RECENT = 100; // 使用率を数える直近の対戦数

function iconUrl(ic) {
  if (!ic) return null;
  if (ic.type === 'file') return ic.file.url;
  if (ic.type === 'external') return ic.external.url;
  if (ic.type === 'custom_emoji') return ic.custom_emoji?.url || null;
  return null; // 絵文字アイコンは画像にできない
}
function withCors(res, cors) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
  return r;
}

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
    const u = new URL(request.url);
    const path = u.pathname.replace(/\/$/, '');
    // /icon は画像を返すだけなので合言葉なしで許可（<img> はヘッダーを送れない）
    if (!(request.method === 'GET' && path.endsWith('/icon'))) {
      if (env.APP_TOKEN && request.headers.get('X-App-Token') !== env.APP_TOKEN)
        return json({ error: 'unauthorized' }, 401);
    }
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

    /* ---------- GET /icon ---------- */
    if (request.method === 'GET' && path.endsWith('/icon')) {
      const id = u.searchParams.get('id');
      if (!id) return json({ error: 'id required' }, 400);
      const key = new Request(new URL('/icon?id=' + id, u.origin).toString());
      const hit = await caches.default.match(key);
      if (hit) return withCors(hit, cors);
      const page = await notion('/pages/' + id);
      const src = iconUrl(page.icon);
      if (!src) return json({ error: 'no icon' }, 404);
      const img = await fetch(src);
      if (!img.ok) return json({ error: 'fetch failed' }, 502);
      const res = new Response(img.body, {
        headers: {
          'Content-Type': img.headers.get('Content-Type') || 'image/png',
          'Cache-Control': 'public, max-age=86400',
        },
      });
      await caches.default.put(key, res.clone());
      return withCors(res, cors);
    }

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
      const noIcon = [];
      for (const p of f.results || []) {
        if (iconUrl(p.icon)) icons[p.id] = 1; else noIcon.push(p.properties?.['ファイター']?.title?.[0]?.plain_text || p.id);
      }
      const counts = {};
      for (const p of m.results || []) {
        for (const r of p.properties?.['自分']?.relation || []) counts[r.id] = (counts[r.id] || 0) + 1;
      }
      return json({ icons, counts, sampled: (m.results || []).length,
                    fighters: (f.results || []).length, noIcon });
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
