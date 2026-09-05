/**
 * CSPJ Public API — Cloudflare Turnstile サーバー側検証
 * /src/lib/turnstile.js
 *
 * 【fail closed が絶対条件】
 *   - secretKey が渡されない(= Worker Secret TURNSTILE_SECRET_KEY 未設定)場合は、
 *     Cloudflareへ問い合わせることなく必ず false を返す。
 *     「Secret未設定 → 検証をスキップしてD1へ保存」という経路は存在しない
 *     (呼び出し側 handlers/contact.js でも secret 未設定を別途チェックしているが、
 *     本関数単体としても安全側に倒す二重の防御としてここでも確認する)。
 *   - ネットワークエラー・非2xx・レスポンスJSONの success !== true は、
 *     いずれも区別なく false(検証失敗)として扱う。
 *
 * @param {string} token       クライアントから送られてきた turnstile_token
 * @param {string} secretKey   env.TURNSTILE_SECRET_KEY の値
 * @param {typeof fetch} [fetchImpl] 依存注入用。既定はグローバルfetch。
 *   テストではCloudflareへ実通信せず、mockに差し替えて使う
 *   (`await verifyTurnstile(token, secret, mockFetch)`)。
 * @returns {Promise<boolean>}
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token, secretKey, fetchImpl = fetch) {
  if (!secretKey || !token) return false;

  const body = new URLSearchParams();
  body.set('secret', secretKey);
  body.set('response', token);

  let res;
  try {
    res = await fetchImpl(VERIFY_URL, { method: 'POST', body });
  } catch {
    return false; // ネットワークエラーはfail closed
  }

  if (!res.ok) return false;

  let data;
  try {
    data = await res.json();
  } catch {
    return false;
  }

  return Boolean(data && data.success === true);
}
