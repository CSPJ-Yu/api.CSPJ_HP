/**
 * CSPJ Public API — エントリポイント
 * /src/index.js
 *
 * ルーティングのみを担当する薄い層。実際の公開条件・serialize・画像解決ロジックは
 * すべて src/handlers/* と src/lib/* に置き、ここでは持たない。
 *
 * ルーティングにはWorkersランタイム標準の URLPattern を使う(外部router libraryは
 * 追加しない)。URLPatternはNode環境とWorkerランタイム(workerd)とで細部の挙動差が
 * 起こり得るため、このファイル自体はNode側のunitテスト対象にしない
 * (`npx wrangler dev` + 実HTTPリクエストでのみ検証する)。ハンドラ本体(handlers/*)は
 * URLPatternに一切依存しない形にしてあるので、Node側では handlers/* を直接呼び出す
 * ことでルーティングの実装詳細と切り離してテストできる。
 *
 * GET/OPTIONS以外のメソッドは、ルーティングテーブルに一致するかどうかに関わらず
 * 常に404で統一する(今回の設計方針により405は使わない)。
 */
import { djIndex, djEvents, djNews, djSocialLinks, djPopup, djSite } from './handlers/djs.js';
import { mediaEvent, mediaNews, mediaPopup } from './handlers/media.js';
import { withCors, preflightResponse, notFound } from './lib/response.js';

// 順序は判定結果に影響しない(URLPatternはパスのセグメント数が一致しない限り
// マッチしないため、"/v1/djs/:slug" が "/v1/djs/:slug/events" に誤って
// マッチすることはない)。可読性のため定義順に並べているだけ。
const ROUTES = [
  { pattern: new URLPattern({ pathname: '/v1/djs/:slug/events' }), handler: djEvents },
  { pattern: new URLPattern({ pathname: '/v1/djs/:slug/news' }), handler: djNews },
  { pattern: new URLPattern({ pathname: '/v1/djs/:slug/social-links' }), handler: djSocialLinks },
  { pattern: new URLPattern({ pathname: '/v1/djs/:slug/popup' }), handler: djPopup },
  { pattern: new URLPattern({ pathname: '/v1/djs/:slug/site' }), handler: djSite },
  { pattern: new URLPattern({ pathname: '/v1/djs/:slug' }), handler: djIndex },
  { pattern: new URLPattern({ pathname: '/v1/media/events/:recordId/:file' }), handler: mediaEvent },
  { pattern: new URLPattern({ pathname: '/v1/media/news/:recordId/:file' }), handler: mediaNews },
  { pattern: new URLPattern({ pathname: '/v1/media/popups/:recordId/:file' }), handler: mediaPopup },
];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return preflightResponse();
    if (request.method !== 'GET') return withCors(notFound());

    const url = new URL(request.url);

    for (const route of ROUTES) {
      const match = route.pattern.exec(url);
      if (match) {
        const response = await route.handler(match.pathname.groups, env, url.origin);
        return withCors(response);
      }
    }

    return withCors(notFound());
  },
};
