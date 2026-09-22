const dotenv = require("dotenv");
dotenv.config();

// Tencent's official UserSig generator.
//
// A UserSig is a short-lived credential proving the bearer is a given TRTC userID. It MUST be
// signed server-side: the SDKSecretKey can never ship in the client bundle. Tencent's own docs
// are explicit — putting the key in the client leaves it "vulnerable to decompilation and
// reverse engineering. Once your key is leaked, attackers can steal your Tencent Cloud traffic."
//
// The export shape differs between versions: tls-sig-api-v2@1.x exports `{ Api }`, while other
// builds and the Tencent samples export the constructor directly as `TLSSigAPIv2`. Resolve
// whichever is present rather than assuming one.
const resolveSigApi = (pkg) => {
  if (typeof pkg === "function") return pkg;
  return pkg.Api || pkg.TLSSigAPIv2 || pkg.TLSSigAPIV2 || pkg.default || null;
};

const SigApi = resolveSigApi(require("tls-sig-api-v2"));

if (typeof SigApi !== "function") {
  throw new Error(
    "tls-sig-api-v2 did not expose a constructor (expected `Api` or `TLSSigAPIv2`). Check the installed version."
  );
}

const SDK_APP_ID = process.env.TRTC_SDK_APP_ID;
const SDK_SECRET_KEY = process.env.TRTC_SDK_SECRET_KEY;

// 7 days. Tencent recommends keeping UserSig validity short in production.
const USER_SIG_EXPIRY_SECONDS = Number(process.env.TRTC_USER_SIG_EXPIRY || 60 * 60 * 24 * 7);

const isConfigured = () => Boolean(SDK_APP_ID && SDK_SECRET_KEY);

let api = null;
const getApi = () => {
  if (!api) {
    // Deliberately lazy: constructing this with empty credentials would throw at module load,
    // which on a serverless host means every cold start dies.
    api = new SigApi(Number(SDK_APP_ID), SDK_SECRET_KEY);
  }
  return api;
};

/**
 * Mint a UserSig for a TRTC userID.
 *
 * TRTC allows only letters, digits, underscore and hyphen in a userID. Our MongoDB ObjectIds are
 * 24 hex characters, so they are already valid and need no mapping.
 */
const generateUserSig = (userId) => {
  if (!isConfigured()) {
    throw new Error(
      "TRTC is not configured. Set TRTC_SDK_APP_ID and TRTC_SDK_SECRET_KEY on the server."
    );
  }
  if (!userId) throw new Error("generateUserSig requires a userId");
  return getApi().genSig(String(userId), USER_SIG_EXPIRY_SECONDS);
};

module.exports = {
  isConfigured,
  generateUserSig,
  USER_SIG_EXPIRY_SECONDS,
  SDK_APP_ID,
};
