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
 * 既存の公開GET API(/v1/djs/*, /v1/media/*)は、GET/OPTIONS以外のメソッドを
 * ルーティングテーブルに一致するかどうかに関わらず常に404で統一する(既存方針。
 * Contact API追加にあたってもこの挙動・Allow-Origin: '*' のCORSは一切変更しない)。
 *
 * 【2026-09 Contact API追加】
 * /v1/contact のみ、上記とは独立したCORS方針(cs-pj.comのみ許可)・メソッド判定
 * (POST以外は405)を持つため、既存route群より先に判定する。既存route群のロジック
 * には触れていない。
 */
import { djIndex, djEvents, djNews, djSocialLinks, djPopup, djSite } from './handlers/djs.js';
import { mediaEvent, mediaNews, mediaPopup } from './handlers/media.js';
import { contactPost } from './handlers/contact.js';
import {
  withCors,
  preflightResponse,
  notFound,
  withContactCors,
  contactPreflightResponse,
  methodNotAllowed,
} from './lib/response.js';

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

const CONTACT_PATH = '/v1/contact';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === CONTACT_PATH) {
      return handleContact(request, env, url);
    }

    if (request.method === 'OPTIONS') return preflightResponse();
    if (request.method !== 'GET') return withCors(notFound());

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

/**
 * /v1/contact 専用のメソッド判定+CORS付与。URLPatternに一切依存しないため
 * (単純な文字列比較のみ)、他ハンドラ同様にNode側のunitテスト対象にできる
 * (test/contact-routing.test.mjs参照)。
 */
export async function handleContact(request, env, url) {
  if (request.method === 'OPTIONS') return contactPreflightResponse();
  if (request.method !== 'POST') return withContactCors(methodNotAllowed());

  const response = await contactPost(request, env, url.origin);
  return withContactCors(response);
}
