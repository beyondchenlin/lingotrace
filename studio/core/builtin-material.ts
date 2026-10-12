/** Immutable, source-bound built-in catalogue. No Training runtime dependency. */
import { canonicalLocalReferenceJSON, captureLocalReference } from './local-reference.ts';

export const BUILTIN_TRAINING_SCHEMA = 'lingotrace-session-builtin-v1' as const;
export interface BuiltinSource {
  readonly version: 'builtin-reference-v1'; readonly registryId: string; readonly language: 'en-US';
  readonly sourcePage: string; readonly sourceVideoUrl: string; readonly sourceCaptionUrl: string;
  readonly policyUrl: string; readonly credit: string;
  readonly officialCaptionVersion: string; readonly officialCaptionSha256: string;
  readonly normalizedCaptionSha256: string; readonly sentenceMapVersion: string; readonly sentenceMapSha256: string;
  readonly timingBasis: string;
  readonly media: { readonly id: string; readonly sha256: string; readonly byteLength: number; readonly durationSeconds: number };
}
interface BuiltinMaterial {
  readonly id: string; readonly version: string; readonly title: string; readonly rights: string;
  readonly cues: readonly { readonly id: string; readonly text: string; readonly start: number; readonly end: number }[];
  readonly builtinReference: BuiltinSource;
}

/** Text is verbatim from the sentence map, including its one documented terminal clamp. */
export const NPS_MATERIAL: BuiltinMaterial = captureLocalReference({
  "id": "nps-connie-lau-education-ranger-7fe78a9f",
  "version": "nps-connie-sentences-v1-sha256-24ea8d06860298369f97e850df7069eb7e9b468ef2ad5df6468f6e868289eedc",
  "title": "NPS 真人片段：教育护林员 Connie Lau",
  "rights": "National Park Service 官方真人片段。美国版权依据：NPS 标注的美国政府作品，源页面未标版权符号。No claim to original U.S. Government works. 不表示 NPS 或出镜者为 LingoTrace 背书；其他司法辖区、隐私及形象权须另行考虑。官方字幕按标点合句，仅末尾 43.960 秒截至 43.366 秒；未作独立人工听校，不声称无配乐。",
  "cues": [
    {
      "id": "nps-connie-7fe78a9f-1",
      "text": "Hi, everybody.",
      "start": 0.77,
      "end": 1.53
    },
    {
      "id": "nps-connie-7fe78a9f-2",
      "text": "My name is Ranger Connie and I am reporting live from Grand Canyon National Park.",
      "start": 1.53,
      "end": 6.02
    },
    {
      "id": "nps-connie-7fe78a9f-3",
      "text": "And I am an education ranger here.",
      "start": 6.02,
      "end": 8.21
    },
    {
      "id": "nps-connie-7fe78a9f-4",
      "text": "I pretty much give programs and lessons to students like yourself from K through 12.",
      "start": 8.21,
      "end": 13.09
    },
    {
      "id": "nps-connie-7fe78a9f-5",
      "text": "And that's one of my favorite things to do is actually to teach the public about these really beautiful places.",
      "start": 13.09,
      "end": 18.56
    },
    {
      "id": "nps-connie-7fe78a9f-6",
      "text": "And the second part is I get to travel to different parks, like here I'm in the Grand Canyon National Park and now I'm here in Yosemite.",
      "start": 18.56,
      "end": 25.94
    },
    {
      "id": "nps-connie-7fe78a9f-7",
      "text": "So here I'm also an education ranger.",
      "start": 25.94,
      "end": 28.04
    },
    {
      "id": "nps-connie-7fe78a9f-8",
      "text": "And I was actually a teacher before this.",
      "start": 28.04,
      "end": 29.84
    },
    {
      "id": "nps-connie-7fe78a9f-9",
      "text": "I taught in Los Angeles for seven years.",
      "start": 29.84,
      "end": 31.558
    },
    {
      "id": "nps-connie-7fe78a9f-10",
      "text": "So it's been really awesome just teaching here, leading field trips, doing virtual programs.",
      "start": 31.558,
      "end": 35.72
    },
    {
      "id": "nps-connie-7fe78a9f-11",
      "text": "And yeah, just changing my classroom from an actual classroom, really small and enclosed to somewhere as beautiful as this.",
      "start": 35.72,
      "end": 43.366
    }
  ],
  "builtinReference": {
    "version": "builtin-reference-v1",
    "registryId": "nps-connie-lau-education-ranger-7fe78a9f",
    "language": "en-US",
    "sourcePage": "https://www.nps.gov/media/video/view.htm?id=7FE78A9F-1C89-4CDE-9BFD-DD0D0E4DE2CB",
    "sourceVideoUrl": "https://www.nps.gov/nps-audiovideo/audiovideo/505d7a14-5907-49f0-a2e7-aedaaa757c3b720p.mp4",
    "sourceCaptionUrl": "https://www.nps.gov/nps-audiovideo/closed-caption/7E7A533E-9794-282E-6B1CBB4348556B45.vtt",
    "policyUrl": "https://www.nps.gov/aboutus/disclaimer.htm",
    "credit": "National Park Service",
    "officialCaptionVersion": "nps-official-7e7a533e-9794-282e-6b1cbb4348556b45-sha256-0ce3a2e3c8f1acb7",
    "officialCaptionSha256": "0ce3a2e3c8f1acb7a0d78eda6f3d8e4afbc7ef1ee5ffc503e2f150979b6146b5",
    "normalizedCaptionSha256": "a24bd3804ba9ef40bef3d0828de6af0fa4ce678fd8393cecd8fed512d473eb3b",
    "sentenceMapVersion": "nps-connie-official-vtt-derived-sentences-v1",
    "sentenceMapSha256": "24ea8d06860298369f97e850df7069eb7e9b468ef2ad5df6468f6e868289eedc",
    "timingBasis": "Official NPS cue boundaries merged by sentence punctuation; not independently acoustically aligned. End at 43.960 seconds clamped to 43.366 seconds, without media modification.",
    "media": {
      "id": "nps-connie-lau-education-ranger-video-v1",
      "sha256": "b2ea5fa763a5687961606061afbef1b7619fcaff3ccd04b3e0b9f14584ffa642",
      "byteLength": 19584717,
      "durationSeconds": 43.366667
    }
  }
});
export const NPS_COURSE_MEDIA = Object.freeze({
  url: '/studio-assets/nps-connie/connie-lau-education-ranger-720p.mp4',
  mediaId: NPS_MATERIAL.builtinReference.media.id,
  mediaSha256: NPS_MATERIAL.builtinReference.media.sha256,
  durationSeconds: NPS_MATERIAL.builtinReference.media.durationSeconds,
  title: 'Connie Lau - Education Ranger',
  sourcePage: NPS_MATERIAL.builtinReference.sourcePage,
});
const registeredIdentity = canonicalLocalReferenceJSON(NPS_MATERIAL);
const fail = (): never => { throw new Error('Unsupported or altered built-in material/source binding.'); };
/** Reading descriptors avoids executing an untrusted source declaration's getter. */
function descriptor(value: object, key: string): PropertyDescriptor | undefined {
  for (let current: object | null = value; current; current = Object.getPrototypeOf(current)) {
    const own = Object.getOwnPropertyDescriptor(current, key);
    if (own) return own;
  }
  return undefined;
}
function claimsBuiltin(material: unknown): boolean {
  if (!material || typeof material !== 'object') return false;
  if ('builtinReference' in material || 'builtinSource' in material) return true;
  const id = descriptor(material, 'id'), version = descriptor(material, 'version'), cues = descriptor(material, 'cues');
  // Accessor identity is not an admissible way to evade the registry check.
  if ([id, version, cues].some(field => field && !Object.hasOwn(field, 'value'))) return true;
  if (id?.value === NPS_MATERIAL.id || (typeof version?.value === 'string' && version.value.startsWith('nps-connie-'))) return true;
  if (!Array.isArray(cues?.value)) return false;
  for (let index = 0; index < cues.value.length; index++) {
    const item = Object.getOwnPropertyDescriptor(cues.value, String(index));
    if (item && !Object.hasOwn(item, 'value')) return true;
    const cue = item?.value;
    const cueId = cue && typeof cue === 'object' ? descriptor(cue, 'id') : undefined;
    if (cueId && !Object.hasOwn(cueId, 'value')) return true;
    if (typeof cueId?.value === 'string' && cueId.value.startsWith('nps-connie-7fe78a9f-')) return true;
  }
  return false;
}
/** Absence on old/generic materials is unchanged. A claim must be the entire registry object.
 * This verifies reference declarations, never an actual fetched media lease or its bytes. */
export function validateOptionalBuiltinSource(material: unknown): void {
  if (!claimsBuiltin(material)) return;
  try { if (canonicalLocalReferenceJSON(material) !== registeredIdentity) fail(); }
  catch { fail(); }
}
/** Invalid NPS claims throw instead of silently routing to the old coffee fallback. */
export function isBuiltinMaterial(material: unknown): boolean {
  validateOptionalBuiltinSource(material);
  return claimsBuiltin(material);
}
export function builtinCourseForMaterial(material: unknown): typeof NPS_COURSE_MEDIA | null {
  return isBuiltinMaterial(material) ? NPS_COURSE_MEDIA : null;
}
