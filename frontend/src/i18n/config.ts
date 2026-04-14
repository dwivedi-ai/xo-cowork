import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enCommon from "./locales/en/common.json";
import enChat from "./locales/en/chat.json";
import enSettings from "./locales/en/settings.json";
import enBilling from "./locales/en/billing.json";
import enUsage from "./locales/en/usage.json";
import enPlugins from "./locales/en/plugins.json";
import enAutomations from "./locales/en/automations.json";

import frCommon from "./locales/fr/common.json";
import frChat from "./locales/fr/chat.json";
import frSettings from "./locales/fr/settings.json";
import frBilling from "./locales/fr/billing.json";
import frUsage from "./locales/fr/usage.json";
import frPlugins from "./locales/fr/plugins.json";
import frAutomations from "./locales/fr/automations.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        chat: enChat,
        settings: enSettings,
        billing: enBilling,
        usage: enUsage,
        plugins: enPlugins,
        automations: enAutomations,
      },
      fr: {
        common: frCommon,
        chat: frChat,
        settings: frSettings,
        billing: frBilling,
        usage: frUsage,
        plugins: frPlugins,
        automations: frAutomations,
      },
    },
    fallbackLng: "en",
    defaultNS: "common",
    ns: ["common", "chat", "settings", "billing", "usage", "plugins", "automations"],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "xo-cowork-language",
      caches: ["localStorage"],
    },
  });

export default i18n;
