# CSPJ Public API (`cspj-public-api`)

CSPJ各DJの公開情報(プロフィール・Schedule・NEWS・SNS LINKS・POPUP)を、認証不要の
読み取り専用APIとして配信するための、独立したCloudflare Workerです。

管理画面(`manage.cs-pj.com`、Cloudflare Pages、Cloudflare Accessによる認証あり)とは
**完全に別のCloudflareプロジェクト**として構成し、想定カスタムドメインは
`api.cs-pj.com`(Cloudflare Access **なし**)です。

D1データベース(`cspj-manage-db`)・R2バケット(`cspj-manage-media`)は、管理画面側
(`cspj-manage`)と同じリソースを読み取り専用の用途で共有します(Contact APIのみ例外。
下記「Contact API」章参照)。GET系公開APIのコードには **SELECT / R2 `get()` 以外の
操作(INSERT・UPDATE・DELETE・R2の`put`/`delete`)を一切実装しません**
(`test/no-write-operations.test.mjs` で回帰確認しています)。

> **現状(2026-09時点)**: `https://api.cs-pj.com` へデプロイ済み・稼働中です
> (Worker名 `cspj-public-api`、Custom Domain設定済み)。Contact API
> (`POST /v1/contact`)はコード実装・テストまで完了していますが、
> **本番利用開始にはまだ準備作業が必要です**(下記「Contact API」章参照)。

## 提供endpoint

```
GET  /v1/djs/:slug
GET  /v1/djs/:slug/events
GET  /v1/djs/:slug/news
GET  /v1/djs/:slug/social-links
GET  /v1/djs/:slug/popup
GET  /v1/djs/:slug/site        … 上記4つ(dj/events/news/social_links/popup)を一括取得

GET  /v1/media/events/:event_id/:file    … Scheduleのフライヤー画像
GET  /v1/media/news/:news_id/:file       … NEWSの画像
GET  /v1/media/popups/:popup_id/:file    … POPUPの画像

POST /v1/contact                          … Contact Form送信受付(下記「Contact API」章参照)
```

上記の`GET /v1/djs/*` `GET /v1/media/*`について、GET/OPTIONS以外のメソッド、および
一致しないパスはすべて `404` を返します(`405 Method Not Allowed` は使わない設計です)。
**`/v1/contact` のみ例外**で、`POST`/`OPTIONS`以外のメソッドには `405` を返します
(詳細は「Contact API」章)。この2つの方針は完全に独立しており、互いに影響しません。

## 公開条件

| リソース | 条件 |
|---|---|
| DJ | `status = 'active'` |
| Schedule (events) | `status = 'published'` |
| NEWS | `status = 'published' AND publish_date <= datetime('now')` |
| POPUP | `status = 'published' AND expires_at IS NOT NULL AND expires_at > datetime('now')` |
| SNS LINKS | 対象DJ(active)に紐づく登録済みリンク全件 |

DJが存在しない、または `status <> 'active'` の場合、そのslug配下の**全endpoint**
(`events`/`news`/`social-links`/`popup`/`site`含む)が `404` になります。

0件時のレスポンス:
```
events        []
news          []
social_links  []
popup         null
```

## レスポンスに含めないフィールド(allow-list方式)

`src/lib/serialize.js` はDB行を `{ ...row }` のように展開せず、フィールドを1つずつ
明示的に列挙して返します。以下は**どのレスポンスにも一切含まれません**:

```
dj_id / image_key / flyer_key / account_status / users情報 / status /
created_at / updated_at / link_id / sort_order / memo / Access関連情報
```

Scheduleの `memo`(内部管理メモ)は、`src/lib/db.js` のSELECT文自体に含めていない
ため、serialize層に到達する前の時点で除外されています。

NEWS linksは `sort_order` 昇順で並べた `[{label, url}]` のみを返し、`sort_order`
自体・`link_id`・`news_id` はレスポンスに含めません。

POPUPは以下のみを公開対象とします:
```
popup_id / title / body / link_url / link_label / image_url / expires_at
```
`link_label` が未設定(NULL・空文字)の場合は `"詳しくはこちら"` にフォールバックします。

## 画像配信(`/v1/media/*`)

R2のobject key(例: `flyers/<dj_id>/<event_id>/<uuid>.<ext>`)は内部`dj_id`を含むため、
そのままURLへ露出させません。`image_url` は代わりに
`https://api.cs-pj.com/v1/media/<kind>/<record_id>/<uuid>.<ext>` の形で組み立てられ、
`<record_id>` には元々公開情報であるevent_id/news_id/popup_idを、`<uuid>.<ext>` には
image_keyの末尾セグメント(version token)のみを使います。

`/v1/media/*` へのリクエストは、都度以下の手順で処理します(`src/lib/media.js`):

```
record ID
  ↓
D1で「現在の公開条件」を再確認(非公開化・期限切れなら即404)
  ↓
現在のimage_keyを取得
  ↓
requestedされたversion(:file)と現在のimage_keyの末尾セグメントを比較(不一致なら404)
  ↓
一致すればprivate R2から get() してstream
```

これにより、非公開化・期限切れ後は(URLを知っていても)画像が配信されなくなります。
また画像差し替え時は`image_key`(≒version)が変わるため、古いURLは自然に404になります。

## Contact API(`POST /v1/contact`)

CSPJ公式サイト(`cs-pj.com`の問い合わせフォーム)からの送信を受け付ける、
公開API内で唯一の**書き込み**エンドポイントです。GET系公開APIとは異なり、
外部入力(氏名・メール・本文等)をD1(`contact_submissions`テーブル)へ保存します。

### データフロー

```
cs-pj.com/contact/
  ↓ POST
https://api.cs-pj.com/v1/contact
  ↓
Content-Type確認(application/jsonのみ) → 415
  ↓
body size確認(最大16KB、Content-Lengthを信用せず実受信量で判定) → 413
  ↓
JSON parse → 400
  ↓
入力validation(下記) → 400
  ↓
Turnstile server-side verification(fail closed) → 403
  ↓
D1 INSERT(contact_submissionsのみ) → 失敗時500
  ↓
201 { "ok": true }
```
途中のどこで失敗しても、それ以降には進みません(D1 INSERTが完了した場合のみ201)。

### Request

```json
{
  "name": "山田 太郎",
  "email": "example@example.com",
  "category": "dj_site",
  "sns_url": "https://instagram.com/...",
  "message": "問い合わせ本文",
  "privacy_consent": true,
  "privacy_policy_version": "2026-09-05",
  "turnstile_token": "..."
}
```
`sns_url` のみ任意。`status`/`contact_id`/`created_at`等をクライアントが指定しても
一切採用されません(`src/lib/contact-validate.js` がallow-list方式で明示的に
列挙したフィールドしか読み取らないため)。

### validation(`src/lib/contact-validate.js`)

| フィールド | 必須 | 検証内容 |
|---|---|---|
| `name` | ✅ | 文字列、trim後1〜100文字 |
| `email` | ✅ | 文字列、簡易メール形式、最大254文字 |
| `category` | ✅ | 次のallowlistのみ: `web_site` `dj_site` `visual_flyer` `promotion` `event` `other` |
| `sns_url` | 任意 | 指定時のみ検証。http/httpsのみ、最大2048文字 |
| `message` | ✅ | 文字列、trim後10〜5000文字 |
| `privacy_consent` | ✅ | **boolean `true`のみ**(文字列`"true"`等は暗黙変換せず拒否) |
| `privacy_policy_version` | ✅ | 現在の許可version(`PRIVACY_POLICY_VERSION`定数、現在`"2026-09-05"`)と完全一致のみ |
| `turnstile_token` | ✅(本番時) | 空でない文字列(実際の検証はTurnstile章) |

型が違う場合の暗黙変換は一切行いません(例: `name`にobject、`privacy_consent`に
文字列`"true"`)。将来Privacy Policyを更新する際は、`PRIVACY_POLICY_VERSION`定数を
変更するだけで新versionのみ受理するようになります(任意の文字列をそのまま
「同意済みversion」として受け入れる実装にはしていません)。

### Response

| ケース | Status | Body |
|---|---|---|
| 成功 | `201` | `{"ok": true}`(`contact_id`は返しません) |
| validation失敗 | `400` | `{"error": "Bad Request"}` |
| Turnstile失敗 | `403` | `{"error": "Forbidden"}` |
| Content-Type不正 | `415` | `{"error": "Unsupported Media Type"}` |
| body size超過 | `413` | `{"error": "Payload Too Large"}` |
| POST以外のメソッド | `405` | `{"error": "Method Not Allowed"}`、`Allow: POST, OPTIONS` |
| D1エラー等 | `500` | `{"error": "Internal Server Error"}` |

全レスポンスは常に `Cache-Control: no-store`。内部SQL・スタックトレース・
D1エラー本文等は一切レスポンスに含めません。

### Turnstile(`src/lib/turnstile.js`)

Cloudflare Turnstileによるサーバー側検証を**必須・fail closed**とします。

- `env.TURNSTILE_SECRET_KEY`(Worker Secret)が**未設定の場合、検証をスキップして
  D1へ保存する経路は存在しません**。secret未設定は実際のTurnstile検証失敗と
  完全に同一のレスポンス(`403`)になり、外部から区別できません。
- 検証先は `https://challenges.cloudflare.com/turnstile/v0/siteverify`。
  ネットワークエラー・非2xx・レスポンスJSONの`success !== true`は、いずれも
  区別なく検証失敗として扱います。
- `verifyTurnstile(token, secretKey, fetchImpl)` は`fetchImpl`を差し替え可能な
  設計にしてあり、テストではCloudflareへ実通信せずmockで検証します
  (恒久的なbypass flagは実装していません)。

**Secretの設定方法**(値そのものはこのリポジトリ・READMEには一切含めません):
```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```
実行するとプロンプトで値の入力を求められます(対話式)。

### D1 schema(`contact_submissions`)

```sql
CREATE TABLE contact_submissions (
  contact_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL,
  sns_url TEXT,
  message TEXT NOT NULL,
  privacy_consent INTEGER NOT NULL,
  privacy_policy_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_contact_submissions_status ON contact_submissions(status);
CREATE INDEX idx_contact_submissions_created_at ON contact_submissions(created_at);
```

`status`はINSERT時に本Worker側で必ず`'new'`固定(`src/lib/contact-db.js`のSQL文に
リテラルで埋め込み。クライアント値を使う経路は無い)。将来Manage側で
`new` / `in_progress` / `replied` / `closed` を管理する想定です。

> **⚠️ migrationの管理元について**: `cspj-manage-db`のD1 schema/migrationは
> **`cspj-manage`(`manage.CSPJ_HP`)リポジトリの`migrations/`が正本**です
> (本リポジトリには`migrations/`ディレクトリを作成していません)。
> `contact_submissions`テーブルのmigrationは、`manage.CSPJ_HP`側で別途
> 作成・適用する必要があります(上記のCREATE TABLE文をそのまま使えます)。
> **本リポジトリのコードは、このテーブルが既に存在する前提で動作します**
> (存在しない場合、INSERT失敗により常に`500`を返します)。

### 書き込み範囲の保証(`test/no-write-operations.test.mjs`)

Contact API追加により、本APIは初めて意図的な書き込み(INSERT)を持ちました。
保証内容を以下に変更しています:

- `src/lib/contact-db.js` **以外**のどのファイルにも、書き込み系操作
  (INSERT/UPDATE/DELETE/DDL、R2の`put`/`delete`、D1の`run()`)が一切存在しない
  (`/v1/djs/*` `/v1/media/*`は引き続き完全に読み取り専用)
- `src/lib/contact-db.js`に存在してよい書き込みは、**`contact_submissions`への
  INSERTのみ**。このファイルであっても UPDATE/DELETE/R2書き込みは禁止のまま
- 上記は静的なソースコード解析(正規表現)によるテストで、実行時のロジック変更
  だけでなくソース自体への回帰としても保証しています

### 本番利用開始までに必要な作業(未実施)

コード実装・テストと、実際の本番運用開始は分離しています。**Contact APIを
「本番運用可能」と判断するには、最低限以下がすべて揃う必要があります**:

- [ ] `manage.CSPJ_HP`側で`contact_submissions`のmigrationを本番D1へ適用
- [ ] `wrangler secret put TURNSTILE_SECRET_KEY` でSecretを設定
- [ ] `CSPJ_HP`側にTurnstile UIを導入
- [ ] `CSPJ_HP`のContact Formから実際に接続
- [ ] 必要ならCloudflare側でRate Limitingルールを設定(下記)

これらが揃うまでは、コードが本番にデプロイされていても実質的に利用開始しない
方針です(Secret未設定の間はfail closedにより常に`403`となり、書き込みは発生しません)。

### Rate Limiting(推奨案・未設定)

Worker内へ独自のIP保存等は実装していません(`contact_submissions`にもIPアドレスは
一切保存しません)。Cloudflare側のWAF / Rate Limiting Rulesでの設定を推奨します:

- 対象: `http.request.uri.path eq "/v1/contact"`
- カウント: 送信元IPごと
- しきい値の初期案: 1分あたり5リクエスト程度(通常の問い合わせ利用では十分足りる想定)
- 動作: Block、Mitigation timeout: 60秒程度

利用可能なルール数・カウント方法(IPのみ/複数条件併用可)はCloudflareのプランに
よって異なります(Free: 1ルール、Pro: 2ルール、Business以上はより柔軟)。実際の
設定はダッシュボード(Security > WAF > Rate limiting rules)からの手動作業になります。

### honeypotについて(未実装・提案)

スパム対策として、隠しフィールドを利用したhoneypot方式(入力があれば黙って拒否/
無視する)も有効ですが、`CSPJ_HP`側のフォームHTML実装と対になる仕様のため、
今回は勝手にRequest仕様へ追加していません。必要であれば別途ご相談ください。

## Cache-Control

初期実装では長期immutableキャッシュは使用せず、以下の短時間キャッシュのみとします
(非公開化・期限切れが実際のCDN配信へ反映されるまでの遅延を抑えるため):

- JSON系endpoint: `Cache-Control: public, max-age=60, s-maxage=60`
- media(画像)endpoint: `Cache-Control: public, max-age=60, s-maxage=60`
- 404レスポンス: `Cache-Control: no-store`

長期cache・Cache API・purge戦略は今回のフェーズでは実装しません(将来の最適化課題)。

## CORS

`GET /v1/djs/*` `GET /v1/media/*`(既存の公開GET API)は、認証不要でどこからでも
参照されてよい情報のため、Allow-Originはワイルドカードです:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
```

`POST /v1/contact` は外部入力を受け付ける(書き込む)エンドポイントのため、
利用元を公式サイトのみに限定した別のCORS設定を持ちます:
```
Access-Control-Allow-Origin: https://cs-pj.com
Access-Control-Allow-Methods: POST, OPTIONS
```
(`www.cs-pj.com` は常に `cs-pj.com` へ301リダイレクトされ、そのoriginから直接fetchが
発生することは無いため、許可originに含めていません。)

いずれもCredentials(cookie等)は一切扱わず、`OPTIONS` は `204`(正常応答)を返します。
CORSはあくまで補助的な防御であり、Contact APIの本体の防御は次章のvalidation /
Turnstile / (導入予定の)Rate Limitingです。

## project構成

```
cspj-public-api/
├─ wrangler.toml
├─ .gitignore
├─ README.md
├─ src/
│  ├─ index.js              … ルーティングを担当するエントリポイント。
│  │                            /v1/contact のメソッド判定+CORSも(URLPatternに
│  │                            依存しないためhandleContact()としてexport)
│  ├─ lib/
│  │  ├─ db.js               … 公開条件を集約したD1クエリ関数群(個別endpoint/site共通)
│  │  ├─ serialize.js        … allow-list方式のレスポンス整形
│  │  ├─ response.js         … JSON/404/CORS/Cache-Controlヘルパー(GET系+Contact系)
│  │  ├─ media.js            … image_url組み立て・再検証付きR2 stream解決
│  │  ├─ contact-validate.js … Contact送信の入力validation(allow-list方式)
│  │  ├─ turnstile.js        … Cloudflare Turnstileサーバー側検証(fail closed、DI可能)
│  │  └─ contact-db.js       … 【唯一の書き込み箇所】contact_submissionsへのINSERT
│  └─ handlers/
│     ├─ djs.js              … /v1/djs/* の6ハンドラ
│     ├─ media.js            … /v1/media/* の3ハンドラ
│     └─ contact.js          … POST /v1/contact のハンドラ
└─ test/
   ├─ mock-d1.js             … Node標準機能のみで書いた簡易D1モック(contact_submissions
   │                            へのINSERTのみ許可、forceRunErrorオプションあり)
   ├─ mock-r2.js             … 同、R2モック
   ├─ fixtures.js            … 全テスト共通の固定データセット
   ├─ db.test.mjs            … lib/db.js の公開条件テスト
   ├─ serialize.test.mjs     … lib/serialize.js のallow-listテスト
   ├─ response.test.mjs      … lib/response.js のCORS/Cache-Controlテスト
   ├─ handlers.test.mjs      … handlers/* の統合的なテスト(site⇔個別endpoint一致含む)
   ├─ contact-validate.test.mjs … contact-validate.js のvalidationテスト
   ├─ turnstile.test.mjs         … turnstile.js のテスト(Cloudflareへ実通信しない)
   ├─ contact.test.mjs           … handlers/contact.js の統合テスト
   ├─ contact-routing.test.mjs   … /v1/contact のメソッド判定・CORSのテスト
   └─ no-write-operations.test.mjs … 書き込み範囲(contact_submissionsのみ)の静的テスト
```

`src/handlers/*` はURLPatternに一切依存しない `(params, env, origin) => Response`
という統一シグネチャにしてあり、Node環境からURLPatternを介さず直接呼び出してテスト
できます。`src/index.js`(実際のURLPatternによるルーティング)はNode環境と
Workerランタイム(workerd)とで挙動差が起こり得るため、Node側のunitテスト対象には
含めていません。ルーティング自体(実際のHTTPパス解決)は `wrangler dev` を使った
実HTTPリクエストで確認してください。

## テスト実行方法

npm依存は追加していません(`package.json` も置いていません)。Node標準の
テストランナー(`node:test`)のみを使用します。

```bash
# 全テストをまとめて実行(shellのglob展開でtest/配下の*.test.mjsを全て渡す)
node --test test/*.test.mjs

# 個別ファイルのみ実行する場合
node --test test/db.test.mjs
node --test test/serialize.test.mjs
node --test test/response.test.mjs
node --test test/handlers.test.mjs
node --test test/contact-validate.test.mjs
node --test test/turnstile.test.mjs
node --test test/contact.test.mjs
node --test test/contact-routing.test.mjs
node --test test/no-write-operations.test.mjs
```

> 環境によっては `node --test test/`(ディレクトリを直接渡す形)が正しく
> 動作しないことがあります(このリポジトリの開発環境ではCJSモジュール解決エラーに
> なることを確認済みです)。上記の `test/*.test.mjs` の形、または個別ファイル指定を
> 使ってください。

## ローカルでの動作確認(`wrangler dev`)

```bash
npx wrangler dev
```

起動後、別ターミナルから実際のHTTPリクエストで確認できます(例):

```bash
curl -i http://localhost:8787/v1/djs/yu-x
curl -i http://localhost:8787/v1/djs/nonexistent-slug
curl -i -X OPTIONS http://localhost:8787/v1/djs/yu-x
curl -i -X POST http://localhost:8787/v1/djs/yu-x
```

`wrangler dev` はデフォルトで **remote** のD1/R2を参照しません(`--local` 相当の
ローカルD1が使われます)。ローカルD1に実データが入っていない場合、多くのレスポンスは
`404`(DJが見つからない)になりますが、これはルーティング・CORS・メソッドハンドリング・
Cache-Controlヘッダーの形を確認する目的では問題ありません。

## Cloudflare上でのデプロイ状況

完了済み:

- git remote作成・GitHub repository(`api.CSPJ_HP`)作成・commit・push
- `wrangler deploy`(Worker `cspj-public-api` を本番作成)
- `api.cs-pj.com` custom domainの作成・反映
- GET系公開API(`/v1/djs/*` `/v1/media/*`)の本番稼働確認

未実施(Contact API関連。詳細は「Contact API > 本番利用開始までに必要な作業」参照):

- `manage.CSPJ_HP`側での`contact_submissions`のmigration適用
- `TURNSTILE_SECRET_KEY` の設定
- Rate Limitingルールの設定
- `CSPJ_HP`側のTurnstile導入・Contact Form接続

> **補足**: このWorkerはGitHubリポジトリとの自動デプロイ連携(Git integration /
> Workers Builds)を構成していません。デプロイは常に手動の`wrangler deploy`
> 実行時にのみ発生します(`git push`だけでは本番へは反映されません)。

## 関連プロジェクト

- 管理画面(`manage.cs-pj.com`): `cspj-manage`(別リポジトリ、Cloudflare Pages、Access保護あり)
- 公開サイト(`cs-pj.com`): `CSPJ_HP`(別リポジトリ。本APIとの接続は今回のフェーズでは未実施)
