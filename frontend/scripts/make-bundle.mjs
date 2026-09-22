#!/usr/bin/env node
/**
 * Build an OTA update bundle for the Varnox Android app.
 *
 * Produces two files in public/bundles/:
 *   bundle.zip    the web assets, zipped with index.html at the root
 *   latest.json   the manifest the app polls: { version, url, releasedAt }
 *
 * Both are ordinary static files served by the web deployment, so updates need no third-party
 * service and no extra infrastructure.
 *
 * Usage:  node scripts/make-bundle.mjs 1.0.2
 *
 * The version string is what the app compares against the bundle it is running. Any change to
 * the web app needs a NEW version here, or the app will correctly decide it is already current.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(root, "dist");
const outDir = path.join(root, "public", "bundles");

const version = process.argv[2] || process.env.BUNDLE_VERSION;
if (!version) {
  console.error("usage: node scripts/make-bundle.mjs <version>   e.g. node scripts/make-bundle.mjs 1.0.2");
  process.exit(1);
}

const bundlesUrl =
  process.env.BUNDLES_URL || "https://varnox-web.vercel.app/bundles";

const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });

// 1. Build the web assets.
console.log("\n[1/4] building web assets…");
run("npm run build");

// 2. Zip them. index.html must sit at the ROOT of the archive, so zip from inside dist.
//    - bundles/ is excluded so a bundle never contains a previous bundle, which would make every
//      release larger than the last.
//    - *.apk is excluded because the sideloadable APK is also served from public/; shipping an
//      8 MB installer inside the update bundle would be absurd.
console.log("\n[2/4] packaging bundle.zip…");
fs.mkdirSync(outDir, { recursive: true });
const zipPath = path.join(outDir, "bundle.zip");
fs.rmSync(zipPath, { force: true });
execSync(`zip -qr "${zipPath}" . -x "bundles/*" "*.apk"`, { cwd: dist, stdio: "inherit" });

const sizeKb = Math.round(fs.statSync(zipPath).size / 1024);

// 3. Write the manifest the app polls.
console.log("\n[3/4] writing latest.json…");
const manifest = {
  version,
  url: `${bundlesUrl}/bundle.zip`,
  sizeKb,
  releasedAt: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(outDir, "latest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);

// 4. Rebuild so dist/ also contains the bundle and manifest for deployment. This second pass is
//    needed because public/ is copied into dist/ during the build, and step 2 excluded it.
console.log("\n[4/4] rebuilding so dist/ ships the bundle…");
run("npm run build");

// Sanity-check the archive: index.html must be at the root, not nested.
const listing = execSync(`unzip -l "${zipPath}"`, { encoding: "utf8" });
if (!/^\s*\d+.*\sindex\.html$/m.test(listing)) {
  console.error("\nWARNING: index.html was not found at the root of bundle.zip — the app will reject this bundle.");
  process.exit(1);
}

console.log(`\n✓ bundle ${version} ready (${sizeKb} KB)`);
console.log(`  zip      ${zipPath}`);
console.log(`  manifest ${path.join(outDir, "latest.json")}`);
console.log(`  app will fetch ${manifest.url}\n`);
