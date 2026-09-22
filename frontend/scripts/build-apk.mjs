#!/usr/bin/env node
/**
 * Build the Android APK.
 *
 * Wraps the three steps that must happen in order, plus a cleanup that is easy to forget and
 * expensive when missed:
 *
 *     npm run build  →  npx cap sync android  →  gradlew assembleDebug
 *
 * The cleanup is the important part. frontend/public/ holds two generated artifacts:
 *   varnox-app.apk   so the web deploy can serve the in-app "Download app" button
 *   bundles/         the OTA update bundle and its manifest
 *
 * `cap sync` copies ALL of public/ into the Android assets, so without stripping them the APK
 * ships a copy of the previous APK inside itself. That happened once and took the APK from 13 MB
 * to 21.5 MB — 12.4 MB of pure bloat, and the app doesn't need either file: it fetches updates
 * from the web deployment.
 *
 * Usage:  ANDROID_HOME=/path/to/sdk node scripts/build-apk.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });

if (!process.env.ANDROID_HOME) {
  console.error("ANDROID_HOME is not set. Point it at your Android SDK (platform 36 + build-tools 36.0.0).");
  console.error("Gradle also needs a full JDK, not a JRE — see ~/.gradle/gradle.properties.");
  process.exit(1);
}

console.log("\n[1/4] building web assets…");
run("npm run build");

console.log("\n[2/4] syncing into the Android project…");
run("npx cap sync android");

console.log("\n[3/4] stripping generated artifacts from the Android assets…");
const assetDir = path.join(root, "android/app/src/main/assets/public");
for (const name of ["varnox-app.apk", "bundles"]) {
  const target = path.join(assetDir, name);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`  removed ${name}`);
  } else {
    console.log(`  ${name} not present`);
  }
}

console.log("\n[4/4] assembling the APK…");
run("sh gradlew assembleDebug", path.join(root, "android"));

const apk = path.join(root, "android/app/build/outputs/apk/debug/app-debug.apk");
const sizeMb = (fs.statSync(apk).size / 1048576).toFixed(1);

console.log(`\n✓ APK built — ${sizeMb} MB`);
console.log(`  ${apk}`);
console.log("\nTo publish it for the in-app Download button:");
console.log("  cp android/app/build/outputs/apk/debug/app-debug.apk public/varnox-app.apk");
console.log("  cp android/app/build/outputs/apk/debug/app-debug.apk dist/varnox-app.apk");
console.log("  npx vercel --prod\n");
