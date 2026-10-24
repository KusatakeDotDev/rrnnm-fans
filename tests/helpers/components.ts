import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ADR-0018: 未公開のReactコンポーネントもStorybook・同期登録の網羅対象にする。
export const componentPaths = ["src/components", "src/unreleased"]
  .flatMap((dir) => {
    const root = fileURLToPath(new URL(`../../${dir}/`, import.meta.url));
    return existsSync(root)
      ? readdirSync(root, { recursive: true })
          .map(String)
          .filter((name) => name.endsWith(".tsx"))
          .map((name) => `${dir}/${name.replaceAll("\\", "/")}`)
      : [];
  })
  .sort();
export const componentPathByName = Object.fromEntries(
  componentPaths.map((file) => [file.split("/").at(-1)!.slice(0, -4), file]),
);
if (Object.keys(componentPathByName).length !== componentPaths.length)
  throw new Error("コンポーネント名が重複している");
