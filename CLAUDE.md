- 作業前に `README.md` を読む
- 作業前に `mcp__front-local__graph_read_words` で graph_id `word-graph-1` を読み、用語一覧を把握する
- 作業前に `mcp__front-local__graph_read_texts` で graph_id `word-graph-1` を読み、全テキストを把握する
- テキストが200件を超えたら `mcp__front-local__graph_read_texts_by_word` でタスク関連 word に絞って取得する

## graph への書き込みルール
- セッション中に新しいアイデア・方針・決定が出たら確認なしで即座に `mcp__front-local__graph_write_text` で記録する
- テキストはどんどん追記する。既存テキストは修正せず新テキストとして追記する
- 矛盾・未定義を発見したら word `issue` を紐づけて書き込む
- 既存テキストと現状の乖離を発見したら word `goal` を紐づけて書き込む
- word は既存を優先し、明らかに新概念のときのみ新 word を作る（通知不要）
