import { useCallback, useEffect, useMemo, useState } from "react";
import { socket } from "../socket";
import { api } from "../api";

export function useStatus(me) {
  const [statuses, setStatuses] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get("/api/status");
      setStatuses(Array.isArray(res.data) ? res.data : []);
    } catch {
      /* keep whatever we had */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onNew = (status) => {
      setStatuses((prev) => {
        if (prev.some((s) => s.id === status.id)) return prev;
        // The broadcast payload is the same object sent back to the author
        // (whose own status is trivially "viewed") — recompute per-viewer
        // here rather than trusting that flag for anyone else.
        const viewed = status.username === me;
        return [...prev, { ...status, viewed }];
      });
    };
    const onDeleted = ({ id }) => {
      setStatuses((prev) => prev.filter((s) => s.id !== id));
    };
    const onViewed = ({ statusId }) => {
      // Only affects the owner's own "seen by" count — a soft refresh of
      // the list is enough, the detailed viewer list is fetched on demand.
      setStatuses((prev) =>
        prev.map((s) =>
          s.id === statusId ? { ...s, viewerCount: (s.viewerCount || 0) + 1 } : s,
        ),
      );
    };

    socket.on("status:new", onNew);
    socket.on("status:deleted", onDeleted);
    socket.on("status:viewed", onViewed);
    return () => {
      socket.off("status:new", onNew);
      socket.off("status:deleted", onDeleted);
      socket.off("status:viewed", onViewed);
    };
  }, [me]);

  const mine = useMemo(
    () => statuses.filter((s) => s.username === me).sort((a, b) => a.createdAt - b.createdAt),
    [statuses, me],
  );

  const othersGrouped = useMemo(() => {
    const map = new Map();
    statuses
      .filter((s) => s.username !== me)
      .forEach((s) => {
        if (!map.has(s.username)) map.set(s.username, []);
        map.get(s.username).push(s);
      });

    const groups = Array.from(map.entries()).map(([username, items]) => {
      const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
      return {
        username,
        avatarUrl: sorted[sorted.length - 1]?.avatarUrl || null,
        items: sorted,
        hasUnviewed: sorted.some((s) => !s.viewed),
        latestAt: sorted[sorted.length - 1]?.createdAt || 0,
      };
    });

    groups.sort((a, b) => {
      if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
      return b.latestAt - a.latestAt;
    });
    return groups;
  }, [statuses, me]);

  const createTextStatus = useCallback(async (text, bgColor) => {
    const res = await api.post("/api/status", { type: "text", text, bgColor });
    setStatuses((prev) =>
      prev.some((s) => s.id === res.data.id) ? prev : [...prev, res.data],
    );
    return res.data;
  }, []);

  const createMediaStatus = useCallback(async (file, caption) => {
    const formData = new FormData();
    formData.append("file", file);
    const uploadRes = await api.post("/api/upload", formData);
    const res = await api.post("/api/status", {
      type: file.type.startsWith("video/") ? "video" : "image",
      mediaUrl: uploadRes.data.url,
      text: caption || null,
    });
    setStatuses((prev) =>
      prev.some((s) => s.id === res.data.id) ? prev : [...prev, res.data],
    );
    return res.data;
  }, []);

  const viewStatus = useCallback(
    (id) => {
      setStatuses((prev) =>
        prev.map((s) => (s.id === id ? { ...s, viewed: true } : s)),
      );
      api.post(`/api/status/${id}/view`).catch(() => {});
    },
    [],
  );

  const deleteStatusById = useCallback(async (id) => {
    setStatuses((prev) => prev.filter((s) => s.id !== id));
    try {
      await api.delete(`/api/status/${id}`);
    } catch {
      load();
    }
  }, [load]);

  const getViewers = useCallback(async (id) => {
    const res = await api.get(`/api/status/${id}/viewers`);
    return Array.isArray(res.data) ? res.data : [];
  }, []);

  return {
    loaded,
    mine,
    othersGrouped,
    createTextStatus,
    createMediaStatus,
    viewStatus,
    deleteStatus: deleteStatusById,
    getViewers,
    reload: load,
  };
}
