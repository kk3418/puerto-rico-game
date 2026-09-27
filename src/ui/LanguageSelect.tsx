import { useTranslation } from "react-i18next";
import { resolveAppLanguage, type AppLanguage } from "../i18n";

export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const value = resolveAppLanguage(i18n.resolvedLanguage ?? i18n.language);

  return (
    <label className={`language-select${compact ? " compact" : ""}`}>
      <span>{t("language")}</span>
      <select
        value={value}
        onChange={(event) => {
          void i18n.changeLanguage(event.target.value as AppLanguage);
        }}
      >
        <option value="en">{t("languageEn")}</option>
        <option value="zh-Hant">{t("languageZh")}</option>
      </select>
    </label>
  );
}
