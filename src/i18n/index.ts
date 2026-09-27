import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import enCommon from "./locales/en/common.json";
import enGame from "./locales/en/game.json";
import enLog from "./locales/en/log.json";
import enTerms from "./locales/en/terms.json";
import zhCommon from "./locales/zh-Hant/common.json";
import zhGame from "./locales/zh-Hant/game.json";
import zhLog from "./locales/zh-Hant/log.json";
import zhTerms from "./locales/zh-Hant/terms.json";

export const SUPPORTED_LNGS = ["en", "zh-Hant"] as const;
export type AppLanguage = (typeof SUPPORTED_LNGS)[number];

export const LANGUAGE_STORAGE_KEY = "pr-lang";

export function resolveAppLanguage(lng: string): AppLanguage {
  return lng.toLowerCase().startsWith("zh") ? "zh-Hant" : "en";
}

export const i18nReady = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon, game: enGame, terms: enTerms, log: enLog },
      "zh-Hant": { common: zhCommon, game: zhGame, terms: zhTerms, log: zhLog },
    },
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LNGS],
    ns: ["common", "game", "terms", "log"],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      convertDetectedLanguage: resolveAppLanguage,
    },
  });

function syncDocument(lng: string): void {
  if (typeof document === "undefined") return;
  const resolved = resolveAppLanguage(lng);
  document.documentElement.lang = resolved;
  document.title = i18n.t("documentTitle");
}

i18n.on("initialized", () => {
  syncDocument(i18n.resolvedLanguage ?? i18n.language ?? "en");
});
i18n.on("languageChanged", syncDocument);

export default i18n;
