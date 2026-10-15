import type { CSSProperties } from 'react';

// story のラッパー（.on-paper・.on-ground の div）に当てる余白と並べ方。
// story ごとに同じ値を書くと、余白を変えるときに直し漏れた story だけずれる。

/** ラッパーの内側の余白。 */
export const pad = '1.5rem';

/** 縦に積む見本。幅は 36rem で止める。 */
export const column = { padding: pad, maxWidth: '36rem' } satisfies CSSProperties;

/** 大きさや色の違いを横に並べる見本。 */
export const row = { display: 'flex', alignItems: 'center', gap: '1.25rem', padding: pad } satisfies CSSProperties;
