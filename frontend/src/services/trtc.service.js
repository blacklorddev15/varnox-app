import axiosInstance from "./url.service";

/**
 * Is calling available on this deployment?
 *
 * The server answers this (it is the side that holds the TRTC credentials), so the UI can hide the
 * call buttons rather than present a button that always fails. Returns { enabled: false } on ANY
 * error, including a missing endpoint or a network blip — a call feature must never be able to
 * break the chat UI.
 */
export const getCallConfig = async () => {
  try {
    const res = await axiosInstance.get("/trtc/config");
    const data = res?.data?.data;
    return {
      enabled: Boolean(data?.enabled),
      sdkAppId: data?.sdkAppId ?? null,
      expirySeconds: data?.expirySeconds ?? null,
    };
  } catch {
    return { enabled: false, sdkAppId: null, expirySeconds: null };
  }
};

/**
 * Fetch this user's call credentials.
 *
 * The UserSig is minted server-side and scoped to the authenticated session — the browser never
 * sees, and could not use, the TRTC SecretKey.
 */
export const getCallCredentials = async () => {
  const res = await axiosInstance.get("/trtc/usersig");
  const data = res?.data?.data;

  if (!data?.userSig || !data?.sdkAppId || !data?.userId) {
    throw new Error("Server did not return usable call credentials");
  }

  return data;
};

/**
 * Initialise TUICallKit once per session, as soon as we know who the user is.
 *
 * This must NOT wait until the user places a call. Until init() has run the client is not
 * registered with TRTC, so the app cannot RECEIVE an incoming call — the caller would ring into
 * the void and the callee would never see anything. Placing a call worked before without this;
 * being called did not.
 *
 * The promise is cached so React re-renders and multiple callers share a single init.
 */
let initPromise = null;

export const ensureCallInit = () => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const config = await getCallConfig();
    if (!config.enabled) {
      throw new Error("Calling is not configured on this server");
    }

    // Imported dynamically so the ~3.4 MB SDK stays out of the main bundle entirely when calling
    // is switched off.
    const trtc = await import("@trtc/calls-uikit-react");
    const creds = await getCallCredentials();

    await trtc.TUICallKitAPI.init({
      userID: creds.userId,
      userSig: creds.userSig,
      SDKAppID: creds.sdkAppId,
    });

    return trtc;
  })();

  // Allow a retry: without this, one transient failure would poison the cache for the whole session.
  initPromise.catch(() => {
    initPromise = null;
  });

  return initPromise;
};
