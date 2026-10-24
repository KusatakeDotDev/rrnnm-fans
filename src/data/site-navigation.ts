export interface SiteLink {
  href: string;
  label: string;
}
export const PAGE_LINKS: readonly SiteLink[] = [
  { href: "/skeb/", label: "Skeb" },
  { href: "/goods/", label: "グッズ" },
];

/** フッターから辿らせない、おふざけのページ（tests/conformance/routes.spec.ts がフッターの検査から外す）。サイトマップには載る。 */
export const UNLINKED_ROUTES: readonly string[] = ["/kusobaka-slot/"];
