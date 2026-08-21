/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import PropTypes from "prop-types";

const ThemeContext = createContext(null);

const STORAGE_KEY = "app-theme";
const DEFAULT_THEME = "light";
const SUPPORTED = ["dark", "light", "system"];

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

function resolveTheme(preference) {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return preference;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);
  const [resolved, setResolved] = useState(() =>
    resolveTheme(getInitialTheme()),
  );

  const applyTheme = useCallback((res) => {
    document.documentElement.setAttribute("data-theme", res);
    setResolved(res);
  }, []);

  const setTheme = useCallback(
    (newTheme) => {
      if (!SUPPORTED.includes(newTheme)) return;
      setThemeState(newTheme);
      try {
        localStorage.setItem(STORAGE_KEY, newTheme);
      } catch {
        /* ignore */
      }
      applyTheme(resolveTheme(newTheme));
    },
    [applyTheme],
  );

  useEffect(() => {
    applyTheme(resolveTheme(theme));
  }, [theme, applyTheme]);

  useEffect(() => {
    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => applyTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

ThemeProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}