/** Deep-link course intent — presentation / routing only.
 * Never auto-switches over a restored saved practice; prompts an explicit end-round CTA instead.
 * Does not invent materials, scores, or Follow admission. */

export type StudioCourseKind = 'nps' | 'cafe';

export type CourseDeepLinkAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'matched'; readonly course: StudioCourseKind }
  | { readonly kind: 'auto-start'; readonly course: StudioCourseKind }
  | { readonly kind: 'prompt-switch'; readonly course: StudioCourseKind; readonly current: StudioCourseKind | 'other' };

export const NPS_COURSE_ID = 'nps-connie-lau-education-ranger-7fe78a9f';
export const CAFE_COURSE_ID = 'cafe-original';

export function parseCourseQueryParam(value: string | null | undefined): StudioCourseKind | null {
  if (value === 'cafe') return 'cafe';
  if (value === 'nps') return 'nps';
  return null;
}

export function parseFollowQueryParam(value: string | null | undefined): boolean {
  return value === '1' || value === 'true';
}

export function courseKindForMaterialId(materialId: string | null | undefined): StudioCourseKind | 'other' | null {
  if (!materialId) return null;
  if (materialId === CAFE_COURSE_ID || materialId.startsWith('cafe-')) return 'cafe';
  if (materialId === NPS_COURSE_ID || materialId.startsWith('nps-connie-')) return 'nps';
  return 'other';
}

export function resolveCourseDeepLink(input: {
  readonly requested: StudioCourseKind | null;
  readonly currentMaterialId: string | null | undefined;
  readonly hasRestoredSession: boolean;
  readonly freshAwaitingInput: boolean;
}): CourseDeepLinkAction {
  if (!input.requested) return { kind: 'none' };
  const current = courseKindForMaterialId(input.currentMaterialId);
  if (current === input.requested) return { kind: 'matched', course: input.requested };
  if (!input.hasRestoredSession && input.freshAwaitingInput) {
    return { kind: 'auto-start', course: input.requested };
  }
  return {
    kind: 'prompt-switch',
    course: input.requested,
    current: current ?? 'other',
  };
}

export function stripCourseQueryParam(href: string): string {
  const url = new URL(href, 'https://lingotrace.invalid');
  url.searchParams.delete('course');
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
}
