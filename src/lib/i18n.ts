// Translations: Español (Argentina) and English. The language follows Windows
// unless the user picks one in Options → Language.
import { useCallback } from 'react'
import { db, useDb } from './store'
import { en, type Dict } from './locales/en'
import { es } from './locales/es'

export type Lang = 'es-AR' | 'en'
export type LangSetting = 'auto' | Lang

export const languages: { id: Lang; name: string }[] = [
  { id: 'es-AR', name: 'Español (Argentina)' },
  { id: 'en', name: 'English' },
]

const dicts: Record<Lang, Dict> = { en, 'es-AR': es }

export function systemLang(): Lang {
  return navigator.language.toLowerCase().startsWith('es') ? 'es-AR' : 'en'
}

export function resolveLang(setting: LangSetting | undefined): Lang {
  return setting && setting !== 'auto' ? setting : systemLang()
}

type Key = keyof Dict
type Args<K extends Key> = Dict[K] extends (...a: infer A) => string ? A : []
export type T = <K extends Key>(key: K, ...args: Args<K>) => string

function translate<K extends Key>(lang: Lang, key: K, ...args: Args<K>): string {
  const v = dicts[lang][key] ?? en[key]
  return typeof v === 'function' ? (v as (...a: unknown[]) => string)(...args) : (v as string)
}

/** For code outside React (alerts, formatting): uses the current setting. */
export const t: T = (key, ...args) => translate(resolveLang(db().settings.lang), key, ...args)

/** For components: re-renders when the language changes. */
export function useT(): T {
  const lang = useDb((s) => resolveLang(s.settings.lang))
  return useCallback<T>((key, ...args) => translate(lang, key, ...args), [lang])
}

export function useLang(): Lang {
  return useDb((s) => resolveLang(s.settings.lang))
}
