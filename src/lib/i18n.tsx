import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { translations, type LangKey } from "./translations";

type Lang = "id" | "en";
const LANG_KEY = "dash-lang";

type I18nCtx = { lang: Lang; t: (key: LangKey) => string; setLang: (l: Lang) => void };

const Ctx = createContext<I18nCtx>({ lang: "id", t: (k) => k, setLang: () => {} });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "id";
    return (localStorage.getItem(LANG_KEY) as Lang) || "id";
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(LANG_KEY, l);
  }, []);

  const t = useCallback((key: LangKey) => translations[key]?.[lang] ?? key, [lang]);

  return <Ctx.Provider value={{ lang, t, setLang }}>{children}</Ctx.Provider>;
}

export function useT() { return useContext(Ctx); }

export function LangToggle({ className }: { className?: string }) {
  const { lang, setLang } = useT();
  return (
    <button
      onClick={() => setLang(lang === "id" ? "en" : "id")}
      className={
        "flex items-center justify-center w-8 h-8 rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs font-semibold flex-shrink-0 " +
        (className ?? "")
      }
      title={lang === "id" ? "Switch to English" : "Ganti ke Bahasa Indonesia"}
    >
      {lang === "id" ? "EN" : "ID"}
    </button>
  );
}
