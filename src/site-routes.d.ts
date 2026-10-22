declare module 'virtual:site-routes' {
  /** ビルド対象の未公開ルートと照合する。存在しない一般ルートを隠すものではない。 */
  export function isRouteVisible(href: string): boolean;
}
