export interface SiteLink {
  href: string;
  label: string;
}
export const PAGE_LINKS: readonly SiteLink[] = [
  { href: "/skeb/", label: "Skeb" },
  { href: "/goods/", label: "グッズ" },
  { href: "/play/", label: "ミニゲーム" },
  { href: "/notify/", label: "通知" },
];

/**
 * 一覧のページ。その下の1件ずつのページ（`/play/<slug>/`）はフッターに並べず、一覧から入る（ADR-0015「フッターに一覧のページと単独のページを並べる」）。
 * tests/conformance/routes.spec.ts が、下のページをフッターの検査から外し、一覧のページからリンクしているかを見る。
 */
export const LIST_ROUTES: readonly string[] = ["/play/"];

/**
 * 本番に出すが、どこからもリンクせず、サイトマップにも載せないページ。パスを知っている主だけが、本番で確かめるため
 * （ADR-0035「公開の前に、本物の push で確かめる」）。リンクは src/integrations/unreleased.ts が、未公開のページと同じく外す。
 * TODO(RRNNM-118): 通知を公開するときに、ここから外す。
 */
export const UNLINKED_ROUTES: readonly string[] = ["/notify/"];
