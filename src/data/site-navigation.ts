export interface SiteLink {
  href: string;
  label: string;
}
export const PAGE_LINKS: readonly SiteLink[] = [
  { href: "/skeb/", label: "Skeb" },
  { href: "/goods/", label: "グッズ" },
  { href: "/play/", label: "あそぶ" },
];

/**
 * 一覧のページ。その下の1件ずつのページ（`/play/<slug>/`）はフッターに並べず、一覧から入る（ADR-0015「フッターに一覧のページと単独のページを並べる」）。
 * tests/conformance/routes.spec.ts が、下のページをフッターの検査から外し、一覧のページからリンクしているかを見る。
 */
export const LIST_ROUTES: readonly string[] = ["/play/"];
