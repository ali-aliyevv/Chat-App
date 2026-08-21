import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

const PROMPTED_KEY = "push_prompted_v1";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const isSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined";

  const [subscribed, setSubscribed] = useState(false);

  const subscribe = useCallback(async () => {
    if (!isSupported) return false;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return false;

      const registration = await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      if (!sub) {
        const keyRes = await api.get("/api/push/vapid-public-key");
        const publicKey = keyRes.data?.key;
        if (!publicKey) return false;
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      await api.post("/api/push/subscribe", { subscription: sub.toJSON() });
      setSubscribed(true);
      return true;
    } catch {
      return false;
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
    } catch {
      /* ignore */
    } finally {
      setSubscribed(false);
    }
  }, [isSupported]);

  // Reflect whatever subscription already exists (e.g. granted in a
  // previous session) without prompting again.
  useEffect(() => {
    if (!isSupported) return;
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, [isSupported]);

  // Auto-prompt once per browser, a moment after the chat page mounts —
  // not on initial load, so the permission dialog isn't the first thing a
  // new visitor sees.
  useEffect(() => {
    if (!isSupported) return undefined;
    if (localStorage.getItem(PROMPTED_KEY)) return undefined;
    if (Notification.permission !== "default") return undefined;

    const timer = setTimeout(() => {
      localStorage.setItem(PROMPTED_KEY, "1");
      subscribe();
    }, 3000);
    return () => clearTimeout(timer);
  }, [isSupported, subscribe]);

  return { isSupported, subscribed, subscribe, unsubscribe };
}
