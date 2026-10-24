import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vite-plus/test';

import NemophilaField, { NemophilaFieldWithSnapshot } from '../../src/components/NemophilaField.tsx';
import { SNAPSHOT_IMAGE_ITEM } from '../../src/components/field-snapshot';

/**
 * 前回の畑の絵を敷くスクリプト（SNAPSHOT_SCRIPT）を出すのは、ラッパー専用の `NemophilaFieldWithSnapshot` だけ。
 *
 * 敷くスクリプトだけが出て、絵を外すラッパーのスクリプト（mountField）が無いと、敷いた絵が残り続ける。
 * Claude Design に同期するのは default export の方なので、そちらは出さない
 * （docs/adr/0011-react-components-for-design-sync.md「スクリプトの扱い」）。
 * ラッパーを通した出力は層3（tests/artifact/build-output.spec.ts）が見る。ここはラッパーを通さない形を、対にして見る。
 */
const render = (component: typeof NemophilaField) =>
  renderToStaticMarkup(createElement(component, { lede: '瑠璃野ねも 非公式ファンサイト' }));

// 敷くスクリプトだけが持つ文。CSS Modules のクラス名には頼らない。保存先の名前はスクリプトと同じところから読む。
const SNAPSHOT = `sessionStorage.getItem('${SNAPSHOT_IMAGE_ITEM}')`;

describe('src/components/NemophilaField.tsx — 前回の絵を敷くスクリプト', () => {
  it('同期する default export は、敷くスクリプトを出さない', () => {
    const html = render(NemophilaField);
    expect(html).not.toContain('<script');
    expect(html).not.toContain(SNAPSHOT);
  });

  it('ラッパー専用の NemophilaFieldWithSnapshot は、root の最初の子に敷くスクリプトを出す', () => {
    const html = render(NemophilaFieldWithSnapshot);
    // root の section の開きタグのすぐ後ろが敷くスクリプト（parentElement で root を取るため）。
    const script = /^<section\b[^>]*\sdata-field=""[^>]*><script>([^<]*)/.exec(html)?.[1];
    expect(script).toContain(SNAPSHOT);
  });
});
