// Cloudflare Pages Functions — catch-all ルート
//
// 動作の仕組み:
//   1. リクエストが来ると Pages はまず静的ファイルを探す
//        /            -> index.html
//        /fighters.js -> fighters.js
//   2. 該当する静的ファイルが無いパス（/log, /meta, /icon, /history, /rate）
//      だけが、このファイルへ流れてくる
//
// ロジック本体は worker/src/index.js のまま使い回している。
// API を直す時は worker/src/index.js を編集すれば、ここは触らなくてよい。
import worker from "../worker/src/index.js";

export const onRequest = (context) => worker.fetch(context.request, context.env);
