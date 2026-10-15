import { expect, test } from '@playwright/test';

/**
 * src/components/NemophilaField.module.css の登場の演出（copy-in）と、動きを減らす設定で止めるルール。
 *
 * 畑のキャッチと添え書きは、ぼかしから出てくる。動きを減らす設定では止めて、最初から見せる。
 * 止めるルールは、演出を付けるルール（`.copy > *`）と同じ詳細度で後ろに書いて勝たせている。
 * 演出の側のセレクタを強くすると、止める側が黙って負ける（以前 `.copy > *` が `.copy > :not(.lede)` に負け、
 * 見出しが透明から出ていた）。
 *
 * 設定が無いときに演出が付いていることも見る。付いていなければ、止まっているかを見ても意味が無い。
 * 演出の名前は CSS Modules でビルドごとに変わるので、`none` かどうかだけを見る。
 */
for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`畑のキャッチと添え書きの登場の演出 — prefers-reduced-motion: ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/');

    const animations = await page
      .locator('[data-field] h1, [data-field] h1 ~ p')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));

    expect(animations).toHaveLength(2);
    if (reducedMotion === 'reduce') {
      expect(animations).toEqual(['none', 'none']);
    } else {
      expect(animations).not.toContain('none');
    }
  });
}
