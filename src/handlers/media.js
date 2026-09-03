/**
 * CSPJ Public API — /v1/media/* ハンドラ
 * /src/handlers/media.js
 *
 * (params, env) => Promise<Response> の統一シグネチャ。URLPatternには依存しない。
 * 実処理(D1再確認・version照合・R2 get)はすべて lib/media.js の resolveAndStreamMedia に
 * 委譲し、ここではkindごとのハンドラをまとめてR2オブジェクトのstream応答を組み立てるだけ。
 */
import { resolveAndStreamMedia } from '../lib/media.js';
import { notFound } from '../lib/response.js';

const MEDIA_CACHE_SECONDS = 60;

/**
 * @param {string} kind 'events' | 'news' | 'popups'
 * @returns {(params: {recordId: string, file: string}, env: object) => Promise<Response>}
 */
function createMediaHandler(kind) {
  return async function mediaHandler({ recordId, file }, env) {
    const object = await resolveAndStreamMedia(kind, recordId, file, env);
    if (!object) return notFound();

    const headers = new Headers();
    if (object.httpMetadata && object.httpMetadata.contentType) {
      headers.set('Content-Type', object.httpMetadata.contentType);
    }
    headers.set('X-Content-Type-Options', 'nosniff');
    // 初期実装では短時間cacheのみ(immutableは使用しない)。
    // 非公開化・期限切れ後、長時間古い画像がCDNから配信され続けることを避けるため。
    headers.set('Cache-Control', `public, max-age=${MEDIA_CACHE_SECONDS}, s-maxage=${MEDIA_CACHE_SECONDS}`);

    return new Response(object.body, { status: 200, headers });
  };
}

export const mediaEvent = createMediaHandler('events');
export const mediaNews = createMediaHandler('news');
export const mediaPopup = createMediaHandler('popups');
