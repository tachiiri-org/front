# Schema Editor Plan

## 目的

`/schema-editor` から JSON スキーマを段階的に編集できるようにし、最終的に R2 上の既存 JSON を安全に更新できるようにする。

## 前提

- `src/schema/**` が型定義とバリデーションの中心
- `src/storage/layouts/**` が R2 への読み書きと正規化の中心
- `src/runtime/bind/**` が UI 編集の中心
- `table` はすでに「schema を JSON で編集して保存する」最初の成功例
- ローカル開発でも本番と同じ R2 API 経由を通す

## 進捗

- `component` 側の properties editor を schema 登録ベースに拡張済み
- `screen.head` を schema ベースで編集できるようにし、`lang` と `meta` も扱えるようにした
- `normalizeScreen` は `head` の defaults を補うように揃えた
- `table` の JSON editor を `render/editor` 側の共通部品へ切り出した
- component editor の properties schema を kind ごとの登録表に寄せた
- resource 保存も parse だけでなく正規化して通すように揃えた
- 以後の細かい進捗はローカルコミット単位で追うので、必要なら直近コミットを参照する

## 論点

### 保存経路ごとに検証を差し込む

`schema-editor` で編集できるようにするだけでは不十分で、どの保存経路でも壊れた JSON を受け付けないことが必要。

現状の保存経路:

- `handleResourcePut` は JSON の parse だけで保存している
- `handleScreenPut` と `handleComponentPut` は normalize を通す
- UI 側の `updateScreen` / `putComponent` は最終的に R2 API を通す

そのため、`schema-editor` で触れる対象は「UI の入力」ではなく「保存時に通る検証と正規化」として設計する。

### 増やし方は登録表ベースに寄せる

`if` を増やして対応項目を足すと、`screen` / `component` / `resource` の差分が肥大化する。

`src/schema/component/index.ts` にある `componentDefaults` と `componentSchemas` を起点に、

- どの path を
- どの editor で
- どの validator / normalizer で扱うか

を登録として定義する。

### 既存 UI と新規 editor を分けて考える

`screen.head` や `screen.shell` は既存の `screen` editor ですでに編集できるので、まずはその経路の整合を保つ。

一方で、`table` の JSON editor は再利用しやすい共通部品として切り出し、他の schema でも同じ入力体験を使えるようにする。

## 進め方

### 1. まず境界を固める

最初に共通化したいのは「JSON を表示する」ことではなく、「保存前に検証して、壊れた形を正規化する」こと。

ここで見る対象:

- `componentDefaults` と `componentSchemas`
- `normalizeScreen`
- `normalizeComponentValue`
- `handleResourceGet` / `handleResourcePut`

この段階で確認したいこと:

- `screen` 系、`component` 系、`resource` 系の保存経路で検証の有無を揃える
- 保存時に正規化できるものと、保存前に弾くべきものを切り分ける
- 読み込み時の補正は、保存時の検証と矛盾しないようにする

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

ここでの判断基準は次の通り。

- path ごとに扱う型が明確である
- UI の入力と保存時の検証が同じ定義を参照できる
- 後から `select.source` や `style map` を足しても既存の分岐を壊さない

### 5. 正規化を後ろで支える

保存できるだけでは不十分なので、R2 から読む時にも補正する。

ここでやること:

- 欠けている値を補う
- 古い JSON を新しい形に寄せる
- 参照整合性が壊れる値を弾く

## 実装順の提案

1. `handleResourcePut` を含む保存経路の検証方針を揃える
2. `table` の JSON editor を共通部品として切り出す
3. `screen.head` と `screen.shell` を既存 editor 側で整理する
4. `select` と `style map` を schema-editor に載せる
5. `frame` の placement や kind 変更を載せる
6. `editor` 系の参照値や `list` / `canvas` / `form` のようなネストが深い型を載せる
7. `table` のように schema 依存が強い data を載せる
8. `normalize.ts` に migration を増やす

## 段階ごとの扱い

最初は壊れにくいものから始めるが、次の領域も段階的に実装対象に含める。

- frame の placement
- kind 変更
- editor 系の参照値
- list / canvas / form のようなネストが深い型
- table のように schema 依存が強い data

これらは「やらない」領域ではなく、基礎が固まったあとに順に追加していく対象。

`screen.head` と `screen.shell` は既存 editor ですでに触れているので、schema-editor の初期対象というより、保存経路の整合を確認する対象として扱う。

## 判断基準

- 既存 JSON を壊さない
- 保存時に必ず検証できる
- UI で編集した内容が R2 の実体にそのまま反映される
- 新しい型を足すときの変更箇所が局所化されている
