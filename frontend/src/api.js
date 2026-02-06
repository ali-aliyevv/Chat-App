import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
});

let isRefreshing = false;
let refreshPromise = null;

let onAuthFail = null;
export const setOnAuthFail = (fn) => {
  onAuthFail = fn;
};

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    const original = error?.config;

    if (!original || !status) return Promise.reject(error);

    const url = original.url || "";

    const isAuthEndpoint =
      url.includes("/api/login") ||
      url.includes("/api/register/request-otp") ||
      url.includes("/api/register/verify-otp") ||
      url.includes("/api/refresh") ||
      url.includes("/api/logout") ||
      url.includes("/api/me");

    if (status === 401 && url.includes("/api/me")) {
      return Promise.reject(error);
    }

    if (original._retry) return Promise.reject(error);

    if (status === 401 && !isAuthEndpoint) {
      original._retry = true;

      try {
        if (!isRefreshing) {
          isRefreshing = true;
          refreshPromise = api.post("/api/refresh");
        }

        await refreshPromise;

        isRefreshing = false;
        refreshPromise = null;

        return api(original);
      } catch (e) {
        isRefreshing = false;
        refreshPromise = null;

        if (typeof onAuthFail === "function") onAuthFail();
        return Promise.reject(e);
      }
    }

    return Promise.reject(error);
  }
);