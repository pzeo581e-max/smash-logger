/**
 * スマブラ記録 中継Worker
 * ブラウザ(GitHub Pages) → このWorker → Notion API
 * Notionトークンはここ（Secret）にだけ置く。ブラウザには出さない。
 *
 * POST /log   … 対戦 / メモ / レート を追加・更新
 * GET  /meta  … アイコンを持つファイターの一覧＋直近100戦の使用回数
 * GET  /icon?id=<pageId> … アイコン画像を中継（Notionの署名URLは5分で切れるため）
 *                          画像を返すだけなので合言葉は不要
 * GET  /history?limit=100 … 対戦履歴とメモ履歴（端末をまたいで分析するため）
 * GET  /rate?season=第26期 … 期別レートの現在値
 *
 * スマメイトの対戦は 対戦種別=スマメイト / レート / レート変動 / 期(リレーション) まで記録する。
 */

const V = '2022-06-28';
const DB = {
  match:   '',  // env.MATCH_DB_ID
  memo:    '',  // env.MEMO_DB_ID
  fighter: '97ca75a8-74d9-4a3e-bf87-bae775e9db14', // 👤 ファイター（スマブラSP）
  rate:    'db5c5dfe-b9f0-4389-89b6-49fe4e653c56', // 📈 スマメイト 期別レート
};
const RECENT = 100;

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
const txt = p => p?.title?.[0]?.plain_text ?? p?.rich_text?.[0]?.plain_text ?? '';

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

    const call = (method, url, body) => fetch('https://api.notion.com/v1' + url, {
      method,
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': V,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(r => r.json());
    const notion = (url, body) => call(body ? 'POST' : 'GET', url, body);
    const patch  = (url, body) => call('PATCH', url, body);

    const matchDb   = env.MATCH_DB_ID   || DB.match;
    const memoDb    = env.MEMO_DB_ID    || DB.memo;
    const fighterDb = env.FIGHTER_DB_ID || DB.fighter;
    const rateDb    = env.RATE_DB_ID    || DB.rate;

    // 期別レートの行を取得（無ければ作る）
    const seasonRow = async (season) => {
      if (!season) return null;
      const q = await notion(`/databases/${rateDb}/query`,
        { page_size: 1, filter: { property: '期', title: { equals: season } } });
      if (q.results?.[0]) return q.results[0];
      const created = await notion('/pages', { parent: { database_id: rateDb },
        properties: { '期': { title: [{ text: { content: season } }] } } });
      return created.object === 'error' ? null : created;
    };

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
      const icons = {}, noIcon = [];
      for (const p of f.results || []) {
        const ic = p.icon;
        // カスタム絵文字・外部リンクは期限なし → URLをそのまま渡す
        // アップロード画像は5分で失効 → '@' を返してブラウザに /icon 経由で取りに来させる
        if (ic?.type === 'custom_emoji' && ic.custom_emoji?.url) icons[p.id] = ic.custom_emoji.url;
        else if (ic?.type === 'external' && ic.external?.url) icons[p.id] = ic.external.url;
        else if (ic?.type === 'file') icons[p.id] = '@';
        else noIcon.push(txt(p.properties?.['ファイター']) || p.id);
      }
      const counts = {};
      for (const p of m.results || [])
        for (const r of p.properties?.['自分']?.relation || []) counts[r.id] = (counts[r.id] || 0) + 1;
      return json({ icons, counts, sampled: (m.results || []).length,
                    fighters: (f.results || []).length, noIcon });
    }

    /* ---------- GET /history ---------- */
    if (request.method === 'GET' && path.endsWith('/history')) {
      const limit = Math.min(Math.max(+u.searchParams.get('limit') || 100, 1), 100);
      const [m, n] = await Promise.all([
        notion(`/databases/${matchDb}/query`, { page_size: limit,
          sorts: [{ timestamp: 'created_time', direction: 'descending' }] }),
        notion(`/databases/${memoDb}/query`, { page_size: 40,
          sorts: [{ timestamp: 'created_time', direction: 'descending' }] }),
      ]);
      return json({
        matches: (m.results || []).map(p => ({
          url: p.url, at: p.created_time,
          result: p.properties?.['勝敗']?.select?.name || null,
          me: p.properties?.['自分']?.relation?.[0]?.id || null,
          vs: p.properties?.['相手']?.relation?.[0]?.id || null,
          memo: txt(p.properties?.['メモ']),
          kind: p.properties?.['対戦種別']?.select?.name || null,
          rate: p.properties?.['レート']?.number ?? null,
          diff: p.properties?.['レート変動']?.number ?? null,
        })),
        memos: (n.results || []).map(p => ({
          url: p.url, at: p.created_time,
          date: p.properties?.['日付']?.date?.start || null,
          tags: (p.properties?.['タグ']?.multi_select || []).map(t => t.name),
          memo: txt(p.properties?.['メモ']),
        })),
      });
    }

    /* ---------- GET /rate ---------- */
    if (request.method === 'GET' && path.endsWith('/rate')) {
      const season = u.searchParams.get('season') || '';
      const q = await notion(`/databases/${rateDb}/query`, season
        ? { page_size: 1, filter: { property: '期', title: { equals: season } } }
        : { page_size: 20, sorts: [{ timestamp: 'created_time', direction: 'descending' }] });
      return json({ rows: (q.results || []).map(p => ({
        id: p.id,
        url: p.url,
        season: txt(p.properties?.['期']),
        last: p.properties?.['最終レート']?.number ?? null,
        best: p.properties?.['最高レート']?.number ?? null,
        record: txt(p.properties?.['戦績']),
      })) });
    }

    /* ---------- POST /log ---------- */
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
    let b;
    try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }

    /* レート更新（期別レートDBを1期1行でupsert） */
    if (b.type === 'rate') {
      const season = (b.season || '').trim();
      if (!season) return json({ error: '期を入力してください' }, 400);
      if (typeof b.rate !== 'number' || !isFinite(b.rate)) return json({ error: 'レートを数値で入力してください' }, 400);
      const q = await notion(`/databases/${rateDb}/query`,
        { page_size: 1, filter: { property: '期', title: { equals: season } } });
      const row = (q.results || [])[0];
      const prevBest = row?.properties?.['最高レート']?.number;
      const best = prevBest == null ? b.rate : Math.max(prevBest, b.rate);
      const props = {
        '最終レート': { number: b.rate },
        '最高レート': { number: best },
        ...(b.record ? { '戦績': { rich_text: [{ text: { content: String(b.record).slice(0, 200) } }] } } : {}),
      };
      const res = row
        ? await patch(`/pages/${row.id}`, { properties: props })
        : await notion('/pages', { parent: { database_id: rateDb },
            properties: { '期': { title: [{ text: { content: season } }] }, ...props } });
      if (res.object === 'error') return json({ error: res.message || 'notion error' }, 400);
      return json({ ok: true, url: res.url, last: b.rate, best, created: !row });
    }

    let payload, extra = {};
    if (b.type === 'match') {
      if (!b.meId || !b.vsId || !b.result) return json({ error: '自分/相手/勝敗が必要です' }, 400);
      const memo = (b.memo || '').trim();
      const kind = b.kind || null;
      const rate = typeof b.rate === 'number' && isFinite(b.rate) ? b.rate : null;
      let diff = null, row = null;

      if (kind === 'スマメイト' && b.season) {
        row = await seasonRow(b.season);
        if (rate != null) {
          // 直前の「レートが入っている対戦」との差を変動として記録する
          const prev = await notion(`/databases/${matchDb}/query`, {
            page_size: 1,
            filter: { and: [{ property: 'レート', number: { is_not_empty: true } },
                            { property: '対戦種別', select: { equals: 'スマメイト' } }] },
            sorts: [{ timestamp: 'created_time', direction: 'descending' }],
          });
          const pr = prev.results?.[0]?.properties?.['レート']?.number;
          if (pr != null) diff = rate - pr;
          // 期別レートの最終・最高を同時に更新
          const best = row?.properties?.['最高レート']?.number;
          await patch(`/pages/${row.id}`, { properties: {
            '最終レート': { number: rate },
            '最高レート': { number: best == null ? rate : Math.max(best, rate) },
            ...(b.record ? { '戦績': { rich_text: [{ text: { content: String(b.record).slice(0, 200) } }] } } : {}),
          } });
          extra = { season: b.season, rate, best: best == null ? rate : Math.max(best, rate), diff };
        }
      }

      payload = {
        parent: { database_id: matchDb },
        properties: {
          'メモ': { title: [{ text: { content: (memo.split('\n')[0] || '（メモなし）').slice(0, 2000) } }] },
          '勝敗': { select: { name: b.result } },
          '自分': { relation: [{ id: b.meId }] },
          '相手': { relation: [{ id: b.vsId }] },
          ...(kind ? { '対戦種別': { select: { name: kind } } } : {}),
          ...(rate != null ? { 'レート': { number: rate } } : {}),
          ...(diff != null ? { 'レート変動': { number: diff } } : {}),
          ...(row ? { '期': { relation: [{ id: row.id }] } } : {}),
        },
        children: memo.includes('\n') ? [{ object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ text: { content: memo.slice(0, 1900) } }] } }] : undefined,
      };
    } else if (b.type === 'memo') {
      const memo = (b.memo || '').trim();
      if (!memo) return json({ error: 'メモが空です' }, 400);
      payload = {
        parent: { database_id: memoDb },
        properties: {
          'メモ': { title: [{ text: { content: memo.split('\n')[0].slice(0, 2000) } }] },
          '日付': { date: { start: b.date || new Date().toISOString().slice(0, 10) } },
          ...(b.tags?.length ? { 'タグ': { multi_select: b.tags.slice(0, 10).map(name => ({ name })) } } : {}),
        },
        children: memo.includes('\n') ? [{ object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ text: { content: memo.slice(0, 1900) } }] } }] : undefined,
      };
    } else {
      return json({ error: 'unknown type' }, 400);
    }

    const data = await notion('/pages', payload);
    if (data.object === 'error') return json({ error: data.message || 'notion error' }, 400);
    // Notionは存在しないページIDのリレーションを黙って捨てるので、入ったか確認して返す
    const warn = [];
    if (b.type === 'match') {
      if (!data.properties?.['自分']?.relation?.length) warn.push('「自分」が登録されませんでした（キャラのIDが古い可能性）');
      if (!data.properties?.['相手']?.relation?.length) warn.push('「相手」が登録されませんでした（キャラのIDが古い可能性）');
    }
    return json({ ok: true, url: data.url, warn, ...extra });
  },
};
