/**
 * CSPJ Public API — レスポンス整形(allow-list方式)
 * /src/lib/serialize.js
 *
 * 【最重要】ここでのDB行 → JSONの変換は、必ずフィールドを1つずつ明示的に列挙する
 * allow-list方式で行う。`{ ...row }` のようにDB行をまるごと展開することは絶対にしない。
 * これにより、将来migrationでdjs/events/news/social_links/popupsテーブルに
 * 新しい内部列が追加されても、この関数を明示的に変更しない限り自動的には公開されない
 * (デフォルトで非公開側に倒れる設計)。
 *
 * 以下は本ファイルのどの関数の戻り値にも一切含めない:
 *   dj_id / image_key / flyer_key / account_status / users情報 / status /
 *   created_at / updated_at / link_id / sort_order / memo / Access関連情報
 */
import { buildMediaUrl } from './media.js';

/** djs行 → 公開DJ情報。slug/display_nameのみ。 */
export function serializeDj(dj) {
  return {
    slug: dj.slug,
    display_name: dj.display_name,
  };
}

/** events行 → 公開Schedule情報。memo/status/flyer_key/dj_id等は含めない。 */
export function serializeEvent(row, origin) {
  return {
    event_id: row.event_id,
    date: row.date,
    event_name: row.event_name,
    venue: row.venue,
    location: row.location,
    type: row.type,
    image_url: buildMediaUrl(origin, 'events', row.event_id, row.flyer_key),
  };
}

/**
 * news行(+links)→ 公開NEWS情報。
 * links は [{label, url}] のみ(link_id/news_id/sort_orderは含めない)。
 */
export function serializeNewsItem(row, origin) {
  return {
    news_id: row.news_id,
    title: row.title,
    body: row.body,
    publish_date: row.publish_date,
    image_url: buildMediaUrl(origin, 'news', row.news_id, row.image_key),
    links: (row.links || []).map((link) => ({ label: link.label, url: link.url })),
  };
}

/** social_links行 → 公開SNS LINK情報。link_id/dj_id/created_at/updated_atは含めない。 */
export function serializeSocialLink(row) {
  return {
    service: row.service,
    label: row.label,
    url: row.url,
  };
}

/**
 * popups行 → 公開POPUP情報。popup_id/title/body/link_url/link_label/image_url/expires_atのみ。
 * link_labelが未設定(null/空文字)の場合は既定文言「詳しくはこちら」にフォールバックする
 * (管理画面側のUI既定文言と同じ)。
 * rowがnull(有効な公開中POPUPが無い)の場合はnullをそのまま返す。
 */
export function serializePopup(row, origin) {
  if (!row) return null;
  const label = row.link_label && String(row.link_label).trim() ? row.link_label : '詳しくはこちら';
  return {
    popup_id: row.popup_id,
    title: row.title,
    body: row.body,
    link_url: row.link_url,
    link_label: label,
    image_url: buildMediaUrl(origin, 'popups', row.popup_id, row.image_key),
    expires_at: row.expires_at,
  };
}
