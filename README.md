# スマブラ記録フロント（GitHub Pages + Cloudflare Workers）

Notionの2つのDBに、スマホ/PCのブラウザから1タップで書き込むための入力画面です。

- `index.html` … 入力画面（GitHub Pagesで公開）
- `fighters.js` … ファイター89体の名前とNotionページID
- `worker/` … Cloudflare Worker（中継サーバー。Notionトークンを隠す）

書き込み先
| | DB | ID |
|---|---|---|
| 対戦 | 🎮 スマブラ対戦記録 | `df7dde8c-0b99-466d-aefe-e3779f4b06a1` |
| メモ | 🗒 スマブラメモ | `869c23c7-0b13-4a77-9e37-b11b040ebab9` |

---

## 手順

### 1. Notionインテグレーションを作る（5分）
1. https://www.notion.so/profile/integrations → **New integration**
2. 名前は `smash-logger`、種類は **Internal**
3. **Internal Integration Secret**（`ntn_...`）をコピーして控える
4. 「🎮 スマブラ対戦記録」「🗒 スマブラメモ」「👤 ファイター（スマブラSP）」の各DBを開き、
   右上 `...` → **コネクト** → `smash-logger` を追加
   （ファイターDBもリレーション解決に必要）

### 2. Workerをデプロイする（10分）
```bash
cd worker
npx wrangler login
# wrangler.toml の ALLOWED_ORIGIN を自分のGitHub Pages URL に書き換える
npx wrangler secret put NOTION_TOKEN   # 1.で控えた ntn_... を貼る
npx wrangler secret put APP_TOKEN      # 自分で決める合言葉（例: 長いランダム文字列）
npx wrangler deploy
```
最後に表示される `https://smash-logger.xxxx.workers.dev` を控える。

### 3. GitHub Pagesで公開する（5分）
1. GitHubで新しいリポジトリを作る（Publicでも中身にトークンは無いので安全）
2. `index.html` と `fighters.js` をpush
3. Settings → Pages → Source: **Deploy from a branch** / Branch: `main` / `/ (root)`
4. 数分後に `https://YOUR-NAME.github.io/REPO/` が開く

### 4. 初回設定
公開ページを開き、右上の **⚙** から
- Worker の URL（手順2）
- 合言葉（手順2の `APP_TOKEN`）

を入力。端末のlocalStorageに保存され、以降は入力不要。スマホはホーム画面に追加推奨。

---

## 使い方
- **対戦タブ**：自分 → 相手 → 勝ち/負け → メモ → 送信。送信後も「自分」は保持されるので連戦を素早く記録できる。
- **メモタブ**：本文＋日付で 🗒 スマブラメモ に追加。
- 検索ボックスでファイターを絞り込み。「全表示」でタイル一覧を伸ばす。

## アイコン画像を付ける場合
1. head icon画像（[SmashWiki](https://www.ssbwiki.com/Category:Head_icons_(SSBU))）をリポジトリの `icons/` に置く
2. `fighters.js` の各要素に `"icon": "icons/mario.png"` を追記

## セキュリティ
- Notionトークンは Worker の Secret のみ。ブラウザ側には出ない。
- Worker URLを知られても `APP_TOKEN` が無ければ401。
- `ALLOWED_ORIGIN` で自分のページ以外からのブラウザ呼び出しを弾く。

## 壊れたときの確認順
1. `npx wrangler tail` でWorkerのログを見る
2. 401 → 合言葉の不一致 / 400 → プロパティ名の変更 / 404 → DBがインテグレーションに未接続
3. Notionのプロパティ名（`メモ` `勝敗` `自分` `相手` `日付`）を変えたら `worker/src/index.js` も直す
