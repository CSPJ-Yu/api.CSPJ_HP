/**
 * CSPJ Public API — Contact送信のサーバー側validation
 * /src/lib/contact-validate.js
 *
 * フロント側(CSPJ_HP)のvalidationは一切信用せず、ここで独立に全項目を再検証する。
 * 【重要・allow-list方式】戻り値の data は、ここで明示的に列挙したフィールドのみを
 * 持つ新規オブジェクトとして組み立てる。payload由来の他のキー(status/contact_id/
 * created_at/updated_at等、クライアントが指定してはいけない値)は一切参照しない
 * ため、混入する余地がない(存在しても静かに無視される)。
 */

/** カテゴリのallowlist。ここに無い値はすべて400。 */
export const CONTACT_CATEGORIES = Object.freeze([
  'web_site',
  'dj_site',
  'visual_flyer',
  'promotion',
  'event',
  'other',
]);

/**
 * 現在有効なPrivacy Policyのversion。将来Policyを更新した場合はこの値を変更する
 * (任意の文字列をそのまま「同意済みversion」として受け入れることはしない —
 * クライアントが送ってきたversionは、必ずこの値と完全一致する場合のみ受理する)。
 */
export const PRIVACY_POLICY_VERSION = '2026-09-05';

const NAME_MIN = 1;
const NAME_MAX = 100;
const EMAIL_MAX = 254;
const SNS_URL_MAX = 2048;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 5000;

// 簡易だが実用上十分なメール形式チェック(RFC 5322の完全準拠は行わない)。
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isString(v) {
  return typeof v === 'string';
}

/**
 * Contact送信payloadを検証する。
 *
 * 【重要】暗黙の型変換は一切行わない。例えば name に object、privacy_consent に
 * 文字列 "true" が渡された場合はそのまま拒否する(Boolean("true")のような変換はしない)。
 *
 * @param {unknown} payload JSON.parse()済みのリクエストボディ
 * @returns {{ valid: true, data: object } | { valid: false, reason: string }}
 *   reason はデバッグ・テスト用の内部情報であり、HTTPレスポンスへは一切含めないこと
 *   (呼び出し側は常に汎用的な400を返す)。
 */
export function validateContactPayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reason: 'payload must be a JSON object' };
  }

  // name: 必須。trim後 1〜100文字。
  if (!isString(payload.name)) return { valid: false, reason: 'name must be a string' };
  const name = payload.name.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { valid: false, reason: 'name length out of range' };
  }

  // email: 必須。妥当な形式。最大254文字。
  if (!isString(payload.email)) return { valid: false, reason: 'email must be a string' };
  const email = payload.email.trim();
  if (email.length === 0 || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
    return { valid: false, reason: 'invalid email' };
  }

  // category: 必須。allowlistのみ。
  if (!isString(payload.category) || !CONTACT_CATEGORIES.includes(payload.category)) {
    return { valid: false, reason: 'invalid category' };
  }
  const category = payload.category;

  // sns_url: 任意。指定されている場合のみ検証(http/httpsのみ、最大2048文字)。
  let snsUrl = null;
  if (payload.sns_url !== undefined && payload.sns_url !== null) {
    if (!isString(payload.sns_url)) return { valid: false, reason: 'sns_url must be a string' };
    const raw = payload.sns_url.trim();
    if (raw.length > 0) {
      if (raw.length > SNS_URL_MAX) return { valid: false, reason: 'sns_url too long' };
      let parsed;
      try {
        parsed = new URL(raw);
      } catch {
        return { valid: false, reason: 'invalid sns_url' };
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, reason: 'sns_url must be http/https' };
      }
      snsUrl = raw;
    }
  }

  // message: 必須。trim後 10〜5000文字。
  if (!isString(payload.message)) return { valid: false, reason: 'message must be a string' };
  const message = payload.message.trim();
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) {
    return { valid: false, reason: 'message length out of range' };
  }

  // privacy_consent: 厳密に boolean true のみ。文字列"true"等は拒否(暗黙変換しない)。
  if (payload.privacy_consent !== true) {
    return { valid: false, reason: 'privacy_consent must be boolean true' };
  }

  // privacy_policy_version: 現在の許可versionと完全一致のみ。
  if (payload.privacy_policy_version !== PRIVACY_POLICY_VERSION) {
    return { valid: false, reason: 'privacy_policy_version mismatch' };
  }

  // turnstile_token: 空でない文字列であることのみここで確認する。
  // 実際にCloudflareへ問い合わせて検証するのは呼び出し側(handlers/contact.js)の責務。
  if (!isString(payload.turnstile_token) || payload.turnstile_token.trim().length === 0) {
    return { valid: false, reason: 'turnstile_token is required' };
  }

  return {
    valid: true,
    data: {
      name,
      email,
      category,
      sns_url: snsUrl,
      message,
      privacy_policy_version: PRIVACY_POLICY_VERSION,
      turnstile_token: payload.turnstile_token,
    },
  };
}
