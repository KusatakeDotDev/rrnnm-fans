/**
 * トップのネモフィラ畑を WebGL2 で描く。NemophilaField.astro のスクリプトから使う
 * （docs/adr/0009-nemophila-field-hero.md）。
 *
 * **手前の花は3Dモデルの株、奥は一枚絵。** 株は購入した素材を変換したもの（ADR-0009「花の3Dモデル」）で、
 * 描けると分かってから取りに行く。取れなければ全部を一枚絵で描く。メッシュとテクスチャは1つの独自バンドルから読む。
 *
 * **three.js は使わない**（ADR-0009「three.js を使わず、素の WebGL2 で書く」）。
 *
 * **描けなくても何も壊れない。** WebGL2 が無い・シェーダーが通らない・コンテキストを
 * 失ったときは何もせずに戻り、CSS のグラデーションの畑（NemophilaField.module.css）が残る。
 *
 * **色は CSS から読む。** 色の literal は tokens.css にしか置かない（Issue rurino-nemo-fansite#5）ので、
 * 畑の色は NemophilaField.module.css が `--field-<状態>-<部位>` に割り当てたパレットを
 * getComputedStyle で解決して受け取る。ここには16進数を書かない。
 *
 * 計算のうち分岐のあるもの（状態の読み取り・色の読み取り・寄せ方・開幕の風・叩いた波紋のスロット）は
 * src/lib/field.ts にあり、単体テストが掛かっている。
 */
import {
  approach,
  FIELD_MAX_STEP_S,
  FIELD_STATES,
  type FieldState,
  FRAME_WINDOW,
  isSlow,
  lowerDpr,
  openingGust,
  addRipple,
  type Ripple,
  RIPPLE_SLOTS,
  rippleStrength,
  smoothstep,
  type FieldMesh,
  type FlowerBed,
  groundColumns,
  parseCssRgb,
  parseFieldState,
  placeFlower,
  planFlowers,
  type Rgb01,
} from "../lib/field";
import { FIELD_ATLAS_SIZE } from "../lib/field-atlas";
import { parseFieldBundle } from "../lib/field-bundle-source";
import { SMALL_SCREEN_PX } from "./field-snapshot";

/* ---------------------------------------------------------------------------
   状態ごとの色以外の値。色は CSS から読む（下の readPalettes）。
   ------------------------------------------------------------------------- */
interface StateLook {
  /** 花が帯びる光の強さ（配信中だけ）。 */
  live: number;
  /** 全体の明るさ。夜は落とす。 */
  ambient: number;
  /** 光の粒の量（0〜1）。 */
  motes: number;
  /** 妖精の光の数（0〜3）。 */
  wisps: number;
}

const LOOKS: Record<FieldState, StateLook> = {
  day: { live: 0, ambient: 1, motes: 0.35, wisps: 1 },
  soon: { live: 0.25, ambient: 0.95, motes: 0.6, wisps: 2 },
  live: { live: 1, ambient: 0.72, motes: 1, wisps: 3 },
};

/** 状態ごとに CSS から読む色の部位。`--field-<状態>-<部位>` の後ろ半分。 */
const PARTS = ["fog", "ground", "stem", "mote", "glow"] as const;
type Part = (typeof PARTS)[number];
type Palette = Record<Part, Rgb01>;

/** 状態が変わったとき、色がどれだけ速く移るか。 */
const STATE_RATE = 2.2;

/* ---------------------------------------------------------------------------
   畑の形
   ------------------------------------------------------------------------- */
const FOG_NEAR = 10;
const FOG_FAR = 115;
const CAMERA_Y = 1.3;
const CAMERA_Z = 8;
const LOOK_AT: Vec3 = [0, 3, -30];
/**
 * 開幕の演出。カメラは定位置のまま、畑は最初の1枚から見せる（毎回見せても邪魔にならないよう、2回目以降も飛ばさない）。
 * そのあと妖精の光（1つめ）が画面の下の外（カメラのすぐ前の低いところ）から飛び出し、右上へ弧を描いて
 * 畑の奥のいつもの軌道へ入る — 手前から奥へ視線を連れていく。
 * 道は3次ベジェ。ここに置くのは最初の2点で、残りの2点は着く時刻のいつもの軌道の位置と向きから決める
 * （着いたところで止まらず、そのままの速さで軌道へ移る）。
 * 畑が出てから GUIDE_DELAY_S 待って飛び始め、GUIDE_S で着く。動きを減らす設定では飛ばない。
 */
const GUIDE_PATH: Vec3[] = [
  [0.8, -0.4, 6.8],
  [1.0, 1.6, 3.5],
];
const GUIDE_DELAY_S = 0.4;
const GUIDE_S = 2.2;
/**
 * 開幕の妖精の大きさ（いつもの何倍か）。昼の空の上では、いつもの大きさだと埋もれる。着くまでに 1 へ戻す。
 * 飛び始めは 0 から GUIDE_GROW（飛んだ割合）かけて大きくする — 点は中心が画面の外にあると丸ごと捨てられるので、
 * 大きいまま下端を越えると、半分欠けた光が急に出る。
 */
const GUIDE_LEAD = 1.6;
const GUIDE_GROW = 0.3;
/**
 * 妖精の軌道（と開幕の道）の左右の幅を決めた、横長の画面（16:9・画角 50°）の映る幅（距離 1 あたりの半分）。
 * これより狭い画面（縦長）では、映る幅に合わせて左右を縮める — そのままだと縦長では妖精がほとんど枠の外を飛ぶ。
 */
const WIDE_HALF = Math.tan((25 * Math.PI) / 180) * (16 / 9);
/**
 * 株の cm をワールドの長さへ。素材の株は高さ 19〜24cm で、これを掛けると 0.5〜0.6 になる
 * （一枚絵の花の高さ 0.5 × 大きさ と揃う）。カメラの高さ 1.3 から見て、膝下の花畑の見え方。
 */
const WORLD_PER_CM = 0.03;
/** なぞった位置を拾う面の高さ（花の中ほど）。 */
const POINTER_PLANE_Y = 0.3;
/**
 * 入り直す前の風を凪がせるスロットの数。入り直すたびに、残っている風をいちばん弱いスロットへ移す（どのスロットの風より
 * 弱ければ捨てる）。空いていなければいちばん弱い風を上書きし、上書きした風は1コマで消える。風は 1.6 の速さで凪ぐので、計算では 0.5 秒ごとになぞり直しても、
 * 上書きするのは 1.5 秒前の風で、強さは移したときの 1 割ほど。
 */
const FADE_SLOTS = 3;

/** 起伏。手前はなだらかに波打ち、奥へ行くほど丘として持ち上がる。 */
function hill(x: number, z: number): number {
  let y =
    0.25 * Math.sin(x * 0.15 + 1.0) * Math.cos(z * 0.11) + 0.15 * Math.sin(x * 0.37 + z * 0.23);
  const far = Math.max(0, -z - 18);
  y += (far * far * 0.0025 + far * 0.05) * (0.75 + 0.25 * Math.cos(x * 0.035));
  return y;
}

/**
 * 奥行き z で画面に映る片側の幅。reach は画角の半分の tan × 縦横比（画面の横の広がり）。
 * 視差でカメラが横に動くぶんと、風で倒れるぶんの余白を足す。
 */
const visibleHalf = (z: number, reach: number) => (CAMERA_Z - z) * reach + 1.5;
/** 画角（縦、度）と縦横比から reach（画角の半分の tan × 縦横比）。 */
const reachOf = (fovDeg: number, aspect: number) => Math.tan((fovDeg * Math.PI) / 360) * aspect;
/** 植え直すとき、今の reach より少し広めに植えておく。少し広がるたびに植え直さずに済む。 */
const REACH_HEADROOM = 1.1;
/**
 * 遠くの地面が花の色に寄る距離（始まり〜寄りきり）。奥の花は1〜2px の点なので、地面ごと花の色に
 * しておけば、花の間からのぞく地面も花畑の一部に見える。横に広い画面で一枚絵の花がまばらになっても、
 * 奥が地面の色に抜けない。
 */
const CARPET_NEAR = 14;
const CARPET_FAR = 45;
/**
 * 地面が花の色に半分ほど寄るおおよその奥行き（z）。カメラはほぼ水平に -z を向いている。
 * 一枚絵の花を上限で間引くのは、ここより奥だけ。寄り始め（CARPET_NEAR）から間引くと、
 * まだ灰緑の地面が花の間からのぞく。
 */
const CARPET_Z = CAMERA_Z - (CARPET_NEAR + CARPET_FAR) / 2;

/* ---------------------------------------------------------------------------
   行列（列優先。WebGL にそのまま渡せる形）
   ------------------------------------------------------------------------- */
type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];
/** ベジェ曲線（点の数で次数が決まる）。 */
const bezier = (points: readonly Vec3[], t: number): Vec3 =>
  points.length === 1
    ? points[0]!
    : bezier(
        points.slice(1).map((p, i) => mix3(points[i]!, p, t)),
        t,
      );
/**
 * シードを固定した乱数（mulberry32）。0 以上 1 未満。花の植え方を開くたびに同じにする —
 * 前回の畑の絵（スナップショット）を先に出して本物と入れ替えるので、並びが変わると入れ替えた瞬間に花が動いて見える。
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Camera {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  view: Float32Array;
}

function lookAt(eye: Vec3, target: Vec3): Camera {
  const forward = normalize(sub(target, eye));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  // prettier-ignore
  const view = new Float32Array([
    right[0], up[0], -forward[0], 0,
    right[1], up[1], -forward[1], 0,
    right[2], up[2], -forward[2], 0,
    -dot(right, eye), -dot(up, eye), dot(forward, eye), 1,
  ]);
  return { eye, right, up, forward, view };
}

function perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const nf = 1 / (near - far);
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

/* ---------------------------------------------------------------------------
   シェーダー
   ------------------------------------------------------------------------- */
const FOG_GLSL = /* glsl */ `
  uniform float uFogNear, uFogFar;
  float fogAt(float dist) { return smoothstep(uFogNear, uFogFar, dist); }
`;

const GROUND_VS = /* glsl */ `#version 300 es
  uniform mat4 uView, uProj;
  ${FOG_GLSL}
  in vec3 aPos;
  out float vFog, vDist;
  out vec2 vXZ;
  void main() {
    vec4 mv = uView * vec4(aPos, 1.0);
    vDist = -mv.z;
    vFog = fogAt(vDist);
    vXZ = aPos.xz;
    gl_Position = uProj * mv;
  }`;

/* 地面。遠くほど花の色（花びらの中ほどの色を花と同じ仕上げに通したもの）に寄せ、
   まだらにして花の群れの濃淡に見せる。下の PETAL_GLSL を使うので、定義はその後ろ。 */

/* 値ノイズ。風と地面のまだらで同じ形を使い、hash（格子点ごとの乱数）だけを差し替える。
   - 風: sin の hash。見て決めてきた風の流れ方はこの乱数の上にあるので変えない
   - 地面: sin を使わない hash。sin(大きな数) は GPU によって精度が落ち、地面の端（x が数百）で
     模様が縞や塊になる
   座標は数百になるので、乱数とノイズの計算は highp で行う（地面のフラグメントシェーダーは mediump）。 */
const SIN_HASH = /* glsl */ `return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);`;
const FRACT_HASH = /* glsl */ `
    highp vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);`;
const noiseGlsl = (hash: string) => /* glsl */ `
  highp float hash(highp vec2 p) { ${hash} }
  highp float noise(highp vec2 p) {
    highp vec2 i = floor(p), f = fract(p);
    highp vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

/* 風。花（一枚絵）と株（3Dモデル）で同じものを使う。位置 p（xz）と揺れの位相 ph から、
   その場所の草木がどちらへどれだけ倒れるかを返す。なぞった跡・叩いた波紋・妖精の通り道も
   ここで足す。 */
const WIND_GLSL = /* glsl */ `
  uniform float uTime, uGust, uGustFront, uMotion, uMouseStr;
  uniform vec3 uMouse;
  uniform vec2 uMouseDir; // なぞった向き（xz）。折り返すと短くなる
  uniform vec3 uMouseFade[${FADE_SLOTS}]; // 入り直す前の風。xy は中心（xz）、z は強さ
  uniform vec2 uMouseFadeDir[${FADE_SLOTS}];
  uniform vec4 uRipple[${RIPPLE_SLOTS}]; // 叩いた波紋。xy は中心（xz）、z は叩いてからの秒数、w は強さ
  uniform vec3 uFairy[3]; // xz は位置、y は押す強さ（0〜1）
  ${noiseGlsl(SIN_HASH)}
  // なぞった風。d は風の中心からの位置、dir はなぞった向き、s は強さ、n2 は風のまだら。
  // なぞった向きへ倒し、外へ押すのは少しだけ — 外へ押すだけだと、指先を中心に花が円く分かれ、その輪が
  // 指先に付いて回って探し回るように見えた。強さは n2 で場所ごとに 0.4〜1.4 倍に揺らし（中心も揺れる）、
  // 届く範囲の縁が円く揃わないようにする。
  // smoothstep の端を大→小の順に渡すのは GLSL の仕様では未定義だが、妖精の押し・光の粒・妖精の光でも
  // 同じ書き方をしているので、ここだけは変えない（直すなら全部まとめて）。
  vec2 strokeWind(vec2 d, vec2 dir, float s, float n2) {
    float dl = length(d);
    float reach = smoothstep(2.8, 0.0, dl) * mix(0.4, 1.4, n2);
    return (dir * 0.8 + (d / (dl + 1e-3)) * 0.2) * s * reach * 0.6;
  }
  vec2 windAt(vec2 p, float ph) {
    float t = uTime;
    vec2 dir = normalize(vec2(0.35, 1.0));
    float n = noise(p * 0.07 + vec2(t * 0.22, -t * 0.30));
    float n2 = noise(p * 0.23 + vec2(-t * 0.6, -t * 0.8));
    vec2 w = dir * ((n - 0.45) * 0.9 + (n2 - 0.5) * 0.35);
    w += vec2(sin(t * 1.6 + ph * 6.283), cos(t * 1.2 + ph * 6.283)) * 0.045;
    float g = exp(-pow((p.y - uGustFront) / 6.0, 2.0)) * uGust;
    w += dir * g * 1.25;
    w += strokeWind(p - uMouse.xz, uMouseDir, uMouseStr, n2);
    for (int i = 0; i < ${FADE_SLOTS}; i++) {
      // 凪いだスロットは計算しない（uniform なので、どちらへ分かれるかは全部の頂点でそろう）。
      if (uMouseFade[i].z > 1e-3) w += strokeWind(p - uMouseFade[i].xy, uMouseFadeDir[i], uMouseFade[i].z, n2);
    }
    // 重なった波紋は足す。波紋の幅（約 2）は続けて叩いた波紋どうしの間（叩く間隔 × 6.5）より広いので、連打すると
    // 叩いた点のまわりが上限（下の 1.3）に張りついて止まる。強さを強いほうに寄せる案（4乗の和の4乗根）とも見比べて、
    // 足すほうが違和感が少なかった。
    for (int i = 0; i < ${RIPPLE_SLOTS}; i++) {
      // 消えた波紋は計算しない（uniform なので、どちらへ分かれるかは全部の頂点でそろう）。
      // 消えたかどうかは CPU 側（src/lib/field.ts の RIPPLE_GONE）で決め、強さをちょうど 0 にして渡す。
      if (uRipple[i].w > 0.0) {
        vec2 dr = p - uRipple[i].xy; float rd = length(dr);
        float d = rd - uRipple[i].z * 6.5;
        w += (dr / (rd + 1e-3)) * exp(-d * d / 1.4) * uRipple[i].w * 1.3;
      }
    }
    for (int i = 0; i < 3; i++) {
      vec2 fd = p - uFairy[i].xz; float fl = length(fd);
      w += (fd / (fl + 1e-3)) * smoothstep(2.2, 0.0, fl) * 0.6 * uFairy[i].y;
    }
    float L = length(w); if (L > 1.3) w *= 1.3 / L;
    return w * uMotion;
  }
`;

/* 花の色の仕上げ。株と一枚絵で同じ。テクスチャは乗算済みアルファで上げてあるので、
   割り戻してから使う（透明な縁の色が縮小で混ざって、花びらの縁が緑に滲むのを防ぐ）。 */
const PETAL_GLSL = /* glsl */ `
  uniform vec3 uGlow;
  uniform float uLive, uAmb;
  vec3 unpremultiply(vec4 tx) { return tx.rgb / max(tx.a, 1e-3); }
  vec3 finishPetal(vec3 col, float hue, float glow) {
    col *= mix(vec3(0.86, 0.94, 1.06), vec3(1.04, 1.0, 0.97), hue) * uAmb;
    // 夜に光るのは花びら（青）だけ。葉は光らせない。
    float petal = smoothstep(0.05, 0.25, col.b - col.g);
    // 夜は葉を沈める。花だけが浮かぶように。
    col *= mix(1.0, 0.6, uLive * (1.0 - petal));
    return col + uGlow * uLive * (0.2 + 0.45 * glow) * petal;
  }
`;

const GROUND_FS = /* glsl */ `#version 300 es
  precision mediump float;
  uniform vec3 uGround, uFog, uPetal;
  ${PETAL_GLSL}
  in float vFog, vDist;
  // 地面の座標（数百になる）。ノイズに渡すので highp。
  in highp vec2 vXZ;
  out vec4 outColor;
  ${noiseGlsl(FRACT_HASH)}
  void main() {
    // 花の色に寄り始めるより手前は、地面の色だけ。ノイズと仕上げを計算しない（分かれ目は距離で決まり、
    // 隣どうしの画素はほぼ同じ側に入るので、分岐で遅くはならない）。
    float far = smoothstep(${CARPET_NEAR.toFixed(1)}, ${CARPET_FAR.toFixed(1)}, vDist);
    if (far <= 0.0) {
      outColor = vec4(mix(uGround, uFog, vFog), 1.0);
      return;
    }
    float mottle = 0.6 * noise(vXZ * 0.12) + 0.4 * noise(vXZ * 0.45);
    float carpet = far * mix(0.55, 0.95, mottle);
    vec3 col = mix(uGround, finishPetal(uPetal, mottle, 0.5), carpet);
    outColor = vec4(mix(col, uFog, vFog), 1.0);
  }`;

/* 遠くの花：1輪＝茎の板＋花の板。茎は根元から先へ、花は茎の先で画面に正対する板。
   花の絵は、株のテクスチャから切り出した3輪のどれか（uAtlas = 1）か、
   株を読めなかったときに描いた1輪（uAtlas = 0）。 */
const FLOWER_VS = /* glsl */ `#version 300 es
  uniform mat4 uView, uProj;
  uniform float uAtlas;
  uniform vec4 uRects[3];
  ${FOG_GLSL}
  ${WIND_GLSL}
  in vec2 aCorner; in float aPart; in vec3 iOffset; in vec3 iData;
  out vec2 vUv; out float vPart, vFog, vHue, vGlow;
  void main() {
    float sc = iData.x, ph = iData.y;
    vHue = iData.z; vPart = aPart;
    float h = 0.5 * sc;
    vec2 w = windAt(iOffset.xz, ph);
    float t = aPart < 0.5 ? aCorner.y : 1.0;
    float b = t * t;
    vec3 wp = iOffset + vec3(w.x * b * h, h * t - length(w) * b * h * 0.3, w.y * b * h);
    vec4 mv = uView * vec4(wp, 1.0);
    float dist = -mv.z;
    if (aPart < 0.5) {
      mv.x += aCorner.x * 0.011 * sc * step(dist, 28.0);
      vUv = vec2(0.0);
    } else {
      float s = 0.12 * sc; float a = ph * 6.2831;
      mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
      mv.xy += (r * aCorner) * s * vec2(1.0, 0.78);
      vec2 corner = aCorner * 0.5 + 0.5;
      // テクスチャの行は上から下。板の上端（corner.y = 1）が切り出しの上端に来るよう反転する。
      vec4 rect = uRects[int(min(vHue * 3.0, 2.0))];
      vUv = uAtlas > 0.5 ? rect.xy + vec2(corner.x, 1.0 - corner.y) * rect.zw : corner;
    }
    vGlow = 0.5 + 0.5 * sin(uTime * 2.2 + ph * 19.0);
    vFog = fogAt(dist);
    gl_Position = uProj * mv;
  }`;

const FLOWER_FS = /* glsl */ `#version 300 es
  precision mediump float;
  uniform sampler2D uTex;
  uniform vec3 uFog, uStem;
  ${PETAL_GLSL}
  in vec2 vUv; in float vPart, vFog, vHue, vGlow;
  out vec4 outColor;
  void main() {
    vec3 col;
    if (vPart < 0.5) {
      col = uStem * uAmb;
    } else {
      vec4 tx = texture(uTex, vUv);
      if (tx.a < 0.3) discard;
      col = finishPetal(unpremultiply(tx), vHue, vGlow);
    }
    outColor = vec4(mix(col, uFog, vFog), 1.0);
  }`;

/* 手前の花：株（素材の3Dモデル）。1株に花が数輪と葉が付いている。
   位置は cm の int16 で来るので、uPosScale（cm）と WORLD_PER_CM でワールドの長さに直す。
   風は株の根元の位置で1回決め、高いところほど大きく倒す（一枚絵の茎と同じ曲がり方）。 */
const CLUMP_VS = /* glsl */ `#version 300 es
  uniform mat4 uView, uProj;
  uniform float uPosScale, uHeight;
  ${FOG_GLSL}
  ${WIND_GLSL}
  in vec3 aPos; in vec3 aNormal; in vec2 aUv;
  in vec3 iOffset; in vec3 iData;
  out vec2 vUv; out vec3 vNormal; out float vFog, vHue, vGlow;
  void main() {
    float sc = iData.x, ph = iData.y;
    vHue = iData.z;
    float a = ph * 6.2831;
    mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec3 local = aPos * uPosScale * ${WORLD_PER_CM.toFixed(4)} * sc;
    local.xz = r * local.xz;
    vec3 n = aNormal; n.xz = r * n.xz;
    float h = uHeight * ${WORLD_PER_CM.toFixed(4)} * sc;
    float t = clamp(local.y / h, 0.0, 1.0);
    float b = t * t;
    vec2 w = windAt(iOffset.xz, ph);
    vec3 wp = iOffset + local + vec3(w.x * b * h, -length(w) * b * h * 0.3, w.y * b * h);
    vec4 mv = uView * vec4(wp, 1.0);
    vUv = aUv;
    vNormal = n;
    vGlow = 0.5 + 0.5 * sin(uTime * 2.2 + ph * 19.0);
    vFog = fogAt(-mv.z);
    gl_Position = uProj * mv;
  }`;

const CLUMP_FS = /* glsl */ `#version 300 es
  precision mediump float;
  uniform sampler2D uTex;
  uniform vec3 uFog;
  ${PETAL_GLSL}
  in vec2 vUv; in vec3 vNormal; in float vFog, vHue, vGlow;
  out vec4 outColor;
  void main() {
    vec4 tx = texture(uTex, vUv);
    if (tx.a < 0.2) discard;
    // 素材の板は片面なので両面で描き、裏から見たら法線を返す（素材のマテリアルと同じ）。
    vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
    // 光は右上から（畑の上の .light と同じ向き）。影を落とすほど強くはしない。
    float light = 0.82 + 0.3 * max(dot(n, normalize(vec3(0.45, 0.85, 0.3))), 0.0);
    vec3 col = finishPetal(unpremultiply(tx) * light, vHue, vGlow);
    // 縁の抜けは MSAA の alpha to coverage に任せる。縮小で薄くなった縁を立て直してから渡す。
    float alpha = clamp((tx.a - 0.5) / max(fwidth(tx.a), 1e-4) + 0.5, 0.0, 1.0);
    outColor = vec4(mix(col, uFog, vFog), alpha);
  }`;

const MOTE_VS = /* glsl */ `#version 300 es
  uniform mat4 uView, uProj;
  uniform float uTime, uDensity, uPixel, uMotion;
  in vec3 aPos; in float aSeed;
  out float vA;
  void main() {
    vec3 p = aPos; float t = uTime * uMotion;
    p.x += sin(t * 0.3 + aSeed * 6.0) * 0.6;
    p.y += sin(t * 0.5 + aSeed * 10.0) * 0.3 + fract(t * 0.02 + aSeed) * 0.8;
    p.z += cos(t * 0.25 + aSeed * 4.0) * 0.6;
    vec4 mv = uView * vec4(p, 1.0);
    gl_PointSize = uPixel * (34.0 + aSeed * 46.0) / (-mv.z);
    vA = smoothstep(aSeed - 0.05, aSeed, uDensity) * (0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 1.5 + aSeed * 20.0)));
    gl_Position = uProj * mv;
  }`;

const MOTE_FS = /* glsl */ `#version 300 es
  precision mediump float;
  uniform vec3 uColor;
  in float vA;
  out vec4 outColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d); a *= a;
    outColor = vec4(uColor, a * vA * 0.8);
  }`;

const WISP_VS = /* glsl */ `#version 300 es
  uniform mat4 uView, uProj;
  uniform float uPixel, uCount, uMaxPoint, uLead;
  in vec3 aPos; in float aSize, aIdx, aFade;
  out float vA;
  void main() {
    vec4 mv = uView * vec4(aPos, 1.0);
    // 開幕の妖精はカメラの近くを飛ぶ。GPU の上限を超えると四角く切れるので、上限で止める。
    float lead = aIdx < 0.5 ? uLead : 1.0;
    gl_PointSize = min(uPixel * aSize * lead / (-mv.z), uMaxPoint);
    vA = clamp(uCount - aIdx, 0.0, 1.0) * aFade;
    gl_Position = uProj * mv;
  }`;

const WISP_FS = /* glsl */ `#version 300 es
  precision mediump float;
  uniform vec3 uColor;
  in float vA;
  out vec4 outColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.12, 0.0, d);
    float halo = smoothstep(0.5, 0.0, d); halo *= halo;
    outColor = vec4(uColor, (core * 0.9 + halo * 0.55) * vA);
  }`;

/* ---------------------------------------------------------------------------
   WebGL の下回り
   ------------------------------------------------------------------------- */
interface Program {
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
  attrib: (name: string) => number;
}

/**
 * シェーダーのコンパイルとリンクを**始めるだけ**で、終わるのを待たない（終わったかは `whenLinked` で見る）。
 * 状態を問い合わせるとそこで終わるまで止まるので、ここでは何も問い合わせない。頂点属性の位置も
 * 問い合わせずに済むよう、リンクの前に頂点シェーダーの `in` の宣言の順で決めておく
 * （宣言から読むので、属性の名前を書くのはシェーダーの中だけ。読めない名前を引くと `attrib` が投げる）。
 * コンテキストを失っていると `createShader` が `null` を返し、そこで投げる（呼ぶ側が受ける）。
 */
function startProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): Program {
  const attribs = [...vsSource.matchAll(/\bin\s+\w+\s+([^;]+);/g)].flatMap((m) =>
    m[1]!.split(",").map((name) => name.trim()),
  );
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vsSource],
    [gl.FRAGMENT_SHADER, fsSource],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  attribs.forEach((name, i) => gl.bindAttribLocation(program, i, name));
  gl.linkProgram(program);
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniform: (name) => {
      if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(program, name));
      return uniforms.get(name)!;
    },
    attrib: (name) => {
      const location = attribs.indexOf(name);
      // 宣言から読めなかった名前は黙って飛ばさず、ここで止める（`in highp vec3 a;` などの書き方は読めない）。
      if (location < 0) throw new Error(`頂点属性 ${name} が頂点シェーダーの in の宣言に無い`);
      return location;
    },
  };
}

/** リンクが終わったかを拡張で待つ上限。 */
const LINK_WAIT_MS = 4_000;

/**
 * シェーダーのリンクが全部終わったら、全部通ったかを返す。通らなかったら理由をコンソールに出す。
 * `KHR_parallel_shader_compile` があれば、終わるのを待つ間もほかの処理（素材のデコードなど）を進める。
 * 無ければ LINK_STATUS を問い合わせたところで終わるまで止まる。
 * 拡張があっても、LINK_WAIT_MS を過ぎたら LINK_STATUS を直に問い合わせて決着させる
 * （終わったと返さないドライバで、問い合わせが回り続けないように）。
 */
function whenLinked(
  gl: WebGL2RenderingContext,
  parallel: KHR_parallel_shader_compile | null,
  programs: readonly Program[],
): Promise<boolean> {
  const deadline = performance.now() + LINK_WAIT_MS;
  return new Promise((resolve) => {
    const check = () => {
      // 失った後は問い合わせが意味のある値を返さないことがあり、待ち続けてしまう。
      if (gl.isContextLost()) {
        resolve(false);
        return;
      }
      if (
        parallel &&
        performance.now() < deadline &&
        !programs.every((p) => gl.getProgramParameter(p.program, parallel.COMPLETION_STATUS_KHR))
      ) {
        setTimeout(check, 4);
        return;
      }
      const failed = programs.filter((p) => !gl.getProgramParameter(p.program, gl.LINK_STATUS));
      // 通らなかった理由を残す（特定の GPU・ドライバで落ちたときに追えるように）。問い合わせるのは失敗したときだけ。
      for (const { program } of failed) {
        const logs =
          gl.getAttachedShaders(program)?.map((shader) => gl.getShaderInfoLog(shader)) ?? [];
        console.warn("畑のシェーダーが通らなかった", gl.getProgramInfoLog(program), ...logs);
      }
      resolve(failed.length === 0);
    };
    check();
  });
}

/** 頂点属性を1本作って繋ぐ。`divisor` を付けるとインスタンスごとの値になる。 */
function attribute(
  gl: WebGL2RenderingContext,
  program: Program,
  name: string,
  data: Float32Array,
  size: number,
  options: { divisor?: number; usage?: number } = {},
): WebGLBuffer {
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, options.usage ?? gl.STATIC_DRAW);
  const location = program.attrib(name);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  if (options.divisor) gl.vertexAttribDivisor(location, options.divisor);
  return buffer;
}

/* ---------------------------------------------------------------------------
   色
   ------------------------------------------------------------------------- */

/** CSS のカスタムプロパティを、ブラウザに解決させた色（`rgb(…)`）で返す。 */
function cssColor(root: HTMLElement, name: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  probe.hidden = true;
  root.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

/** CSS のカスタムプロパティを 0〜1 の RGB で読む。読めなければ黒ではなく `null`。 */
function readColor(root: HTMLElement, name: string): Rgb01 | null {
  return parseCssRgb(cssColor(root, name));
}

/** 3状態ぶんの色。1色でも読めなければ `null`（描かずに CSS の畑を残す）。 */
function readPalettes(root: HTMLElement): Record<FieldState, Palette> | null {
  const result: Partial<Record<FieldState, Palette>> = {};
  for (const state of FIELD_STATES) {
    const palette: Partial<Palette> = {};
    for (const part of PARTS) {
      const rgb = readColor(root, `--field-${state}-${part}`);
      if (!rgb) return null;
      palette[part] = rgb;
    }
    result[state] = palette as Palette;
  }
  return result as Record<FieldState, Palette>;
}

/** CSS から読んだ色でネモフィラの花を1輪描き、テクスチャにする。 */
function flowerTexture(gl: WebGL2RenderingContext, root: HTMLElement): WebGLTexture {
  const color = (name: string) => cssColor(root, name);
  const white = color("--field-petal-center");
  const pale = color("--field-petal-pale");
  const petal = color("--field-petal-mid");
  const edge = color("--field-petal-edge");
  const vein = color("--field-petal-vein");

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const c = canvas.getContext("2d")!;
  c.translate(64, 64);
  for (let i = 0; i < 5; i++) {
    c.save();
    c.rotate((i * Math.PI * 2) / 5);
    const g = c.createRadialGradient(0, -6, 3, 0, -32, 34);
    g.addColorStop(0, white);
    g.addColorStop(0.32, pale);
    g.addColorStop(0.6, petal);
    g.addColorStop(1, edge);
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(0, -31, 21, 30, 0, 0, Math.PI * 2);
    c.fill();
    // 花びらの付け根の小さな斑点。ネモフィラの見分けどころ。
    c.fillStyle = vein;
    c.globalAlpha = 0.55;
    for (let j = 0; j < 5; j++) {
      c.beginPath();
      c.arc((j - 2) * 4.2, -15 - (j % 2) * 4, 1.5, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.restore();
  }
  c.fillStyle = white;
  c.beginPath();
  c.arc(0, 0, 9, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = edge;
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5 + 0.6;
    c.beginPath();
    c.arc(Math.cos(a) * 5, Math.sin(a) * 5, 1.8, 0, Math.PI * 2);
    c.fill();
  }

  // シェーダーは乗算済みアルファを前提に割り戻す（PETAL_GLSL）ので、ここも乗算して上げる。
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const texture = uploadTexture(gl, canvas);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  return texture;
}

function uploadTexture(gl: WebGL2RenderingContext, source: TexImageSource): WebGLTexture {
  // 以前の描画準備のエラーを、今回の転送失敗として扱わない。
  while (!gl.isContextLost() && gl.getError() !== gl.NO_ERROR) {
    /* drain */
  }
  const texture = gl.createTexture();
  if (!texture) throw new Error("Texture allocation failed");
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso) {
      const maxAnisotropy = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, maxAnisotropy));
    }
    if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR)
      throw new Error("Texture upload failed");
    return texture;
  } catch (error) {
    gl.deleteTexture(texture);
    throw error;
  }
}

/* ---------------------------------------------------------------------------
   花の3Dモデル（株）。BOOTH「ネモフィラ」【3Dモデル】を変換したもの（ADR-0009「花の3Dモデル」）。
   ------------------------------------------------------------------------- */
const MESH_URL = "/field/nemophila.bin";
/** これを過ぎたら株を諦めて一枚絵の花だけで描く。そのぶん最初の1枚が遅れる上限でもある。 */
const ASSET_TIMEOUT_MS = 4_000;

/**
 * テクスチャの中の花3輪（1024px の画素で x, y, 幅, 高さ）。遠くの一枚絵の花に使う。
 * 素材のテクスチャの透過から測った値。テクスチャを差し替えたら測り直す。
 */
const ATLAS_FLOWERS = [
  [36, 26, 266, 264],
  [344, 38, 268, 253],
  [659, 22, 251, 266],
].flatMap((rect) => rect.map((v) => v / FIELD_ATLAS_SIZE));

interface ClumpAssets {
  mesh: FieldMesh;
  atlas: WebGLTexture;
}

/** 株とテクスチャを取る。どちらかが取れない・形が合わないなら `null`（一枚絵の花だけで描く）。 */
export async function loadClumpAssets(gl: WebGL2RenderingContext): Promise<ClumpAssets | null> {
  const controller = new AbortController();
  const { signal } = controller;
  const timeout = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);
  const expired = new Promise<null>((resolve) =>
    signal.addEventListener("abort", () => resolve(null), { once: true }),
  );
  const load = async (): Promise<ClumpAssets | null> => {
    const response = await fetch(MESH_URL, { signal });
    if (!response.ok) return null;
    const bundle = parseFieldBundle(await response.arrayBuffer());
    if (!bundle || signal.aborted || gl.isContextLost()) return null;
    // 透明な画素の色が縮小時に縁へ混ざらないよう、乗算済みアルファで読む。
    const bitmap = await createImageBitmap(new Blob([bundle.texture], { type: "image/webp" }), {
      premultiplyAlpha: "premultiply",
    });
    try {
      if (signal.aborted || gl.isContextLost()) return null;
      if (bitmap.width !== FIELD_ATLAS_SIZE || bitmap.height !== FIELD_ATLAS_SIZE) return null;
      return { mesh: bundle.mesh, atlas: uploadTexture(gl, bitmap) };
    } finally {
      bitmap.close();
    }
  };
  try {
    return await Promise.race([load(), expired]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------------------------------------------------------------------------
   本体
   ------------------------------------------------------------------------- */

/**
 * ソフトウェアで描いている（GPU が使えない）か。
 *
 * 花は2万輪を超えるので、CPU で描くと画面全体が重くなり、スクロールまで引きずる。
 * そういう環境では描かずに CSS の畑を残す — 見た目は落ちるが、読むことは妨げない。
 * `failIfMajorPerformanceCaveat` で大半は弾けるが、ブラウザによっては素通りするので
 * レンダラの名前でも見る。ヘッドレスのブラウザ（規約テスト）もここで弾かれる。
 */
function isSoftwareRenderer(gl: WebGL2RenderingContext): boolean {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
}

export interface FieldOptions {
  /** 描く面。 */
  canvas: HTMLCanvasElement;
  /** 動きを減らす設定。風は弱く、開幕（妖精と風）とカメラの視差は無し。 */
  reducedMotion: boolean;
  /**
   * 最初の1枚を描き終えたとき。キャンバスを見せるのはここから。`gaveUp` は株の素材を取りに行って諦めたか（一枚絵の花だけで描いた）。
   * 描いたフレームの中で呼ぶので、ここでならキャンバスの中身を読める（次に開いたときに先に出す絵を撮る）。
   * 最初の1枚は開くたびに同じ（植え方はシードを固定した乱数、時刻は 0、開幕の妖精はまだ画面の外）。
   */
  onFirstFrame: (info: { gaveUp: boolean }) => void;
  /** 描けなくなったとき（コンテキストの喪失・シェーダーが通らなかった）。CSS の畑へ戻す。 */
  onLost: () => void;
}

/** 描き始めた畑の操作口。 */
export interface FieldController {
  /**
   * 動きを止める／動かす。止めている間は時間が進まず、描画のループも止まり、
   * ポインタ（なぞる・叩く・視差）にも反応しない
   * （WCAG 2.2.2。5秒を超えて自動で動き続けるものには止める手段が要る）。
   * 止めていても状態が変われば、色が移りきるまでは描く。
   */
  setPaused: (paused: boolean) => void;
}

/**
 * `root`（`data-state` を持つ要素）の上に畑を描き始める。
 * 描けない環境なら何もせずに `null` を返す。
 *
 * 動きを減らす設定の人には、止めた状態（静止画）で始める。
 */
export function mountField(root: HTMLElement, options: FieldOptions): FieldController | null {
  const { canvas, reducedMotion } = options;
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
    // GPU が無くソフトウェアで描くしかない環境では、コンテキスト自体をもらわない。
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl || isSoftwareRenderer(gl)) return null;

  const palettes = readPalettes(root);
  /** 遠くの地面が寄っていく花の色。花びらの色は状態に依らない。 */
  const petal = readColor(root, "--field-petal-mid");
  if (!palettes || !petal) return null;

  /*
   * 素材は GPU で描けると分かってから取りに行く（ADR-0009「花の3Dモデル」）。描き始めるまでの待ちを縮めるため、
   * 取得とシェーダーのコンパイルを並べる。シェーダーが通らない環境では取った素材を捨てるが、まれなので速さを取った。
   */
  // 拡張はコンパイルを出す前に有効にする（有効にしてから出したものだけ並べる実装があっても効くように）。
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  let groundProgram: Program,
    flowerProgram: Program,
    clumpProgram: Program,
    moteProgram: Program,
    wispProgram: Program;
  try {
    groundProgram = startProgram(gl, GROUND_VS, GROUND_FS);
    flowerProgram = startProgram(gl, FLOWER_VS, FLOWER_FS);
    clumpProgram = startProgram(gl, CLUMP_VS, CLUMP_FS);
    moteProgram = startProgram(gl, MOTE_VS, MOTE_FS);
    wispProgram = startProgram(gl, WISP_VS, WISP_FS);
  } catch {
    return null;
  }
  // 取りに行くのが先。拡張が無いと whenLinked はその場でリンクが終わるまで止まるので、後に置くと並ばない。
  const assetsLoaded = loadClumpAssets(gl);
  const linked = whenLinked(gl, parallel, [
    groundProgram,
    flowerProgram,
    clumpProgram,
    moteProgram,
    wispProgram,
  ]);

  const isSmall = Math.min(window.innerWidth, window.innerHeight) < SMALL_SCREEN_PX;

  /* 地面。幅は奥行きごとに画面に映る幅に合わせる（奥ほど広い台形）。決まった幅だと、横に広い
     画面では奥の端が画面の内側に来る。映る幅が広がったら張り直す（下の resize）。
     横の刻みは幅に合わせて増やし、GROUND_STEP 以下に保つ — 粗いと谷で地面が起伏より浮き、
     hill() の高さに立てた花の根元が埋まる。 */
  const SEG_Z = 70;
  const DEPTH = 105;
  const GROUND_STEP = 2;
  const groundVao = gl.createVertexArray()!;
  gl.bindVertexArray(groundVao);
  const groundBuffer = attribute(gl, groundProgram, "aPos", new Float32Array(0), 3);
  const groundIndexBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, groundIndexBuffer);
  gl.bindVertexArray(null);
  let groundIndexCount = 0;
  let groundSegX = 0;
  const shapeGround = (reach: number) => {
    const halfAt = (z: number) => Math.max(10, visibleHalf(z, reach) + 4);
    const zAt = (iz: number) => -32.5 - DEPTH / 2 + (iz / SEG_Z) * DEPTH;
    const segX = groundColumns(2 * halfAt(zAt(0)), GROUND_STEP, SEG_Z);
    const pos = new Float32Array((segX + 1) * (SEG_Z + 1) * 3);
    for (let iz = 0, k = 0; iz <= SEG_Z; iz++) {
      const z = zAt(iz);
      const half = halfAt(z);
      for (let ix = 0; ix <= segX; ix++, k += 3) {
        const x = -half + (ix / segX) * 2 * half;
        pos[k] = x;
        pos[k + 1] = hill(x, z) - 0.05;
        pos[k + 2] = z;
      }
    }
    gl.bindVertexArray(groundVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, groundBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    // インデックスは刻みの数だけで決まる。数が変わらなければ前のものを使う。
    if (segX !== groundSegX) {
      const index = new Uint16Array(segX * SEG_Z * 6);
      for (let iz = 0, k = 0; iz < SEG_Z; iz++) {
        for (let ix = 0; ix < segX; ix++, k += 6) {
          const a = iz * (segX + 1) + ix;
          const b = a + segX + 1;
          index[k] = a;
          index[k + 1] = b;
          index[k + 2] = a + 1;
          index[k + 3] = a + 1;
          index[k + 4] = b;
          index[k + 5] = b + 1;
        }
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, groundIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
      groundSegX = segX;
      groundIndexCount = index.length;
    }
    gl.bindVertexArray(null);
  };

  /* 花。株（素材の3Dモデル）が読めたら手前に株を植え、その奥を一枚絵の花で埋める。
     読めなければ全部を一枚絵の花で描く。どちらになるかは素材が届くまで決まらないので、
     植えるのは届いてから（下の loadClumpAssets の後）。 */
  const FLOWER_COUNT = isSmall ? 16000 : 26000;
  /** 株を植える奥行きの端。ここより手前が株、奥が一枚絵。 */
  const CLUMP_FAR_Z = -12;
  /**
   * 株を株の帯いっぱいに同じ密度で植えたときの数。THIN_Z より奥は間引くので、植わるのはこれより
   * 少ない（1440×900 で約 4,700、狭い画面で約 2,400）。
   */
  const CLUMP_COUNT = isSmall ? 5000 : 10000;
  /**
   * 花を間引く奥行きの端（z）と、そこより奥で残す割合。株も一枚絵の花も、奥行きによらず同じ割合で間引く。
   * 間引かないと奥が詰まりすぎて見えた — 株の帯の奥（THIN_Z〜CLUMP_FAR_Z）は、画面では手前の大きな花の
   * すぐ上の細い帯に縮まって映り、隙間の無い青の筋になる（ADR-0009「花の3Dモデル」）。
   */
  const THIN_Z = 0;
  const THIN_KEEP = 0.35;
  /**
   * 奥行き z の花を残す割合。THIN_Z ちょうどは手前側（1）にする — 一枚絵の花の受け入れる率の上限は
   * THIN_Z でも測るので（FlowerBed.breaks）、ここを奥側にすると手前の密度が上限で頭打ちになりうる
   * （株の素材が無く、手前まで一枚絵の花で描くとき）。
   */
  const keepAt = (z: number) => (z < THIN_Z ? THIN_KEEP : 1);
  /** 畑の手前の端と奥の端（z）。 */
  const NEAR_Z = 7;
  const FAR_Z = -82;
  /**
   * 密度の基準になる幅。株はこの幅（と映る幅の狭いほう）より外には植えない — 株は重いので、
   * 横に広い画面でも数を増やさない。その外側は、手前でも一枚絵の花で埋める。
   * 一枚絵の花は、FLOWER_COUNT 本をこの幅に植えたときの密度（THIN_Z より奥はその keepAt 倍）を保つだけ
   * 本数を増やす。ただし FLOWER_COUNT の MAX_FLOWER_RATIO 倍まで — それより広い画面は奥だけ少しまばらに
   * なるが、奥は地面が花の色に寄っているので地面の色に抜けては見えない。手前（地面が花の色にならない
   * ところ）は上限で間引かない。
   */
  const baseHalf = (z: number) => 5 + (8 - z) * 0.78;
  // 株は余白（REACH_HEADROOM）を掛ける前の、今映る幅に植える。余白のぶんは画面の外なので、
  // そこに株を回すと映るところがまばらになる。余白と株の幅の間は一枚絵の花が埋める。
  const clumpHalf = (z: number) => Math.min(baseHalf(z), visibleHalf(z, viewReach));
  const MAX_FLOWER_RATIO = 1.5;
  const sizeFor = (z: number, random: () => number) =>
    (0.8 + random() * 0.5) * (1 + Math.max(0, -z) * 0.02);

  let flowerVao: WebGLVertexArrayObject | null = null;
  let flowerBuffers: { offsets: WebGLBuffer; data: WebGLBuffer } | null = null;
  /** 一枚絵の花の手前の端（株があれば株の奥から、無ければ畑の手前の端から）と、今植えている本数。 */
  let flowerNearZ = NEAR_Z;
  let flowerCount = 0;
  let flowerTex: WebGLTexture | null = null;
  let useAtlas = false;
  interface ClumpPart {
    vao: WebGLVertexArrayObject;
    count: number;
    firstIndex: number;
    indexCount: number;
    height: number;
  }
  const clumpParts: ClumpPart[] = [];
  let clumpScale = 1;
  /** 株のメッシュ（読めたときだけ）。 */
  let clumpMesh: {
    mesh: FieldMesh;
    positions: WebGLBuffer;
    normals: WebGLBuffer;
    uvs: WebGLBuffer;
    indices: WebGLBuffer;
  } | null = null;
  /**
   * 花を植えて地面を張ったときに映っていた横の広がり（reachOf）。大きさが分かる前は 0。
   * 一枚絵の花と地面は、これに REACH_HEADROOM を掛けた幅まで植える（張る）。
   */
  let viewReach = 0;
  /** 植え直すときに消す、株ごとの位置と大きさのバッファ。 */
  const clumpInstanceBuffers: WebGLBuffer[] = [];

  /**
   * 一枚絵の花を植える。株と同じく**カメラに映る幅にだけ植える** — 決まった幅に植えると、横に広い
   * 画面では奥の左右に花の無いところができ、縦長の画面では大半が画面の外に植わる。
   * 株があれば、株の奥に加えて、株の幅の外の手前の左右にも植える。
   * 密度は基準の幅に FLOWER_COUNT 本を植えたときと同じにする（上限あり。baseHalf と MAX_FLOWER_RATIO）。
   * THIN_Z より奥は、その keepAt 倍。
   */
  const plantFlowers = () => {
    const reach = viewReach * REACH_HEADROOM;
    // 株の外の帯にも、どの画面でも少しは植わる — 株は余白（REACH_HEADROOM）を除いた幅にだけ植えるので、
    // 余白のぶんを一枚絵の花が埋める。
    const bed = (nearZ: number, farZ: number): FlowerBed => ({
      nearZ,
      farZ,
      // 株のあるところは株に任せ、その外側にだけ植える。
      width: (z) =>
        z > flowerNearZ ? Math.max(0, visibleHalf(z, reach) - clumpHalf(z)) : visibleHalf(z, reach),
      outer: (z) => visibleHalf(z, reach),
      // 密度を keepAt 倍にする — 同じ本数を 1 / keepAt 倍の幅に植えたときの密度に揃える。
      baseHalf: (z) => baseHalf(z) / keepAt(z),
      breaks: [flowerNearZ, THIN_Z],
    });
    // 地面が花の色に寄ったところ（CARPET_Z より奥）と、その手前で分けて見積もる。手前は地面が花の色に
    // ならず、上限でさらに間引くと地面が目立つので、いつも基準の密度（THIN_Z より奥は keepAt 倍）で植える。
    // 上限を超えるぶんは奥だけで間引く。
    const perDepth = FLOWER_COUNT / (flowerNearZ - FAR_Z);
    const nearBed = bed(NEAR_Z, CARPET_Z);
    const farBed = bed(CARPET_Z, FAR_Z);
    const nearPlan = planFlowers(nearBed, perDepth, Infinity);
    const farPlan = planFlowers(
      farBed,
      perDepth,
      Math.max(0, FLOWER_COUNT * MAX_FLOWER_RATIO - nearPlan.count),
    );
    flowerCount = nearPlan.count + farPlan.count;
    const offsets = new Float32Array(flowerCount * 3);
    const data = new Float32Array(flowerCount * 3);
    const spot = { x: 0, z: 0 };
    // シードを固定した乱数で植える — 同じ大きさの画面なら開くたびに同じ並びになり、前回の絵と入れ替えても動かない。
    const random = seededRandom(1);
    for (let i = 0; i < flowerCount;) {
      const near = i < nearPlan.count;
      if (!placeFlower(near ? nearBed : farBed, near ? nearPlan : farPlan, random, spot)) continue;
      const { x, z } = spot;
      const k = i * 3;
      offsets[k] = x;
      offsets[k + 1] = hill(x, z);
      offsets[k + 2] = z;
      data[k] = sizeFor(z, random);
      data[k + 1] = random();
      data[k + 2] = random();
      i++;
    }
    if (flowerBuffers) {
      gl.bindBuffer(gl.ARRAY_BUFFER, flowerBuffers.offsets);
      gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, flowerBuffers.data);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return;
    }
    flowerVao = gl.createVertexArray()!;
    gl.bindVertexArray(flowerVao);
    // prettier-ignore
    attribute(gl, flowerProgram, 'aCorner', new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1, 1, 1, 1]), 2);
    attribute(gl, flowerProgram, "aPart", new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]), 1);
    flowerBuffers = {
      offsets: attribute(gl, flowerProgram, "iOffset", offsets, 3, { divisor: 1 }),
      data: attribute(gl, flowerProgram, "iData", data, 3, { divisor: 1 }),
    };
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]),
      gl.STATIC_DRAW,
    );
    gl.bindVertexArray(null);
  };

  /** 整数の頂点属性を、0〜1（符号付きは -1〜1）に正規化して読ませる。 */
  const intAttribute = (name: string, buffer: WebGLBuffer, size: number, type: number) => {
    const location = clumpProgram.attrib(name);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, type, true, 0, 0);
  };

  const uploadClumps = (mesh: FieldMesh) => {
    const upload = (data: ArrayBufferView, target: number = gl.ARRAY_BUFFER) => {
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(target, buffer);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return buffer;
    };
    clumpMesh = {
      mesh,
      positions: upload(mesh.positions),
      normals: upload(mesh.normals),
      uvs: upload(mesh.uvs),
      indices: upload(mesh.indices, gl.ELEMENT_ARRAY_BUFFER),
    };
    clumpScale = mesh.positionScale;
  };

  /**
   * 株を散らす。**カメラに映る幅にだけ植える** — 決まった幅（画面の外まで）に植えると、
   * 縦長の画面では8割近くが映らないところに植わり、そのぶん手前がまばらになる。
   * 映る幅は奥行きに比例するので、面で均等になるよう、その幅の中で均等に取る。
   * 手前から奥へ並べておくと、手前の株に隠れた画素を奥の株が塗らずに済む。
   * THIN_Z より奥は、keepAt の割合だけ残す。
   */
  const scatterClumps = () => {
    if (!clumpMesh) return;
    const { mesh, positions, normals, uvs, indices } = clumpMesh;
    for (const part of clumpParts) gl.deleteVertexArray(part.vao);
    clumpParts.length = 0;
    for (const buffer of clumpInstanceBuffers) gl.deleteBuffer(buffer);
    clumpInstanceBuffers.length = 0;

    const maxHalf = clumpHalf(CLUMP_FAR_Z);
    const clumps: number[][] = [];
    const random = seededRandom(2);
    while (clumps.length < CLUMP_COUNT) {
      const z = NEAR_Z - random() * (NEAR_Z - CLUMP_FAR_Z);
      const x = (random() * 2 - 1) * maxHalf;
      if (Math.abs(x) > clumpHalf(z)) continue;
      // 高さ（2つめ）は、間引いたあとに残った株にだけ求める。
      clumps.push([x, 0, z, 0.85 + random() * 0.5, random(), random()]);
    }
    clumps.sort((a, b) => b[2]! - a[2]!);
    // THIN_Z より手前は keepAt が 1（thin() は 1 未満）なので必ず残る。手前の株は並べた列の先頭に
    // 固まっているので列の番号も変わらず、位置も形（どの株の素材かは、下で列の番号から決める）も
    // 間引かないときと同じ。間引きを field.ts に出して単体テストを書くことはしない（filter 1つで、
    // 確かめられるのは filter が順番を保つことだけになる。PR rurino-nemo-fansite#122）。
    const thin = seededRandom(4);
    const kept = clumps.filter((c) => thin() < keepAt(c[2]!));
    for (const c of kept) c[1] = hill(c[0]!, c[2]!);

    mesh.parts.forEach((part, k) => {
      const mine = kept.filter((_, i) => i % mesh.parts.length === k);
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      intAttribute("aPos", positions, 3, gl.SHORT);
      intAttribute("aNormal", normals, 3, gl.BYTE);
      intAttribute("aUv", uvs, 2, gl.UNSIGNED_SHORT);
      clumpInstanceBuffers.push(
        attribute(
          gl,
          clumpProgram,
          "iOffset",
          new Float32Array(mine.flatMap((c) => c.slice(0, 3))),
          3,
          { divisor: 1 },
        ),
        attribute(gl, clumpProgram, "iData", new Float32Array(mine.flatMap((c) => c.slice(3))), 3, {
          divisor: 1,
        }),
      );
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
      gl.bindVertexArray(null);
      clumpParts.push({
        vao,
        count: mine.length,
        firstIndex: part.firstIndex,
        indexCount: part.indexCount,
        height: part.heightCm,
      });
    });
  };

  /**
   * 素材が届くまで（または諦めるまで）は描かない。先に描くと、届いた瞬間に畑が入れ替わって見える。
   * 植えるのは素材が届いたらすぐ（シェーダーのリンクを待たない）。描き始めるのは両方そろってから。
   * シェーダーが通らなかったら、コンテキストを失ったときと同じく CSS の畑へ戻す — 素材を待たずにすぐ
   * （戻したあとに届いた素材は、planted の `lost` で使わない）。植える途中で投げたときも同じ道で戻す。
   */
  let ready = false;
  /** 素材が届いた（または諦めた）か。株を植えるか、一枚絵の花をどこから植えるかは、これで決まる。 */
  let stocked = false;
  /** 広がったあとの植え直しを待っているタイマー（下の resize）。待っていなければ undefined。 */
  let replantTimer: ReturnType<typeof setTimeout> | undefined;
  /** 株と花を植える。植える幅はキャンバスの大きさで決まるので、大きさが分かる前（0×0）は植えない。 */
  const plant = () => {
    // 待っている植え直しは要らなくなる。消さないと、すぐあとにもう一度全部植え直す。
    // 植えずに戻るときも消す — 残すと「待っている」の印だけが残り、resize が空のタイマーを掛け直し続ける。
    clearTimeout(replantTimer);
    replantTimer = undefined;
    if (!stocked || viewReach === 0) return;
    scatterClumps();
    plantFlowers();
  };
  const planted = assetsLoaded.then((assets) => {
    if (lost) {
      if (assets) gl.deleteTexture(assets.atlas);
      return;
    }
    if (assets) {
      uploadClumps(assets.mesh);
      flowerNearZ = CLUMP_FAR_Z;
      flowerTex = assets.atlas;
      useAtlas = true;
    } else {
      flowerTex = flowerTexture(gl, root);
    }
    stocked = true;
    plant();
  });
  // リンクに失敗したときは planted を待たないので、その間に投げても未処理の reject にしない（投げたら下の鎖が受ける）。
  planted.catch(() => {});

  /* 漂う光の粒 */
  const MOTES = isSmall ? 160 : 280;
  const moteVao = gl.createVertexArray()!;
  gl.bindVertexArray(moteVao);
  const motePos = new Float32Array(MOTES * 3);
  const moteSeed = new Float32Array(MOTES);
  const moteRandom = seededRandom(3);
  for (let i = 0; i < MOTES; i++) {
    const x = (moteRandom() * 2 - 1) * 20;
    const z = 8 - moteRandom() * 48;
    motePos.set([x, hill(x, z) + 0.3 + moteRandom() * 2.6, z], i * 3);
    moteSeed[i] = moteRandom();
  }
  attribute(gl, moteProgram, "aPos", motePos, 3);
  attribute(gl, moteProgram, "aSeed", moteSeed, 1);

  /* 妖精の気配：尾を引く光 */
  const TRAIL = 12;
  const WISPS = 3;
  const wispVao = gl.createVertexArray()!;
  gl.bindVertexArray(wispVao);
  // 画面の外で埋めておく。動きを減らす設定では止めた状態で始まり、位置を一度も入れないまま描くため（0 だと原点に光が出る）。
  const wispPos = new Float32Array(WISPS * TRAIL * 3).fill(999);
  const wispSize = new Float32Array(WISPS * TRAIL);
  const wispIdx = new Float32Array(WISPS * TRAIL);
  const wispFade = new Float32Array(WISPS * TRAIL);
  for (let k = 0; k < WISPS; k++) {
    for (let j = 0; j < TRAIL; j++) {
      const i = k * TRAIL + j;
      wispIdx[i] = k;
      wispFade[i] = 1 - j / TRAIL;
      wispSize[i] = j === 0 ? 210 : 120 * (1 - j / TRAIL) + 20;
    }
  }
  const wispBuffer = attribute(gl, wispProgram, "aPos", wispPos, 3, { usage: gl.DYNAMIC_DRAW });
  attribute(gl, wispProgram, "aSize", wispSize, 1);
  attribute(gl, wispProgram, "aIdx", wispIdx, 1);
  attribute(gl, wispProgram, "aFade", wispFade, 1);
  gl.bindVertexArray(null);

  /**
   * 妖精の軌道の左右の縮め具合（1 で縮めない）。画面の形が変わったら、急に飛ばないよう orbitTarget へ寄せていく。
   */
  let orbitScale = 1;
  let orbitTarget = 1;
  const wispAt = (k: number, t: number): Vec3 => {
    const x = (Math.sin(t * 0.21 + k * 2.1) * 9 + Math.sin(t * 0.53 + k) * 2) * orbitScale;
    const z = -7 + Math.sin(t * 0.13 + k * 1.3) * 10;
    return [x, hill(x, z) + 1.0 + 0.35 * Math.sin(t * 0.9 + k * 3.0), z];
  };
  const trails: Vec3[][] = [[], [], []];
  const fairy = new Float32Array(9).fill(999);
  const maxPoint = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null)?.[1] ?? 64;

  /**
   * 開幕の妖精（1つめの光）の位置。`u` は飛んだ割合（0〜1）。着くところは、いつもの軌道のその時刻の位置。
   * 進み方 `u²(2 − u)` は、出だしの速さが 0、着くときの速さが道の向きのまま 1 倍。3つめの点を軌道の向きの
   * 逆へ「速さ × GUIDE_S / 3」だけ戻して置くと、ベジェの終わりの速さが軌道の速さと揃い、継ぎ目で止まらない。
   */
  const introLength = GUIDE_DELAY_S + GUIDE_S;
  // TODO(RRNNM-31): 制御点は orbitScale が変わったときしか変わらないので、毎フレーム作り直さない。
  const fairyAt = (u: number): Vec3 => {
    const end = wispAt(0, introLength);
    const step = 0.01;
    const ahead = wispAt(0, introLength + step);
    const back = GUIDE_S / 3 / step;
    const control = mix3(end, ahead, -back);
    const start = GUIDE_PATH.map(([x, y, z]): Vec3 => [x * orbitScale, y, z]);
    return bezier([...start, control, end], u * u * (2 - u));
  };
  /** 開幕の妖精の飛んだ割合（0〜1）。時計は畑の時計（time）と同じ — 軌道へ移るフレームで位置がずれない。 */
  const flight = () => Math.min(1, Math.max(0, (time - GUIDE_DELAY_S) / GUIDE_S));

  /* 大きさ */
  let proj = perspective(50, 1, 0.1, 300);
  let fov = 50;
  let aspect = 1;
  let pixel = 1;
  /** 今の描く解像度（CSS の 1px あたりの画素）と、重かったときに下げた上限。 */
  let dpr = 1;
  let dprLimit = Infinity;
  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    dpr = Math.min(window.devicePixelRatio || 1, isSmall ? 1.75 : 2, dprLimit);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    aspect = width / height;
    fov = aspect < 0.8 ? 64 : 50;
    proj = perspective(fov, aspect, 0.1, 300);
    orbitTarget = Math.min(1, (Math.tan((fov * Math.PI) / 360) * aspect) / WIDE_HALF);
    pixel = (dpr * height) / 800;
    // 花と地面はカメラに映る幅にしか植えて（張って）いない。映る幅が広がったら植え直す（縮むぶんにはそのまま）。
    // 縦横比だけでは見ない — 縦長で画角が 50° から 64° に切り替わると、縦横比が縮んでも映る幅は広がる。
    const reach = reachOf(fov, aspect);
    // 地面は軽いのですぐ張り直す。株と花は重い（数万本）ので、ウィンドウをドラッグで広げている間は
    // 待ち、止まってから1回だけ植え直す。初めて大きさが分かったときは待たずに植える。
    if (reach > viewReach * REACH_HEADROOM) {
      const first = viewReach === 0;
      viewReach = reach;
      shapeGround(viewReach * REACH_HEADROOM);
      if (first) plant();
      else waitToReplant();
    } else if (replantTimer !== undefined) {
      // 待っている間は、大きさが変わるたびに待ち直す。ゆっくり広げていても、途中では植え直さない。
      waitToReplant();
    }
  };
  const waitToReplant = () => {
    clearTimeout(replantTimer);
    replantTimer = setTimeout(() => {
      if (lost) return;
      plant();
      resume();
    }, 200);
  };
  resize();
  orbitScale = orbitTarget;
  // 大きさを変えるとキャンバスの絵が消えるので、止めている間でも1コマ描き直す。
  // resize() の中では呼ばない — 上の初回の resize() は resume を定義する前に走る。
  const resizeObserver = new ResizeObserver(() => {
    resize();
    resume();
  });
  resizeObserver.observe(canvas);

  /* 入力：なぞると風、叩くと波紋 */
  let camera = lookAt([0, CAMERA_Y, CAMERA_Z], LOOK_AT);
  const pointer = { x: 0, y: 0 };
  const mouseTarget: Vec3 = [999, 0, 999];
  const mouse: Vec3 = [999, 0, 999];
  /**
   * なぞった向き（xz）と強さ。向きは画面の上で動いた距離（px）のぶんだけ今の動きの向きへ回し、折り返すと一度
   * 短くなる（風が弱まる）。強さは向きによらず、畑の中で動いた距離で溜める — 向きと強さを1本のベクトルにまとめると、
   * 逆向きの動きが打ち消し合い、行ったり来たりなぞっても風がほとんど溜まらない。
   */
  const mouseDir: [number, number] = [0, 0];
  let mouseStrength = 0;
  /**
   * 入り直す前の風（FADE_SLOTS 個。中心の x・z と強さ、向き）。入り直したら、残っている風をここへ移し、
   * 出たところで凪がせる。中心を入った点へ寄せると前の向きのまま畑を渡り、置き直すと残った風が1コマで跳ぶ。
   */
  const fade = new Float32Array(FADE_SLOTS * 3);
  const fadeDir = new Float32Array(FADE_SLOTS * 2);
  let lastHit: Vec3 | null = null;
  /** lastHit を拾ったときの、画面の上の位置（CSS px）。なぞった向きを回す量に使う。 */
  let lastX = 0;
  let lastY = 0;
  /** 叩いた波紋（RIPPLE_SLOTS 個まで）。叩き直しても前の波紋は消さない（src/lib/field.ts の addRipple）。 */
  const ripples: Ripple[] = [];
  const rippleUniform = new Float32Array(RIPPLE_SLOTS * 4);

  /** 画面上の点から、花の中ほどの高さの面へ視線を飛ばした先。 */
  const groundPoint = (event: PointerEvent): Vec3 | null => {
    const rect = canvas.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pointer.x = nx;
    pointer.y = ny;
    const tanHalf = reachOf(fov, 1);
    const reach = reachOf(fov, aspect);
    const dir = normalize([
      camera.forward[0] + nx * reach * camera.right[0] + ny * tanHalf * camera.up[0],
      camera.forward[1] + nx * reach * camera.right[1] + ny * tanHalf * camera.up[1],
      camera.forward[2] + nx * reach * camera.right[2] + ny * tanHalf * camera.up[2],
    ]);
    if (dir[1] >= -1e-4) return null;
    const t = (POINTER_PLANE_Y - camera.eye[1]) / dir[1];
    return [camera.eye[0] + dir[0] * t, POINTER_PLANE_Y, camera.eye[2] + dir[2] * t];
  };
  const onControl = (event: Event) =>
    event.target instanceof Element && event.target.closest("a, button");
  // 止めている間はポインタに反応しない（風も波紋も視差も）。止めたら動かない、を守る。
  // 最初の1枚を描くまでは反応しない — 波紋や風が入ると、前回の絵として撮られてしまう。
  // 2本目の指は追わない。lastHit は1つなので、指どうしで取り合うと指の間の距離と向きを拾う。
  root.addEventListener("pointermove", (event) => {
    if (paused || firstFrame || !event.isPrimary) return;
    // リンクやボタンの上は、空と同じく畑の外として扱う。
    const hit = onControl(event) ? null : groundPoint(event);
    if (!hit) {
      // 畑の外へ出たら、戻ってきた点を入ってきた点として扱う（出た点からの1区間をまとめて拾わない）。
      lastHit = null;
      return;
    }
    if (lastHit) {
      const dx = hit[0] - lastHit[0];
      const dz = hit[2] - lastHit[2];
      const moved = Math.hypot(dx, dz);
      if (moved > 0) {
        // 向きは時間ではなく、画面の上で動いた距離で回す（50px ほどで 6 割）。指先のわずかな震えでは、
        // 残っている風の向きはほとんど変わらない。畑の中の距離で回すと、奥では 1px の震えでもほぼ丸ごと回る。
        // 凪いでいたら（指先を止めたまま風が収まったら）前の向きは捨て、今の動きの向きにする。
        const pixels = Math.hypot(event.clientX - lastX, event.clientY - lastY);
        const wasCalm = mouseStrength < 0.05;
        mouseDir[0] = wasCalm ? dx / moved : approach(mouseDir[0], dx / moved, pixels, 0.02);
        mouseDir[1] = wasCalm ? dz / moved : approach(mouseDir[1], dz / moved, pixels, 0.02);
      }
      // 強さは、向きと違って畑の中の距離で溜める。手前は溜まりにくく（1秒に約 680px なぞって 0.45 ほど）、奥は
      // すぐ上限に届く。画面の上の距離に変えると手応えが変わるので、変えない。
      mouseStrength = Math.min(1, mouseStrength + moved * 0.35);
    } else {
      // 入ってきた最初の点（畑の外や空から戻った点）には、風の中心を寄せずに置き、強さは 0 から溜め直す。
      // 空のすぐ下から入ると、この点は地平線の近くの遠いところになり、そこから指先を追って風が手前へ動く。
      // 指先の動きそのものなので、そのままにする。
      // 残っている風は、いちばん弱いスロットへ移して出たところで凪がせる（どのスロットの風より弱ければ捨てる）。
      let weakest = 0;
      for (let i = 1; i < FADE_SLOTS; i++)
        if (fade[i * 3 + 2]! < fade[weakest * 3 + 2]!) weakest = i;
      if (mouseStrength > fade[weakest * 3 + 2]!) {
        fade.set([mouse[0], mouse[2], mouseStrength], weakest * 3);
        fadeDir.set(mouseDir, weakest * 2);
      }
      mouseStrength = 0;
      mouse.splice(0, 3, ...hit);
    }
    lastHit = hit;
    lastX = event.clientX;
    lastY = event.clientY;
    mouseTarget.splice(0, 3, ...hit);
  });
  root.addEventListener("pointerdown", (event) => {
    if (paused || firstFrame || !event.isPrimary || onControl(event)) return;
    const hit = groundPoint(event);
    if (!hit) return;
    // 叩いた点は波紋にだけ使い、なぞった跡（lastHit）には入れない。そのためタッチでは、触れた点から最初の
    // pointermove までの1区間を拾わない。タッチで確かめられていないので、変えずにおく。
    addRipple(ripples, { x: hit[0], z: hit[2], born: time, released: null });
  });
  root.addEventListener("pointerleave", (event) => {
    // 2本目の指が離れても、1本目のなぞりは続ける。
    if (event.isPrimary) lastHit = null;
  });

  /* 状態の色を寄せていく途中の値 */
  const initial = parseFieldState(root.dataset["state"]);
  const current = {
    ...LOOKS[initial],
    colors: Object.fromEntries(PARTS.map((p) => [p, [...palettes[initial][p]]])) as Record<
      Part,
      number[]
    >,
  };

  /* ループ。画面の外と裏のタブ、止めている間は回さない（回しっぱなしにしない）。 */
  let last = performance.now();
  /** 畑の時計。止めている間は進まない。 */
  let time = 0;
  let frameId = 0;
  let visible = true;
  let firstFrame = true;
  let lost = false;
  let paused = reducedMotion;
  /** 開幕が済んだか。止めている間は時計が進まないので、止めた所から飛び続ける。 */
  let introDone = reducedMotion;
  /**
   * 直近のフレームの間隔（ms）。開幕が終わって動いている間だけ溜め、重ければ描く解像度を下げる
   * （src/lib/field.ts の isSlow / lowerDpr）。下げるだけで上げ直さない — 行ったり来たりして
   * 画面の粗さが揺れるより、一度決めたらそのままのほうが目に障らない。
   */
  const intervals: number[] = [];

  /** 状態の色が移りきったか。止めていても、移りきるまでは描く。 */
  const settled = (target: FieldState) =>
    PARTS.every((part) =>
      current.colors[part].every((c, i) => Math.abs(c - palettes[target][part][i]!) < 1e-3),
    ) &&
    (["live", "ambient", "motes", "wisps"] as const).every(
      (key) => Math.abs(current[key] - LOOKS[target][key]) < 1e-3,
    );

  const setUniforms = (program: Program) => {
    gl.useProgram(program.program);
    gl.uniformMatrix4fv(program.uniform("uView"), false, camera.view);
    gl.uniformMatrix4fv(program.uniform("uProj"), false, proj);
    gl.uniform1f(program.uniform("uFogNear"), FOG_NEAR);
    gl.uniform1f(program.uniform("uFogFar"), FOG_FAR);
  };

  /** 花の仕上げ（PETAL_GLSL）の uniform。地面の遠くの色と、一枚絵の花と株で同じもの。 */
  const setPetalUniforms = (program: Program) => {
    gl.uniform3fv(program.uniform("uGlow"), current.colors.glow);
    gl.uniform1f(program.uniform("uLive"), current.live);
    gl.uniform1f(program.uniform("uAmb"), current.ambient);
  };

  const frame = (now: number) => {
    frameId = 0;
    // 植える前（素材が届く前、または大きさが分かる前）は描かない。地面だけを描くと、
    // そこで onFirstFrame が呼ばれて CSS の畑が隠れる。
    if (!visible || document.hidden || lost || !ready || viewReach === 0) return;

    const interval = now - last;
    // 最初の1枚は時刻 0 で描く（開くたびに同じ絵にする。前回の絵と入れ替えても動かない）。
    const dt = firstFrame ? 0 : Math.min(FIELD_MAX_STEP_S, interval / 1000);
    last = now;
    if (!paused) time += dt;
    if (time >= introLength) introDone = true;

    if (!paused && introDone && !firstFrame && dpr > 1) {
      intervals.push(interval);
      if (intervals.length > FRAME_WINDOW) intervals.shift();
      if (isSlow(intervals)) {
        dprLimit = lowerDpr(dpr) ?? 1;
        intervals.length = 0;
        resize();
      }
    }

    const gust = reducedMotion ? { front: 0, strength: 0 } : openingGust(time);

    const target = parseFieldState(root.dataset["state"]);
    for (const part of PARTS) {
      const to = palettes[target][part];
      current.colors[part] = current.colors[part].map((c, i) =>
        approach(c, to[i]!, dt, STATE_RATE),
      );
    }
    for (const key of ["live", "ambient", "motes", "wisps"] as const) {
      current[key] = approach(current[key], LOOKS[target][key], dt, STATE_RATE);
    }

    const calm = Math.exp(-dt * 1.6);
    mouseStrength *= calm;
    for (let i = 0; i < FADE_SLOTS; i++) fade[i * 3 + 2] = fade[i * 3 + 2]! * calm;
    // なぞった風は、指先より少し遅れて付いてくる。速くなぞると中心が届く範囲（2.8）より後ろへ離れ、指先の真下には
    // 吹かなくなる。指先にすぐ付いてくる案（跡に沿って伸ばす案）とも見比べて、この遅れに決めた。
    for (let i = 0; i < 3; i++) mouse[i] = approach(mouse[i]!, mouseTarget[i]!, dt, 5);
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
      const r = ripples[i];
      rippleUniform[i * 4] = r?.x ?? 0;
      rippleUniform[i * 4 + 1] = r?.z ?? 0;
      // 叩いた時刻ではなく経過時間を渡す。時計が大きくなると、float32 どうしの引き算（uTime - 叩いた時刻）で桁が落ちる。
      rippleUniform[i * 4 + 2] = r ? time - r.born : 0;
      rippleUniform[i * 4 + 3] = r ? rippleStrength(r, time) : 0;
    }

    orbitScale = approach(orbitScale, orbitTarget, dt, 2);
    const wispTime = reducedMotion ? time * 0.3 : time;
    for (let k = 0; k < WISPS && !paused; k++) {
      const intro = k === 0 && !introDone;
      const head = intro ? fairyAt(flight()) : wispAt(k, wispTime);
      const active = current.wisps - k > 0.5;
      // 開幕の妖精は、光と同じく飛び立ちに合わせて押し始める（飛ぶ前の見えない点が、手前の花を倒さない）。
      const push = intro ? smoothstep(0, GUIDE_GROW, flight()) : 1;
      fairy.set(active ? [head[0], push, head[2]] : [999, 0, 999], k * 3);
      const trail = trails[k]!;
      trail.unshift(head);
      if (trail.length > TRAIL * 3) trail.length = TRAIL * 3;
      for (let j = 0; j < TRAIL; j++) {
        wispPos.set(trail[Math.min(trail.length - 1, j * 3)]!, (k * TRAIL + j) * 3);
      }
    }

    // カメラ：定位置から、ポインタに合わせてわずかに視差
    const px = reducedMotion ? 0 : pointer.x;
    const py = reducedMotion ? 0 : pointer.y;
    const eye: Vec3 = [
      approach(camera.eye[0], px * 0.5, dt, 2),
      approach(camera.eye[1], CAMERA_Y + py * 0.15, dt, 2),
      approach(camera.eye[2], CAMERA_Z, dt, 2),
    ];
    camera = lookAt(eye, LOOK_AT);

    const { fog, ground, stem, mote } = current.colors;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    setUniforms(groundProgram);
    gl.uniform3fv(groundProgram.uniform("uGround"), ground);
    gl.uniform3fv(groundProgram.uniform("uFog"), fog);
    gl.uniform3fv(groundProgram.uniform("uPetal"), petal);
    setPetalUniforms(groundProgram);
    gl.bindVertexArray(groundVao);
    gl.drawElements(gl.TRIANGLES, groundIndexCount, gl.UNSIGNED_SHORT, 0);

    /** 風と花の色の uniform。一枚絵の花と株で同じもの。 */
    const setPlantUniforms = (program: Program) => {
      setUniforms(program);
      gl.uniform1f(program.uniform("uTime"), time);
      gl.uniform1f(program.uniform("uMotion"), reducedMotion ? 0.3 : 1);
      gl.uniform1f(program.uniform("uGust"), gust.strength);
      gl.uniform1f(program.uniform("uGustFront"), gust.front);
      gl.uniform3fv(program.uniform("uMouse"), mouse);
      gl.uniform1f(program.uniform("uMouseStr"), mouseStrength);
      gl.uniform2fv(program.uniform("uMouseDir"), mouseDir);
      gl.uniform3fv(program.uniform("uMouseFade"), fade);
      gl.uniform2fv(program.uniform("uMouseFadeDir"), fadeDir);
      gl.uniform4fv(program.uniform("uRipple"), rippleUniform);
      gl.uniform3fv(program.uniform("uFairy"), fairy);
      gl.uniform3fv(program.uniform("uFog"), fog);
      setPetalUniforms(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, flowerTex);
      gl.uniform1i(program.uniform("uTex"), 0);
    };

    if (clumpParts.length) {
      setPlantUniforms(clumpProgram);
      // 位置は正規化済み（-1〜1）で届くので、cm へは倍率を掛けるだけ。
      gl.uniform1f(clumpProgram.uniform("uPosScale"), clumpScale);
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      for (const part of clumpParts) {
        gl.uniform1f(clumpProgram.uniform("uHeight"), part.height);
        gl.bindVertexArray(part.vao);
        gl.drawElementsInstanced(
          gl.TRIANGLES,
          part.indexCount,
          gl.UNSIGNED_SHORT,
          part.firstIndex * 2,
          part.count,
        );
      }
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    }

    setPlantUniforms(flowerProgram);
    gl.uniform3fv(flowerProgram.uniform("uStem"), stem);
    gl.uniform1f(flowerProgram.uniform("uAtlas"), useAtlas ? 1 : 0);
    gl.uniform4fv(flowerProgram.uniform("uRects"), ATLAS_FLOWERS);
    // frame() は植える前には描かないので、ここでは花の VAO が必ずある。
    gl.bindVertexArray(flowerVao!);
    gl.drawElementsInstanced(gl.TRIANGLES, 12, gl.UNSIGNED_SHORT, 0, flowerCount);

    // 光は足し算で重ねる。キャンバスは透明なので、アルファも足して空の上に乗せる。
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
    gl.depthMask(false);

    setUniforms(moteProgram);
    gl.uniform1f(moteProgram.uniform("uTime"), time);
    gl.uniform1f(moteProgram.uniform("uMotion"), reducedMotion ? 0.3 : 1);
    gl.uniform1f(moteProgram.uniform("uDensity"), current.motes);
    gl.uniform1f(moteProgram.uniform("uPixel"), pixel);
    gl.uniform3fv(moteProgram.uniform("uColor"), mote);
    gl.bindVertexArray(moteVao);
    gl.drawArrays(gl.POINTS, 0, MOTES);

    setUniforms(wispProgram);
    gl.uniform1f(wispProgram.uniform("uPixel"), pixel);
    gl.uniform1f(wispProgram.uniform("uCount"), current.wisps);
    gl.uniform1f(wispProgram.uniform("uMaxPoint"), maxPoint);
    const lead = introDone
      ? 1
      : mix(GUIDE_LEAD, 1, smoothstep(0.6, 1, flight())) * smoothstep(0, GUIDE_GROW, flight());
    gl.uniform1f(wispProgram.uniform("uLead"), lead);
    gl.uniform3fv(wispProgram.uniform("uColor"), mote);
    gl.bindVertexArray(wispVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, wispBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, wispPos);
    // 開幕の妖精（1つめの光とその尾）は手前の花の中から飛び立つので、手前の葉に隠されないよう、
    // 開幕の間は前後を見ずに重ねる。2つめ・3つめの光は奥を回っているので、いつもどおり前後を見る。
    // TODO(RRNNM-31): 開幕が終わって前後を見るのに戻るフレームで、光の輪と尾が手前の花で急に欠けないか確かめる。
    if (!introDone) gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.POINTS, 0, TRAIL);
    gl.enable(gl.DEPTH_TEST);
    gl.drawArrays(gl.POINTS, TRAIL, (WISPS - 1) * TRAIL);
    gl.bindVertexArray(null);

    if (firstFrame) {
      firstFrame = false;
      options.onFirstFrame({ gaveUp: !useAtlas });
    }

    if (!paused || !settled(target)) {
      frameId = requestAnimationFrame(frame);
    }
  };

  const resume = () => {
    if (frameId || !visible || document.hidden || lost) return;
    last = performance.now();
    // 止まる前に溜めた間隔は捨てる。止まっている間に周りの負荷（別のタブの描画など）が変わっていたら当てにならない。
    intervals.length = 0;
    frameId = requestAnimationFrame(frame);
  };
  // 止めている間に状態が変わったら、色を移すために描き直す。
  new MutationObserver(resume).observe(root, { attributes: true, attributeFilter: ["data-state"] });
  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    resume();
  }).observe(root);
  document.addEventListener("visibilitychange", resume);
  canvas.addEventListener("webglcontextlost", (event) => {
    if (lost) return;
    event.preventDefault();
    lost = true;
    resizeObserver.disconnect();
    options.onLost();
  });

  /**
   * 失敗はすぐ CSS の畑へ戻す。繋ぐのは同期の組み立てが全部終わってから（下の resume() の前）—
   * 途中で投げたとき（ラッパーのスクリプトが受ける）、まだ宣言していない lost などに触れないように。
   */
  const giveUp = () => {
    if (lost) return;
    lost = true;
    resizeObserver.disconnect();
    options.onLost();
    // 上げた素材ごとコンテキストを手放す（lost を先に立てたので、下の webglcontextlost は何もしない）。
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  void linked
    .then(async (ok) => {
      if (!ok) return giveUp();
      await planted;
      if (lost) return;
      ready = true;
      resume();
    })
    .catch(giveUp);

  resume();
  return {
    setPaused: (value) => {
      paused = value;
      // 止めていても色を移すあいだはループが回り続け、上の resume() を通らないので、ここでも捨てる。
      intervals.length = 0;
      // 吹いている途中の風と波紋は、その場で凪がせる（止めたのに花が揺れ続けないように）。
      if (value) {
        mouseStrength = 0;
        for (let i = 0; i < FADE_SLOTS; i++) fade[i * 3 + 2] = 0;
        lastHit = null;
        ripples.length = 0;
      }
      resume();
    },
  };
}
