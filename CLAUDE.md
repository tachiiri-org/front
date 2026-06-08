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
select:mcp__front-production__graph_read_words,mcp__front-production__graph_read_texts_by_word
```

次に `mcp__front-production__graph_read_words`（graph_id: `word-graph-1`）でワード一覧を取得し、タスクに関連するワードのテキストを `mcp__front-production__graph_read_texts_by_word` で読む。

---

# タスク実行中のルール

## 重要操作の前に

deploy・migrate・スクリプト実行など重要な操作を行う前に:
- ワードグラフに該当するワードがあれば、そのテキストを読んでから実行する（仮定で動かない）

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
