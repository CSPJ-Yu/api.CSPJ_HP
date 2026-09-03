/**
 * src/lib/serialize.js の allow-list 方式テスト。
 * 「禁止フィールドが一切出力に含まれないこと」を機械的に確認する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  serializeDj,
  serializeEvent,
  serializeNewsItem,
  serializeSocialLink,
  serializePopup,
} from '../src/lib/serialize.js';
import { fixtures } from './fixtures.js';

const ORIGIN = 'https://api.cs-pj.com';

// ご指定の禁止フィールド一覧(このいずれのキーも、どのserialize関数の出力にも
// 含まれてはいけない)。
const FORBIDDEN_KEYS = [
  'dj_id',
  'image_key',
  'flyer_key',
  'account_status',
  'users',
  'status',
  'created_at',
  'updated_at',
  'link_id',
  'sort_order',
  'memo',
];

function assertNoForbiddenKeys(obj, label) {
  const keys = Object.keys(obj);
  for (const forbidden of FORBIDDEN_KEYS) {
    assert.equal(keys.includes(forbidden), false, `${label} に禁止フィールド "${forbidden}" が含まれています`);
  }
}

test('serializeDj: slug/display_nameのみ', () => {
  const dj = fixtures.djs[0];
  const out = serializeDj(dj);
  assert.deepEqual(Object.keys(out).sort(), ['display_name', 'slug']);
  assertNoForbiddenKeys(out, 'serializeDj');
});

test('serializeEvent: 許可フィールドのみ、image_urlはimage_key由来だがimage_key自体は出さない', () => {
  const row = fixtures.events.find((e) => e.event_id === 'ev-published');
  const out = serializeEvent(row, ORIGIN);
  assert.deepEqual(
    Object.keys(out).sort(),
    ['date', 'event_id', 'event_name', 'image_url', 'location', 'type', 'venue'].sort()
  );
  assertNoForbiddenKeys(out, 'serializeEvent');
  assert.equal(out.image_url, `${ORIGIN}/v1/media/events/ev-published/aaaa-1111.jpg`);
});

test('serializeEvent: flyer_keyが無い場合はimage_url: null', () => {
  const row = fixtures.events.find((e) => e.event_id === 'ev-published-noimage');
  const out = serializeEvent(row, ORIGIN);
  assert.equal(out.image_url, null);
});

test('serializeNewsItem: links配下にもlink_id/sort_orderを含めない', () => {
  const row = {
    news_id: 'news-published-past',
    title: 't',
    body: 'b',
    publish_date: '2026-09-01 00:00:00',
    image_key: 'news/dj-1/news-published-past/cccc-3333.jpg',
    links: [{ link_id: 'nl-b', news_id: 'x', label: 'リンクB', url: 'https://example.com/b', sort_order: 0 }],
  };
  const out = serializeNewsItem(row, ORIGIN);
  assertNoForbiddenKeys(out, 'serializeNewsItem');
  assert.deepEqual(Object.keys(out).sort(), ['body', 'image_url', 'links', 'news_id', 'publish_date', 'title'].sort());
  assert.deepEqual(Object.keys(out.links[0]).sort(), ['label', 'url']);
});

test('serializeSocialLink: service/label/urlのみ', () => {
  const row = fixtures.social_links[0];
  const out = serializeSocialLink(row);
  assert.deepEqual(Object.keys(out).sort(), ['label', 'service', 'url']);
  assertNoForbiddenKeys(out, 'serializeSocialLink');
});

test('serializePopup: link_labelがnullの場合は既定文言にフォールバックする', () => {
  const row = fixtures.popups.find((p) => p.popup_id === 'popup-active');
  const out = serializePopup(row, ORIGIN);
  assert.equal(out.link_label, '詳しくはこちら');
  assertNoForbiddenKeys(out, 'serializePopup');
  assert.deepEqual(
    Object.keys(out).sort(),
    ['body', 'expires_at', 'image_url', 'link_label', 'link_url', 'popup_id', 'title'].sort()
  );
});

test('serializePopup: link_labelが設定済みならそのまま使う', () => {
  const row = { ...fixtures.popups.find((p) => p.popup_id === 'popup-expired'), expires_at: '2099-01-01 00:00:00' };
  const out = serializePopup(row, ORIGIN);
  assert.equal(out.link_label, 'カスタムラベル');
});

test('serializePopup: rowがnullならnullを返す(popup:null用)', () => {
  assert.equal(serializePopup(null, ORIGIN), null);
});
