/**
 * CSPJ Public API — /v1/djs/* ハンドラ
 * /src/handlers/djs.js
 *
 * 各ハンドラは (params, env, origin) => Promise<Response> という統一シグネチャにし、
 * URLPattern(src/index.js側)には一切依存しない。これにより、Node上でも
 * URLPatternを介さずハンドラ単体を直接呼び出してテストできる。
 *
 * どのハンドラも、まず getActiveDjBySlug で「slugが存在し、かつ status='active'」を
 * 確認し、満たさない場合はその配下の情報を一切見ずに404を返す(inactiveなDJの
 * 個別コンテンツだけが200で漏れる、という中途半端な状態を作らない)。
 */
import {
  getActiveDjBySlug,
  getPublishedEvents,
  getPublishedNews,
  getSocialLinks,
  getActivePopup,
} from '../lib/db.js';
import {
  serializeDj,
  serializeEvent,
  serializeNewsItem,
  serializeSocialLink,
  serializePopup,
} from '../lib/serialize.js';
import { json, notFound, cacheHeaders } from '../lib/response.js';

const CACHE_SECONDS = 60;

/** GET /v1/djs/:slug */
export async function djIndex({ slug }, env, origin) {
  const dj = await getActiveDjBySlug(env.DB, slug);
  if (!dj) return notFound();
  return json(serializeDj(dj, origin), 200, cacheHeaders(CACHE_SECONDS));
}

/** GET /v1/djs/:slug/events */
export async function djEvents({ slug }, env, origin) {
  const dj = await getActiveDjBySlug(env.DB, slug);
  if (!dj) return notFound();
  const events = await getPublishedEvents(env.DB, dj.dj_id);
  return json({ events: events.map((row) => serializeEvent(row, origin)) }, 200, cacheHeaders(CACHE_SECONDS));
}

/** GET /v1/djs/:slug/news */
export async function djNews({ slug }, env, origin) {
  const dj = await getActiveDjBySlug(env.DB, slug);
  if (!dj) return notFound();
  const news = await getPublishedNews(env.DB, dj.dj_id);
  return json({ news: news.map((row) => serializeNewsItem(row, origin)) }, 200, cacheHeaders(CACHE_SECONDS));
}

/** GET /v1/djs/:slug/social-links */
export async function djSocialLinks({ slug }, env) {
  const dj = await getActiveDjBySlug(env.DB, slug);
  if (!dj) return notFound();
  const links = await getSocialLinks(env.DB, dj.dj_id);
  return json({ social_links: links.map(serializeSocialLink) }, 200, cacheHeaders(CACHE_SECONDS));
}

/** GET /v1/djs/:slug/popup */
export async function djPopup({ slug }, env, origin) {
  const dj = await getActiveDjBySlug(env.DB, slug);
  if (!dj) return notFound();
  const popup = await getActivePopup(env.DB, dj.dj_id);
  return json({ popup: serializePopup(popup, origin) }, 200, cacheHeaders(CACHE_SECONDS));
}

/**
 * GET /v1/djs/:slug/site
 * 個別endpointと全く同じ関数(lib/db.js・lib/serialize.js)だけを組み合わせて構成する。
 * 個別に独自のSQL・独自の条件分岐を書かないことで、個別endpointとの仕様ズレを防ぐ。
 */
export async function djSite({ slug }, env, origin) {
  const dj = await getActiveDjBySlug(env.DB, slug);
  if (!dj) return notFound();

  const [events, news, socialLinks, popup] = await Promise.all([
    getPublishedEvents(env.DB, dj.dj_id),
    getPublishedNews(env.DB, dj.dj_id),
    getSocialLinks(env.DB, dj.dj_id),
    getActivePopup(env.DB, dj.dj_id),
  ]);

  return json(
    {
      dj: serializeDj(dj, origin),
      events: events.map((row) => serializeEvent(row, origin)),
      news: news.map((row) => serializeNewsItem(row, origin)),
      social_links: socialLinks.map(serializeSocialLink),
      popup: serializePopup(popup, origin),
    },
    200,
    cacheHeaders(CACHE_SECONDS)
  );
}
