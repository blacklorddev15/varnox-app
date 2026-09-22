const response = require("../utils/responseHandler");
const trtcService = require("../services/trtcService");

/**
 * Reports whether calling is available, so the client can hide the call buttons rather than
 * offer a button that always fails.
 *
 * SDKAppID is NOT a secret — the client needs it to initialise the SDK. The SecretKey never
 * leaves the server.
 */
const getConfig = (req, res) => {
  const enabled = trtcService.isConfigured();
  return response(res, 200, "TRTC configuration", {
    enabled,
    sdkAppId: enabled ? Number(trtcService.SDK_APP_ID) : null,
    expirySeconds: trtcService.USER_SIG_EXPIRY_SECONDS,
  });
};

/**
 * Issues a UserSig for the CALLER'S OWN user id.
 *
 * The id is taken from the authenticated session and never from the request. If it were accepted
 * from the client, any logged-in user could mint a valid signature for someone else's account and
 * place calls as them.
 */
const getUserSig = (req, res) => {
  try {
    const userId = req.user?._id || req.user?.userId;

    if (!userId) {
      return response(res, 401, "Not authenticated");
    }

    if (!trtcService.isConfigured()) {
      return response(res, 503, "Calling is not configured on this server");
    }

    const userSig = trtcService.generateUserSig(userId);

    return response(res, 200, "UserSig generated", {
      userId: String(userId),
      sdkAppId: Number(trtcService.SDK_APP_ID),
      userSig,
      expirySeconds: trtcService.USER_SIG_EXPIRY_SECONDS,
    });
  } catch (err) {
    console.error("TRTC getUserSig error:", err.message);
    return response(res, 500, "Could not generate a call signature");
  }
};

module.exports = { getConfig, getUserSig };
