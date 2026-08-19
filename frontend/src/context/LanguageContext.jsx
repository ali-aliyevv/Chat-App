/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useState } from "react";
import PropTypes from "prop-types";
import { translations } from "../i18n/translations";

const LanguageContext = createContext(null);

const STORAGE_KEY = "app-language";
const DEFAULT_LANG = "az";
const SUPPORTED = ["az", "en", "ru"];

function getInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_LANG;
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(getInitialLang);

  const setLang = useCallback((newLang) => {
    if (!SUPPORTED.includes(newLang)) return;
    setLangState(newLang);
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
    } catch {
      /* ignore */
    }
  }, []);

  // t("userJoined", { user: "ali123" }) -> "{user} qoşuldu" mətnindəki
  // {user} yerdəyişənini "ali123" ilə əvəz edir.
  const t = useCallback(
    (key, vars) => {
      const dict = translations[lang] || translations[DEFAULT_LANG];
      let str = dict[key] ?? key;
      if (vars) {
        Object.keys(vars).forEach((k) => {
          str = str.replace(new RegExp(`{${k}}`, "g"), vars[k]);
        });
      }
      return str;
    },
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

LanguageProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside LanguageProvider");
  return ctx;
}