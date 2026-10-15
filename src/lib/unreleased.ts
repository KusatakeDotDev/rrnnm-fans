export type AstroCommand = 'dev' | 'build' | 'preview' | 'sync';

/** 1・0 以外をどちらにも倒さないのは、値の読み違いで未公開のものを本番に出さないため（ADR-0018「本番に漏らしていないことを、配る前に確かめる」）。 */
export function parseShowUnreleased(value: string | undefined, command: AstroCommand): boolean {
  if (value === undefined) return command === 'dev';
  if (value === '1') return true;
  if (value === '0') return false;
  throw new Error(`SHOW_UNRELEASED は 1 か 0 で指定する（受け取った値: ${JSON.stringify(value)}）`);
}

/** src/pages/ へ移しても同じルートになるよう、index と、`_`・`.` で始まるファイルの扱いを、Astro のファイルのルーティングに合わせる。 */
export function unreleasedRoute(file: string): string | null {
  const segments = file.split('/');
  if (segments.some((segment) => segment.startsWith('_'))) return null;
  const name = segments.pop()!;
  if (name.startsWith('.')) return null;
  // 黙って見逃すと、src/pages/ へ移したときに Astro がエンドポイントや .well-known として扱い、動きが変わるため。
  if (segments.some((segment) => segment.startsWith('.')) || !name.endsWith('.astro')) {
    throw new Error(`src/unreleased/ でルートにできるのは .astro だけ（${file}）。ページでないものは _ で始まるディレクトリに置く`);
  }
  // オフのビルドでは動的ルートが作るパスが分からず、本番の dist に残っていないかを確かめられないため。
  if (file.includes('[')) throw new Error(`src/unreleased/ に動的ルートは置けない（${file}）`);
  const page = name.slice(0, -'.astro'.length);
  if (page !== 'index') segments.push(page);
  return `/${segments.join('/')}`;
}

/** Vite のモジュールの ID はクエリが付き、Windows でも区切りが `/` で、ドライブ文字の大小が揃わない。 */
const normalize = (id: string) =>
  id
    .split('?')[0]!
    .replaceAll('\\', '/')
    .replace(/^[a-z]:/, (drive) => drive.toUpperCase());

export function isInside(dir: string, id: string): boolean {
  const base = normalize(dir);
  return normalize(id).startsWith(base.endsWith('/') ? base : `${base}/`);
}
