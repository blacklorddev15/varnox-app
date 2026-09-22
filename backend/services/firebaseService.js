const path = require("path");
const fs = require("fs");

// ---------------------------------------------------------------------------------------
// firebase-admin is loaded LAZILY, never at module load. This is deliberate and load-bearing.
//
// firebase-admin -> jwks-rsa -> jose@6, which is ESM-only. Vercel's Node runtime compiles
// handlers to bytecode and does not support require()-ing an ES module, so an eager require
// crashed the process on EVERY invocation:
//
//   Error [ERR_REQUIRE_ESM]: require() of ES Module /var/task/node_modules/jose/dist/webapi/index.js
//   from /var/task/node_modules/jwks-rsa/src/utils.js not supported
//   Node.js process exited with exit status: 1.
//
// Firebase is optional here - it only powers phone-token verification, and this app uses
// email/SMS OTP. A deployment with no Firebase credentials now never pulls the dependency in.
//
// NOTE: if you later add Firebase credentials, keep this lazy require. Requiring
// firebase-admin eagerly will reintroduce the crash on Vercel.
// ---------------------------------------------------------------------------------------
let adminApp = null;
let adminAuth = null;

const loadAdmin = () => {
  if (!adminApp) {
    adminApp = require("firebase-admin/app");
    adminAuth = require("firebase-admin/auth");
  }
  return { app: adminApp, auth: adminAuth };
};

let isInitialized = false;

const serviceAccountCandidates = () => {
  const configured = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : null;
  return [
    configured,
    path.resolve(__dirname, "../config/firebase-service-account.json"),
    path.resolve(__dirname, "../config/firebase-service-account.json.json"),
  ].filter(Boolean);
};

// True when there is any plausible way to authenticate. Checked WITHOUT loading firebase-admin.
const isFirebaseConfigured = () => {
  if (serviceAccountCandidates().some((p) => fs.existsSync(p))) return true;
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
  );
};

const initFirebase = () => {
  if (isInitialized) return true;

  if (!isFirebaseConfigured()) {
    console.log(
      "ℹ️ [Firebase] No credentials configured — phone-token verification is disabled. (firebase-admin is not loaded.)"
    );
    return false;
  }

  try {
    const { app: admin } = loadAdmin();
    const { getApps, initializeApp, cert } = admin;

    if (getApps().length > 0) {
      isInitialized = true;
      return true;
    }

    const filePath = serviceAccountCandidates().find((p) => fs.existsSync(p));
    if (filePath) {
      const serviceAccount = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      initializeApp({ credential: cert(serviceAccount) });
      isInitialized = true;
      console.log("✅ Firebase Admin initialized from service account file");
      return true;
    }

    let privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
    isInitialized = true;
    console.log("✅ Firebase Admin initialized from environment variables");
    return true;
  } catch (error) {
    console.error("❌ Failed to initialize Firebase Admin:", error.message);
    return false;
  }
};

// Verify a Firebase ID token from the client.
const verifyFirebaseToken = async (idToken) => {
  if (!isInitialized && !initFirebase()) {
    throw new Error(
      "Firebase Admin is not configured. Add firebase-service-account.json to backend/config/, or set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY."
    );
  }

  try {
    const { auth } = loadAdmin();
    return await auth.getAuth().verifyIdToken(idToken);
  } catch (error) {
    console.error("Firebase token verification error:", error.message);
    throw new Error("Invalid or expired Firebase ID token");
  }
};

// Preserves the original export surface without forcing the dependency to load.
const getAuth = (...args) => {
  const { auth } = loadAdmin();
  return auth.getAuth(...args);
};

// Safe at import time: returns early without touching firebase-admin when unconfigured.
initFirebase();

module.exports = { getAuth, verifyFirebaseToken, isFirebaseConfigured };
