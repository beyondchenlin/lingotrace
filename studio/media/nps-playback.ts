import {NPS_COURSE_MEDIA} from '../core/builtin-material.ts';
/** Playback representation only. The immutable official material, captions and
 * persisted attempts continue to identify the original NPS source bytes.
 * This registered derivative preserves every audio/video packet and timestamp;
 * its independently verified hash must never be reported as the original hash. */
export const NPS_PLAYBACK_MEDIA = Object.freeze({
  ...NPS_COURSE_MEDIA,
  allowVerifiedDirect: true as const,
  playbackVariant: Object.freeze({
    url: '/studio-assets/nps-connie/1ae4ef4410aa49a86a654303c7fe52ef26b86484e22fae234911bb2ec1c46526.mp4',
    mediaId: 'nps-connie-lau-lossless-mp4-v1',
    mediaSha256: '1ae4ef4410aa49a86a654303c7fe52ef26b86484e22fae234911bb2ec1c46526',
  }),
});
