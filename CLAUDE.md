# 会話開始時のセットアップ

以下を順番に行う。

## 1. ブラウザセッション起動

フロントエンドの確認作業を伴う場合、最初にブラウザを起動する:

```bash
# 初回のみ（Chromium が未インストールの場合）
npx playwright install chromium

npx tsx e2e/start-session.ts
```

- `.dev.vars` から認証情報を自動読み込みして GitHub ログイン + TOTP 認証を行う
- Chromium が CDP port 9222 でバックグラウンド起動し、会話中ずっと維持される
- 既にブラウザが起動済みなら認証状態だけ確認して即終了する
- 停止: `kill $(cat /tmp/playwright-chrome.pid)`

認証情報は `.dev.vars`（gitignore済み）で管理する:
- `GITHUB_EMAIL` / `GITHUB_PASSWORD` — GitHub アカウント
- `GITHUB_TOTP_SECRET` — TOTP シークレット（base32）

## 2. ワードグラフの読み込み

`mcp__front-production__graph_read_words` がまだロードされていなければ、ToolSearch で以下のスキーマをロードする:

```
select:mcp__front-production__graph_read_words,mcp__front-production__graph_read_texts_by_word,mcp__front-production__graph_read_nodes_from
```

`graph_read_words`（graph_id: `word-graph-1`）でブックマーク一覧を取得する（出力: `[node_id] label`）。タスクに関連する word を選び `graph_read_texts_by_word(word, depth=2)` でトラバース。情報が少なければ depth=3 に増やす。ユーザーがノード ID を渡した場合は `graph_read_nodes_from(node_id)` を使う。ノードの追記は人間のみ行い、AI は書き込まない。

---

# タスク実行中のルール

## 重要操作の前に

deploy・migrate・スクリプト実行など重要な操作を行う前に:
- ワードグラフに該当するワードがあれば、そのテキストを読んでから実行する（仮定で動かない）

## デプロイフロー（毎回必ず踏む）

コード修正後は以下の順番でデプロイ・確認を進める。ショートカットしない。

### 1. 開発環境（dev）

```bash
git -C front push origin dev
git -C backend push origin dev
```

- GitHub Actions が自動デプロイする
- CI の結果を確認する
- Playwright スクリーンショットで表示を確認する（下記参照）
- 問題なければ次のステップへ

### 2. 検証環境（stage）

```bash
# front
git -C front checkout stage && git merge dev && git push origin stage && git checkout dev

# backend
git -C backend checkout stage && git merge dev && git push origin stage && git checkout dev
```

- CI の結果を確認する
- Playwright スクリーンショットで表示を確認する
- 問題なければ次のステップへ

### 3. 本番環境（production）

```bash
# front
git -C front checkout main && git merge stage && git push origin main && git checkout dev

# backend
git -C backend checkout main && git merge stage && git push origin main && git checkout dev
```

- CI の結果を確認する
- Playwright スクリーンショットで最終確認する

---

## フロントエンド確認（PDCA）

コード修正後の確認には `screenshot.ts` を使う:

```bash
npx tsx e2e/screenshot.ts [url-or-path] [output.png]
# 例:
npx tsx e2e/screenshot.ts /DB%20Apply /tmp/check.png
```

URL は BASE_URL 相対パスでも絶対URLでも可。省略すると現在のページを撮影。

## MCP 認証切れ

MCP ツール呼び出しが認証エラーで失敗した場合は、ユーザーに再認証を依頼してからリトライする。
