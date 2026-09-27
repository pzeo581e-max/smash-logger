# デプロイ手順（Cloudflare Pages）

静的フロント（index.html / fighters.js）と API（/log, /meta, /icon, /history, /rate）を
**Cloudflare Pages 1か所**で配信する構成。GitHub の main に push すると自動デプロイされる。

## 初回セットアップ

1. Cloudflare ダッシュボード > Workers & Pages > Create > Pages > Connect to Git
2. リポジトリ `smash-logger` / ブランチ `main` を選択
3. ビルド設定
   - Framework preset: **None**
   - Build command: **空欄**
   - Build output directory: **`/`**（ルート）
4. Settings > Variables and Secrets に以下を登録（Production / Preview 両方）

   | 名前 | 種別 | 値 |
   |---|---|---|
   | `NOTION_TOKEN` | Secret | Notion インテグレーションのトークン |
   | `APP_TOKEN` | Secret | アプリの合言葉 |
   | `ALLOWED_ORIGIN` | Text | 発行された Pages の URL（例 `https://smash-logger.pages.dev`） |
   | `MATCH_DB_ID` | Text | 対戦記録DBのID |
   | `MEMO_DB_ID` | Text | メモDBのID |

5. 変数を入れたら **Deployments > Retry deployment** で再デプロイ（変数は再デプロイで反映）
6. アプリを開き、⚙タブの「Worker の URL」に Pages の URL を入力して「接続テスト」

## 以降の更新

main に push するだけ。Cloudflare 側の手動コピペは不要。

## 構成

```
index.html                 入力フロント（対戦 / メモ / 履歴 / 設定）
fighters.js                ファイター86体のデータ
functions/[[path]].js      Pages Functions の入口（worker を呼ぶだけ）
worker/src/index.js        API ロジック本体
worker/wrangler.toml       旧 Workers 単体運用の設定（参考用）
```
