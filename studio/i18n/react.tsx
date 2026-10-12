'use client';
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {DEFAULT_STUDIO_LOCALE, normalizeStudioLocale, readStudioLocale, writeStudioLocale, translate, translateKnownUi, type MessageKey, type MessageParams, type StudioLocale} from './locale';

type LocaleContext = {locale: StudioLocale; setLocale: (locale: StudioLocale) => void; preferenceSaved: boolean; t: (key: MessageKey, params?: MessageParams) => string; ui: (message: string | null | undefined) => string};
const StudioLocaleContext = createContext<LocaleContext>({locale: DEFAULT_STUDIO_LOCALE, setLocale: () => {}, preferenceSaved: true, t: (key, params) => translate(DEFAULT_STUDIO_LOCALE, key, params), ui: message => translateKnownUi(DEFAULT_STUDIO_LOCALE, message)});

/** This provider changes presentation context only; it never keys or replaces the practice subtree. */
export function StudioLocaleProvider({children}: {children: ReactNode}) {
  const [locale, updateLocale] = useState<StudioLocale>(DEFAULT_STUDIO_LOCALE);
  const [preferenceSaved, setPreferenceSaved] = useState(true);
  const localeRef = useRef(locale); localeRef.current = locale;
  useEffect(() => { let storage: Storage | null = null; try {storage = window.localStorage;} catch {} updateLocale(readStudioLocale(storage)); }, []);
  useEffect(() => {document.documentElement.lang = locale;}, [locale]);
  const setLocale = useCallback((next: StudioLocale) => {
    const selected = normalizeStudioLocale(next); localeRef.current = selected; updateLocale(selected);
    let storage: Storage | null = null; try {storage = window.localStorage;} catch {}
    setPreferenceSaved(writeStudioLocale(storage, selected));
  }, []);
  // Stable functions avoid restarting media/history effects when the language changes.
  const t = useCallback((key: MessageKey, params?: MessageParams) => translate(localeRef.current, key, params), []);
  const ui = useCallback((message: string | null | undefined) => translateKnownUi(localeRef.current, message), []);
  const value = useMemo(() => ({locale, setLocale, preferenceSaved, t, ui}), [locale, setLocale, preferenceSaved, t, ui]);
  return <StudioLocaleContext.Provider value={value}>{children}</StudioLocaleContext.Provider>;
}
export function useStudioLocale() {return useContext(StudioLocaleContext);}
export function InterfaceLanguageSettings() {
  const {locale, setLocale, preferenceSaved, t} = useStudioLocale();
  return <section className="interface-language-settings" aria-label={t('settings.language')}>
    <h2>{t('settings.language')}</h2>
    <label className="field">{t('settings.languageChoice')}<select aria-label={t('settings.languageChoice')} value={locale} onChange={event => setLocale(normalizeStudioLocale(event.target.value))}>
      <option value="en" lang="en">English</option><option value="zh-CN" lang="zh-CN">简体中文</option>
    </select></label>
    <p className="note">{t('settings.languageScope')}</p>
    {!preferenceSaved && <p className="notice warn" role="status">{t('settings.languageNotSaved')}</p>}
  </section>;
}
