export const SKEB_PROFILE_URL = 'https://skeb.jp/@rurino_nemo';

export type SkebWork = {
  id: string;
  title: string;
  url: `https://skeb.jp/@rurino_nemo/works/${number}`;
  nemoRole: 'creator';
  category: 'voice';
  creator: '瑠璃野ねも';
  updated: string;
  sources: [{ kind: 'user-provided'; url: string; provided: string }];
  confidence: 'secondary';
  availability: 'user-confirmed';
  tags: string[];
  summaryScope?: 'selected-audio';
  /** ご本人が X に出した納品のポスト。`video` は、試聴の動画が付いているか。 */
  deliveryPost?: { url: `https://x.com/rurino_nemo/status/${string}`; video: boolean };
  /** ご本人が YouTube に上げ直した動画。 */
  youtube?: `https://www.youtube.com/watch?v=${string}`;
};

// URL と役割、リンク先で聴けること、納品のポストと YouTube の URL は運営者からの情報（docs/OPERATIONS.md「Skeb の作品リンク」）。
// 納品のポストは、X の埋め込みを許すポスト（tests/helpers/x-embed.ts）にも同じ ID を書く。
const DELIVERY_POSTS: Readonly<Record<number, { id: string; video: boolean }>> = {
  1: { id: '1420022175256489992', video: false },
  3: { id: '1638130119385686016', video: true },
  4: { id: '1638910012822257664', video: true },
  5: { id: '1638910720111968257', video: true },
  6: { id: '1639293743227604992', video: true },
  7: { id: '1639296086262308864', video: true },
  8: { id: '1760689029820174460', video: true },
  9: { id: '1760689870878765366', video: true },
  10: { id: '1760690096574239180', video: true },
  11: { id: '1772639381423022579', video: true },
  12: { id: '1772640132392202415', video: true },
  13: { id: '1772640668499820765', video: true },
};

const YOUTUBE: Readonly<Record<number, string>> = {
  1: 'TSWyQSkRxs8',
};

export const SKEB_WORKS: readonly SkebWork[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
].map((number): SkebWork => {
  const url = `https://skeb.jp/@rurino_nemo/works/${number}` as const;
  const post = DELIVERY_POSTS[number];
  const video = YOUTUBE[number];
  return {
    id: `rurino_nemo-${number}`,
    title: `ボイス作品 #${number}`,
    url,
    nemoRole: 'creator',
    category: 'voice',
    creator: '瑠璃野ねも',
    updated: '2026-10-12',
    sources: [{ kind: 'user-provided', url, provided: '2026-10-12' }],
    confidence: 'secondary',
    availability: 'user-confirmed',
    tags: [],
    ...([9, 11].includes(number) ? { summaryScope: 'selected-audio' as const } : {}),
    ...(post ? { deliveryPost: { url: `https://x.com/rurino_nemo/status/${post.id}` as const, video: post.video } } : {}),
    ...(video ? { youtube: `https://www.youtube.com/watch?v=${video}` as const } : {}),
  };
});
