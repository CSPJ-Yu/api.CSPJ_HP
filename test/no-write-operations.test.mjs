/**
 * 静的チェック: src/配下のソースコードに書き込み系操作が一切含まれていないことを確認する。
 * 「Public APIコードにはINSERT/UPDATE/DELETEを実装しない」「R2 put/deleteを実装しない」
 * という設計方針を、実行時テストだけでなくソース自体への回帰テストとしても保証する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

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
const FORBIDDEN_PATTERNS = [
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\.put\s*\(/, // R2Bucket.put / D1でも通常使わないが念のため
  /\.delete\s*\(/, // R2Bucket.delete
  /\.run\s*\(/, // D1PreparedStatement.run()(書き込み実行用。本APIはfirst()/all()のみ使う)
];

test('src/配下のどのファイルにも書き込み系操作(INSERT/UPDATE/DELETE/put/delete/run)が存在しない', () => {
  const files = listJsFiles(SRC_DIR);
  assert.ok(files.length > 0, 'src/配下のjsファイルが1つも見つかりませんでした(パス設定を確認してください)');

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.equal(
        pattern.test(content),
        false,
        `${file} に書き込み系の可能性があるパターン ${pattern} が見つかりました`
      );
    }
  }
});
