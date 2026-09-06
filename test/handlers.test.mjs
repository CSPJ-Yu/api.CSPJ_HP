/**
 * src/handlers/* のテスト。
 *
 * 【重要】URLPatternには一切依存しない。ハンドラを直接importして、
 * URLPatternが解析したであろうparamsオブジェクトを手で組み立てて渡す。
 * ルーティング(src/index.js、URLPatternのマッチング)自体はここでは検証しない
 * (`npx wrangler dev` + 実HTTPリクエストで別途確認する。README参照)。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { djIndex, djEvents, djNews, djSocialLinks, djPopup, djSite } from '../src/handlers/djs.js';
import { mediaEvent, mediaNews, mediaPopup, mediaDj } from '../src/handlers/media.js';
import { createMockD1 } from './mock-d1.js';
import { createMockR2 } from './mock-r2.js';
import { fixtures, r2Objects, NOW } from './fixtures.js';

const ORIGIN = 'https://api.cs-pj.com';

function makeEnv() {
  return {
    DB: createMockD1(fixtures, { now: NOW }),
    MEDIA: createMockR2(r2Objects),
  };
}

// ---- /v1/djs/:slug ----------------------------------------------------

test('djIndex: activeなDJは200(portal_card_image_urlを含む)', async () => {
  const res = await djIndex({ slug: 'yu-x' }, makeEnv(), ORIGIN);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60, s-maxage=60');
  const body = await res.json();
  assert.deepEqual(body, {
    slug: 'yu-x',
    display_name: 'YU-X',
    portal_card_image_url: `${ORIGIN}/v1/media/djs/yu-x/eeee-5555.jpg`,
  });
});

test('djIndex: portal_card_image_key未設定のDJはportal_card_image_url: null', async () => {
  const res = await djIndex({ slug: 'other-dj' }, makeEnv(), ORIGIN);
  const body = await res.json();
  assert.equal(body.portal_card_image_url, null);
});

test('djIndex: レスポンスにportal_card_image_key自体は含まれない', async () => {
  const res = await djIndex({ slug: 'yu-x' }, makeEnv(), ORIGIN);
  const body = await res.json();
  assert.equal('portal_card_image_key' in body, false);
});

test('djIndex: inactiveなDJは404', async () => {
  const res = await djIndex({ slug: 'inactive-dj' }, makeEnv(), ORIGIN);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('djIndex: 存在しないslugは404', async () => {
  const res = await djIndex({ slug: 'nonexistent-slug' }, makeEnv(), ORIGIN);
  assert.equal(res.status, 404);
});

// ---- /v1/djs/:slug/events ----------------------------------------------

test('djEvents: publishedのみ、image_urlが正しく組み立てられる', async () => {
  const res = await djEvents({ slug: 'yu-x' }, makeEnv(), ORIGIN);
  assert.equal(res.status, 200);
  const body = await res.json();
  const ids = body.events.map((e) => e.event_id);
  assert.deepEqual(ids.sort(), ['ev-published', 'ev-published-noimage'].sort());
  const withImage = body.events.find((e) => e.event_id === 'ev-published');
  assert.equal(withImage.image_url, `${ORIGIN}/v1/media/events/ev-published/aaaa-1111.jpg`);
  const withoutImage = body.events.find((e) => e.event_id === 'ev-published-noimage');
  assert.equal(withoutImage.image_url, null);
});

test('djEvents: inactiveなDJは配下も404', async () => {
  const res = await djEvents({ slug: 'inactive-dj' }, makeEnv(), ORIGIN);
  assert.equal(res.status, 404);
});

test('djEvents: 0件でも200 + 空配列', async () => {
  const res = await djEvents({ slug: 'other-dj' }, makeEnv(), ORIGIN);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.events, []);
});

// ---- /v1/djs/:slug/news -------------------------------------------------

test('djNews: published かつ publish_date<=now のみ。draft/archived/futureは出ない', async () => {
  const res = await djNews({ slug: 'yu-x' }, makeEnv(), ORIGIN);
  const body = await res.json();
  assert.deepEqual(
    body.news.map((n) => n.news_id),
    ['news-published-past']
  );
});

test('djNews: news_linksはsort_order順', async () => {
  const res = await djNews({ slug: 'yu-x' }, makeEnv(), ORIGIN);
  const body = await res.json();
  assert.deepEqual(
    body.news[0].links.map((l) => l.label),
    ['リンクB', 'リンクC', 'リンクA']
  );
});

// ---- /v1/djs/:slug/social-links ------------------------------------------

test('djSocialLinks: 自DJのリンクのみ返り、他DJのリンクは混ざらない', async () => {
  const res = await djSocialLinks({ slug: 'yu-x' }, makeEnv(), ORIGIN);
  const body = await res.json();
  assert.equal(body.social_links.length, 2);
  assert.ok(!body.social_links.some((l) => l.url.includes('other-dj')));
});

// ---- /v1/djs/:slug/popup --------------------------------------------------

test('djPopup: 有効な公開中POPUPがあれば返す(link_labelは既定文言にフォールバック)', async () => {
  const res = await djPopup({ slug: 'yu-x' }, makeEnv(), ORIGIN);
  const body = await res.json();
  assert.equal(body.popup.popup_id, 'popup-active');
  assert.equal(body.popup.link_label, '詳しくはこちら');
  assert.equal(body.popup.image_url, `${ORIGIN}/v1/media/popups/popup-active/dddd-4444.jpg`);
});

test('djPopup: 無い場合は popup: null (200)', async () => {
  const res = await djPopup({ slug: 'other-dj' }, makeEnv(), ORIGIN);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.popup, null);
});

// ---- /v1/djs/:slug/site: 個別endpointと同じ内容になること -------------------

test('djSite: dj/events/news/social_links/popupが個別endpointの結果と一致する', async () => {
  const env = makeEnv();
  const [siteRes, djRes, eventsRes, newsRes, socialRes, popupRes] = await Promise.all([
    djSite({ slug: 'yu-x' }, env, ORIGIN),
    djIndex({ slug: 'yu-x' }, env, ORIGIN),
    djEvents({ slug: 'yu-x' }, env, ORIGIN),
    djNews({ slug: 'yu-x' }, env, ORIGIN),
    djSocialLinks({ slug: 'yu-x' }, env, ORIGIN),
    djPopup({ slug: 'yu-x' }, env, ORIGIN),
  ]);
  const site = await siteRes.json();
  assert.deepEqual(site.dj, await djRes.json());
  assert.deepEqual(site.events, (await eventsRes.json()).events);
  assert.deepEqual(site.news, (await newsRes.json()).news);
  assert.deepEqual(site.social_links, (await socialRes.json()).social_links);
  assert.deepEqual(site.popup, (await popupRes.json()).popup);
});

test('djSite: inactiveなDJは404', async () => {
  const res = await djSite({ slug: 'inactive-dj' }, makeEnv(), ORIGIN);
  assert.equal(res.status, 404);
});

// ---- /v1/media/* ------------------------------------------------------

test('mediaEvent: 公開済みイベントの正しいversionは200・Content-Type付き', async () => {
  const res = await mediaEvent({ recordId: 'ev-published', file: 'aaaa-1111.jpg' }, makeEnv());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60, s-maxage=60');
  const text = await res.text();
  assert.equal(text, 'FAKE-JPEG-BYTES-EVENT');
});

test('mediaEvent: version不一致は404', async () => {
  const res = await mediaEvent({ recordId: 'ev-published', file: 'wrong-version.jpg' }, makeEnv());
  assert.equal(res.status, 404);
});

test('mediaEvent: draft(非公開)は、R2に実体があっても404', async () => {
  const res = await mediaEvent({ recordId: 'ev-draft-with-image', file: 'bbbb-2222.jpg' }, makeEnv());
  assert.equal(res.status, 404);
});

test('mediaEvent: 存在しないrecordIdは404', async () => {
  const res = await mediaEvent({ recordId: 'nonexistent', file: 'x.jpg' }, makeEnv());
  assert.equal(res.status, 404);
});

test('mediaNews: 公開済みNEWSの画像は200', async () => {
  const res = await mediaNews({ recordId: 'news-published-past', file: 'cccc-3333.jpg' }, makeEnv());
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'FAKE-JPEG-BYTES-NEWS');
});

test('mediaPopup: 有効な公開中POPUPの画像は200、期限切れは404', async () => {
  const okRes = await mediaPopup({ recordId: 'popup-active', file: 'dddd-4444.jpg' }, makeEnv());
  assert.equal(okRes.status, 200);

  // popup-expiredはimage_key自体が無いためversion不一致で404になるが、
  // ここでは「期限切れなら公開条件を満たさずD1側でヒットしない」ことも別途確認する。
  const expiredRes = await mediaPopup({ recordId: 'popup-expired', file: 'anything.jpg' }, makeEnv());
  assert.equal(expiredRes.status, 404);
});

// ---- /v1/media/djs/:recordId/:file(Portal Card Image) ---------------------

test('mediaDj: activeなDJ + 画像ありは200・Content-Type付き', async () => {
  const res = await mediaDj({ recordId: 'yu-x', file: 'eeee-5555.jpg' }, makeEnv());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60, s-maxage=60');
  assert.equal(await res.text(), 'FAKE-JPEG-BYTES-PORTAL-CARD');
});

test('mediaDj: activeなDJ + 画像未設定は404', async () => {
  const res = await mediaDj({ recordId: 'other-dj', file: 'anything.jpg' }, makeEnv());
  assert.equal(res.status, 404);
});

test('mediaDj: 存在しないslugは404', async () => {
  const res = await mediaDj({ recordId: 'nonexistent-slug', file: 'x.jpg' }, makeEnv());
  assert.equal(res.status, 404);
});

test('mediaDj: inactiveなDJは、R2に実体・D1にkeyがあっても404(portal_card_image_urlを直接叩いても取得不可)', async () => {
  const res = await mediaDj({ recordId: 'inactive-dj', file: 'ffff-6666.jpg' }, makeEnv());
  assert.equal(res.status, 404);
});

test('mediaDj: version不一致は404', async () => {
  const res = await mediaDj({ recordId: 'yu-x', file: 'wrong-version.jpg' }, makeEnv());
  assert.equal(res.status, 404);
});

test('mediaDj: R2に実体が無い(孤立参照)場合も404', async () => {
  const envNoR2Object = { DB: createMockD1(fixtures, { now: NOW }), MEDIA: createMockR2({}) };
  const res = await mediaDj({ recordId: 'yu-x', file: 'eeee-5555.jpg' }, envNoR2Object);
  assert.equal(res.status, 404);
});
