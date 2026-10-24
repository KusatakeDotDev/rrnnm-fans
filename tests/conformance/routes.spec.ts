import { existsSync } from "node:fs";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { OFFICIAL } from "../../src/data/official";
import { UNLINKED_ROUTES } from "../../src/data/site-navigation";
import { AXE_TAGS, THIRD_PARTY_EMBED } from "../helpers/axe";
import { DIST, builtRoutes } from "../helpers/dist";
import { X_EMBED_PAGES, X_EMBEDS, X_HOST } from "../helpers/x-embed";

/**
 * 全ページにかかる規約。ページを開くのは、ルートごとに1回だけにし、規約はステップで見る
 * （ADR-0027「規約テストは、ルートごとに1本にする」）。ステップは expect.soft で見るので、1つの規約が落ちても、ほかの規約は見続ける。
 * 落ちた規約で待ち続けてテストの時間切れになり、後ろのステップが見られなくならないよう、値は待たずに1回読んでから比べる。
 * 待たないと見られないもの（アクセシブルネーム・押す操作と、押したあとの移動）は、短く切って待つ。演出の始まりを待つのは、ルートごとに1回なので既定の時間のままにする。
 * ルートは書かず、dist に出たページから組む（ADR-0003「層2 — ルートを列挙しない」）。
 */
const quick = expect.configure({ soft: true, timeout: 1_000 });

const NARROW = { width: 360, height: 800 };
/** axe はこの幅で回す。ADR-0003「層の定義」が、コンポーネントの検査の幅と比べている。 */
const WIDE = { width: 1280, height: 720 };
const FOOTER_WIDTHS = [360, 1280];

const UNOFFICIAL = "非公式";

const ACCOUNTS = [
  ["YouTube", OFFICIAL.youtube],
  ["X", OFFICIAL.x],
  ["マシュマロ", OFFICIAL.marshmallow],
  ["BOOTH", OFFICIAL.booth],
  ["Skeb", OFFICIAL.skeb],
] as const;

const hasSkeb = builtRoutes().includes("/skeb/");

// og:* は property に、twitter:* は name に書く（OGP と X のカードの仕様の書き方）。属性を取り違えても気付けるよう、属性ごとに分けて読む。
const readMetas = (page: Page) =>
  page.evaluate(() => {
    const metas = {
      property: {} as Record<string, string[]>,
      name: {} as Record<string, string[]>,
    };
    for (const meta of document.querySelectorAll("meta")) {
      for (const attr of ["property", "name"] as const) {
        const key = meta.getAttribute(attr);
        if (key) (metas[attr][key] ??= []).push(meta.getAttribute("content") ?? "");
      }
    }
    return metas;
  });

/**
 * どちらも、body を縦の flex にした形（src/layouts/Base.astro）が崩れると壊れる。flex をやめるとフッターが中身のすぐ下で止まり、
 * .container の width: 100% を消すと、flex の子のヘッダーが中身の幅に縮んで中央に寄る。トップのヘッダーは畑の上に absolute で
 * 重ねていて flex の子ではないので、それを捕まえるのは下層ページの回。
 * 高さの単位（svh）は見ない。デスクトップの Chrome にはアドレスバーが無く、svh・dvh・vh が同じ値になる。
 */
async function checkLayout(page: Page, width: number): Promise<void> {
  await test.step(`${width}px で、ヘッダーと本文が同じ左右の線に揃う`, async () => {
    const { header, content } = await page.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? { x: rect.x, width: rect.width } : null;
      };
      return { header: box("body > header"), content: box("main > .container") };
    });
    expect.soft(header, "body > header が無い").not.toBeNull();
    expect.soft(content, "main > .container が無い").not.toBeNull();
    if (!header || !content) return;
    expect.soft(header.x).toBeCloseTo(content.x, 0);
    expect.soft(header.width).toBeCloseTo(content.width, 0);
  });

  // どのページも中身が画面より短くなるよう、ビューポートを中身の高さより高くしてから見る。ページの長さを書かずに済む。
  await test.step(`${width}px で、中身が短くてもフッターが画面の下端に付く`, async () => {
    const contentHeight = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.documentElement.scrollHeight;
    });
    await page.setViewportSize({ width, height: contentHeight + 400 });

    const { scrollHeight, viewport, footer } = await page.evaluate(() => {
      const rect = document.querySelector("body > footer")?.getBoundingClientRect();
      return {
        scrollHeight: document.documentElement.scrollHeight,
        viewport: window.innerHeight,
        footer: rect ? { y: rect.y, height: rect.height } : null,
      };
    });
    expect
      .soft(
        scrollHeight,
        "ビューポートを広げたあとに中身が伸び、画面に収まらなかった。ビューポートの高さについて伸びる中身（svh・vh の高さ）があれば、" +
          "余白を足しても収まらないので、その上限を見る。無ければ、足す余白（400）を増やす",
      )
      .toBeLessThanOrEqual(viewport);
    expect.soft(footer, "body > footer が無い").not.toBeNull();
    if (footer) expect.soft(Math.abs(footer.y + footer.height - viewport)).toBeLessThan(1);
  });
}

/** 行頭の点を消したのに role="list" の無い ul・ol の、開きタグ。 */
async function bulletlessListsWithoutRole(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("ul, ol")]
      .filter(
        (list) =>
          getComputedStyle(list).listStyleType === "none" && list.getAttribute("role") !== "list",
      )
      .map((list) => list.outerHTML.slice(0, list.outerHTML.indexOf(">") + 1)),
  );
}

/**
 * X の埋め込み（ADR-0014・ADR-0022 の決定）は、ブラウザが組み立てた DOM で見る。HTML を正規表現で読むと、文字参照（`&#45;` など）や
 * 属性の書き方で、ブラウザと違う読み方になるため。X は止めて開く（playwright.config.ts の BLOCK_EXTERNAL_EMBEDS）ので、見るのは
 * こちらの HTML と、ページのスクリプトが load までに足したもの。
 */
const readXEmbeds = (page: Page) =>
  page.evaluate(
    ({ source, flags }) => {
      const xHost = new RegExp(source, flags);
      const statusId = (href: string) => /\/status(?:es)?\/(\d+)/i.exec(href)?.[1];
      return {
        // widgets.js は class で埋め込みを見つける（ポストの twitter-tweet のほか、タイムラインなども）。こちらの HTML には書かない。
        widgets: [...document.querySelectorAll('[class*="twitter-"]')].flatMap((el) =>
          [...el.classList]
            .filter((name) => name.startsWith("twitter-"))
            .map((name) => `${el.localName}.${name}`),
        ),
        // 埋め込みの置き場所ごとの、ポストへのリンクの ID（ポストの URL でないリンクは ''）。
        boxes: [...document.querySelectorAll("[data-x-post]")].map((box) =>
          [...box.querySelectorAll("a[href]")].map(
            (a) => statusId(a.getAttribute("href") ?? "") ?? "",
          ),
        ),
        tweetIds: [...document.querySelectorAll("[data-tweet-id]")].map(
          (el) => el.getAttribute("data-tweet-id") ?? "",
        ),
        // ポストの ID は、どの要素のどの属性に書いたものも数える（href・cite・SVG の a など）。値は DOM が文字参照を解いたもの。
        attrIds: [...document.querySelectorAll("*")].flatMap((el) =>
          [...el.attributes].flatMap((attr) => statusId(attr.value) ?? []),
        ),
        // X のホストから直に読むもの。widgets.js を通さずに X の iframe を置く形（ポストの ID が `?id=` に入り、class も `/status/` も
        // 無いので、上のどれにも当たらない）と、pbs.twimg.com の画像を直に読む形（転載）。script は tests/artifact/build-output.spec.ts が見る。
        // 読めない URL はブラウザも読みに行かないので飛ばす。
        direct: [
          ...document.querySelectorAll(":not(script)[src], [srcset], object[data], video[poster]"),
        ].flatMap((el) => {
          const values = [
            el.getAttribute("src"),
            el.getAttribute("data"),
            el.getAttribute("poster"),
            ...(el.getAttribute("srcset") ?? "")
              .split(",")
              .map((candidate) => candidate.trim().split(/\s+/)[0]),
          ].filter((value): value is string => typeof value === "string" && value !== "");
          return values.flatMap((value) => {
            try {
              return xHost.test(new URL(value, location.href).hostname)
                ? [`${el.localName}: ${value}`]
                : [];
            } catch {
              return [];
            }
          });
        }),
      };
    },
    { source: X_HOST.source, flags: X_HOST.flags },
  );

for (const route of builtRoutes()) {
  test(`全ページにかかる規約を守っている — ${route}`, async ({ page, request }) => {
    await test.step("検索避けのヘッダー（X-Robots-Tag）を付けて配っていない", async () => {
      // 見るのは、wrangler dev が本番のホストに当てるヘッダー（ADR-0003「E2E のサーバーは `wrangler dev`」）。
      const response = await request.get(route);
      expect
        .soft(response.headers()["x-robots-tag"], `${route} に X-Robots-Tag がある`)
        .toBeUndefined();
    });

    await page.setViewportSize(NARROW);
    await page.goto(route);

    await test.step('ページの言語を日本語（lang="ja"）と示している', async () => {
      expect.soft(await page.evaluate(() => document.documentElement.lang)).toBe("ja");
    });

    // 検索から下層ページに直接来る人が多いので、トップだけでなく全ページで、4箇所すべてに出す。
    await test.step("<title> に「非公式」が入っている", async () => {
      expect.soft(await page.title()).toContain(UNOFFICIAL);
    });

    // og:title も見るのは、カードによっては og:site_name を出さず og:title だけを出すため。画像の中のロゴのラベルは絵なので見ない。
    await test.step("OGP（og:site_name・og:title）に「非公式」が入っている", async () => {
      const metas = await readMetas(page);
      for (const property of ["og:site_name", "og:title"]) {
        expect
          .soft(metas.property[property] ?? [], property)
          .toEqual([expect.stringContaining(UNOFFICIAL)]);
      }
    });

    // robots だけでなく googlebot など個別のクローラ向けの名前も、`none`（noindex, nofollow と同じ）も拾う。
    await test.step("検索避けの meta（noindex・nofollow・none）を置いていない", async () => {
      const blocking = await page
        .locator("meta[name][content]")
        .evaluateAll((metas) =>
          metas
            .filter(
              (m) =>
                /robots|bot/i.test(m.getAttribute("name") ?? "") &&
                /\b(noindex|nofollow|none)\b/i.test(m.getAttribute("content") ?? ""),
            )
            .map((m) => m.outerHTML),
        );
      expect.soft(blocking).toEqual([]);
    });

    // OGP は、崩れても見た目には何も出ず、SNS に貼られて初めて気付く。
    const og =
      await test.step("SNS のカードに要る OGP のタグが1つずつあり、カードは大きい画像の形", async () => {
        const metas = await readMetas(page);
        const one = (key: string): string => {
          const values = (key.startsWith("og:") ? metas.property : metas.name)[key] ?? [];
          expect.soft(values, `${key} が1つでない`).toHaveLength(1);
          expect.soft(values[0]?.trim(), `${key} が空`).toBeTruthy();
          return values[0] ?? "";
        };
        one("og:title");
        one("og:description");
        expect.soft(one("og:type")).toBe("website");
        expect.soft(one("twitter:card")).toBe("summary_large_image");
        return {
          page: one("og:url"),
          image: one("og:image"),
          width: one("og:image:width"),
          height: one("og:image:height"),
        };
      });

    // SNS は相対 URL を読めない。全ページがトップを指す、のような書き間違いも落とす。
    // SNS は画像を URL ごとにキャッシュするので、差し替えのたびに名前を変えられるよう、ファイル名に日付を入れる（src/layouts/og-image.ts）。
    await test.step("og:url がこのページを、og:image が同じホストの日付入りの画像を、絶対 URL で指す", async () => {
      const pageUrl = URL.canParse(og.page) ? new URL(og.page) : null;
      const imageUrl = URL.canParse(og.image) ? new URL(og.image) : null;
      expect.soft(pageUrl, "og:url が絶対 URL でない").not.toBeNull();
      expect.soft(imageUrl, "og:image が絶対 URL でない").not.toBeNull();
      if (!pageUrl || !imageUrl) return;
      expect.soft(pageUrl.protocol).toBe("https:");
      // route は dist のファイル名から作るので、末尾の `/`（404.html と /404/ など）と、文字の符号化（日本語のルート）を揃えてから比べる。
      const trimSlash = (p: string) => p.replace(/\/$/, "");
      expect.soft(trimSlash(decodeURI(pageUrl.pathname))).toBe(trimSlash(route));
      expect
        .soft(imageUrl.origin, "og:image が og:url と別のホストを指している")
        .toBe(pageUrl.origin);
      expect
        .soft(imageUrl.pathname, "og:image のファイル名に日付（.YYYYMMDD.png）が無い")
        .toMatch(/\.\d{8}\.png$/);
    });

    // タグの値は src/layouts/og-image.ts、画像は scripts/generate-og-image.mjs が書いてコミットしたもの。回し忘れると片方だけ古くなる。
    await test.step("og:image の画像が dist にあり、og:image:width・height と大きさが合う", async () => {
      if (!URL.canParse(og.image)) return;
      const imageFile = path.join(DIST, new URL(og.image).pathname);
      expect.soft(existsSync(imageFile), `og:image の ${imageFile} が dist に無い`).toBe(true);
      if (!existsSync(imageFile)) return;
      // 読めないときの例外は soft にならず、テストが止まって後ろのステップが見られなくなるので、soft の失敗に替える。
      const size = await sharp(imageFile)
        .metadata()
        .catch((error: unknown) => String(error));
      expect.soft(typeof size === "string" ? size : "", "og:image の画像が読めない").toBe("");
      if (typeof size === "string") return;
      expect.soft(Number(og.width)).toBe(size.width);
      expect.soft(Number(og.height)).toBe(size.height);
    });

    await test.step("X の埋め込みは、許したページの、許したポストへのリンクだけで、X のホストから直に読むものが無い", async () => {
      const found = await readXEmbeds(page);
      expect.soft(found.direct, "X のホストから直に読むもの").toEqual([]);
      expect.soft(found.widgets, "こちらの HTML に書いた X の埋め込みのコード").toEqual([]);
      if (!X_EMBED_PAGES.includes(route)) {
        expect.soft(found.boxes, "埋め込みの置き場所（data-x-post）").toEqual([]);
        expect.soft(found.tweetIds, "data-tweet-id").toEqual([]);
        return;
      }
      expect
        .soft(found.boxes.length, "埋め込みの置き場所が0件。検査が空振りしている")
        .toBeGreaterThan(0);
      // スクリプトは最初のリンクを oEmbed に渡すので、2本あるとどれが出るか読み取りにくい。
      expect
        .soft(
          found.boxes.filter((ids) => ids.length !== 1 || ids[0] === ""),
          "ポストへのリンクが1本ではない置き場所",
        )
        .toEqual([]);
      // 置き場所の外の属性と data-tweet-id も含めて見る。widgets.js がどの属性からポストを決めるかに、この検査を合わせないため。
      const ids = [...found.attrIds, ...found.tweetIds];
      expect
        .soft(
          ids.filter((id) => !X_EMBEDS[route]!.posts.includes(id)),
          "許していないポスト",
        )
        .toEqual([]);
    });

    // ヘッダーのナビには置かない（ADR-0015「フッターに一覧のページと単独のページを並べる」）。
    await test.step("Skeb のページへのリンクは、出すビルドでフッターに1つだけあり、出さないビルドでは無い", async () => {
      const inFooter = await page
        .locator('a[href="/skeb/"]')
        .evaluateAll((links) => links.map((link) => link.closest("body > footer") !== null));
      expect.soft(inFooter).toEqual(hasSkeb ? [true] : []);
    });

    await checkLayout(page, NARROW.width);
    // 点を消すかどうかは幅で変えられるので、下のステップは狭い幅と広い幅の両方で見る。
    const narrowBulletless = await bulletlessListsWithoutRole(page);

    await page.setViewportSize(WIDE);

    // 第三者の埋め込みの中は見ない（tests/helpers/axe.ts）。X の埋め込みは読ませていないので、埋め込みが出なかったときの表示を見る。
    await test.step("axe の WCAG A・AA（コントラストを含む）に当たらない", async () => {
      const results = await new AxeBuilder({ page })
        .withTags(AXE_TAGS)
        .exclude(THIRD_PARTY_EMBED)
        .analyze();
      expect
        .soft(
          results.violations.map(
            (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" / ")}`,
          ),
        )
        .toEqual([]);
    });

    // axe はこれを違反にしないので、上のステップでは見つからない。
    await test.step('行頭の点を消したリスト（ul・ol）に role="list" を付け、Safari と VoiceOver でもリストとして読ませる', async () => {
      expect
        .soft([...new Set([...narrowBulletless, ...(await bulletlessListsWithoutRole(page))])])
        .toEqual([]);
    });

    // 「非公式」はロゴ画像の中にある（SiteHeader.tsx）。文字としては alt に入るので、見えている画像の alt も数える。
    await test.step("ヘッダーに「非公式」が出ている", async () => {
      const shown = await page.evaluate(() => {
        const header = document.querySelector('body > header, header[role="banner"]');
        if (!header) return "";
        return [
          header.textContent ?? "",
          ...[...header.querySelectorAll("img")]
            .filter((img) => img.checkVisibility())
            .map((img) => img.alt),
        ].join(" ");
      });
      expect.soft(shown).toContain(UNOFFICIAL);
    });

    await test.step("フッターに「非公式」が出ている", async () => {
      const text = await page.evaluate(
        () =>
          document.querySelector('body > footer, footer[role="contentinfo"]')?.textContent ?? "",
      );
      expect.soft(text).toContain(UNOFFICIAL);
    });

    // 弾くのは公認を名乗る語だけ。本人以外（購入した素材の作者など）の許可を書くことがありうるので、「許可」は弾かない。
    // SNS のカードには本文ではなく description や og:* の文が出るので、meta の中身も見る。
    await test.step("本文にも meta にも、「公認」を名乗る表記が無い", async () => {
      const bodyText = await page.locator("body").innerText();
      const metaText = await page
        .locator("meta[content]")
        .evaluateAll((metas) => metas.map((meta) => meta.getAttribute("content")).join("\n"));
      expect.soft(`${bodyText}\n${metaText}`).not.toMatch(/公認|オフィシャルサイト|本人からOK/);
    });

    // アイコンだけだと、このサイト自身の SNS に見える。
    await test.step("フッターに公式アカウントの並びがあり、誰のアカウントかを、見えている見出しと読み上げの名前で言う", async () => {
      const list = page
        .locator("body > footer ul")
        .filter({ has: page.locator(`a[href="${OFFICIAL.youtube}"]`) });
      const count = await list.count();
      expect.soft(count, "公式アカウントの並びが1つでない").toBe(1);
      if (count !== 1) return;
      expect.soft(await list.locator("a[href]").count()).toBe(ACCOUNTS.length);
      await quick(list).toHaveAccessibleName(/\S/);
      const heading = await list.evaluate((ul) => {
        const before = ul.previousElementSibling;
        return (
          before !== null && before.checkVisibility() && (before.textContent ?? "").trim() !== ""
        );
      });
      expect.soft(heading, "並びの直前に、見えている見出しが無い").toBe(true);
    });

    // 公式のアカウントそのものではなく中継ページを挟むと、1クリックではなくなる。
    for (const [name, href] of ACCOUNTS) {
      await test.step(`フッターから ${name} へ1クリックで行け、新しいタブで開く`, async () => {
        const link = page.locator(`body > footer a[href="${href}"]`);
        const count = await link.count();
        expect.soft(count, `${href} へのリンクが1つでない`).toBe(1);
        if (count !== 1) return;
        expect.soft(await link.isVisible(), `${href} へのリンクが見えていない`).toBe(true);
        const found = await link.evaluate((a) => ({
          target: a.getAttribute("target"),
          rel: a.getAttribute("rel"),
          icons: [...a.querySelectorAll("img")].map((img) => ({
            alt: img.alt,
            drawn: img.complete && img.naturalWidth > 0,
          })),
        }));
        expect.soft(found.target, "target").toBe("_blank");
        expect.soft(found.rel, "rel").toBe("noopener noreferrer");
        expect.soft(found.icons.length, "アイコンが1つでない").toBe(1);
        const [icon] = found.icons;
        if (found.icons.length !== 1 || !icon) return;
        // アイコンだけのリンクなので、名前は画像の alt から来る。新しいタブで開くことは、そのあとの補足で読み上げる。
        expect.soft(icon.alt, "アイコンの alt が空").not.toBe("");
        await quick(link).toHaveAccessibleName(
          new RegExp(`^${icon.alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.+`),
        );
        // 名前は alt から来るので、画像のパスを間違えて 404 になっても上は通る。アイコンは lazy にしていない（SiteFooter.tsx）ので、
        // load を待って開いた時点で、描ける画像が届いたかは決まっている。
        expect.soft(icon.drawn, "描ける画像が届いていない").toBe(true);
      });
    }

    const contactPath =
      await test.step("フッターの「お問い合わせ」が見えていて、ビルドしたページの節を指す", async () => {
        const link = page
          .locator("body > footer")
          .getByRole("link", { name: "お問い合わせ", exact: true });
        const count = await link.count();
        expect.soft(count, "「お問い合わせ」のリンクが1つでない").toBe(1);
        if (count !== 1) return null;
        expect.soft(await link.isVisible(), "「お問い合わせ」が見えていない").toBe(true);
        const url = new URL((await link.getAttribute("href")) ?? "", page.url());
        expect.soft(url.hash, "節を指していない").not.toBe("");
        expect
          .soft(builtRoutes(), "行き先のページがビルドに無い")
          .toContain(decodeURI(url.pathname));
        return decodeURI(url.pathname);
      });
    // フッターは全ページで同じなので、押して移る検査とフッターだけの検査は、「お問い合わせ」の行き先のページでだけ見る。
    // そのページでなら、押してもページを開き直さない（同じページの中の移動）。
    const onContactPage = contactPath === route;

    if (onContactPage) {
      await test.step("フッターが、axe の全ルールに当たらない", async () => {
        const results = await new AxeBuilder({ page }).include("body > footer").analyze();
        expect
          .soft(
            results.violations.map(
              (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" / ")}`,
            ),
          )
          .toEqual([]);
      });
    }

    await checkLayout(page, WIDE.width);

    if (onContactPage) {
      // マウスで押したあとは、.focus() で当てたリンクに :focus-visible が当たらないので、フッターのキーボードの検査を先に回す。
      // 期待値を PAGE_LINKS（フッターに渡すリンクを作るもの）から作ると、そこに足し忘れても通る（RRNNM-63）。
      await test.step("フッターのページへのリンクが、ビルドしたページ（UNLINKED_ROUTES を除く）と過不足なくそろう", async () => {
        const paths = await page.locator("body > footer a[href]").evaluateAll((links) =>
          links
            .map((link) => link.getAttribute("href") ?? "")
            // `#` だけの href と空の href は、URL にすると今のページを指して数えられてしまうので、その前に外す。
            .filter((href) => href !== "" && !href.includes("#"))
            .map((href) => new URL(href, location.href))
            .filter((url) => url.origin === location.origin)
            .map((url) => decodeURI(url.pathname)),
        );
        expect.soft(paths.sort()).toEqual(
          builtRoutes()
            .filter((built) => !UNLINKED_ROUTES.includes(built))
            .sort(),
        );
        // 外す一覧に、もう無いページが残ると、同じパスでページを作り直したときにフッターの検査から黙って外れる。
        expect
          .soft(
            UNLINKED_ROUTES.filter((unlinked) => !builtRoutes().includes(unlinked)),
            "ビルドに無い、フッターから外すページ",
          )
          .toEqual([]);
      });

      for (const width of FOOTER_WIDTHS) {
        await test.step(`${width}px で、フッターのリンクを Tab で順にたどれ、どれも 44px 四方以上で、フォーカスが見える`, async () => {
          await page.setViewportSize({ width, height: 900 });
          const links = page.locator("body > footer").getByRole("link");
          const count = await links.count();
          // getByRole は見えていないリンクを数えないので、この幅で並びごと消えても、残ったリンクだけで通ってしまう。
          expect
            .soft(count, "この幅で見えていないフッターのリンクがある")
            .toBe(await page.locator("body > footer a[href]").count());
          if (count === 0) return;
          await links.first().focus();
          const visits: { index: number; width: number; height: number; outline: string }[] = [];
          for (let i = 0; i < count; i++) {
            visits.push(
              await page.evaluate(() => {
                const focused = document.activeElement as HTMLElement;
                const box = focused.getBoundingClientRect();
                return {
                  index: [...document.querySelectorAll("body > footer a[href]")].indexOf(focused),
                  width: box.width,
                  height: box.height,
                  outline: getComputedStyle(focused).outlineStyle,
                };
              }),
            );
            await page.keyboard.press("Tab");
          }
          expect
            .soft(
              visits.map((visit) => visit.index),
              "Tab でたどったリンクの順",
            )
            .toEqual([...Array(count).keys()]);
          expect
            .soft(
              visits.filter((visit) => visit.width < 44 || visit.height < 44),
              "44px 四方に足りないリンク",
            )
            .toEqual([]);
          expect
            .soft(
              visits.filter((visit) => visit.outline === "none"),
              "フォーカスが見えないリンク",
            )
            .toEqual([]);
        });

        await test.step(`${width}px で、ページが横にはみ出さない`, async () => {
          expect
            .soft(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
              ),
            )
            .toBe(true);
        });
      }

      // 窓口は制作者の X（src/data/contact.ts）で、連絡先を書くのはこのページだけ。相手が DM を受け取れる設定かは、人が見る。
      await test.step("「お問い合わせ」を押すと、制作者の X へのリンクがある節へ飛ぶ", async () => {
        // 押せないときの例外は soft にならないので、ほかのステップと同じく soft の失敗に替える。
        const contact = page
          .locator("body > footer")
          .getByRole("link", { name: "お問い合わせ", exact: true });
        const clickError = await contact.click({ timeout: 2_000 }).then(
          () => "",
          (error: unknown) => String(error),
        );
        expect.soft(clickError, "「お問い合わせ」を押せない").toBe("");
        if (clickError) return;
        // 飛んだ先の見出し（:target）を持つ節。
        const section = page.locator("section:has(> :target)");
        await quick(section).toHaveCount(1);
        const link = section.getByRole("link");
        const count = await link.count();
        expect.soft(count, "節のリンクが1つでない").toBe(1);
        if (count !== 1) return;
        expect.soft(await link.isVisible(), "節のリンクが見えていない").toBe(true);
        const href = (await link.getAttribute("href")) ?? "";
        expect.soft(href).toMatch(/^https:\/\/x\.com\/[^/]+$/);
        // 制作者の X と本人の X を取り違えていないこと（上の正規表現は本人の X も通す）。
        expect.soft(href).not.toBe(OFFICIAL.x);
      });
    }
  });
}
