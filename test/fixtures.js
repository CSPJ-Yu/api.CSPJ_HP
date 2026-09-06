/**
 * 全テスト共通の固定データセット。
 * /test/fixtures.js
 *
 * 「現在時刻」は固定文字列 NOW で扱う(実行タイミングに依存させないため)。
 * 日付は currentDate(2026-09-04)を基準にした前後関係にしてある。
 */
export const NOW = '2026-09-04 12:00:00';

export const fixtures = {
  djs: [
    {
      dj_id: 'dj-1',
      slug: 'yu-x',
      display_name: 'YU-X',
      status: 'active',
      portal_card_image_key: 'portal-cards/dj-1/eeee-5555.jpg',
    },
    // other-djはportal_card_image_key未設定(portal_card_image_url: nullのケース用)
    { dj_id: 'dj-2', slug: 'other-dj', display_name: 'OTHER DJ', status: 'active' },
    // inactive-djはあえてportal_card_image_keyを設定しR2にも実体を置く。
    // 「inactiveならkey/R2実体があっても取得不可」を確認するため
    // (ev-draft-with-imageと同じ考え方)。
    {
      dj_id: 'dj-3',
      slug: 'inactive-dj',
      display_name: 'INACTIVE DJ',
      status: 'inactive',
      portal_card_image_key: 'portal-cards/dj-3/ffff-6666.jpg',
    },
  ],

  events: [
    {
      event_id: 'ev-published',
      dj_id: 'dj-1',
      date: '2026-10-01',
      event_name: 'CSPJ NIGHT',
      venue: 'Club A',
      location: 'Tokyo',
      type: 'club',
      status: 'published',
      flyer_key: 'flyers/dj-1/ev-published/aaaa-1111.jpg',
      memo: '主催者向け内部メモ(公開してはいけない)',
    },
    {
      event_id: 'ev-published-noimage',
      dj_id: 'dj-1',
      date: '2026-11-01',
      event_name: 'NO IMAGE EVENT',
      venue: 'Club B',
      location: 'Osaka',
      type: 'club',
      status: 'published',
      flyer_key: null,
      memo: null,
    },
    {
      event_id: 'ev-draft',
      dj_id: 'dj-1',
      date: '2026-10-05',
      event_name: 'DRAFT EVENT',
      venue: 'Club C',
      location: 'Tokyo',
      type: 'club',
      status: 'draft',
      flyer_key: null,
      memo: null,
    },
    {
      event_id: 'ev-archived',
      dj_id: 'dj-1',
      date: '2026-01-01',
      event_name: 'ARCHIVED EVENT',
      venue: 'Club D',
      location: 'Tokyo',
      type: 'club',
      status: 'archived',
      flyer_key: null,
      memo: null,
    },
    {
      event_id: 'ev-cancelled',
      dj_id: 'dj-1',
      date: '2026-10-10',
      event_name: 'CANCELLED EVENT',
      venue: 'Club E',
      location: 'Tokyo',
      type: 'club',
      status: 'cancelled',
      flyer_key: null,
      memo: null,
    },
    // statusはdraftだが画像だけは持っている(=media routeが「画像の有無」だけで
    // 判定していないことを確認するためのケース。R2には実体もfixtures.r2mediaに置く)。
    {
      event_id: 'ev-draft-with-image',
      dj_id: 'dj-1',
      date: '2026-10-20',
      event_name: 'DRAFT WITH IMAGE',
      venue: 'Club F',
      location: 'Tokyo',
      type: 'club',
      status: 'draft',
      flyer_key: 'flyers/dj-1/ev-draft-with-image/bbbb-2222.jpg',
      memo: null,
    },
  ],

  news: [
    {
      news_id: 'news-published-past',
      dj_id: 'dj-1',
      title: '公開済みNEWS',
      body: '本文です',
      publish_date: '2026-09-01 00:00:00', // NOW以前 → 公開
      status: 'published',
      image_key: 'news/dj-1/news-published-past/cccc-3333.jpg',
    },
    {
      news_id: 'news-draft',
      dj_id: 'dj-1',
      title: '下書きNEWS',
      body: '本文です',
      publish_date: '2026-09-01 00:00:00',
      status: 'draft',
      image_key: null,
    },
    {
      news_id: 'news-archived',
      dj_id: 'dj-1',
      title: 'アーカイブ済みNEWS',
      body: '本文です',
      publish_date: '2026-08-01 00:00:00',
      status: 'archived',
      image_key: null,
    },
    {
      news_id: 'news-future',
      dj_id: 'dj-1',
      title: '公開予約中NEWS',
      body: '本文です',
      publish_date: '2026-12-01 00:00:00', // NOWより未来 → 非公開(予約中)
      status: 'published',
      image_key: null,
    },
  ],

  news_links: [
    // わざと挿入順をsort_orderと不一致にしてある(順序保証のテスト用)
    { link_id: 'nl-a', news_id: 'news-published-past', label: 'リンクA', url: 'https://example.com/a', sort_order: 2 },
    { link_id: 'nl-b', news_id: 'news-published-past', label: 'リンクB', url: 'https://example.com/b', sort_order: 0 },
    { link_id: 'nl-c', news_id: 'news-published-past', label: 'リンクC', url: 'https://example.com/c', sort_order: 1 },
  ],

  social_links: [
    { link_id: 'sl-1', dj_id: 'dj-1', service: 'instagram', label: null, url: 'https://instagram.com/yu-x', created_at: '2026-01-01 00:00:00' },
    { link_id: 'sl-2', dj_id: 'dj-1', service: 'other', label: 'Linktree', url: 'https://linktr.ee/yu-x', created_at: '2026-01-02 00:00:00' },
    // 別DJのリンク(dj-1のsocial-linksに混入していないことを確認するため)
    { link_id: 'sl-3', dj_id: 'dj-2', service: 'x', label: null, url: 'https://x.com/other-dj', created_at: '2026-01-01 00:00:00' },
  ],

  popups: [
    {
      popup_id: 'popup-active',
      dj_id: 'dj-1',
      title: '有効なPOPUP',
      body: '本文です',
      link_url: 'https://example.com/popup',
      link_label: null, // 既定文言へフォールバックすることの確認用
      image_key: 'popup/dj-1/popup-active/dddd-4444.jpg',
      status: 'published',
      published_at: '2026-09-01 00:00:00',
      expires_at: '2026-10-01 00:00:00', // NOWより未来 → 有効
    },
    {
      popup_id: 'popup-expired',
      dj_id: 'dj-1',
      title: '期限切れPOPUP',
      body: '本文です',
      link_url: 'https://example.com/expired',
      link_label: 'カスタムラベル',
      image_key: null,
      status: 'published',
      published_at: '2026-07-01 00:00:00',
      expires_at: '2026-08-01 00:00:00', // NOWより過去 → 非公開
    },
    {
      popup_id: 'popup-draft',
      dj_id: 'dj-1',
      title: '下書きPOPUP',
      body: '本文です',
      link_url: null,
      link_label: null,
      image_key: null,
      status: 'draft',
      published_at: null,
      expires_at: null,
    },
    {
      popup_id: 'popup-archived',
      dj_id: 'dj-1',
      title: 'アーカイブ済みPOPUP',
      body: '本文です',
      link_url: null,
      link_label: null,
      image_key: null,
      status: 'archived',
      published_at: '2026-01-01 00:00:00',
      expires_at: '2026-02-01 00:00:00',
    },
  ],
};

/** mock R2に置く実オブジェクト(image_keyと一致させてある)。 */
export const r2Objects = {
  'flyers/dj-1/ev-published/aaaa-1111.jpg': { body: 'FAKE-JPEG-BYTES-EVENT', contentType: 'image/jpeg' },
  // draftイベントの画像も「R2には実体が存在する」状態にしておき、
  // media routeがDBのstatusを再確認して404にすることを確認する。
  'flyers/dj-1/ev-draft-with-image/bbbb-2222.jpg': { body: 'FAKE-JPEG-BYTES-DRAFT', contentType: 'image/jpeg' },
  'news/dj-1/news-published-past/cccc-3333.jpg': { body: 'FAKE-JPEG-BYTES-NEWS', contentType: 'image/jpeg' },
  'popup/dj-1/popup-active/dddd-4444.jpg': { body: 'FAKE-JPEG-BYTES-POPUP', contentType: 'image/jpeg' },
  'portal-cards/dj-1/eeee-5555.jpg': { body: 'FAKE-JPEG-BYTES-PORTAL-CARD', contentType: 'image/jpeg' },
  // inactive-dj用。「R2に実体があってもinactiveなら404」を確認するためのデータ。
  'portal-cards/dj-3/ffff-6666.jpg': { body: 'FAKE-JPEG-BYTES-PORTAL-CARD-INACTIVE', contentType: 'image/jpeg' },
};
