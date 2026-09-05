/**
 * CSPJ Public API — Contact送信のD1書き込み
 * /src/lib/contact-db.js
 *
 * 【最重要】このファイルは、公開API全体の中で唯一 D1 への書き込み(INSERT)を行う
 * 場所です。contact_submissions テーブルへのINSERT以外の書き込み(他テーブルへの
 * INSERT、いかなるUPDATE/DELETE、DDL等)は一切実装しません。
 *
 * test/no-write-operations.test.mjs が、以下を静的に回帰確認しています:
 *   - src/ 配下でこのファイル以外に INSERT/UPDATE/DELETE や、D1のrun実行・R2の
 *     put/delete呼び出しが一切存在しないこと
 *   - このファイル内の INSERT INTO が contact_submissions 以外を対象にしていないこと
 *   - このファイル内にも UPDATE/DELETE、R2のput/delete呼び出しが存在しないこと
 *
 * D1 schema(contact_submissionsテーブル)の管理元は本リポジトリではない。
 * 詳細は README.md の「Contact API」章を参照。
 */

/**
 * 検証済み(validateContactPayloadを通過済み)のデータをcontact_submissionsへ
 * INSERTする。contact_id はここで生成する。status は常に 'new' 固定であり、
 * 呼び出し元から上書きする経路は存在しない。
 *
 * @param {D1Database} db  env.DB
 * @param {{name:string, email:string, category:string, sns_url:string|null, message:string, privacy_policy_version:string}} data
 * @returns {Promise<string>} 生成された contact_id(レスポンスには含めない。内部用途のみ)
 */
export async function insertContactSubmission(db, data) {
  const contactId = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO contact_submissions
         (contact_id, name, email, category, sns_url, message,
          privacy_consent, privacy_policy_version, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')`
    )
    .bind(
      contactId,
      data.name,
      data.email,
      data.category,
      data.sns_url,
      data.message,
      1, // privacy_consent: SQLiteにboolean型は無いため0/1のINTEGERで保存(schema通り)。
      //   ここに到達する時点でvalidateContactPayloadがprivacy_consent===trueを
      //   確認済みのため、常に1を書き込む(クライアント値をそのまま使わない)。
      data.privacy_policy_version
    )
    .run();

  return contactId;
}
