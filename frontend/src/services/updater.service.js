import { Capacitor } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";

// Where new web bundles and the manifest live. Both are ordinary static files served by the web
// deployment itself (/public/bundles), so this needs no third-party account and no extra
// infrastructure — the same Vercel deploy that serves the app serves its updates.
const BUNDLES_BASE =
  import.meta.env.VITE_BUNDLES_URL || "https://varnox-web.vercel.app/bundles";
const MANIFEST_URL = `${BUNDLES_BASE}/latest.json`;

// The sideloadable APK, served by the web deployment itself (frontend/public/varnox-app.apk).
//
// Deliberately NOT a GitHub Release: the repo is private, and assets on a private repo's releases
// require authentication, so the download button would fail for everyone. A static file on the
// public web deployment has no such problem and needs no token.
export const APK_DOWNLOAD_URL =
  import.meta.env.VITE_APK_URL || "https://varnox-web.vercel.app/varnox-app.apk";

export const isNativeApp = () => Capacitor.isNativePlatform();

/**
 * Confirm to the updater that this bundle launched successfully.
 *
 * Capgo treats a missing notifyAppReady() as a failed update and rolls back to the previous
 * bundle, so this must run on every start of the native app. Failure is swallowed on purpose:
 * a broken updater must never stop the app from loading.
 */
export const notifyAppReady = async () => {
  if (!isNativeApp()) return;
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch (err) {
    console.warn("Updater: notifyAppReady failed:", err?.message || err);
  }
};

/** The version string of the bundle currently running. */
export const currentBundleVersion = async () => {
  try {
    const { bundle } = await CapacitorUpdater.current();
    return bundle?.version || null;
  } catch {
    return null;
  }
};

/**
 * Look for a newer web bundle. Returns the manifest plus whether it is actually newer.
 * Cache-busted, because the manifest is a static file and would otherwise be served stale.
 */
export const checkForUpdate = async () => {
  const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Could not reach the update server (HTTP ${res.status})`);
  }

  const manifest = await res.json();
  if (!manifest?.version || !manifest?.url) {
    throw new Error("The update manifest is malformed");
  }

  const current = await currentBundleVersion();

  return {
    version: manifest.version,
    url: manifest.url,
    notes: manifest.notes || null,
    current,
    updateAvailable: manifest.version !== current,
  };
};

/**
 * Download and apply a new bundle.
 *
 * In the browser there is no bundle mechanism — a plain reload with cache bypassing is the
 * equivalent, and it keeps the button meaningful when testing on the web.
 */
export const applyUpdate = async (onProgress) => {
  if (!isNativeApp()) {
    window.location.reload();
    return { updated: true, version: "web-reload" };
  }

  const update = await checkForUpdate();
  if (!update.updateAvailable) {
    return { updated: false, version: update.version };
  }

  let listener = null;
  try {
    listener = await CapacitorUpdater.addListener("download", (info) => {
      onProgress?.(typeof info?.percent === "number" ? info.percent : 0);
    });
  } catch {
    // Progress reporting is a nicety; never let it block the update.
  }

  try {
    const bundle = await CapacitorUpdater.download({
      url: update.url,
      version: update.version,
    });

    // Stage it as the next bundle, then reload so it takes effect.
    await CapacitorUpdater.set({ id: bundle.id });
    await CapacitorUpdater.reload();

    return { updated: true, version: update.version };
  } finally {
    try {
      await listener?.remove?.();
    } catch {
      /* ignore */
    }
  }
};

/** Open the APK download page (browser or system). */
export const openApkDownload = () => {
  window.open(APK_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
};
