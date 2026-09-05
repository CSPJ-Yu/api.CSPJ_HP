/**
 * src/handlers/contact.js (POST /v1/contact) のテスト。
 *
 * URLPatternには依存しない(ハンドラを直接importして、Requestオブジェクトを
 * 手で組み立てて渡す)。Turnstileは常にmockで差し替え、Cloudflareへ実通信しない。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contactPost } from '../src/handlers/contact.js';
import { createMockD1 } from './mock-d1.js';
import { PRIVACY_POLICY_VERSION } from '../src/lib/contact-validate.js';

const ORIGIN = 'https://cs-pj.com';
const URL_ = 'https://api.cs-pj.com/v1/contact';

function validBody(overrides = {}) {
  return {
    name: '山田 太郎',
    email: 'example@example.com',
    category: 'dj_site',
    sns_url: 'https://instagram.com/example',
    message: 'これはテスト用の問い合わせ本文です。',
    privacy_consent: true,
    privacy_policy_version: PRIVACY_POLICY_VERSION,
    turnstile_token: 'dummy-token',
    ...overrides,
  };
}

function makeRequest({ body, rawBody, contentType = 'application/json', extraHeaders = {} } = {}) {
  const headers = { 'Content-Type': contentType, ...extraHeaders };
  const finalBody = rawBody !== undefined ? rawBody : JSON.stringify(body);
  return new Request(URL_, { method: 'POST', headers, body: finalBody });
}

function makeEnv(opts = {}) {
  const env = { DB: createMockD1({}, opts.d1Options) };
  // 'secret'キー自体を渡さない場合は既定値を使う。secret: undefined を明示的に渡した
  // 場合は、実際のCloudflare Workers環境でTURNSTILE_SECRET_KEYが未設定であることを
  // 再現するため、envに一切そのプロパティを持たせない(default parameterの
  // 「undefinedなら既定値」という挙動に頼ると、この2つを区別できないため)。
  env.TURNSTILE_SECRET_KEY = 'secret' in opts ? opts.secret : 'test-secret';
  if (env.TURNSTILE_SECRET_KEY === undefined) delete env.TURNSTILE_SECRET_KEY;
  return env;
}

const alwaysAllow = async () => true;
const alwaysDeny = async () => false;

test('正常送信: 201 + {ok:true} + D1にcontact_submissionsとしてINSERTされ、status=newで保存される', async () => {
  const env = makeEnv();
  const res = await contactPost(makeRequest({ body: validBody() }), env, ORIGIN, { verifyTurnstile: alwaysAllow });

  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(body, { ok: true });
  assert.equal('contact_id' in body, false, 'contact_idを一般ユーザーへ返してはいけない');

  assert.equal(env.DB.writeLog.length, 1);
  assert.equal(env.DB.writeLog[0].table, 'contact_submissions');
  assert.equal(env.DB.writeLog[0].row.status, 'new');
  assert.equal(env.DB.writeLog[0].row.privacy_consent, 1);
});

test('INSERT成功後のみ201になること(Turnstile失敗時はD1へ書き込まれない)', async () => {
  const env = makeEnv();
  const res = await contactPost(makeRequest({ body: validBody() }), env, ORIGIN, { verifyTurnstile: alwaysDeny });
  assert.notEqual(res.status, 201);
  assert.equal(env.DB.writeLog.length, 0, 'Turnstile失敗時にD1へ書き込まれてしまっている');
});

test('D1 INSERT失敗時は201にならない(500)', async () => {
  const env = makeEnv({ d1Options: { forceRunError: true } });
  const res = await contactPost(makeRequest({ body: validBody() }), env, ORIGIN, { verifyTurnstile: alwaysAllow });
  assert.equal(res.status, 500);
  const body = await res.json();
  // 内部エラー・stack trace・D1エラー本文を含めない
  assert.equal(JSON.stringify(body).includes('simulated'), false);
});

test('statusをRequestから指定しても保存値は必ずnew', async () => {
  const env = makeEnv();
  const res = await contactPost(
    makeRequest({ body: validBody({ status: 'closed', contact_id: 'attacker-id' }) }),
    env,
    ORIGIN,
    { verifyTurnstile: alwaysAllow }
  );
  assert.equal(res.status, 201);
  assert.equal(env.DB.writeLog[0].row.status, 'new');
  assert.notEqual(env.DB.writeLog[0].row.contact_id, 'attacker-id');
});

// ---- validation失敗系(すべて400、D1へ書き込まれないこと) -------------------

const invalidCases = {
  nameなし: { name: undefined },
  name不正型: { name: { a: 1 } },
  emailなし: { email: undefined },
  不正email: { email: 'not-an-email' },
  categoryなし: { category: undefined },
  不正category: { category: 'nonexistent' },
  sns_url不正: { sns_url: 'javascript:alert(1)' },
  messageなし: { message: undefined },
  message短すぎ: { message: 'short' },
  message長すぎ: { message: 'a'.repeat(5001) },
  'privacy_consent=false': { privacy_consent: false },
  privacy_consent不正型: { privacy_consent: 'true' },
  privacy_policy_versionなし: { privacy_policy_version: undefined },
  privacy_policy_version不一致: { privacy_policy_version: '2000-01-01' },
};

for (const [label, overrides] of Object.entries(invalidCases)) {
  test(`validation失敗: ${label} → 400、D1未書き込み`, async () => {
    const env = makeEnv();
    const body = { ...validBody(), ...overrides };
    for (const k of Object.keys(overrides)) if (overrides[k] === undefined) delete body[k];
    const res = await contactPost(makeRequest({ body }), env, ORIGIN, { verifyTurnstile: alwaysAllow });
    assert.equal(res.status, 400, label);
    assert.equal(env.DB.writeLog.length, 0, `${label}: D1へ書き込まれてしまっている`);
  });
}

test('不正JSON: 400', async () => {
  const env = makeEnv();
  const res = await contactPost(makeRequest({ rawBody: '{not valid json' }), env, ORIGIN, {
    verifyTurnstile: alwaysAllow,
  });
  assert.equal(res.status, 400);
});

test('Content-Type不正: 415', async () => {
  const env = makeEnv();
  const res = await contactPost(
    makeRequest({ body: validBody(), contentType: 'text/plain' }),
    env,
    ORIGIN,
    { verifyTurnstile: alwaysAllow }
  );
  assert.equal(res.status, 415);
});

test('Content-Type: application/json; charset=utf-8 は許可される', async () => {
  const env = makeEnv();
  const res = await contactPost(
    makeRequest({ body: validBody(), contentType: 'application/json; charset=utf-8' }),
    env,
    ORIGIN,
    { verifyTurnstile: alwaysAllow }
  );
  assert.equal(res.status, 201);
});

test('body size超過(16KB超): 413', async () => {
  const env = makeEnv();
  const oversizedMessage = 'a'.repeat(20 * 1024);
  const res = await contactPost(
    makeRequest({ body: validBody({ message: oversizedMessage }) }),
    env,
    ORIGIN,
    { verifyTurnstile: alwaysAllow }
  );
  assert.equal(res.status, 413);
  assert.equal(env.DB.writeLog.length, 0);
});

test('Turnstile成功: 201', async () => {
  const env = makeEnv();
  const res = await contactPost(makeRequest({ body: validBody() }), env, ORIGIN, { verifyTurnstile: alwaysAllow });
  assert.equal(res.status, 201);
});

test('Turnstile失敗: 403、D1未書き込み', async () => {
  const env = makeEnv();
  const res = await contactPost(makeRequest({ body: validBody() }), env, ORIGIN, { verifyTurnstile: alwaysDeny });
  assert.equal(res.status, 403);
  assert.equal(env.DB.writeLog.length, 0);
});

test('TURNSTILE_SECRET_KEY未設定: Turnstile検証をスキップしてD1へ保存する経路は存在しない(fail closed)', async () => {
  let turnstileCalled = false;
  const env = makeEnv({ secret: undefined });
  const res = await contactPost(makeRequest({ body: validBody() }), env, ORIGIN, {
    verifyTurnstile: async () => {
      turnstileCalled = true;
      return true;
    },
  });
  assert.notEqual(res.status, 201);
  assert.equal(turnstileCalled, false, 'secret未設定なのにTurnstile検証関数が呼ばれている');
  assert.equal(env.DB.writeLog.length, 0, 'secret未設定なのにD1へ書き込まれてしまっている');
});

test('TURNSTILE_SECRET_KEY未設定時のレスポンスは、実際のTurnstile失敗時と区別できない', async () => {
  const envNoSecret = makeEnv({ secret: undefined });
  const envFail = makeEnv();

  const resNoSecret = await contactPost(makeRequest({ body: validBody() }), envNoSecret, ORIGIN, {
    verifyTurnstile: alwaysAllow,
  });
  const resFail = await contactPost(makeRequest({ body: validBody() }), envFail, ORIGIN, {
    verifyTurnstile: alwaysDeny,
  });

  assert.equal(resNoSecret.status, resFail.status);
  assert.deepEqual(await resNoSecret.json(), await resFail.json());
});

test('レスポンスに内部エラー情報(スタックトレース等)が含まれない', async () => {
  const env = makeEnv({ d1Options: { forceRunError: true } });
  const res = await contactPost(makeRequest({ body: validBody() }), env, ORIGIN, { verifyTurnstile: alwaysAllow });
  const text = await res.text();
  assert.equal(/at\s+\S+\s+\(/.test(text), false); // stack trace的な行が含まれない
  assert.equal(text.toLowerCase().includes('d1'), false);
});
