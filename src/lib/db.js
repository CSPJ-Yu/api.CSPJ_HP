/**
 * CSPJ Public API — D1クエリ共通層
 * /src/lib/db.js
 *
 * 個別endpoint(djs/events/news/social-links/popup)と集約endpoint(site)の両方が
 * 必ずこの関数群だけを経由してD1へアクセスする。公開条件(status/publish_date/expires_at)を
 * ここに一元化することで、endpoint間で条件がズレることを構造的に防ぐ。
 *
 * 【重要】ここにはSELECT文しか書かない。INSERT/UPDATE/DELETEはこのAPIに一切実装しない。
 * 【重要】「現在時刻」との比較は必ずSQL側の datetime('now') を使う(cspj-manage側の
 * NEWS/POPUP実装と同じ、実績のある方式)。JS側でnew Date()を作って比較する経路は持たない。
 */

/** 指定slugのDJが存在し、かつ status='active' の場合のみ返す。それ以外はnull。 */
export async function getActiveDjBySlug(db, slug) {
  return db
    .prepare("SELECT dj_id, slug, display_name FROM djs WHERE slug = ? AND status = 'active'")
    .bind(slug)
    .first();
}

/** 指定dj_idの公開中(published)Scheduleを日付昇順で返す。0件なら空配列。 */
export async function getPublishedEvents(db, djId) {
  const { results } = await db
    .prepare(
      `SELECT event_id, date, event_name, venue, location, type, flyer_key
       FROM events
       WHERE dj_id = ? AND status = 'published'
       ORDER BY date ASC`
    )
    .bind(djId)
    .all();
  return results || [];
}

/**
 * 指定dj_idの公開中(published かつ publish_date <= 現在UTC)NEWSを新しい順で返す。
 * 各NEWSの外部リンク(news_links)も sort_order 順に取得して links として付与する。
 */
export async function getPublishedNews(db, djId) {
  const { results } = await db
    .prepare(
      `SELECT news_id, title, body, publish_date, image_key
       FROM news
       WHERE dj_id = ? AND status = 'published' AND publish_date <= datetime('now')
       ORDER BY publish_date DESC`
    )
    .bind(djId)
    .all();
  const newsList = results || [];

  for (const item of newsList) {
    const { results: links } = await db
      .prepare('SELECT label, url FROM news_links WHERE news_id = ? ORDER BY sort_order ASC')
      .bind(item.news_id)
      .all();
    item.links = links || [];
  }

  return newsList;
}

/** 指定dj_idに登録済みのSNS LINKSを登録順(created_at昇順)で返す。0件なら空配列。 */
export async function getSocialLinks(db, djId) {
  const { results } = await db
    .prepare('SELECT service, label, url FROM social_links WHERE dj_id = ? ORDER BY created_at ASC')
    .bind(djId)
    .all();
  return results || [];
}

/**
 * 指定dj_idの「現在有効な公開中POPUP」を1件だけ返す(存在しなければnull)。
 * 条件: status='published' AND expires_at IS NOT NULL AND expires_at > 現在UTC。
 * 管理側で「1 DJにつき同時に有効な公開中POPUPは最大1件」を保証しているため
 * 本来LIMIT無しでも1件以下のはずだが、念のためLIMIT 1を付与する(防御的)。
 */
export async function getActivePopup(db, djId) {
  return db
    .prepare(
      `SELECT popup_id, title, body, link_url, link_label, image_key, expires_at
       FROM popups
       WHERE dj_id = ? AND status = 'published' AND expires_at IS NOT NULL AND expires_at > datetime('now')
       ORDER BY published_at DESC
       LIMIT 1`
    )
    .bind(djId)
    .first();
}
