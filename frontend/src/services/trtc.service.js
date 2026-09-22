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
