import axiosInstance from "./url.service";

// Always surface a real Error with a usable message.
// Previously these helpers threw `err.response?.data` (the API's JSON object) or `err.message`
// (a plain string). Callers do `err?.message || "<generic fallback>"`, so a string or a payload
// without `.message` silently collapsed into a generic "please try again" message, hiding the
// actual cause — including simple network errors.
const toError = (err) => {
  const payload = err?.response?.data;
  const message =
    (payload && (payload.message || payload.error)) || err?.message || "Request failed";
  return new Error(typeof message === "string" ? message : "Request failed");
};

export const register = async ({ email, password, phoneNumber, phoneSuffix }) => {
  try {
    const res = await axiosInstance.post("/auth/register", {
      email,
      password,
      phoneNumber: phoneNumber || undefined,
      phoneSuffix: phoneSuffix || undefined,
    });
    return res.data;
  } catch (err) {
    throw toError(err);
  }
};

export const verifyEmail = async ({ email, otp }) => {
  try {
    const res = await axiosInstance.post("/auth/verify-email", { email, otp });
    return res.data;
  } catch (err) {
    throw toError(err);
  }
};

export const loginWithEmail = async ({ email, password }) => {
  try {
    const res = await axiosInstance.post("/auth/login/email", { email, password });
    return res.data;
  } catch (err) {
    throw toError(err);
  }
};

export const loginWithPhone = async ({ phoneNumber, phoneSuffix, password }) => {
  try {
    const res = await axiosInstance.post("/auth/login/phone", { phoneNumber, phoneSuffix, password });
    return res.data;
  } catch (err) {
    throw toError(err);
  }
};

export const checkUserAuth = async () => {
  try {
    const res = await axiosInstance.get("/auth/check-auth");
    if (res.data.status === "success") {
      const user = res.data.data?.user || res.data.data;
      return { isAuthenticated: true, user };
    }
    return { isAuthenticated: false, user: null };
  } catch {
    return { isAuthenticated: false, user: null };
  }
};

export const updateUserProfile = async (data) => {
  try {
    const isFormData = typeof FormData !== "undefined" && data instanceof FormData;
    const res = await axiosInstance.put("/auth/update-profile", data, {
      // Never set Content-Type for FormData. Only the browser knows the multipart boundary it
      // generates; a manually-set bare "multipart/form-data" carries no boundary, and multer
      // rejects the request outright with "Multipart: Boundary not found". That is what broke
      // profile photo uploads.
      headers: isFormData ? undefined : { "Content-Type": "application/json" },
    });
    return res.data;
  } catch (err) {
    throw toError(err);
  }
};

export const logoutUser = async () => {
  try {
    const res = await axiosInstance.post("/auth/logout");
    return res.data;
  } catch (err) {
    throw toError(err);
  }
};

export const getAllUsers = async () => {
  try {
    const res = await axiosInstance.get("/auth/users");
    return res.data;
  } catch (err) {
    throw toError(err);
  }
};
