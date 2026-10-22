/**
 * トップのネモフィラ畑（ADR-0009 の決定）の計算。DOM にも WebGL にも触らない（ADR-0003「層1 — 純関数だけを置く」）。
 *
 * 地形やシェーダーの定数はここに置かない。分岐の無い数式を置くと、
 * 定数を1つ変えただけの変異が「見た目が少し変わる」以上の差を出さず、
 * テストで殺しようがない生き残りになってスコアだけが下がる。
 */

/** 畑の状態。ふだん／配信前／配信中。 */
export const FIELD_STATES = ['day', 'soon', 'live'] as const;

/**
 * 畑の時計が1コマで進む上限（秒）。重いコマのあとで、動きが一度に飛ばないようにする。
 * 描く速さが 1 / FIELD_MAX_STEP_S（20fps）を下回ると、畑の時計は実際の時刻より遅れる。
 * scripts/measure-field-contrast.mjs も、撮る長さをこの数え方の時計で決める。
 */
export const FIELD_MAX_STEP_S = 0.05;
export type FieldState = (typeof FIELD_STATES)[number];

/**
 * `data-state` の値を状態として読む。知らない値・未指定は「ふだん」。
 *
 * 状態の出どころ（配信データ）はまだ無い（ADR-0009「状態の出どころ」）。
 * 何かが間違った値を書いても、畑が壊れずにふだんの色へ落ちるようにしておく。
 */
export function parseFieldState(value: string | null | undefined): FieldState {
  return FIELD_STATES.find((state) => state === value) ?? 'day';
}

/** 0〜1 の RGB。WebGL の uniform にそのまま渡せる形。 */
export type Rgb01 = readonly [number, number, number];

/**
 * getComputedStyle が返す色（`rgb(r, g, b)` / `rgba(r, g, b, a)` / `rgb(r g b)`）を
 * 0〜1 の RGB にする。読めなければ `null`。
 *
 * 色の literal は tokens.css にしか置かない（Issue rurino-nemo-fansite#5）ので、スクリプトは
 * 畑の色を CSS から読む。その読み口がここ。
 */
export function parseCssRgb(value: string): Rgb01 | null {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const channels = [match[1], match[2], match[3]].map((n) => Number(n) / 255);
  // 正規表現が符号を通さないので、下は見なくてよい。上だけ（`rgb(256, …)`）。
  if (channels.some((c) => c > 1)) return null;
  return [channels[0]!, channels[1]!, channels[2]!];
}

/** GLSL の smoothstep と同じ。`x` が `from` から `to` へ進むにつれ、0 から 1 へなめらかに上がる。 */
export function smoothstep(from: number, to: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * `current` を `target` へ、経過時間 `dt` 秒ぶんだけ寄せる。
 * `rate` が大きいほど速い。フレームの間隔が揺れても、同じ時間で同じだけ進む。
 *
 * 状態が変わったときの色の移り変わりと、なぞった風の減衰に使う。
 */
export function approach(current: number, target: number, dt: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}

/** 開幕の風。奥から手前へ一度だけ波が渡る。 */
export interface Gust {
  /** 波の先頭の奥行き（ワールド座標の z）。 */
  front: number;
  /** 強さ。0 で無風。 */
  strength: number;
}

/** 風が吹き始めるまでの秒数。 */
export const GUST_DELAY_S = 0.6;
/** 風が渡りきるまでの秒数。 */
export const GUST_DURATION_S = 3.4;
/** 波の出発点と到着点（z）。畑のいちばん奥から、カメラの少し手前まで。 */
export const GUST_FROM_Z = -90;
export const GUST_TO_Z = 10;

/**
 * 読み込んでから `t` 秒後の開幕の風。吹いていない時間は強さ 0。
 *
 * 波の先頭は減速しながら手前へ来る（ease-out）。強さは途中で頂点を迎え、
 * 渡りきる少し前に 0 へ戻る（最後まで吹かせると手前で急に止まって見える）。
 */
export function openingGust(t: number): Gust {
  const progress = (t - GUST_DELAY_S) / GUST_DURATION_S;
  if (
    // Stryker disable next-line EqualityOperator: progress がちょうど 0 なら、下の式でも先頭は GUST_FROM_Z・強さは 0 で、返す値が同じ
    progress <= 0 ||
    progress >= 1
  ) return { front: GUST_FROM_Z, strength: 0 };
  const eased = 1 - (1 - progress) ** 2;
  return {
    front: GUST_FROM_Z + eased * (GUST_TO_Z - GUST_FROM_Z),
    strength: Math.sin(Math.PI * Math.min(1, progress * 1.3)),
  };
}

/* ---------------------------------------------------------------------------
   叩いた波紋。花には慣性が無く、風が1コマで変われば花も1コマで跳ぶ。なので叩き直しても、
   前の波紋を1コマで消さず、新しい波紋も1コマで押しきらない。
   ------------------------------------------------------------------------- */

/** 叩いた波紋。 */
export interface Ripple {
  /** 叩いた点（ワールド座標の x・z）。 */
  x: number;
  z: number;
  /** 叩いた時刻（畑の時計、秒）。 */
  born: number;
  /** 手放した時刻。手放していなければ `null`。 */
  released: number | null;
}

/**
 * 波紋を置いておける数。埋まったら、いちばん古い波紋を手放して（`RIPPLE_RELEASE_S` かけて消す）次のスロットを空けておく。
 * 1秒に5回叩くと、波紋は叩いてから 0.6 秒（半径 4 ほど）広がったところで手放す。
 */
export const RIPPLE_SLOTS = 4;
/** 波紋が弱まる速さ。1秒で 0.45 倍になる。 */
export const RIPPLE_DECAY = 0.8;
/**
 * 手放した波紋が消えきるまでの秒数。これより間を空けて叩く限り（1秒に10回まで）、消えきっていない波紋には上書きしない。
 * 0.15 秒では、1秒に10回叩くと消えかけの波紋を上書きして跳んだ（1コマの風の変わり方が 0.35。0.1 秒なら 0.17）。
 */
export const RIPPLE_RELEASE_S = 0.1;
/**
 * 叩いてから押しきるまでの秒数。押し始めの1コマの風の変わり方は 0.13 ほど（1コマで押しきると 1.26、
 * 波紋が広がっていくだけのときは 0.07）。引き換えに、叩いた点のすぐ近く（0.5 まで）は押しきる前に輪が通り過ぎ、
 * 押しは1コマで押しきるときの半分ほどになる。0.12 秒（8〜9割）とも見比べて、跳ねないほうを取った。
 */
export const RIPPLE_ATTACK_S = 0.25;
/** これより弱い波紋は、消えたものとして扱う（手放さずに上書きし、強さは 0 にする）。 */
export const RIPPLE_GONE = 0.01;

/** 波紋の残り（0〜1）。叩いてからの弱まりと、手放してからの消え方を掛けたもの。立ち上がりは含まない。 */
export function rippleLeft(ripple: Ripple, now: number): number {
  const release = ripple.released === null ? 1 : Math.max(0, 1 - (now - ripple.released) / RIPPLE_RELEASE_S);
  return Math.exp(-(now - ripple.born) * RIPPLE_DECAY) * release;
}

/**
 * 波紋の強さ（0〜1）。残りに、叩いてから `RIPPLE_ATTACK_S` 秒かけて押しきる立ち上がりを掛けたもの。
 * 消えた波紋（残りが `RIPPLE_GONE` 未満）は 0 — シェーダーは強さ 0 の波紋を計算しない。
 */
export function rippleStrength(ripple: Ripple, now: number): number {
  const left = rippleLeft(ripple, now);
  // Stryker disable next-line EqualityOperator: 残りがちょうど RIPPLE_GONE になる波紋は、Math.exp の丸めしだいでしか作れない
  if (left < RIPPLE_GONE) return 0;
  return smoothstep(0, RIPPLE_ATTACK_S, now - ripple.born) * left;
}

/**
 * 叩いた波紋をスロット（`ripples`。書き換える）に入れる。空きが無ければ、いちばん弱い波紋に上書きする。
 * 入れたあとで空きが無くなったら（どの波紋もまだ消えていなければ）、いちばん古い波紋を手放しておく —
 * 次に叩いたとき、消えきった波紋に上書きできるように。
 */
export function addRipple(ripples: Ripple[], ripple: Ripple): void {
  const now = ripple.born;
  if (ripples.length < RIPPLE_SLOTS) {
    ripples.push(ripple);
  } else {
    let weakest = 0;
    for (let i = 1; i < ripples.length; i++) {
      // Stryker disable next-line EqualityOperator: 同じ残りの波紋が並んだとき、どれに上書きするかは決めていない（どれもいちばん弱い）
      if (rippleLeft(ripples[i]!, now) < rippleLeft(ripples[weakest]!, now)) weakest = i;
    }
    ripples[weakest] = ripple;
  }
  if (
    ripples.length < RIPPLE_SLOTS ||
    // Stryker disable next-line EqualityOperator: 残りがちょうど RIPPLE_GONE になる波紋は、Math.exp の丸めしだいでしか作れない
    ripples.some((r) => rippleLeft(r, now) < RIPPLE_GONE)
  ) return;
  let oldest: Ripple | undefined;
  for (const r of ripples) {
    if (
      r !== ripple &&
      r.released === null &&
      // Stryker disable next-line EqualityOperator: 同じ時刻に叩いた波紋が並んだとき、どれを手放すかは決めていない（どれもいちばん古い）
      (!oldest || r.born < oldest.born)
    ) oldest = r;
  }
  if (oldest) oldest.released = now;
}

/* ---------------------------------------------------------------------------
   描く解像度。GPU が追いつかない環境では、描く画素を減らして滑らかさを取る。
   ------------------------------------------------------------------------- */

/** 重さを判断するのに見るフレームの数。 */
export const FRAME_WINDOW = 60;
/** フレームの間隔の中央値がこれ（ms）を超えたら重いとみなす。50fps を割ったところ。 */
export const SLOW_FRAME_MS = 20;
/** 1回に下げる割合。画素の数では約半分（0.75²）。 */
export const DPR_STEP = 0.75;

/**
 * 直近のフレームの間隔（ms）から、描くのが重すぎるか。
 * `FRAME_WINDOW` に満たないうちは判断しない。中央値で見るので、ときどきの引っかかり
 * （GC やスクロール）では下げない。
 */
export function isSlow(intervalsMs: readonly number[]): boolean {
  if (intervalsMs.length < FRAME_WINDOW) return false;
  const sorted = [...intervalsMs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]! > SLOW_FRAME_MS;
}

/**
 * 重いときに次に使う解像度（CSS の 1px あたりの画素）。1 より下には下げない — それより
 * 粗くすると花がぼやけるので、そこから先はフレームが落ちるほうを取る。もう下げられなければ `null`。
 */
export function lowerDpr(dpr: number): number | null {
  if (dpr <= 1) return null;
  return Math.max(1, dpr * DPR_STEP);
}

/* ---------------------------------------------------------------------------
   花の3Dモデル（株）。形式は scripts/generate-field-assets.mjs の先頭のコメントが正本。
   ------------------------------------------------------------------------- */

/** ファイルの先頭4バイト（'NEMO'）。 */
export const FIELD_MESH_MAGIC = 0x4f4d454e;
export const FIELD_MESH_VERSION = 1;

/** 1株ぶん。全メッシュ通しの三角形の配列の、どこからどこまでか。 */
export interface FieldMeshPart {
  firstIndex: number;
  indexCount: number;
  /** 株の高さ（cm）。風で先端ほど大きく揺らすのに使う。 */
  heightCm: number;
}

export interface FieldMesh {
  parts: FieldMeshPart[];
  vertexCount: number;
  /** int16 の位置を /32767 してからこれを掛けると cm。 */
  positionScale: number;
  positions: Int16Array;
  normals: Int8Array;
  uvs: Uint16Array;
  indices: Uint16Array;
}

const align4 = (n: number) => Math.ceil(n / 4) * 4;

/**
 * 株のファイルを読む。**形が1つでも合わなければ `null`**（呼び出し側は元の描き方に戻る）。
 *
 * 中身を信じずに確かめるのは、読み違えると GPU が範囲外を読みに行くため。
 * 壊れたファイル・古い形式・途中で切れた応答（通信の失敗）がここで止まる。
 */
export function parseFieldMesh(buffer: ArrayBuffer): FieldMesh | null {
  // Stryker disable next-line EqualityOperator: ちょうど 24 バイトでは株の表を1つも書けず、下の確かめでも null になる
  if (buffer.byteLength < 24) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== FIELD_MESH_MAGIC) return null;
  if (view.getUint32(4, true) !== FIELD_MESH_VERSION) return null;
  const meshCount = view.getUint32(8, true);
  const vertexCount = view.getUint32(12, true);
  const indexCount = view.getUint32(16, true);
  const positionScale = view.getFloat32(20, true);
  // 頂点・三角形の数は直接見ない。株が1つ以上あり、どの株も三角形の数が整数で、
  // 合計が三角形の数に一致し、頂点の番号がどれも頂点の数より小さい — で、0 や端数は全部落ちる。
  if (meshCount === 0 || !(positionScale > 0) || !Number.isFinite(positionScale)) return null;

  const header = 24 + meshCount * 12;
  const positionsAt = header;
  const normalsAt = positionsAt + align4(vertexCount * 6);
  const uvsAt = normalsAt + align4(vertexCount * 3);
  const indicesAt = uvsAt + vertexCount * 4;
  if (buffer.byteLength !== indicesAt + align4(indexCount * 2)) return null;

  const parts: FieldMeshPart[] = [];
  let expectedFirst = 0;
  for (let i = 0; i < meshCount; i++) {
    const part = {
      firstIndex: view.getUint32(24 + i * 12, true),
      indexCount: view.getUint32(28 + i * 12, true),
      heightCm: view.getFloat32(32 + i * 12, true),
    };
    // 株は隙間も重なりもなく並んでいて、どれも三角形を1つ以上持ち、高さを持つ。
    if (part.firstIndex !== expectedFirst) return null;
    if (part.indexCount === 0 || part.indexCount % 3 !== 0) return null;
    if (!(part.heightCm > 0) || !Number.isFinite(part.heightCm)) return null;
    expectedFirst += part.indexCount;
    parts.push(part);
  }
  if (expectedFirst !== indexCount) return null;

  const indices = new Uint16Array(buffer, indicesAt, indexCount);
  if (indices.some((index) => index >= vertexCount)) return null;

  return {
    parts,
    vertexCount,
    positionScale,
    positions: new Int16Array(buffer, positionsAt, vertexCount * 3),
    normals: new Int8Array(buffer, normalsAt, vertexCount * 3),
    uvs: new Uint16Array(buffer, uvsAt, vertexCount * 2),
    indices,
  };
}

/* ---------------------------------------------------------------------------
   植える数と地面の刻み。花と地面は、カメラに映る幅にだけ植える（張る）。
   ------------------------------------------------------------------------- */

/**
 * 一枚絵の花を植える畑の形。z は手前ほど大きい（`nearZ > farZ`）。
 * 奥行き z の帯では、左右それぞれ `[outer(z) - width(z), outer(z)]` の範囲に植える。
 */
export interface FlowerBed {
  nearZ: number;
  farZ: number;
  /** 奥行き z で植える幅（片側）。0 ならその帯には植えない。 */
  width: (z: number) => number;
  /** 植える範囲の外側の端（片側）。 */
  outer: (z: number) => number;
  /** 密度の基準の幅（片側）。奥行き 1 あたり `perDepth` 本をこの幅に植えたときの密度に揃える。 */
  baseHalf: (z: number) => number;
  /**
   * 植える幅か密度が途中で切り替わる z（株の帯の奥の端、間引き始める奥行き）。受け入れる率の上限を、
   * ここでも測る（畑の外のものは見ない）。割合（`width / baseHalf`）がここで跳ぶなら、ちょうどの z では
   * 大きいほうの値を返すこと — 小さいほうを返すと、もう片側の本当の最大を測り損ねることがある。
   */
  breaks?: readonly number[];
}

/** 何本植えるかと、受け入れる率の上限（帯の幅 / 基準の幅 の最大）。 */
export interface FlowerPlan {
  count: number;
  peak: number;
}

/** 本数を見積もるときに、奥行きを刻む数。 */
export const FLOWER_PLAN_STEPS = 200;

/**
 * 基準の密度で植えたときの本数（`maxCount` まで）と、受け入れる率の上限。
 * 本数は、帯ごとに `width / baseHalf` を足し合わせて見積もる。
 *
 * 上限は、両端と `breaks` で測る。割合（`width / baseHalf`）は、その間で最大が端に来る形
 * （単調な関数、またはその max）であること — 刻みの中点で測るだけだと、端や切り替わりで本当の
 * 最大を下回り、そこだけ受け入れる率が 1 で頭打ちになって密度が落ちる。
 */
export function planFlowers(bed: FlowerBed, perDepth: number, maxCount: number): FlowerPlan {
  const share = (z: number) => bed.width(z) / bed.baseHalf(z);
  const depth = bed.nearZ - bed.farZ;
  const step = depth / FLOWER_PLAN_STEPS;
  let sum = 0;
  // Stryker disable next-line ArrayDeclaration: breaks が無いときの配列に数でない値が入っても、下の比べ方でどれも外れる
  const breaks = (bed.breaks ?? []).filter(
    // Stryker disable next-line EqualityOperator: 両端ちょうどの切り替わりを入れても、下で測る両端と同じ値が増えるだけ
    (z) => z < bed.nearZ && z > bed.farZ,
  );
  const peak = Math.max(share(bed.nearZ), share(bed.farZ), ...breaks.map(share));
  for (let i = 0; i < FLOWER_PLAN_STEPS; i++) sum += share(bed.nearZ - (i + 0.5) * step);
  const wanted = (sum / FLOWER_PLAN_STEPS) * depth * perDepth;
  return { count: Math.round(Math.min(maxCount, wanted)), peak };
}

/**
 * 1本ぶんの場所を試す。奥行きは均等に取り、その帯の `width / baseHalf` の割合で残す
 * （帯ごとの密度が基準と揃う）。残せたら `out` に書いて `true`、捨てたら `false`。
 * 呼ぶたびに配列を作らないよう、結果は `out` に書く。
 */
export function placeFlower(
  bed: FlowerBed,
  plan: FlowerPlan,
  random: () => number,
  out: { x: number; z: number },
): boolean {
  const z = bed.nearZ - random() * (bed.nearZ - bed.farZ);
  const half = bed.width(z);
  // 乱数は 0 を返しうるので、等しいときは捨てる。幅 0 の帯に植えないため。
  if (random() * plan.peak >= half / bed.baseHalf(z)) return false;
  const inner = bed.outer(z) - half;
  // Stryker disable next-line EqualityOperator: 乱数のどちら側を左に当てても、左右に半々に植えることは変わらない
  out.x = (random() < 0.5 ? -1 : 1) * (inner + random() * half);
  out.z = z;
  return true;
}

/** 地面のインデックス（Uint16）で指せる頂点の数。 */
export const MAX_GROUND_VERTICES = 65536;

/** 地面の横の刻みの数を、この倍数に切り上げる。 */
export const GROUND_COLUMN_UNIT = 16;

/**
 * 地面の横の刻みの数。幅 `span` を `step` 以下の刻みで割り、`GROUND_COLUMN_UNIT` の倍数に切り上げる —
 * 刻みの数が同じなら、張り直しでインデックスを作り直さずに済む。ただし頂点の数
 * （(刻み + 1) × (縦の刻み `rows` + 1)）が Uint16 のインデックスに収まるところまで。
 */
export function groundColumns(span: number, step: number, rows: number): number {
  const most = Math.floor(MAX_GROUND_VERTICES / (rows + 1)) - 1;
  const wanted = Math.max(1, Math.ceil(span / step / GROUND_COLUMN_UNIT)) * GROUND_COLUMN_UNIT;
  return Math.min(most, wanted);
}
