import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ur from "./locales/ur.json";

const STORAGE_KEY = "pos_language";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ur: { translation: ur },
  },
  lng: typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) || "en" : "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (lng) => {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, lng);
    document.documentElement.lang = lng;
    document.documentElement.dir = lng === "ur" ? "rtl" : "ltr";
  }
});

export default i18n;
