import { createRequire } from "node:module";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type { Plugin } from "vite";

export const EXCALIDRAW_ASSET_PREFIX = "/excalidraw-assets/";

interface ExcalidrawAsset {
  fileName: string;
  source: Uint8Array;
}

function resolveExcalidrawProductionDirectory() {
  const require = createRequire(import.meta.url);
  const packageEntry = require.resolve("@excalidraw/excalidraw");
  return resolve(dirname(packageEntry), "../prod");
}

async function visitFontFiles(
  directory: string,
  fontRoot: string,
  assets: ExcalidrawAsset[]
) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await visitFontFiles(entryPath, fontRoot, assets);
      continue;
    }
    if (!entry.isFile() || extname(entry.name) !== ".woff2") continue;

    const fontPath = relative(fontRoot, entryPath).split(sep).join("/");
    assets.push({
      fileName: `excalidraw-assets/fonts/${fontPath}`,
      source: await readFile(entryPath),
    });
  }
}

export async function collectExcalidrawFontAssets(
  productionDirectory = resolveExcalidrawProductionDirectory()
): Promise<ExcalidrawAsset[]> {
  const fontRoot = resolve(productionDirectory, "fonts");
  const assets: ExcalidrawAsset[] = [];
  await visitFontFiles(fontRoot, fontRoot, assets);
  return assets;
}

function isSafeAssetPath(path: string) {
  return (
    path.startsWith("fonts/") &&
    path.endsWith(".woff2") &&
    !path.includes("..") &&
    !path.includes("\\")
  );
}

export function excalidrawAssetsPlugin(): Plugin {
  const productionDirectory = resolveExcalidrawProductionDirectory();
  let isProductionBuild = false;

  return {
    name: "cacp-excalidraw-assets",
    configResolved(config) {
      isProductionBuild = config.command === "build";
    },
    async buildStart() {
      if (!isProductionBuild) return;
      const assets = await collectExcalidrawFontAssets(productionDirectory);
      for (const asset of assets) {
        this.emitFile({ type: "asset", ...asset });
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = request.url;
        if (!requestUrl) return next();

        const pathname = new URL(requestUrl, "http://localhost").pathname;
        if (!pathname.startsWith(EXCALIDRAW_ASSET_PREFIX)) return next();

        const assetPath = decodeURIComponent(
          pathname.slice(EXCALIDRAW_ASSET_PREFIX.length)
        );
        if (!isSafeAssetPath(assetPath)) {
          response.statusCode = 404;
          response.end();
          return;
        }

        void readFile(resolve(productionDirectory, assetPath))
          .then((source) => {
            response.statusCode = 200;
            response.setHeader("Content-Type", "font/woff2");
            response.setHeader("Cache-Control", "public, max-age=31536000");
            response.end(source);
          })
          .catch(() => next());
      });
    },
  };
}
