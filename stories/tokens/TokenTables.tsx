/**
 * デザイントークンの表（stories/Tokens.mdx が描く）。
 *
 * 表は src/styles/tokens.css を読んで組み立てる。**値を書き写さない** — 色の literal は
 * tokens.css の1箇所にしか無い（docs/DESIGN.md §4 / Issue rurino-nemo-fansite#5）。トークンを足せば表にも自動で出る。
 *
 * src/components に置かない。あそこの .tsx は全部がコンポーネントとして数えられ、story と同期への登録を求められる
 * （tests/repo/story-coverage.test.ts・tests/repo/design-sync.test.ts）。
 */
import { parseCustomProperties, resolve } from '../../src/lib/tokens';
import tokensCss from '../../src/styles/tokens.css?raw';
import styles from './TokenTables.module.css';

const tokens = parseCustomProperties(tokensCss);
const byPrefix = (prefix: string) =>
  [...tokens.keys()]
    .filter((n) => n.startsWith(prefix))
    .map((n) => ({ name: n, raw: tokens.get(n) ?? '', value: resolve(tokens, n) }));

/** パレット。色の literal はここにしか無い。 */
export function Palette() {
  return (
    <table className={styles.tokens}>
      <thead>
        <tr>
          <th scope="col">色</th>
          <th scope="col">トークン</th>
          <th scope="col">値</th>
        </tr>
      </thead>
      <tbody>
        {byPrefix('--c-').map((t) => (
          <tr key={t.name}>
            <td>
              <span className={styles.swatch} style={{ backgroundColor: t.value }} />
            </td>
            <th scope="row">
              <code>{t.name}</code>
            </th>
            <td>
              <code>{t.value}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 役割。コンポーネントが参照するのはこちらで、値はパレットへの参照だけ。 */
export function ColorRoles() {
  return (
    <table className={styles.tokens}>
      <thead>
        <tr>
          <th scope="col">色</th>
          <th scope="col">トークン</th>
          <th scope="col">参照先</th>
        </tr>
      </thead>
      <tbody>
        {byPrefix('--color-').map((t) => (
          <tr key={t.name}>
            <td>
              <span className={styles.swatch} style={{ backgroundColor: t.value }} />
            </td>
            <th scope="row">
              <code>{t.name}</code>
            </th>
            <td>
              <code>{t.raw}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 書体と寸法。 */
export function TypeAndMetrics() {
  const fonts = byPrefix('--font-').map((t) => ({ ...t, sample: 'あのイーハトーヴォのすきとおった風' }));
  const metrics = [...byPrefix('--text-'), ...byPrefix('--leading-'), ...byPrefix('--radius-'), ...byPrefix('--offset-'), ...byPrefix('--tap-'), ...byPrefix('--space-'), ...byPrefix('--anchor-')];
  return (
    <table className={styles.tokens}>
      <thead>
        <tr>
          <th scope="col">トークン</th>
          <th scope="col">値</th>
        </tr>
      </thead>
      <tbody>
        {fonts.map((t) => (
          <tr key={t.name}>
            <th scope="row">
              <code>{t.name}</code>
            </th>
            <td style={{ fontFamily: t.value }}>{t.sample}</td>
          </tr>
        ))}
        {metrics.map((t) => (
          <tr key={t.name}>
            <th scope="row">
              <code>{t.name}</code>
            </th>
            <td>
              <code>{t.value}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
