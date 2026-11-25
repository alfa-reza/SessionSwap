import { cp, mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { build } from "esbuild";

const rootDir = path.resolve(import.meta.dir, "..");
const popupSrc = path.join(rootDir, "src", "popup");
const assetsDir = path.join(rootDir, "src", "assets");
const distDir = path.join(rootDir, "dist");
const popupDist = path.join(distDir, "popup");

const target = Bun.argv[2];
if (target !== "firefox" && target !== "chrome") {
  console.error("❌ Please specify a target: 'firefox' or 'chrome'");
  process.exit(1);
}

console.log(`Building SessionSwap Extension for ${target}...`);

await rm(distDir, { recursive: true, force: true });
await mkdir(path.join(distDir, "background"), { recursive: true });
await mkdir(popupDist, { recursive: true });

await build({
  entryPoints: {
    "background/index": path.join(rootDir, "src/background/index.ts"),
    "popup/index": path.join(rootDir, "src/popup/index.ts"),
  },
  bundle: true,
  outdir: distDir,
  platform: "browser",
  target: "firefox109",
  format: "iife",
  minify: false,
  sourcemap: false,
});

const baseManifest = JSON.parse(await readFile(path.join(rootDir, "src/manifest.json"), "utf8"));
const manifest =
  target === "firefox"
    ? {
        ...baseManifest,
        background: { scripts: ["background/index.js"] },
        browser_specific_settings: {
          gecko: {
            id: "session-switcher@fanesp.online",
            strict_min_version: "109.0",
          },
        },
      }
    : {
        ...baseManifest,
        background: { service_worker: "background/index.js" },
      };

await writeFile(path.join(distDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const popupFiles = await readdir(popupSrc);
await Promise.all(
  popupFiles
    .filter((file) => file.endsWith(".html") || file.endsWith(".css"))
    .map((file) => cp(path.join(popupSrc, file), path.join(popupDist, file)))
);

await cp(assetsDir, path.join(distDir, "assets"), { recursive: true });

console.log("✅ Build complete! Extension files are in ./dist/");
