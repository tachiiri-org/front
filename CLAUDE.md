- follow principles in README.md
- 作業前に `README.md` を読む
- 作業前に `knowledge_read` でプロジェクト知識ツリーを読んで設計を把握する

## 知識ツリーの更新ルール

会話の中で以下に該当する情報が出たら `knowledge_propose` で記録する:

- 新たに確定した設計・制約・方針
- 以前の記述が誤りだと判明した場合（既存ノードを `node_id` 指定で更新）
- 疑問・不明点（`"??? ..."` のテキストで提案）

直接上書きは禁止。常に `proposed` 経由で提案し、人間が accept または削除する。
