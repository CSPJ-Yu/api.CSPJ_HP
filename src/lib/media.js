/**
 * CSPJ Public API — 画像配信共通ヘルパー
 * /src/lib/media.js
 *
 * R2のobject key(例: "flyers/<dj_id>/<event_id>/<uuid>.<ext>")は内部dj_idを含むため、
 * レスポンスやURLへそのまま出してはいけない。
 * ここでは image_key の末尾セグメント("<uuid>.<ext>")だけを「version token」として扱い、
 * それ以外(prefix・dj_id部分)は一切外部へ出さない設計にする。
 *
 * 画像URLの形: https://api.cs-pj.com/v1/media/<kind>/<record_id>/<uuid>.<ext>
 *   - <kind>       … 'events' | 'news' | 'popups' | 'djs'
 *   - <record_id>  … event_id / news_id / popup_id / slug(元々公開情報として返している値そのもの。
 *                     'djs'の場合はdj_idではなくslugを使う — dj_idは既存方針通り非公開のため)
 *   - <uuid>.<ext> … image_keyの末尾セグメントのみ(dj_id等の内部情報は含まれない)
 */

/** image_keyの末尾セグメント("<uuid>.<ext>")だけを取り出す。未設定ならnull。 */
function extractVersionToken(imageKey) {
  if (typeof imageKey !== 'string' || !imageKey) return null;
  const parts = imageKey.split('/');
  const last = parts[parts.length - 1];
  return last || null;
}

/**
 * レスポンスに載せる image_url を組み立てる。画像未設定(image_keyがnull)ならnullを返す。
 * @param {string} origin  リクエストのorigin(例: "https://api.cs-pj.com")。
 *   handler側で `new URL(request.url).origin` を渡す。
 */
export function buildMediaUrl(origin, kind, recordId, imageKey) {
  const version = extractVersionToken(imageKey);
  if (!version) return null;
  return `${origin}/v1/media/${kind}/${encodeURIComponent(recordId)}/${encodeURIComponent(version)}`;
}

/**
 * kindごとに「現在公開されているレコードか」をD1で再確認したうえで、
 * 一致すればR2オブジェクトを返す(呼び出し側でstreamする)。
 *
 * 手順(ご指定の通り): record ID → D1で現在の公開条件を再確認 → 現在のimage_key取得
 *   → requested version/fileとの一致確認 → private R2 get
 *
 * 以下のいずれかに該当する場合は必ずnullを返す(呼び出し側は404にする):
 *   - kindが未知
 *   - レコードが存在しない、または現在公開条件を満たさない(非公開化・期限切れ含む)
 *   - image_keyが未設定
 *   - requestedFileが現在のimage_keyのversion tokenと一致しない(古い/不正なURL)
 *   - R2に該当オブジェクトが実在しない(孤立参照)
 *
 * @returns {Promise<R2ObjectBody|null>}
 */
export async function resolveAndStreamMedia(kind, recordId, requestedFile, env) {
  const db = env.DB;
  let row = null;

  if (kind === 'events') {
    row = await db
      .prepare("SELECT flyer_key AS image_key FROM events WHERE event_id = ? AND status = 'published'")
      .bind(recordId)
      .first();
  } else if (kind === 'news') {
    row = await db
      .prepare(
        "SELECT image_key FROM news WHERE news_id = ? AND status = 'published' AND publish_date <= datetime('now')"
      )
      .bind(recordId)
      .first();
  } else if (kind === 'popups') {
    row = await db
      .prepare(
        `SELECT image_key FROM popups
         WHERE popup_id = ? AND status = 'published' AND expires_at IS NOT NULL AND expires_at > datetime('now')`
      )
      .bind(recordId)
      .first();
  } else if (kind === 'djs') {
    // Portal Card Image。recordIdはslug(dj_idではない。GET /v1/djs/:slugと同じ
    // 公開条件(status='active')をここでも独立に再確認する — /v1/djs/:slug側の
    // 判定結果を信用して素通しすることはしない(他kindと同じ設計)。
    row = await db
      .prepare("SELECT portal_card_image_key AS image_key FROM djs WHERE slug = ? AND status = 'active'")
      .bind(recordId)
      .first();
  } else {
    return null;
  }

  if (!row || !row.image_key) return null;

  const currentVersion = extractVersionToken(row.image_key);
  if (!currentVersion || currentVersion !== requestedFile) return null;

  const object = await env.MEDIA.get(row.image_key);
  if (!object) return null; // D1にキーは残っているがR2に実体が無い(孤立参照)。安全側に倒して404。

  return object;
}
