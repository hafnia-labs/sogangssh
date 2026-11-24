import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { detectLanguage, I18nContext, messages, STORAGE_KEY, type Language } from './context'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(detectLanguage)

  useEffect(() => {
    document.documentElement.lang = lang
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // Not critical: the choice just will not persist.
    }
  }, [lang])

  const value = useMemo(() => ({ lang, setLang, t: messages[lang] }), [lang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
