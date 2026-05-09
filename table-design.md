# Table Component Design

## 目的

`table` コンポーネントは、別画面へ遷移せずに CRUD を行えるインライン編集用の表コンポーネントとして扱う。

要件は次の通り。

- JSON でスキーマを定義する
- JSON データを別に持つ
- セル単位で直接編集できる
- 型制約を持つ
- プルダウン選択を持つ
- 列の追加・削除・非表示ができる
- 保存は全体保存にする
- 保存時は厳密に検証し、無効な状態では保存しない
- 編集途中の未確定状態は許可する
- スキーマ定義自体も JSON 編集可能にする

## 設計方針

### 1. スキーマとデータを分離する

`table` は 1 つの JSON にすべてを詰め込まず、次の 2 つを分ける。

- `schema`: 列定義、バリデーション、表示設定
- `data`: 行データ

この分離により、列定義の変更とデータ編集を独立して扱える。

### 2. 行は内部 ID を持つ

各行は内部 ID を持つ。

- 行の識別
- 変更差分の追跡
- 並び替え
- 将来のマイグレーション

のために、外部キーとは別に安定した識別子が必要になる。

### 3. 列削除は「非表示」を基本にする

将来的に型変更のマイグレーションを入れる前提なので、当面は「削除」よりも「非表示」を基本操作にする。

- 列の追加はそのまま追加
- 列の削除はまず非表示にする
- 非表示列はデータ上は残す
- 表示対象から除外する

これにより、列の破壊的変更を避けつつ、後で復元できる。

### 4. 型変更は当面禁止する

型変更は将来的にマイグレーション機構を導入して対応する。

当面は次の運用にする。

- 型変更は UI から行えない
- 必要なら新しい列を追加する
- 旧列は非表示にする

### 5. 保存は全体保存

セル単位や行単位では保存しない。

- 編集はローカルの draft に反映
- 保存時にテーブル全体を検証
- 問題がなければ全体を保存

## データモデル

### ルート構造

```ts
type TableComponent = {
  kind: 'table';
  name?: string;
  schema: TableSchema;
  data: TableData;
  padding?: string;
};
```

### スキーマ

```ts
type TableSchema = {
  version: number;
  columns: TableColumn[];
};
```

### データ

```ts
type TableData = {
  rows: TableRow[];
};
```

### 行

```ts
type TableRow = {
  id: string;
  values: Record<string, unknown>;
};
```

`id` は内部 ID であり、ユーザーが直接編集する対象ではない。

### 列

```ts
type TableColumn =
  | TextColumn
  | IntColumn
  | BooleanColumn
  | DateColumn
  | SelectColumn;
```

共通項目は次の通り。

```ts
type TableColumnBase = {
  key: string;
  label: string;
  hidden?: boolean;
  required?: boolean;
  nullable?: boolean;
  default?: TableDefaultValue;
};
```

`key` はデータ上のキーで、列名変更時にはこの key を変更する。

`hidden` は論理削除や非表示に使う。

### 型ごとの列定義

#### string

```ts
type TextColumn = TableColumnBase & {
  type: 'string';
  minLength?: number;
  maxLength?: number;
};
```

#### int

```ts
type IntColumn = TableColumnBase & {
  type: 'int';
  min?: number;
  max?: number;
};
```

#### boolean

```ts
type BooleanColumn = TableColumnBase & {
  type: 'boolean';
};
```

#### date

```ts
type DateColumn = TableColumnBase & {
  type: 'date';
  dateKind?: 'date' | 'datetime';
  min?: string;
  max?: string;
};
```

#### select

```ts
type SelectColumn = TableColumnBase & {
  type: 'select';
  source: SelectSource;
};
```

### select の source

選択肢は 2 種類を想定する。

#### 1. inline schema

```ts
type InlineSelectSource = {
  kind: 'inline';
  options: Array<{ value: string; label: string }>;
};
```

#### 2. endpoint

```ts
type EndpointSelectSource = {
  kind: 'endpoint';
  url: string;
  itemsPath?: string;
  valueKey?: string;
  labelKey?: string;
  headers?: Record<string, string>;
};
```

### default 値

```ts
type TableDefaultValue =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'now' }
  | { kind: 'createdAt' }
  | { kind: 'updatedAt' };
```

`date` 列では、初期値として次を許可する。

- `now`: 行作成時の現在時刻
- `createdAt`: 行作成時の作成日時
- `updatedAt`: 行保存時の更新日時

`createdAt` と `updatedAt` は、実運用では system-managed な値として扱う。

## 画面構成

`table` の編集画面は 2 ペイン構成を基本とする。

### 上部: schema editor

- 列一覧
- 列追加
- 列非表示
- 列名編集
- 型変更は非対応
- select options の編集
- default の編集

### 下部: data grid

- 行一覧
- セル編集
- 行追加
- 行削除
- エラー表示

## 編集体験

### セル編集

セルは型に応じて入力UIを切り替える。

- string: text input
- int: number input
- boolean: checkbox
- date: date input もしくは datetime-local
- select: select

編集途中の未確定状態は許可する。

例:

- int セルで一時的に空欄
- date セルで未入力
- string セルで途中入力

ただし、保存時には無効な値を許可しない。

### 行追加

新しい行を追加するときは、列定義の `default` を使って初期値を埋める。

`default` がない場合は型ごとの空値にする。

- string: `''`
- int: `null`
- boolean: `false`
- date: `null`
- select: `''`

### 行削除

行は物理削除でよい。

削除後も他の行の `id` は変えない。

### 列追加

列を追加したら、既存行には追加列の default を補完する。

### 列削除

列削除は即時破棄ではなく、まず `hidden: true` にする。

非表示列は次の挙動にする。

- grid には表示しない
- schema editor では「非表示列」として見える
- data 上の値は保持する
- 後から再表示できる

必要なら将来的に「完全削除」を別操作として追加できる。

## バリデーション

保存前にテーブル全体を検証する。

### 検証対象

- 列定義自体の妥当性
- 行 ID の一意性
- 各セルの型
- required 条件
- select の値が options に含まれるか
- date の形式
- 数値の範囲

### 保存禁止条件

次のいずれかがある場合は保存しない。

- 必須セルが空
- int に数値以外が入っている
- select の値が選択肢に存在しない
- date が不正形式
- columns の key が重複している
- rows の id が重複している
- required な列で値が欠けている

### 編集途中との関係

入力途中で一時的に不正でもよい。

ただし、UI 側はその状態を保持しつつ、保存時にエラーを出す。

## スキーマ編集

`table` はスキーマ自体も JSON 編集可能にする。

このため、最低でも次の 2 つの編集モードを想定する。

- フォームベース編集
- JSON 直接編集

フォームベース編集では安全に変更できる操作を提供する。

- 列追加
- 列名変更
- 列非表示
- default 編集
- select options 編集

JSON 直接編集では、スキーマ全体をそのまま編集できる。

これにより、UI が追いつかないケースも吸収できる。

## 非表示運用

当面の「削除」は非表示で代替する。

この方針の理由は次の通り。

- 型変更を入れないため、列の入れ替えが発生しやすい
- 既存データを消さずに残したい
- 将来のマイグレーションで再利用しやすい

運用イメージ:

1. 新しい列を追加
2. 旧列を hidden にする
3. 必要なら値をコピーする
4. しばらく併用する
5. 後で完全削除を考える

## date 列の扱い

date 列は将来的な監査・更新日時用途を見越して扱う。

### 表現

- `date`: 日付のみ
- `datetime`: 日時

### 初期値

次を想定する。

- `now`
- `createdAt`
- `updatedAt`

### 更新時の挙動

- `createdAt`: 行作成時に固定
- `updatedAt`: 保存時に更新

これらは `table` レンダラ側で system-managed に扱う。

## select 列の扱い

`select` 列は 2 系統の source を持つ。

### inline

JSON スキーマ内で選択肢を完結させる。

用途:

- 固定選択肢
- 小さい enum

### endpoint

外部エンドポイントから候補を取得する。

用途:

- 動的な選択肢
- 他のデータソースに依存する候補

### 保存時検証

endpoint source の場合も、保存時には最終的な選択値が有効か検証する。

## 将来のマイグレーション

型変更は当面禁止するが、将来の拡張余地は残す。

想定する方向性は次の通り。

- schema version を持つ
- migration script を別管理する
- 列単位の rename / type conversion を扱う
- hidden 列からの復元を可能にする

このため、列の物理削除を安易にしない。

## 実装時の注意

- row の内部 ID は UI でユーザーに見せない
- hidden 列も data には残す
- 保存時には draft 全体を再検証する
- JSON 直接編集とフォーム編集で同じ schema へ落とす
- select の endpoint source は fetch エラー時の表示を持つ

## 初期スコープ

初期版で対応する範囲は次とする。

- `string`
- `int`
- `boolean`
- `date`
- `select`
- row の追加・削除・編集
- column の追加・非表示
- schema の JSON 編集
- 全体保存

初期版では入れない。

- 並び替え
- フィルタ
- 型変更
- 物理的な列削除
- 行レベルの partial save
