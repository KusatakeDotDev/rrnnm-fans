/**
 * 配信をとじろ（src/unreleased/play/alt-f4.astro）の BGM。ゲームの外に置いたボタンで鳴らし・止め、スライダーで大きさを変える。
 * 曲は魔王魂の素材で、非公開のリポジトリから重ね、重ねていなければ無音を鳴らす（ADR-0034 の決定）。
 */
// 本物を重ねたビルドでは取りに行かないので、ページの JS に埋め込まず、別のファイルにする。
import silent from "../../../assets/alt-f4-bgm-silent.mp3?no-inline";
import { bgmGain, parseBgmLevel } from "../../../lib/alt-f4";

const tracks = import.meta.glob<string>("../../../assets/alt-f4/maou_14_shining_star.m4a", {
  eager: true,
  import: "default",
});
const LEVEL_ITEM = "alt-f4-bgm-level";

export function setUpBgm(root: HTMLElement): void {
  const toggle = root.querySelector<HTMLButtonElement>("[data-altf4-bgm-toggle]")!;
  const slider = root.querySelector<HTMLInputElement>("[data-altf4-bgm-volume]")!;
  const audio = document.createElement("audio");
  audio.loop = true;
  root.append(audio);
  let context: AudioContext | undefined;
  let gain: GainNode | undefined;

  function applyLevel(): void {
    const value = bgmGain(Number(slider.value));
    if (gain) gain.gain.value = value;
    else audio.volume = value;
  }

  // iOS の Safari は audio の volume を読まずに最大の大きさで鳴らすので、GainNode を通して大きさを変える。
  // iOS の Safari は、押した処理の中で作るか再開した AudioContext でないと音を出さない。
  function connect(): void {
    if (context) {
      if (context.state !== "running") context.resume().catch(() => {});
      return;
    }
    try {
      const created = new AudioContext();
      const node = created.createGain();
      created.createMediaElementSource(audio).connect(node).connect(created.destination);
      context = created;
      gain = node;
      audio.volume = 1;
    } catch {
      // AudioContext を作れないブラウザでは、audio の volume で変える。
    }
    applyLevel();
  }

  toggle.addEventListener("click", () => {
    if (!audio.paused) {
      audio.pause();
      return;
    }
    // 鳴らす人だけが曲の重さを払うよう、押すまで取りに行かない。
    if (!audio.src) audio.src = Object.values(tracks)[0] ?? silent;
    connect();
    audio.play().catch(() => audio.pause());
  });
  // 止まるのは、このボタンを押したときだけではない（メディアキー、iOS でほかのアプリへ移ったときなど）。
  audio.addEventListener("play", () => toggle.setAttribute("aria-pressed", "true"));
  audio.addEventListener("pause", () => toggle.setAttribute("aria-pressed", "false"));

  slider.addEventListener("input", () => {
    applyLevel();
    try {
      localStorage.setItem(LEVEL_ITEM, slider.value);
    } catch {
      // 覚えられなくても、今の大きさはそのまま効く。
    }
  });

  // 保存先が使えないとき（ブラウザでサイトのデータを止めているなど）は、覚えずに、初めの大きさから始める。
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LEVEL_ITEM);
  } catch {
    stored = null;
  }
  slider.value = String(parseBgmLevel(stored));
  applyLevel();
  toggle.disabled = false;
  slider.disabled = false;
}
