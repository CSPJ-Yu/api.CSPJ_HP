# CSPJ Public API (`cspj-public-api`)

CSPJ各DJの公開情報(プロフィール・Schedule・NEWS・SNS LINKS・POPUP)を、認証不要の
読み取り専用APIとして配信するための、独立したCloudflare Workerです。

管理画面(`manage.cs-pj.com`、Cloudflare Pages、Cloudflare Accessによる認証あり)とは
**完全に別のCloudflareプロジェクト**として構成し、想定カスタムドメインは
`api.cs-pj.com`(Cloudflare Access **なし**)です。

D1データベース(`cspj-manage-db`)・R2バケット(`cspj-manage-media`)は、管理画面側
(`cspj-manage`)と同じリソースを読み取り専用の用途で共有します。このリポジトリの
コードには **SELECT / R2 `get()` 以外の操作(INSERT・UPDATE・DELETE・R2の`put`/`delete`)
を一切実装しません**(`test/no-write-operations.test.mjs` で回帰確認しています)。

> **現状(2026-09時点)**: ローカル実装・ローカルテストの段階です。Cloudflare上への
> 実リソース作成・custom domain追加・`wrangler deploy`・git remote/GitHub repository作成・
> commit/pushはまだ行っていません。

## 提供endpoint

```
GET /v1/djs/:slug
GET /v1/djs/:slug/events
GET /v1/djs/:slug/news
GET /v1/djs/:slug/social-links
GET /v1/djs/:slug/popup
GET /v1/djs/:slug/site        … 上記4つ(dj/events/news/social_links/popup)を一括取得

GET /v1/media/events/:event_id/:file    … Scheduleのフライヤー画像
GET /v1/media/news/:news_id/:file       … NEWSの画像
GET /v1/media/popups/:popup_id/:file    … POPUPの画像
```

GET/OPTIONS以外のメソッド、および上記に一致しないパスはすべて `404` を返します
(`405 Method Not Allowed` は使わない設計です)。

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

## Cache-Control

初期実装では長期immutableキャッシュは使用せず、以下の短時間キャッシュのみとします
(非公開化・期限切れが実際のCDN配信へ反映されるまでの遅延を抑えるため):

- JSON系endpoint: `Cache-Control: public, max-age=60, s-maxage=60`
- media(画像)endpoint: `Cache-Control: public, max-age=60, s-maxage=60`
- 404レスポンス: `Cache-Control: no-store`

長期cache・Cache API・purge戦略は今回のフェーズでは実装しません(将来の最適化課題)。

## CORS

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
```
Credentials(cookie等)は一切扱いません。`OPTIONS` は `204`(正常応答)を返します。

## project構成

```
cspj-public-api/
├─ wrangler.toml
├─ .gitignore
├─ README.md
├─ src/
│  ├─ index.js              … ルーティング(URLPattern)のみを担当する薄いエントリポイント
│  ├─ lib/
│  │  ├─ db.js               … 公開条件を集約したD1クエリ関数群(個別endpoint/site共通)
│  │  ├─ serialize.js        … allow-list方式のレスポンス整形
│  │  ├─ response.js         … JSON/404/CORS/Cache-Controlヘルパー
│  │  └─ media.js            … image_url組み立て・再検証付きR2 stream解決
│  └─ handlers/
│     ├─ djs.js              … /v1/djs/* の6ハンドラ
│     └─ media.js            … /v1/media/* の3ハンドラ
└─ test/
   ├─ mock-d1.js             … Node標準機能のみで書いた簡易D1モック
   ├─ mock-r2.js             … 同、R2モック
   ├─ fixtures.js            … 全テスト共通の固定データセット
   ├─ db.test.mjs            … lib/db.js の公開条件テスト
   ├─ serialize.test.mjs     … lib/serialize.js のallow-listテスト
   ├─ response.test.mjs      … lib/response.js のCORS/Cache-Controlテスト
   ├─ handlers.test.mjs      … handlers/* の統合的なテスト(site⇔個別endpoint一致含む)
   └─ no-write-operations.test.mjs … src/配下に書き込み系操作が無いことの静的テスト
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

## Cloudflare上でのデプロイ(未実施)

以下は今回のフェーズでは行っていません:

- git remote作成・GitHub repository作成・commit・push
- `wrangler deploy`(Worker production作成)
- `api.cs-pj.com` custom domainの作成
- remote D1への書き込み(そもそも本APIはremote D1へ書き込みを行いません)
- `cspj-manage` / `CSPJ_HP` 側の変更

## 関連プロジェクト

- 管理画面(`manage.cs-pj.com`): `cspj-manage`(別リポジトリ、Cloudflare Pages、Access保護あり)
- 公開サイト(`cs-pj.com`): `CSPJ_HP`(別リポジトリ。本APIとの接続は今回のフェーズでは未実施)
