import { studioEnglish, studioChinese } from './messages-studio';
import {referenceImpactEnglish, referenceImpactChinese} from './messages-reference-impact';
import { reviewEnglish, reviewChinese } from './messages-review';
import {sceneEnglish, sceneChinese} from './messages-scene';
import {diagnosticEnglish, diagnosticChinese} from './messages-diagnostics';
import {correctionEnglish, correctionChinese} from './messages-correction';

/** Presentation only. Never use translations as persisted identifiers or scoring input. */
export const STUDIO_LOCALES = ['en', 'zh-CN'] as const;
export type StudioLocale = typeof STUDIO_LOCALES[number];
export const DEFAULT_STUDIO_LOCALE: StudioLocale = 'en';
export const STUDIO_LOCALE_STORAGE_KEY = 'lingotrace-studio-interface-locale-v1';
export const english = { ...studioEnglish, ...reviewEnglish, ...sceneEnglish, ...diagnosticEnglish, ...referenceImpactEnglish, ...correctionEnglish } as const;
export const chinese: Record<keyof typeof english, string> = { ...studioChinese, ...reviewChinese, ...sceneChinese, ...diagnosticChinese, ...referenceImpactChinese, ...correctionChinese };
export type MessageKey = keyof typeof english;
export type MessageParams = Readonly<Record<string, string | number>>;
export function normalizeStudioLocale(value: unknown): StudioLocale {
  return value === 'zh-CN' ? 'zh-CN' : DEFAULT_STUDIO_LOCALE;
}
export function readStudioLocale(storage: Pick<Storage, 'getItem'> | null): StudioLocale {
  try { return normalizeStudioLocale(storage?.getItem(STUDIO_LOCALE_STORAGE_KEY)); } catch { return DEFAULT_STUDIO_LOCALE; }
}
export function writeStudioLocale(storage: Pick<Storage, 'setItem'> | null, locale: StudioLocale): boolean {
  try { if (!storage) return false; storage.setItem(STUDIO_LOCALE_STORAGE_KEY, locale); return true; } catch { return false; }
}
export function translate(locale: StudioLocale, key: MessageKey, params: MessageParams = {}): string {
  const message = (locale === 'zh-CN' ? chinese[key] : english[key]) ?? english[key];
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
}
const legacyKeys = new Map<string, MessageKey>();
for (const key of Object.keys(english) as MessageKey[]) {
  legacyKeys.set(english[key], key);
  legacyKeys.set(chinese[key], key);
}
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templateMessages = (Object.keys(english) as MessageKey[]).flatMap(key =>
  [english[key], chinese[key]].filter(message => /\{\w+\}/.test(message)).map(message => {
    const parts = message.split(/(\{\w+\})/g), names: string[] = [];
    const pattern = parts.map(part => {const match = /^\{(\w+)\}$/.exec(part); if (!match) return escapePattern(part); names.push(match[1]); return '(.+?)';}).join('');
    return {key, names, literalLength:message.replace(/\{\w+\}/g,'').length, pattern: new RegExp(`^${pattern}$`, 's')};
  })
).sort((a,b)=>b.literalLength-a.literalLength);
// These are complete, known UI sentences, never arbitrary substring replacements.
const diagnosticSentences = [...legacyKeys.entries()].filter(([message]) => message.length > 6 && /[。.!?]$/.test(message)).sort((a,b) => b[0].length-a[0].length);
/** Display bridge for legacy UI diagnostics. Unknown messages stay intact and never become success.
 * Call only on UI-owned diagnostics, never on course text, user input, or archived data payloads. */
export function translateKnownUi(locale: StudioLocale, message: string | null | undefined): string {
  return translateKnownMessage(locale, message, 0);
}
function translateKnownMessage(locale: StudioLocale, message: string | null | undefined, depth: number): string {
  if (!message) return message ?? '';
  const key = legacyKeys.get(message);
  if (key) return translate(locale, key);
  if (depth < 3) for (const template of templateMessages) {
    const match = template.pattern.exec(message);
    if (match) {
      const params = Object.fromEntries(template.names.map((name,index) => [name,name === 'details' ? translateKnownMessage(locale,match[index+1],depth+1) : match[index+1]]));
      return translate(locale, template.key, params);
    }
  }
  let rest = message; const sentences: string[] = [];
  while (rest) {
    const part = diagnosticSentences.find(([source]) => rest.startsWith(source));
    if (!part) return message;
    sentences.push(translate(locale,part[1])); rest = rest.slice(part[0].length).trimStart();
  }
  return sentences.join(locale === 'zh-CN' ? '' : ' ');
}
