/**
 * src/lib/db.js の公開条件テスト。
 * 実行: node --test test/db.test.mjs (または node --test test/ でまとめて実行)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getActiveDjBySlug,
  getPublishedEvents,
  getPublishedNews,
  getSocialLinks,
  getActivePopup,
} from '../src/lib/db.js';
import { createMockD1 } from './mock-d1.js';
import { fixtures, NOW } from './fixtures.js';

function db() {
  return createMockD1(fixtures, { now: NOW });
}

test('getActiveDjBySlug: activeなDJはそのまま返る', async () => {
  const dj = await getActiveDjBySlug(db(), 'yu-x');
  assert.equal(dj.slug, 'yu-x');
  assert.equal(dj.display_name, 'YU-X');
});

test('getActiveDjBySlug: inactiveなDJはnull', async () => {
  const dj = await getActiveDjBySlug(db(), 'inactive-dj');
  assert.equal(dj, null);
});

test('getActiveDjBySlug: 存在しないslugはnull', async () => {
  const dj = await getActiveDjBySlug(db(), 'nonexistent-slug');
  assert.equal(dj, null);
});

test('getPublishedEvents: publishedのみ返り、draft/archived/cancelledは除外される', async () => {
  const events = await getPublishedEvents(db(), 'dj-1');
  const ids = events.map((e) => e.event_id).sort();
  // ev-draft / ev-archived / ev-cancelled / ev-draft-with-image(status=draft)は含まれない
  assert.deepEqual(ids, ['ev-published', 'ev-published-noimage'].sort());
});

test('getPublishedEvents: memoフィールドはそもそもSELECTされない(取得段階で除外)', async () => {
  const events = await getPublishedEvents(db(), 'dj-1');
  for (const e of events) {
    assert.equal('memo' in e, false);
  }
});

test('getPublishedNews: published かつ publish_date<=now のみ返り、future/draft/archivedは除外される', async () => {
  const news = await getPublishedNews(db(), 'dj-1');
  const ids = news.map((n) => n.news_id);
  assert.deepEqual(ids, ['news-published-past']);
});

test('getPublishedNews: news_linksはsort_order昇順で返る(挿入順ではなく)', async () => {
  const news = await getPublishedNews(db(), 'dj-1');
  const links = news[0].links;
  assert.deepEqual(
    links.map((l) => l.label),
    ['リンクB', 'リンクC', 'リンクA']
  );
});

test('getSocialLinks: 指定dj_idのリンクだけ返り、他DJのリンクは混入しない', async () => {
  const links = await getSocialLinks(db(), 'dj-1');
  assert.equal(links.length, 2);
  assert.ok(links.every((l) => l.url.includes('yu-x') || l.url.includes('linktr')));
});

test('getActivePopup: 有効な公開中POPUPのみ返り、draft/archived/expiredは除外される', async () => {
  const popup = await getActivePopup(db(), 'dj-1');
  assert.equal(popup.popup_id, 'popup-active');
});

test('getActivePopup: 有効な公開中POPUPが無いDJはnull', async () => {
  const popup = await getActivePopup(db(), 'dj-2');
  assert.equal(popup, null);
});
