import { createContext, useContext } from 'react'
import { en } from './en'
import { ko, type Messages } from './ko'

export type Language = 'ko' | 'en'

export const messages: Record<Language, Messages> = { ko, en }

export const STORAGE_KEY = 'sogangssh.language'

export function detectLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'ko' || saved === 'en') return saved
  } catch {
    // Storage unavailable; fall back to the OS language.
  }
  return navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

type I18nValue = {
  lang: Language
  setLang: (lang: Language) => void
  t: Messages
}

export const I18nContext = createContext<I18nValue | null>(null)

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
