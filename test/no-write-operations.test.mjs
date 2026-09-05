/**
 * 静的チェック: src/配下のソースコードの書き込み範囲を保証する。
 *
 * 【2026-09 Contact API追加による保証内容の変更】
 * 従来は「src/配下に書き込み系操作が一切存在しない」ことを保証していたが、
 * Contact API(POST /v1/contact)の追加により、contact_submissions への INSERT だけは
 * 意図的かつ正当な書き込みになった。そのため保証内容を次のように変更する:
 *
 *   1. src/lib/contact-db.js 以外のどのファイルにも、書き込み系操作
 *      (INSERT/UPDATE/DELETE/DDL、R2のput()/delete()、D1のrun())が一切存在しない
 *      (/v1/djs/* /v1/media/* は引き続き完全に読み取り専用である)。
 *   2. src/lib/contact-db.js に存在してよい書き込みは、
 *      「contact_submissions へのINSERT」だけである。
 *        - このファイルであっても UPDATE / DELETE / R2のput()/delete() は禁止のまま。
 *        - INSERT INTO は必ず1件以上存在し、そのすべてが contact_submissions を
 *          対象にしていること(他テーブルへのINSERTが紛れ込んでいないこと)。
 *
 * これにより、Contact APIからdjs/events/news/social_links/popups/users等へ
 * 書き込める状態になっていないことを、実行時テストだけでなくソース自体への
 * 回帰テストとしても保証する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

// contact_submissionsへのINSERTだけを例外的に許可する、唯一のファイル。
const WRITE_ALLOWED_FILE = 'lib/contact-db.js';
const ALLOWED_WRITE_TABLE = 'contact_submissions';

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// SQL文としての書き込み系キーワード、およびR2の書き込み系メソッド呼び出し。
// 大文字・小文字を区別せずに検出する(SQLキーワードは大文字統一だが念のため)。
const FULLY_FORBIDDEN_PATTERNS = [
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\.put\s*\(/, // R2Bucket.put(): どのファイルにも一切存在してはいけない
  /\.delete\s*\(/, // R2Bucket.delete(): 同上
];

// contact-db.js以外では、INSERT/run()もこれらと同様に完全禁止。
const READONLY_ONLY_PATTERNS = [
  /\bINSERT\s+INTO\b/i,
  /\.run\s*\(/,
];

test('src/配下(contact-db.js除く)のどのファイルにも書き込み系操作が存在しない', () => {
  const files = listJsFiles(SRC_DIR);
  assert.ok(files.length > 0, 'src/配下のjsファイルが1つも見つかりませんでした(パス設定を確認してください)');

  for (const file of files) {
    const rel = relative(SRC_DIR, file).split('\\').join('/'); // Windows対策
    if (rel === WRITE_ALLOWED_FILE) continue; // このファイルだけは別途検証する

    const content = readFileSync(file, 'utf8');
    for (const pattern of [...FULLY_FORBIDDEN_PATTERNS, ...READONLY_ONLY_PATTERNS]) {
      assert.equal(
        pattern.test(content),
        false,
        `${rel} に書き込み系の可能性があるパターン ${pattern} が見つかりました`
      );
    }
  }
});

test('contact-db.js: UPDATE/DELETE/R2書き込みは存在しない', () => {
  const content = readFileSync(join(SRC_DIR, WRITE_ALLOWED_FILE), 'utf8');
  for (const pattern of FULLY_FORBIDDEN_PATTERNS) {
    assert.equal(pattern.test(content), false, `${WRITE_ALLOWED_FILE} に禁止パターン ${pattern} が見つかりました`);
  }
});

test('contact-db.js: INSERT INTO はすべて contact_submissions のみを対象にしている', () => {
  const content = readFileSync(join(SRC_DIR, WRITE_ALLOWED_FILE), 'utf8');

  const matches = [...content.matchAll(/INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)/gi)];
  assert.ok(matches.length > 0, `${WRITE_ALLOWED_FILE} にINSERT INTOが1件も見つかりませんでした`);

  for (const m of matches) {
    assert.equal(
      m[1].toLowerCase(),
      ALLOWED_WRITE_TABLE,
      `${WRITE_ALLOWED_FILE} のINSERT INTOが想定外のテーブル(${m[1]})を対象にしています`
    );
  }

  // 書き込みを実行するrun()自体もこのファイルに存在すること(検証だけして実行しない、
  // という中途半端な状態になっていないことの確認)。
  assert.ok(/\.run\s*\(/.test(content), `${WRITE_ALLOWED_FILE} に .run() の呼び出しが見つかりませんでした`);
});

test('djs.js / media.js ハンドラは引き続き完全に読み取り専用である', () => {
  for (const rel of ['handlers/djs.js', 'handlers/media.js', 'lib/db.js', 'lib/media.js']) {
    const content = readFileSync(join(SRC_DIR, rel), 'utf8');
    for (const pattern of [...FULLY_FORBIDDEN_PATTERNS, ...READONLY_ONLY_PATTERNS]) {
      assert.equal(pattern.test(content), false, `${rel} に書き込み系パターン ${pattern} が見つかりました`);
    }
  }
});
