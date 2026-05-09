# Schema Editor Plan

## 目的

`/schema-editor` から JSON スキーマを段階的に編集できるようにし、最終的に R2 上の既存 JSON を安全に更新できるようにする。

## 前提

- `src/schema/**` が型定義とバリデーションの中心
- `src/storage/layouts/**` が R2 への読み書きと正規化の中心
- `src/runtime/bind/**` が UI 編集の中心
- `table` はすでに「schema を JSON で編集して保存する」最初の成功例
- ローカル開発でも本番と同じ R2 API 経由を通す

## 進め方

### 1. まず境界を固める

最初に共通化したいのは「JSON を表示する」ことではなく、「保存前に検証して、壊れた形を正規化する」こと。

ここで見る対象:

- `componentDefaults` と `componentSchemas`
- `normalizeScreen`
- `normalizeComponentValue`
- `handleResourceGet` / `handleResourcePut`

### 2. 変更の小さい型から増やす

最初の対象は、参照関係が弱く、壊れても影響が小さいものにする。

優先度が高いもの:

- `name`
- `padding`
- `style` 系の map
- `screen.head`
- `screen.shell`
- `select.source`
- `table.schema`
- `table.data`

### 3. table の仕組みを共通部品として切り出す

`table` はすでに下記を持っている。

- schema の JSON 編集
- data の JSON 編集
- 保存前検証
- 列追加や列削除の UI

これを、他の schema にも流用できるようにする。

### 4. 編集可能項目を登録表にする

`src/schema/component/index.ts` にある `componentDefaults` と `componentSchemas` を起点に、
「どの path を、どの editor で、どの validator で扱うか」を明示する。

これにより、schema-editor の追加が `if` の増殖ではなく登録の追加になる。

### 5. 正規化を後ろで支える

保存できるだけでは不十分なので、R2 から読む時にも補正する。

ここでやること:

- 欠けている値を補う
- 古い JSON を新しい形に寄せる
- 参照整合性が壊れる値を弾く

## 実装順の提案

1. `table` の JSON editor を共通部品化する
2. `select` と `style map` を schema-editor に載せる
3. `screen.head` と `screen.shell` を載せる
4. `frame` の placement や kind 変更を載せる
5. `editor` 系の参照値や `list` / `canvas` / `form` のようなネストが深い型を載せる
6. `table` のように schema 依存が強い data を載せる
7. `normalize.ts` に migration を増やす

## 段階ごとの扱い

最初は壊れにくいものから始めるが、次の領域も段階的に実装対象に含める。

- frame の placement
- kind 変更
- editor 系の参照値
- list / canvas / form のようなネストが深い型
- table のように schema 依存が強い data

これらは「やらない」領域ではなく、基礎が固まったあとに順に追加していく対象。

## 判断基準

- 既存 JSON を壊さない
- 保存時に必ず検証できる
- UI で編集した内容が R2 の実体にそのまま反映される
- 新しい型を足すときの変更箇所が局所化されている
