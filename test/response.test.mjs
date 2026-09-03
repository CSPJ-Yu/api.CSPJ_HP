/**
 * src/lib/response.js のテスト(CORS/Cache-Control/404の形)。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { json, notFound, corsHeaders, withCors, preflightResponse, cacheHeaders } from '../src/lib/response.js';

test('json: Content-Typeとstatusが正しい', async () => {
  const res = json({ a: 1 }, 200);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.deepEqual(await res.json(), { a: 1 });
});

test('notFound: 404かつCache-Control: no-store', () => {
  const res = notFound();
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('corsHeaders: Allow-OriginがワイルドカードでGET,OPTIONSのみ許可', () => {
  const headers = corsHeaders();
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
  assert.equal(headers['Access-Control-Allow-Methods'], 'GET, OPTIONS');
  assert.equal('Access-Control-Allow-Credentials' in headers, false);
});

test('withCors: 既存レスポンスのstatus/bodyを保ったままCORSヘッダーを追加する', async () => {
  const original = json({ ok: true }, 200);
  const res = withCors(original);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepEqual(await res.json(), { ok: true });
});

test('preflightResponse: 204でCORSヘッダー付き、bodyなし', async () => {
  const res = preflightResponse();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
  const text = await res.text();
  assert.equal(text, '');
});

test('cacheHeaders: immutableを使わない短時間cache(public/max-age/s-maxage)', () => {
  const headers = cacheHeaders(60);
  assert.equal(headers['Cache-Control'], 'public, max-age=60, s-maxage=60');
  assert.equal(headers['Cache-Control'].includes('immutable'), false);
});
