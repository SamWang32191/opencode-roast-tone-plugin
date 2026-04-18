import { transformAsync } from "@babel/core";
import ts from "@babel/preset-typescript";
import solid from "babel-preset-solid";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(rootDir);
const srcDir = join(projectDir, "src");
const distDir = join(projectDir, "dist");

const stripJsxImportSourcePragma = (source) => {
  return source.replace(/^\/\*\*\s*@jsxImportSource[^\n]*\n/u, "");
};

const collectSourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(path)));
      continue;
    }

    if (entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
};

const transformFile = async (filePath) => {
  const source = stripJsxImportSourcePragma(await readFile(filePath, "utf8"));
  const extension = extname(filePath);
  const result = await transformAsync(source, {
    filename: filePath,
    babelrc: false,
    configFile: false,
    presets:
      extension === ".tsx"
        ? [
            [
              solid,
              {
                moduleName: "@opentui/solid",
                generate: "universal",
              },
            ],
            [ts],
          ]
        : [[ts]],
  });

  if (!result?.code) {
    throw new Error(`Failed to transform ${relative(projectDir, filePath)}`);
  }

  const outputPath = join(distDir, relative(srcDir, filePath)).replace(/\.(ts|tsx)$/u, ".js");

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${result.code}\n`, "utf8");
};

await rm(distDir, { recursive: true, force: true });

for (const filePath of await collectSourceFiles(srcDir)) {
  await transformFile(filePath);
}
