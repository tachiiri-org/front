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

ToolSearch で以下をロード（未ロードの場合）:

```
select:mcp__front-production__graph_read_nodes_from,mcp__front-production__graph_add_node,mcp__front-production__graph_update_node,mcp__front-production__graph_delete_node,mcp__front-production__graph_toggle_link,mcp__front-production__graph_set_property,mcp__front-production__graph_remove_property
```

ルートノード ID: `6427e286-9195-4826-8498-6a79a5c29fb7`（graph_id: `word-graph-1`）。**2層構造**: ルート → ドメイン(`システム`/`インフラ`/`ビジネス`)＋`_ガイド`＋`fix` → カテゴリ → 知識ノード。各ノードに `node_type`(root/domain/guide/category/rule/fact/goal/issue) が付き、read 結果に `{node_type=...}` で表示される。

1. **最初に `_ガイド` を読む**（AI運用ルール集）。`graph_read_nodes_from(node_id: ルートID, depth: 1)` でドメイン目次、`depth: 2` でカテゴリ一覧を取得。
2. タスクに関連するカテゴリを `graph_read_nodes_from(node_id: <category_id>, depth: 1)` または `graph_read_texts_by_word(word: "<ノードの正確なラベル>")` で知識を読む（`graph_read_texts_by_word` はブックマーク不問・全ノード対象）。
3. 知識の追加は `graph_add_node`(`parent_node_id`=所属カテゴリ)＋`graph_set_property(key:"node_type",...)`、修正は `graph_update_node`、リンク調整は `graph_toggle_link`。

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
