/**
 * CSPJ Public API — レスポンス生成共通ヘルパー
 * /src/lib/response.js
 *
 * このAPIは認証なし・読み取り専用の公開APIであるため、cspj-manage側のように
 * Cloudflare AccessのJWTを扱うコードは一切持たない。ここではJSON整形・404・
 * CORSヘッダー付与・Cache-Controlヘッダーの組み立てだけを共通化する。
 */

/** 標準のJSONレスポンスを組み立てる。extraHeaders で Cache-Control 等を追加できる。 */
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

/**
 * 404。存在しないslug/record、非公開状態(inactive DJ / draft・archived・cancelled等)、
 * 期限切れPOPUP、mediaのversion不一致など、すべてこの一つに統一する
 * (公開APIの仕様として「非公開なのか存在しないのか」を外部から区別させないため)。
 * 404は将来的にせよキャッシュに長時間残ってはいけないため、常に no-store を明示する。
 */
export function notFound() {
  return json({ error: 'Not Found' }, 404, { 'Cache-Control': 'no-store' });
}

/**
 * GET/OPTIONS以外のメソッド、またはルーティングテーブルに一致しないパスへの応答。
 * 今回の設計では405ではなく404で統一する(ご指定の方針)。
 */
export function methodOrRouteNotFound() {
  return notFound();
}

/** このAPI全体で共通のCORSヘッダー。認証・cookieを一切扱わないため Allow-Origin は '*' に固定する。 */
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

/**
 * 既に組み立てられたResponseへCORSヘッダーを付与して返す。
 * bodyがReadableStream(R2の画像stream等)の場合でも、bodyを読み取らずヘッダーだけ
 * 追加して新しいResponseを作るため、streamを消費してしまうことはない。
 */
export function withCors(response) {
  const headers = new Headers(response.headers);
  const cors = corsHeaders();
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * CORSプリフライト(OPTIONS)への応答。ボディなしの204(正常系)とし、CORSヘッダーを付与する。
 * Credentialsは一切扱わないため Access-Control-Allow-Credentials は付与しない。
 */
export function preflightResponse() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * JSON系エンドポイント用のCache-Control(秒単位)。immutableは使用しない
 * (公開後にNEWS/Schedule/POPUPが非公開化された場合でも、CDNキャッシュが短時間で
 * 追従できるようにするため。長期最適化は今回のフェーズではやらない)。
 */
export function cacheHeaders(seconds) {
  return { 'Cache-Control': `public, max-age=${seconds}, s-maxage=${seconds}` };
}

/* ============================================================
   Contact API(POST /v1/contact)専用のCORS/メソッド応答
   ------------------------------------------------------------
   既存の公開GET API(corsHeaders/withCors/preflightResponse、Allow-Origin: '*')には
   一切手を加えない。Contact APIは外部入力を書き込むエンドポイントであるため、
   利用元を公式サイト(https://cs-pj.com)のみに限定した専用のCORS設定を持つ。
   ただしCORSはあくまで補助的な防御であり、本体の防御はvalidation/Turnstile/
   Rate Limiting(Cloudflare側)とする。
   ============================================================ */

/** Contact POSTの利用を許可するorigin。現時点ではcs-pj.comのみ
 *  (www.cs-pj.comは常にcs-pj.comへ301リダイレクトされ、そのoriginからfetchが
 *  発生することはないため含めていない)。 */
const CONTACT_ALLOWED_ORIGIN = 'https://cs-pj.com';

export function contactCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': CONTACT_ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

/** withCors() のContact版。既存のwithCors()同様、bodyを読み取らずヘッダーのみ付与する。 */
export function withContactCors(response) {
  const headers = new Headers(response.headers);
  const cors = contactCorsHeaders();
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

/** Contact用CORSプリフライト(OPTIONS)応答。 */
export function contactPreflightResponse() {
  return new Response(null, { status: 204, headers: contactCorsHeaders() });
}

/**
 * /v1/contact へPOST以外のメソッド(GET/PUT/PATCH/DELETE等)が来た場合の応答。
 * 既存の公開GET APIとは異なり、こちらは405で統一する(ご指定の方針)。
 */
export function methodNotAllowed() {
  return json({ error: 'Method Not Allowed' }, 405, {
    'Cache-Control': 'no-store',
    Allow: 'POST, OPTIONS',
  });
}
