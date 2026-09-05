/**
 * src/lib/turnstile.js のテスト。
 * Cloudflareへの実通信は一切行わない(fetchImpl依存注入によりmockへ差し替える)。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyTurnstile } from '../src/lib/turnstile.js';

function mockFetch(response, { ok = true, throwError = null } = {}) {
  return async () => {
    if (throwError) throw throwError;
    return {
      ok,
      async json() {
        return response;
      },
    };
  };
}

test('Turnstile成功: success:true を返すレスポンスならtrue', async () => {
  const ok = await verifyTurnstile('token', 'secret', mockFetch({ success: true }));
  assert.equal(ok, true);
});

test('Turnstile失敗: success:false ならfalse', async () => {
  const ok = await verifyTurnstile('token', 'secret', mockFetch({ success: false }));
  assert.equal(ok, false);
});

test('Turnstile失敗: HTTPが非2xxならfalse', async () => {
  const ok = await verifyTurnstile('token', 'secret', mockFetch({ success: true }, { ok: false }));
  assert.equal(ok, false);
});

test('Turnstile失敗: ネットワークエラーはfalse(例外を投げない)', async () => {
  const ok = await verifyTurnstile('token', 'secret', mockFetch({}, { throwError: new Error('network down') }));
  assert.equal(ok, false);
});

test('Turnstile失敗: レスポンスJSONが不正でもfalse', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      throw new Error('invalid json');
    },
  });
  const ok = await verifyTurnstile('token', 'secret', fetchImpl);
  assert.equal(ok, false);
});

test('Secret未設定: fetchを呼ばずに必ずfalse(fail closed)', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, async json() { return { success: true }; } };
  };
  const ok = await verifyTurnstile('token', '', fetchImpl);
  assert.equal(ok, false);
  assert.equal(called, false, 'secret未設定なのにCloudflareへ問い合わせてしまっている');
});

test('token未指定: fetchを呼ばずに必ずfalse', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, async json() { return { success: true }; } };
  };
  const ok = await verifyTurnstile('', 'secret', fetchImpl);
  assert.equal(ok, false);
  assert.equal(called, false);
});
