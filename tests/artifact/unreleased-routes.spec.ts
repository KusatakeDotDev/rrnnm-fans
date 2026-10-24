import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { unreleasedRoute } from "../../src/lib/unreleased";
import { builtPages, DIST, distTextFiles } from "../helpers/dist";

/**
 * 配る dist に、src/unreleased/ のページが、ビルドの記録どおりに入っている・入っていないこと。
 * pnpm test:release で本番の dist（オフ）にも掛かり、配る前に止める。
 */
const UNRELEASED = fileURLToPath(new URL("../../src/unreleased/", import.meta.url));
const ORIGIN = "https://rrnnm.fans";

const routes = existsSync(UNRELEASED)
  ? readdirSync(UNRELEASED, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .flatMap((entry) => {
        const route = unreleasedRoute(
          path
            .relative(UNRELEASED, path.join(entry.parentPath, entry.name))
            .split(path.sep)
            .join("/"),
        );
        return route === null ? [] : [route];
      })
  : [];

/** sitemap の文字データと HTML の属性値は、文字参照を戻してから URL として読む（tests/artifact/sitemap.spec.ts と同じ）。 */
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (text: string) =>
  text.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi,
    (_, dec?: string, hex?: string, name?: string) =>
      dec
        ? String.fromCodePoint(Number(dec))
        : hex
          ? String.fromCodePoint(parseInt(hex, 16))
          : NAMED[name!.toLowerCase()]!,
  );

/** 相対リンクも行き先で比べるよう、置かれたページを基準に解決する。サイトの外を指すものは null。 */
const sitePath = (url: string, from = "/") => {
  const resolved = new URL(url, new URL(from, ORIGIN));
  return resolved.origin === ORIGIN ? decodeURI(resolved.pathname) : null;
};

/** ルートは末尾に / を付けずに作り、ビルドしたページの URL は / で終わるので、末尾の / は比べない。 */
const sameRoute = (route: string, sitePathname: string | null) =>
  sitePathname !== null && sitePathname.replace(/(.)\/$/, "$1") === route;

const showUnreleased = (): boolean => {
  const receipt = JSON.parse(readFileSync(`${DIST}.receipt.json`, "utf8")) as {
    showUnreleased?: unknown;
  };
  expect(typeof receipt.showUnreleased, "ビルドの記録に showUnreleased が無い").toBe("boolean");
  return receipt.showUnreleased as boolean;
};

test.describe("ADR-0018「本番に漏らしていないことを、配る前に確かめる」", () => {
  test("オフの dist には、未公開のページも、sitemap の項目も、そこへのリンクも無い", () => {
    test.skip(showUnreleased(), "オンのビルド");
    const pages = builtPages();
    const locs = distTextFiles()
      .filter(({ rel }) => /^sitemap-\d+\.xml$/.test(rel))
      .flatMap(({ text }) =>
        [...text.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => unescape(m[1]!.trim())),
      );
    const hrefs = pages.flatMap(({ route, file }) =>
      [...readFileSync(file, "utf8").matchAll(/\shref=(["'])(.*?)\1/g)].map((m) => ({
        route,
        href: unescape(m[2]!),
      })),
    );
    for (const route of routes) {
      const hit = (url: string, from?: string) => sameRoute(route, sitePath(url, from));
      expect(
        pages.filter((page) => hit(page.route)).map((page) => page.route),
        `${route} のページ`,
      ).toEqual([]);
      expect(
        locs.filter((loc) => hit(loc)),
        `${route} の sitemap の項目`,
      ).toEqual([]);
      expect(
        hrefs.filter(({ route: from, href }) => hit(href, from)),
        `${route} へのリンク`,
      ).toEqual([]);
    }
  });

  test("オンの dist には、未公開のページがある", () => {
    test.skip(!showUnreleased(), "オフのビルド");
    const built = builtPages().map(({ route }) => route);
    for (const route of routes) {
      expect(
        built.some((b) => sameRoute(route, b)),
        `${route} のページ`,
      ).toBe(true);
    }
  });
});
