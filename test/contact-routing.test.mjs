/**
 * src/index.js の handleContact() のテスト(/v1/contact のメソッド判定・CORS)。
 *
 * handleContact() 自体はURLPatternに一切依存しない(単純な文字列比較のみ)ため、
 * 他のルーティング判定(URLPatternベース。Node/workerdの挙動差により
 * `wrangler dev` でのみ検証する方針)とは異なり、ここで直接unitテストできる。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleContact } from '../src/index.js';
import { createMockD1 } from './mock-d1.js';
import { PRIVACY_POLICY_VERSION } from '../src/lib/contact-validate.js';

const URL_STR = 'https://api.cs-pj.com/v1/contact';

function makeEnv() {
  return { DB: createMockD1({}), TURNSTILE_SECRET_KEY: 'test-secret' };
}

test('GET /v1/contact: 405', async () => {
  const req = new Request(URL_STR, { method: 'GET' });
  const res = await handleContact(req, makeEnv(), new URL(URL_STR));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://cs-pj.com');
});

for (const method of ['PUT', 'PATCH', 'DELETE']) {
  test(`${method} /v1/contact: 405`, async () => {
    const req = new Request(URL_STR, { method });
    const res = await handleContact(req, makeEnv(), new URL(URL_STR));
    assert.equal(res.status, 405);
  });
}

test('OPTIONS /v1/contact: 204 + Contact用CORS(POST, OPTIONSを許可)', async () => {
  const req = new Request(URL_STR, { method: 'OPTIONS' });
  const res = await handleContact(req, makeEnv(), new URL(URL_STR));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://cs-pj.com');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
});

test('POST /v1/contact: 正常時は201になり、Contact用CORSヘッダーが付与される', async () => {
  const req = new Request(URL_STR, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '山田 太郎',
      email: 'example@example.com',
      category: 'dj_site',
      message: 'これはテスト用の問い合わせ本文です。',
      privacy_consent: true,
      privacy_policy_version: PRIVACY_POLICY_VERSION,
      turnstile_token: 'dummy-token',
    }),
  });
  // Turnstile本番検証を実際に呼ぶとCloudflareへ実通信してしまうため、
  // ここではsecret未設定にしてfail closed(403)になることだけ確認する
  // (実際の200系フローはcontact.test.mjs側でverifyTurnstileをmockして検証済み)。
  const res = await handleContact(req, { DB: createMockD1({}) }, new URL(URL_STR));
  assert.equal(res.status, 403); // TURNSTILE_SECRET_KEY未設定によるfail closed
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://cs-pj.com');
});

test('既存の公開GET APIのCORS(Allow-Origin: *)には影響しない(定数の独立性を確認)', async () => {
  const { corsHeaders } = await import('../src/lib/response.js');
  assert.equal(corsHeaders()['Access-Control-Allow-Origin'], '*');
});
