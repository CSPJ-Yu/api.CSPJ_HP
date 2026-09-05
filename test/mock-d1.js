/**
 * テスト用の簡易D1モック(Node標準機能のみ、npm依存なし)。
 * /test/mock-d1.js
 *
 * cspj-manage側のテストで確立した「実SQLをそのまま実クエリとして流し込み、
 * 正規表現で対象テーブル/条件を判定してJSでフィルタする」という手法を踏襲する。
 * フルのSQLパーサではなく、src/lib/db.js・src/lib/media.js・src/lib/contact-db.js が
 * 実際に発行する既知のクエリ形だけを対象にした、意図的に単純な作り。
 *
 * 【重要】"now" は固定文字列で受け取る(実行時刻に依存させない)。
 * DB保存形式("YYYY-MM-DD HH:MM:SS")はゼロ埋め固定長のため、文字列としての
 * 大小比較がそのまま時系列の前後関係と一致する(SQLite側のdatetime比較と同じ性質)。
 *
 * 【2026-09 Contact API追加】run()は、Public APIが全編SELECTのみだった間は
 * 「呼ばれたら即エラー」で書き込みゼロを保証していたが、Contact APIの追加により
 * contact_submissions への INSERT だけは正当な書き込みになった。そのため run() は
 * 「INSERT INTO contact_submissions」のときだけ実際にfixtures.contact_submissionsへ
 * 反映し、それ以外(他テーブルへのINSERT、UPDATE、DELETE等)は従来通り例外を投げる
 * ことで、書き込み範囲がcontact_submissionsだけに限定されていることをテストで
 * 確認できるようにしている。
 */

export function createMockD1(fixtures, options = {}) {
  const now = options.now || '2026-09-04 12:00:00';
  const forceRunError = Boolean(options.forceRunError);
  let writeAttempted = false;
  const writeLog = [];

  function prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    let boundArgs = [];
    return {
      bind(...args) {
        boundArgs = args;
        return this;
      },
      async first() {
        const rows = execute(normalized, boundArgs);
        return rows[0] || null;
      },
      async all() {
        const rows = execute(normalized, boundArgs);
        return { results: rows };
      },
      async run() {
        // "D1 INSERT失敗"のテスト用: D1側の障害(接続断・容量超過等)をシミュレートする。
        if (forceRunError) {
          throw new Error('Mock D1: simulated D1 failure(テスト用)');
        }

        if (/^INSERT INTO contact_submissions\b/i.test(normalized)) {
          writeAttempted = true;
          const [
            contact_id, name, email, category, sns_url, message,
            privacy_consent, privacy_policy_version,
          ] = boundArgs;
          const row = {
            contact_id, name, email, category, sns_url, message,
            privacy_consent, privacy_policy_version, status: 'new',
          };
          writeLog.push({ table: 'contact_submissions', row });
          (fixtures.contact_submissions ||= []).push(row);
          return { success: true };
        }

        writeAttempted = true;
        writeLog.push({ table: null, sql: normalized, rejected: true });
        throw new Error(
          'Mock D1: run()(書き込み)は contact_submissions へのINSERT以外サポートしていません。'
        );
      },
    };
  }

  function execute(sql, args) {
    if (/\bFROM\s+djs\b/.test(sql)) {
      const [slug] = args;
      return (fixtures.djs || [])
        .filter((d) => d.slug === slug && d.status === 'active')
        .map((d) => ({ dj_id: d.dj_id, slug: d.slug, display_name: d.display_name }));
    }

    if (/\bFROM\s+news_links\b/.test(sql)) {
      const [newsId] = args;
      return (fixtures.news_links || [])
        .filter((l) => l.news_id === newsId)
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => ({ label: l.label, url: l.url }));
    }

    if (/\bFROM\s+events\b/.test(sql)) {
      if (sql.includes('event_id = ?')) {
        const [eventId] = args;
        const row = (fixtures.events || []).find((e) => e.event_id === eventId && e.status === 'published');
        return row ? [{ image_key: row.flyer_key || null }] : [];
      }
      const [djId] = args;
      return (fixtures.events || [])
        .filter((e) => e.dj_id === djId && e.status === 'published')
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map((e) => ({
          event_id: e.event_id,
          date: e.date,
          event_name: e.event_name,
          venue: e.venue,
          location: e.location,
          type: e.type,
          flyer_key: e.flyer_key || null,
        }));
    }

    if (/\bFROM\s+news\b/.test(sql)) {
      if (sql.includes('news_id = ?')) {
        const [newsId] = args;
        const row = (fixtures.news || []).find(
          (n) => n.news_id === newsId && n.status === 'published' && n.publish_date <= now
        );
        return row ? [{ image_key: row.image_key || null }] : [];
      }
      const [djId] = args;
      return (fixtures.news || [])
        .filter((n) => n.dj_id === djId && n.status === 'published' && n.publish_date <= now)
        .slice()
        .sort((a, b) => (a.publish_date < b.publish_date ? 1 : a.publish_date > b.publish_date ? -1 : 0))
        .map((n) => ({
          news_id: n.news_id,
          title: n.title,
          body: n.body,
          publish_date: n.publish_date,
          image_key: n.image_key || null,
        }));
    }

    if (/\bFROM\s+social_links\b/.test(sql)) {
      const [djId] = args;
      return (fixtures.social_links || [])
        .filter((s) => s.dj_id === djId)
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
        .map((s) => ({ service: s.service, label: s.label, url: s.url }));
    }

    if (/\bFROM\s+popups\b/.test(sql)) {
      if (sql.includes('popup_id = ?')) {
        const [popupId] = args;
        const row = (fixtures.popups || []).find(
          (p) => p.popup_id === popupId && p.status === 'published' && p.expires_at && p.expires_at > now
        );
        return row ? [{ image_key: row.image_key || null }] : [];
      }
      const [djId] = args;
      return (fixtures.popups || [])
        .filter((p) => p.dj_id === djId && p.status === 'published' && p.expires_at && p.expires_at > now)
        .slice()
        .sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
        .slice(0, 1)
        .map((p) => ({
          popup_id: p.popup_id,
          title: p.title,
          body: p.body,
          link_url: p.link_url,
          link_label: p.link_label || null,
          image_key: p.image_key || null,
          expires_at: p.expires_at,
        }));
    }

    throw new Error(`Mock D1: 未対応のクエリです(テスト側の実装漏れの可能性): ${sql}`);
  }

  return {
    prepare,
    get writeAttempted() {
      return writeAttempted;
    },
    /** 発生した書き込み(許可されたものも拒否されたものも含む)の記録。テスト検証用。 */
    get writeLog() {
      return writeLog.slice();
    },
  };
}
