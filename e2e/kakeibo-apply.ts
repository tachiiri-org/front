/**
 * 店に費目・略名を一括で付ける。マッピングは MAP に持つ（店名の完全一致 or 正規表現）。
 * 明細そのものは触らない。費目・略名は店に紐づくので、取り込みを跨いで残る。
 *
 * 使い方: npx tsx e2e/kakeibo-apply.ts [dev|stage|production] [--dry-run]
 */
import './load-dev-vars.ts';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const ENV = process.argv[2] ?? 'production';
const DRY = process.argv.includes('--dry-run');
const PREFIX = ENV === 'production' ? '' : `${ENV}.`;
const BASE = `https://${PREFIX}kakeibo.tachiiri.com`;
const STATE = path.join(path.dirname(fileURLToPath(import.meta.url)), `.auth/${PREFIX}kakeibo-tachiiri-com.json`);

/** [店名の判定, 費目, 略名] 。判定は文字列(完全一致) か RegExp。 */
type Rule = [string | RegExp, string[], string?];

const MAP: Rule[] = [
  // 公共料金・通信（月ごとに別店舗になるものは正規表現でまとめる）
  ['東京ガス', ['公共料金'], '東京ガス'],
  ['東京都水道局', ['公共料金'], '水道局'],
  ['ＮＨＫ　放送受信料', ['公共料金'], 'NHK'],
  [/^ＮＵＲＯ光/, ['通信費'], 'NURO光'],
  ['ラクテンモバイルツウシンリヨウ', ['通信費'], '楽天モバイル'],
  ['ドコモご利用料金', ['通信費'], 'ドコモ'],
  [/^ソフトバンクＭ/, ['通信費'], 'ソフトバンク'],

  // 通販
  ['ヨドバシドットコム', ['日用品'], 'ヨドバシ'],
  ['ＡＭＡＺＯＮ．ＣＯ．ＪＰ', ['日用品'], 'Amazon'],

  // 食費（スーパー・食料品）
  [/^ヨークフーズ/, ['食費'], 'ヨークフーズ'],
  ['ライフ恵比寿ガ－デンプレイス店', ['外食'], 'YGP'],
  [/^イトーヨーカドー/, ['食費'], 'ヨーカドー'],
  ['セブン－イレブン', ['外食'], 'セブン'],
  ['ファミリーマート', ['外食'], 'ファミマ'],
  ['ローソン', ['外食'], 'ローソン'],
  ['坂ノ途中ＯｎｌｉｎｅＳｈｏｐ', ['食費'], '坂ノ途中'],
  ['株式会社大石', ['食費'], '大石'],
  ['オーケー三鷹北口店', ['食費'], 'オーケー'],
  ['いなげや　小金井東町店', ['食費'], 'いなげや'],
  ['京王ストア', ['食費'], '京王ストア'],
  ['まいばすけっと', ['食費'], 'まいばす'],
  [/^サミット/, ['食費'], 'サミット'],
  ['イオンマーケット', ['食費'], 'イオン'],
  ['よつ葉ミルクプレイス', ['食費'], 'よつ葉'],
  [/^コ―ク  オン  ペイ|^コカ・コーラ/, ['外食'], 'コカコーラ'],

  // 外食
  [/マクドナルド|マックデリバリ/, ['外食'], 'マック'],
  ['ガスト', ['外食'], 'ガスト'],
  ['ケンタッキーフライドチキン', ['外食'], 'ケンタッキー'],
  [/^吉野家/, ['外食'], '吉野家'],
  [/^サイゼリヤ/, ['外食'], 'サイゼリヤ'],
  ['すかいら－く店頭飲食アプリ決済', ['外食'], 'すかいらーく'],
  ['カブシキガイシャドミノピザジャパン', ['外食'], 'ドミノピザ'],
  ['ピザーラ', ['外食'], 'ピザーラ'],
  [/^モスの|^モスバーガー/, ['外食'], 'モス'],
  [/^かつや/, ['外食'], 'かつや'],
  ['デニーズ', ['外食'], 'デニーズ'],
  ['餃子の王将　武蔵境駅前店', ['外食'], '王将'],
  ['魚べい東小金井店', ['外食'], '魚べい'],
  ['銀座麻辣湯', ['外食'], '麻辣湯'],
  ['八郎そば', ['外食'], '八郎そば'],
  ['スターバックス　コーヒー　ジャパン', ['外食'], 'スタバ'],
  [/^タリーズ/, ['外食'], 'タリーズ'],
  ['サーティワンアイスクリーム', ['外食'], 'サーティワン'],

  // サブスク・クラウド
  [/OPENAI|CHATGPT/, ['サブスク'], 'OpenAI'],
  [/CLAUDE\.AI|ANTHROPIC/, ['サブスク'], 'Claude'],
  [/NOTION|ＮＯＴＩＯＮ/, ['サブスク'], 'Notion'],
  [/ＮＥＴＦＬＩＸ|ネットフリックス/, ['サブスク'], 'Netflix'],
  [/^ＡＰＰＬＥ  ＣＯＭ  ＢＩＬＬ/, ['サブスク'], 'Apple'],
  ['Ａｍａｚｏｎプライム会費', ['サブスク'], 'Amazonプライム'],
  [/GITHUB|ＧＩＴＨＵＢ/, ['サブスク'], 'GitHub'],
  [/CLOUDFLARE|ＣＬＯＵＤＦＬＡＲＥ/, ['サブスク'], 'Cloudflare'],
  [/ＧＯＯＧＬＥ＊ＣＬＯＵＤ/, ['サブスク'], 'GCP'],
  [/BUYMEACOFFEE|COFF\.EE/, ['サブスク'], 'buymeacoffee'],
  ['ＤＭＭ', ['日用品'], 'DMM'],

  // 日用品
  ['バックマーケットジャパンカブシキガイシャ', ['日用品'], 'Back Market'],
  ['株式会社タカギ', ['日用品'], 'タカギ'],
  [/^ダイソー/, ['日用品'], 'ダイソー'],
  [/^セリア/, ['日用品'], 'セリア'],
  ['カインズ', ['日用品'], 'カインズ'],
  [/^ウェルパーク/, ['日用品'], 'ウェルパーク'],
  ['無印良品', ['日用品'], '無印'],

  // 美容
  ['Ｓｑｕａｒｅ', ['美容院'], '美容院'],

  // レジャー
  [/^東京ディズニーリゾート/, ['日用品'], 'ディズニー'],
  [/^ＴＯＨＯシネマズ|^吉祥寺オデヲン|^丸の内ピカデリー/, ['日用品'], '映画'],
  ['京王れーるランド', ['日用品'], '京王れーるランド'],
  ['野川公園', ['テニス'], '野川公園'],
  ['多摩動物公園', ['日用品'], '多摩動物公園'],
  [/^ＮＩＮＴＥＮＤＯ/, ['日用品'], '任天堂'],

  // 医療
  // 医療も日用品に寄せる（費目を増やしすぎない方針）
  [/クリニック|薬局|医療センター|脳神経外科/, ['日用品'], undefined],

  // ── 2回目の分類（未分類だった61店舗のうち、方針が決まったもの）
  // 商業施設・駅ビルは中で何を買ったか分からないので「お出かけ」でまとめる
  [/^アトレ|^吉祥寺パルコ|^ルミネ|^東京ソラマチ|^東京ミッドタウン|^新丸の内ビルディング/, ['外食'], undefined],
  [/^東京駅グランスタ|^グランスタ東京|^キラリナ京王吉祥寺|^ｎｏｎｏｗａ|^渋谷サクラステージ/, ['外食'], undefined],
  [/^ＪＲ東日本クロスステーション|^ＪＲ－ＣｒｏｓｓＲＣＰ/, ['外食'], undefined],

  // カフェ・スイーツ・食堂は外食
  [/^ゴディバ|^パティスリー|^ラブティック|^楠木茶房|^キィニョン|^ウッドベリ|^ＨＵＧＨＵＧ/, ['外食'], undefined],
  [/^カフェテラスロイヤル|^和菓子処ならは|^ハイチ|^いい菜|^アンドザフリット|^国際基督教大学食堂/, ['外食'], undefined],
  [/券売機|^発券機|^食券/, ['外食'], undefined],

  // 書店・衣類は日用品
  [/^ジュンク堂|^丸善|^紀伊國屋|^ＢＯＯＫＯＦＦ/, ['日用品'], undefined],
  [/^ＺＡＲＡ|^ユニクロ/, ['日用品'], undefined],

  // 交通
  ['Ｓｕｉｃａ（ＧｏｏｇｌｅＰａｙ）', ['交通費'], 'Suica'],
  [/^ＧＯ（タクシーアプリ）|^個人タクシー/, ['交通費'], undefined],
  // 支店管轄ごとに別店舗になっているのでまとめる
  [/^ＮｅｗＤａｙｓ/, ['交通費'], 'NewDays'],
  [/^ヤマト運輸|^チヤ―ジスポツト/, ['交通費'], undefined],
  ['サイクルンペデイア', ['交通費'], 'サイクルンペディア'],

  // 習い事・その他
  ['桜田倶楽部・東京テニスカレッジ', ['テニス'], '東京テニスカレッジ'],
  [/^テニスサポ|^ダヴィンチマスターズ|^パークス野川店/, ['日用品'], undefined],
  ['秋田県男鹿市（さとふる）', ['ふるさと納税'], 'さとふる'],
  // 業種が判別できなかった1件。新規の店は未分類のまま出したいので、包括ルールにはしない。
  ['ＷＡＩ', ['日用品'], 'WAI'],

  // ── 4回目（2025-09〜2026-01 の取り込みで増えた店）
  // 外食
  [/^スシロー|^和牛ステーキ|^俺のフレンチ|^じゅうじゅうカルビ|^プロント|^不二家レストラン/, ['外食'], undefined],
  [/^スターバックスコーヒージャパン|^ＣｏＣｏ壱番屋|^シャトレーゼ|^お菓子の城/, ['外食'], undefined],
  [/^コ―ク　オン|^ＧＲＡＮＤ・ＦＯＯＤ・ＨＡＬＬ/, ['外食'], undefined],
  // 食費
  [/^業務ス－パ－|^オーケー　小金井店/, ['食費'], undefined],
  // 日用品（通販・雑貨・家電・書店・スポーツ用品）
  [/^マイニンテンドーストア|^ニンテンドーＥシヨツプ|^メルカリＳｈｏｐｓ|^ＢＡＳＥ|^マルミツウエブストア/, ['日用品'], undefined],
  [/^エディオン|^ニトリ|^キャンドゥ|^二子玉川　蔦屋家電|^ときわスポーツ|^プロスキー/, ['日用品'], undefined],
  // 商業施設は外食に寄せる方針
  [/^宇都宮パセオ|^東京ミッドタウン|^二子玉川ライズ|^玉川高島屋|^東急百貨店|^エキュートエディション/, ['外食'], undefined],
  [/^吉祥寺　パルコ|^デックス東京ビーチ|^ＩＭＡＧＩＮＵＳ/, ['外食'], undefined],
  // レジャー系は日用品（レジャー費目は統合済み）
  [/^東京ジョイポリス|^Ｊリーグチケット/, ['日用品'], undefined],
  // 交通
  [/^ＪＲ東日本みどりの窓口/, ['交通費'], undefined],
  // 通信・サブスク
  [/^ラクテンニジユウヨン/, ['通信費'], undefined],
  [/^CGTRADER/, ['サブスク'], undefined],
  // 保険は公共料金ではなく独立させる
  [/^オリックス生命保険/, ['保険'], 'オリックス生命'],
  // ふるさと納税
  [/（さとふる）$/, ['ふるさと納税'], undefined],

  // カフェ・ベーカリー・飲食店
  [/^くじらカフェ|^カフェ杉と胡桃|^チアーズベーグル|^ベーカリーカフェクラウン|^リュモンコーヒースタンド/, ['外食'], undefined],
  [/^珈琲や東小金井工房|^ＫＡＮＥＬ　ＢＲＥＡＤ|^ＳＯＦＴＣＲＥＡＭＳＴＡＮＤ|^モンロワ－ル/, ['外食'], undefined],
  [/^松のや|^松屋　|^中目黒カレー|^天王寺アベノタコヤキ|^コナとスパイス|^ＧＬＩＴＣＨ/, ['外食'], undefined],
  [/^ｔｈｅ　ＧＡＲＤＥＮ|^ＬＩＴＴＬＥ　ＭＯＴＨＥＲＨＯＵＳＥ/, ['外食'], undefined],
  // 商業施設
  [/^エミオ武蔵境/, ['外食'], undefined],
  // スーパー
  [/^オオゼキ/, ['食費'], undefined],
  // サブスク
  [/DUOLINGO|GALLUP/, ['サブスク'], undefined],
  // 日用品（衣類・雑貨・クリーニング・年賀状・その他物販）
  [/^ＧＡＰ|^うさちゃんクリ|^ウェブポ年賀状|^ＬＩＮＯＡ|^ＭＡＩＳＯＮ|^ＡｍａｚｏｎＰａｙ提携サイト/, ['日用品'], undefined],
  [/^ＨｅｒｂａｌＣｈｉｎｅｓｅＳＴＥ|^カツラ　ツルヤミツノブ/, ['日用品'], undefined],
  // レジャー系は日用品に統合済み
  [/^らくがキッズ|^アソビュー|^上野動物園|^国立科学博物館|^Ｓｕｂ．チケット/, ['日用品'], undefined],
  // 旅行・移動
  [/^AIRBNB/, ['交通費'], 'Airbnb'],
  [/^宇都宮モビリティサ－ビス/, ['交通費'], undefined],



  // ── 3回目
  ['ザ・リッツ・カールトン東京', ['外食'], 'リッツカールトン'],
  [/^シェアラウンジ/, ['日用品'], 'シェアラウンジ'],
  [/^ツルヤ/, ['日用品'], 'ツルヤ'],
  ['メルカリ', ['日用品'], 'メルカリ'],
  ['ヨドバシカメラ吉祥寺', ['日用品'], 'ヨドバシ吉祥寺'],
  [/^Ａｍａｚｏｎ  Ｄｏｗｎｌｏａｄｓ/, ['日用品'], 'Amazon DL'],
  // 羽田空港内の店舗はまとめて外食（ターミナル内の飲食が実態）
  [/^羽田空港ターミナル|^ｃｕｕｄ第２タ－ミナルビル店/, ['外食'], '羽田空港'],
];


/**
 * 略名が指定されていない店の表示名を作る。
 * 全角は半角へ、決済端末由来の「／ＮＦＣ」など無意味な接尾辞は落とし、10文字以内に詰める。
 * 一覧で横に並ぶので、長い正式名称のままだと読み比べられない。
 */
function defaultAlias(name: string): string {
  let t = name.normalize('NFKC').replace(/\s+/g, ' ').trim();
  t = t.replace(/[\/／]?\s*NFC\s*$/i, '');                 // 決済端末の識別子
  t = t.replace(/[\/／]\s*LINE\s*EC\s*$/i, '');
  t = t.replace(/^(株式会社|カブシキガイシャ)/, '');
  t = t.replace(/(株式会社|カブシキガイシャ)$/, '');
  t = t.replace(/[（(][^）)]*[）)]\s*$/, '');                 // 末尾の括弧書き
  t = t.replace(/\s*(支店管轄|本部|本店|オンライン|ご利用料金|ご利用金額)$/, '');
  t = t.trim();
  if (t.length <= 10) return t;

  // ここから短縮。まず末尾の「◯◯店」を落とす。ただし本体まで削らないよう、
  // 落とした結果が4文字未満になるならやめる（「キィニョン…ののみち店」→「キィ」になった）。
  const dropped = t.replace(/\s*[^\s]{0,8}店$/, '').trim();
  if (dropped.length >= 4) t = dropped;
  if (t.length <= 10) return t;

  // それでも長ければ区切りで切る。機械的に切ると読めない語ができるため。
  const cut = t.slice(0, 10);
  const sep = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('/'), cut.lastIndexOf('・'));
  return (sep >= 4 ? cut.slice(0, sep) : cut).trim();
}



const norm = (s: string): string => s.normalize('NFKC').replace(/\s+/g, ' ').trim();

function ruleFor(shop: string): Rule | undefined {
  const n = norm(shop);
  return MAP.find(([m]) => (typeof m === 'string' ? norm(m) === n : m.test(shop) || m.test(n)));
}

if (!existsSync(STATE)) {
  console.error(`認証状態がありません。先に screenshot-kakeibo.ts を実行してください`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ storageState: JSON.parse(readFileSync(STATE, 'utf-8')) });
const page = await ctx.newPage();
await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.kk', { timeout: 30000 });

const shops = (await page.evaluate(`(async () => {
  const r = await fetch('/api/v1/kakeibo/shops');
  return (await r.json()).shops;
})()`)) as { shop_id: string; name: string; alias: string | null }[];

const plan: { id: string; shop: string; cats: string[]; alias?: string }[] = [];
const unmatched: string[] = [];
for (const s of shops) {
  const rule = ruleFor(s.name);
  if (!rule) {
    unmatched.push(s.name);
    // 費目が決まらなくても表示名は短くしておく
    plan.push({ id: s.shop_id, shop: s.name, cats: [], alias: defaultAlias(s.name) });
    continue;
  }
  plan.push({ id: s.shop_id, shop: s.name, cats: rule[1], alias: rule[2] ?? defaultAlias(s.name) });
}

console.log(`店舗数=${shops.length} 一致=${plan.length} 未分類=${unmatched.length}`);
for (const p of plan) console.log(`  ${p.shop} → ${p.cats.join('|')}${p.alias ? ' / ' + p.alias : ''}`);
console.log('--- 未分類 ---');
for (const u of unmatched) console.log(`  ${u}`);

if (DRY) { console.log('\n(dry-run: 変更していません)'); await browser.close(); process.exit(0); }

let ok = 0;
let skipped = 0;
for (const p of plan) {
  // backend にレート制限があるので間隔を空ける（429 で半分近く弾かれた）
  await page.waitForTimeout(900);
  const body = JSON.stringify(
    p.cats.length === 0 ? { alias: p.alias } : { categories: p.cats, alias: p.alias },
  );
  const res = (await page.evaluate(
    `fetch('/api/v1/kakeibo/shops/${p.id}', {method:'PUT',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(r=>r.status)`,
  )) as number;
  if (res === 200) { ok++; continue; }
  if (res === 429) {
    // 一度だけ長めに待って再試行する
    await page.waitForTimeout(6000);
    const retry = (await page.evaluate(
      `fetch('/api/v1/kakeibo/shops/${p.id}', {method:'PUT',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(r=>r.status)`,
    )) as number;
    if (retry === 200) { ok++; continue; }
  }
  skipped++;
  console.log(`  失敗 ${res}: ${p.shop}`);
}
console.log(`\n登録 ${ok}/${plan.length}（失敗 ${skipped}）`);
await browser.close();
