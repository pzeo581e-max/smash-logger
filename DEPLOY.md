# デプロイ手順（Cloudflare Workers + 静的アセット）

静的フロント（index.html / fighters.js）と API（/log, /meta, /icon, /history, /rate）を
**Cloudflare の1プロジェクト**で配信する。GitHub の main に push すると自動デプロイされる。

## 初回セットアップ

1. Cloudflare ダッシュボード > Workers & Pages > Create > Import a repository
2. リポジトリ `pzeo581e-max/smash-logger` / ブランチ `main`
3. 設定
   - **Project name: `smash-logger-app`**（既存の Worker `smash-logger` と名前が衝突するため別名）
   - Build command: 空欄
   - Deploy command: `npx wrangler deploy`（既定のまま）
4. Deploy を押す。ルートの `wrangler.toml` が読まれる
5. デプロイ後、Settings > Variables and Secrets に **Secret を2つ**登録

   | 名前 | 種別 | 値 |
   |---|---|---|
   | `NOTION_TOKEN` | Secret | Notion インテグレーションのトークン |
   | `APP_TOKEN` | Secret | アプリの合言葉 |

   ※ `ALLOWED_ORIGIN` / `MATCH_DB_ID` / `MEMO_DB_ID` は `wrangler.toml` に書いてあるので登録不要
6. 発行された URL（`https://smash-logger-app.<サブドメイン>.workers.dev`）を開く
7. ⚙タブの「Worker の URL」に**同じURL**を入れて接続テスト

## 移行が終わったら

- `wrangler.toml` の `ALLOWED_ORIGIN` を新しい URL に書き換える
- 旧 Worker `smash-logger` を削除
- GitHub Pages を無効化

## 以降の更新

main に push するだけ。Cloudflare 側の手動コピペは不要。

## 構成

```
index.html             入力フロント（対戦 / メモ / 履歴 / 設定）
fighters.js            ファイター86体のデータ
worker/src/index.js    API ロジック本体（main に指定）
wrangler.toml          デプロイ設定
.assetsignore          静的公開から除外するファイル
```
