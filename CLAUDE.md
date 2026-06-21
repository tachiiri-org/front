# タスク開始前

AIガイド（`ba28271f-2066-4101-8c0a-8fbfcf26efc3`, graph_id: `word-graph-1`）を読む。

---

# ブラウザセッション

フロントエンドの確認作業を伴う場合:

```bash
npx tsx e2e/start-session.ts   # 初回: npx playwright install chromium
```

- `.dev.vars` から認証情報を自動読み込み（GITHUB_EMAIL / GITHUB_PASSWORD / GITHUB_TOTP_SECRET）
- CDP port 9222 でバックグラウンド起動。停止: `kill $(cat /tmp/playwright-chrome.pid)`

スクリーンショット:
```bash
npx tsx e2e/screenshot.ts [url-or-path] [output.png]
```

---

# デプロイフロー

```bash
# dev
git -C front push origin dev
git -C backend push origin dev

# stage
git -C front checkout stage && git merge dev && git push origin stage && git checkout dev
git -C backend checkout stage && git merge dev && git push origin stage && git checkout dev

# production
git -C front checkout main && git merge stage && git push origin main && git checkout dev
git -C backend checkout main && git merge stage && git push origin main && git checkout dev
```

CI確認 → Playwright スクリーンショット → 問題なければ次へ。

MCP 認証切れの場合はユーザーに再認証を依頼してからリトライ。
