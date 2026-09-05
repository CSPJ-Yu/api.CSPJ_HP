/**
 * CSPJ Public API — POST /v1/contact ハンドラ
 * /src/handlers/contact.js
 *
 * データフロー(ご指定の通り):
 *   Content-Type / body size確認 → JSON parse → 入力validation →
 *   Turnstile server-side verification → D1 INSERT → 201 { ok: true }
 *
 * 途中のどこかで失敗した場合は、そこで確定して即座にエラーレスポンスを返す
 * (D1 INSERTが完了する前に成功扱いになる経路は存在しない)。
 *
 * 【重要】本ハンドラ自身はD1へのwrite操作を直接持たない。書き込みは
 * lib/contact-db.js の insertContactSubmission() のみに委譲する
 * (write操作の存在箇所を1ファイルに集約するため)。
 */
import { validateContactPayload } from '../lib/contact-validate.js';
import { verifyTurnstile as defaultVerifyTurnstile } from '../lib/turnstile.js';
import { insertContactSubmission } from '../lib/contact-db.js';
import { json } from '../lib/response.js';

const MAX_BODY_BYTES = 16 * 1024; // 16KB

/** すべてのContactレスポンスは常に no-store(成功時も含む)。 */
function contactJson(data, status) {
  return json(data, status, { 'Cache-Control': 'no-store' });
}

const BAD_REQUEST = () => contactJson({ error: 'Bad Request' }, 400);
const TURNSTILE_FAILED = () => contactJson({ error: 'Forbidden' }, 403);
// secret未設定時も、実際の検証失敗時と全く同じレスポンスにする
// (「secretが設定されていない」という内部状態を外部から区別できないようにするため)。
const TURNSTILE_UNAVAILABLE = TURNSTILE_FAILED;

/**
 * Content-Type ヘッダーが application/json(charset等のparameter付きも許容)かどうか。
 */
function isJsonContentType(request) {
  const raw = request.headers.get('content-type') || '';
  const base = raw.split(';')[0].trim().toLowerCase();
  return base === 'application/json';
}

/**
 * request.body を最大 maxBytes までストリームで読み取り、UTF-8文字列として返す。
 * 途中で上限を超えた場合は、残りを読み切らずに即座に中断してrejectする
 * (Content-Lengthヘッダーは詐称され得るため信用せず、実際に受信したbyte数で判定する)。
 */
async function readBodyWithLimit(request, maxBytes) {
  // Content-Lengthが分かっていて明らかに超過している場合は、ストリームを読む前に弾く。
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const err = new Error('declared content-length exceeds limit');
    err.code = 'BODY_TOO_LARGE';
    throw err;
  }

  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* 中断できなくても致命的ではないため無視 */
      }
      const err = new Error('request body exceeds limit');
      err.code = 'BODY_TOO_LARGE';
      throw err;
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(combined);
}

/**
 * @param {Request} request
 * @param {object} env  env.DB(D1) と env.TURNSTILE_SECRET_KEY(Worker Secret) を使う
 * @param {string} origin  未使用(他ハンドラとシグネチャを揃えるためだけに受け取る)
 * @param {object} [deps]  テスト用の依存注入。既定は本番実装。
 * @param {typeof verifyTurnstile} [deps.verifyTurnstile]
 */
export async function contactPost(request, env, origin, deps = {}) {
  const verifyTurnstileFn = deps.verifyTurnstile || defaultVerifyTurnstile;

  // 1. Content-Type確認
  if (!isJsonContentType(request)) {
    return contactJson({ error: 'Unsupported Media Type' }, 415);
  }

  // 2. body size確認 + 読み取り
  let rawBody;
  try {
    rawBody = await readBodyWithLimit(request, MAX_BODY_BYTES);
  } catch (err) {
    if (err && err.code === 'BODY_TOO_LARGE') {
      return contactJson({ error: 'Payload Too Large' }, 413);
    }
    return contactJson({ error: 'Internal Server Error' }, 500);
  }

  // 3. JSON parse
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return BAD_REQUEST();
  }

  // 4. 入力validation(フロント側のvalidationは信用せず、ここで独立に再検証する)
  const result = validateContactPayload(payload);
  if (!result.valid) {
    return BAD_REQUEST();
  }
  const data = result.data;

  // 5. Turnstile server-side verification(fail closed)
  //    TURNSTILE_SECRET_KEY が未設定の場合、検証をスキップしてD1へ保存する経路は
  //    絶対に作らない。secret未設定は「検証失敗」と全く同じ応答にする。
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return TURNSTILE_UNAVAILABLE();
  }
  const turnstileOk = await verifyTurnstileFn(data.turnstile_token, secret);
  if (!turnstileOk) {
    return TURNSTILE_FAILED();
  }

  // 6. D1 INSERT(ここで初めて書き込みが発生する。失敗時は201を返さない)
  try {
    await insertContactSubmission(env.DB, data);
  } catch {
    return contactJson({ error: 'Internal Server Error' }, 500);
  }

  // 7. 成功。INSERTが正常完了した場合のみここに到達する。
  //    contact_id は一般ユーザーへ返さない。
  return contactJson({ ok: true }, 201);
}
