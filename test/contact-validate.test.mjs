/**
 * src/lib/contact-validate.js のテスト。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateContactPayload, CONTACT_CATEGORIES, PRIVACY_POLICY_VERSION } from '../src/lib/contact-validate.js';

function validPayload(overrides = {}) {
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

test('正常な送信は valid: true になる', () => {
  const result = validateContactPayload(validPayload());
  assert.equal(result.valid, true);
  assert.equal(result.data.name, '山田 太郎');
  assert.equal(result.data.email, 'example@example.com');
  assert.equal(result.data.category, 'dj_site');
  assert.equal(result.data.sns_url, 'https://instagram.com/example');
  assert.equal(result.data.privacy_policy_version, PRIVACY_POLICY_VERSION);
});

test('未知のフィールド(status/contact_id等)は無視される(採用されない)', () => {
  const result = validateContactPayload(validPayload({
    status: 'closed',
    contact_id: 'attacker-supplied-id',
    created_at: '2000-01-01 00:00:00',
  }));
  assert.equal(result.valid, true);
  assert.equal('status' in result.data, false);
  assert.equal('contact_id' in result.data, false);
  assert.equal('created_at' in result.data, false);
});

test('name: 必須', () => {
  const { name, ...rest } = validPayload();
  assert.equal(validateContactPayload(rest).valid, false);
});

test('name: 不正な型(object)は暗黙変換せず拒否', () => {
  const result = validateContactPayload(validPayload({ name: { toString: () => 'x' } }));
  assert.equal(result.valid, false);
});

test('name: 101文字は拒否、100文字は許可', () => {
  assert.equal(validateContactPayload(validPayload({ name: 'あ'.repeat(101) })).valid, false);
  assert.equal(validateContactPayload(validPayload({ name: 'あ'.repeat(100) })).valid, true);
});

test('email: 必須', () => {
  const { email, ...rest } = validPayload();
  assert.equal(validateContactPayload(rest).valid, false);
});

test('email: 不正な形式は拒否', () => {
  assert.equal(validateContactPayload(validPayload({ email: 'not-an-email' })).valid, false);
});

test('category: 必須', () => {
  const { category, ...rest } = validPayload();
  assert.equal(validateContactPayload(rest).valid, false);
});

test('category: allowlist外は拒否', () => {
  assert.equal(validateContactPayload(validPayload({ category: 'not-a-real-category' })).valid, false);
});

test('category: allowlistの全値を許可', () => {
  for (const category of CONTACT_CATEGORIES) {
    assert.equal(validateContactPayload(validPayload({ category })).valid, true, category);
  }
});

test('sns_url: 未指定(省略)は許可され、data.sns_urlはnull', () => {
  const { sns_url, ...rest } = validPayload();
  const result = validateContactPayload(rest);
  assert.equal(result.valid, true);
  assert.equal(result.data.sns_url, null);
});

test('sns_url: 不正な形式(http/https以外)は拒否', () => {
  assert.equal(validateContactPayload(validPayload({ sns_url: 'ftp://example.com/x' })).valid, false);
  assert.equal(validateContactPayload(validPayload({ sns_url: 'javascript:alert(1)' })).valid, false);
});

test('sns_url: 2048文字超は拒否', () => {
  const longUrl = 'https://example.com/' + 'a'.repeat(2048);
  assert.equal(validateContactPayload(validPayload({ sns_url: longUrl })).valid, false);
});

test('message: 必須', () => {
  const { message, ...rest } = validPayload();
  assert.equal(validateContactPayload(rest).valid, false);
});

test('message: 短すぎ(9文字)は拒否、10文字は許可', () => {
  assert.equal(validateContactPayload(validPayload({ message: 'a'.repeat(9) })).valid, false);
  assert.equal(validateContactPayload(validPayload({ message: 'a'.repeat(10) })).valid, true);
});

test('message: 長すぎ(5001文字)は拒否、5000文字は許可', () => {
  assert.equal(validateContactPayload(validPayload({ message: 'a'.repeat(5001) })).valid, false);
  assert.equal(validateContactPayload(validPayload({ message: 'a'.repeat(5000) })).valid, true);
});

test('privacy_consent: false は拒否', () => {
  assert.equal(validateContactPayload(validPayload({ privacy_consent: false })).valid, false);
});

test('privacy_consent: 文字列"true"は暗黙変換せず拒否', () => {
  assert.equal(validateContactPayload(validPayload({ privacy_consent: 'true' })).valid, false);
});

test('privacy_policy_version: 必須', () => {
  const { privacy_policy_version, ...rest } = validPayload();
  assert.equal(validateContactPayload(rest).valid, false);
});

test('privacy_policy_version: 現在versionと不一致は拒否', () => {
  assert.equal(validateContactPayload(validPayload({ privacy_policy_version: '2000-01-01' })).valid, false);
});

test('不正なpayload自体(null/配列/プリミティブ)は拒否', () => {
  assert.equal(validateContactPayload(null).valid, false);
  assert.equal(validateContactPayload([]).valid, false);
  assert.equal(validateContactPayload('x').valid, false);
  assert.equal(validateContactPayload(undefined).valid, false);
});
