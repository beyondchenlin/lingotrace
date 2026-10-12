import type {OriginalCourseMediaLease} from './context-bookmark-media.ts';
import {ORIGINAL_COURSE_MEDIA} from './context-bookmark-media.ts';
type BoundMaterial={id:string;version:string;localReference?:{version:string;media:{id:string;sha256:string;durationSeconds:number}};cues:readonly {id:string;start:number;end:number}[]};
/** New-version route only. Never upgrades missing legacy provenance or accepts
 * an ordinary course URL fallback as verified original media. */
export function correctedReferenceMediaError(material:BoundMaterial,lease:OriginalCourseMediaLease|null,video:{src:string;currentSrc:string;duration:number;readyState:number}):string|null{
 const binding=material.localReference;
 if(!binding||(binding.version!=='local-reference-v1'&&binding.version!=='local-reference-v2'))return '校正素材缺少可核验的媒体版本。';
 if(!lease?.verified||lease.actualSha256!==ORIGINAL_COURSE_MEDIA.mediaSha256||lease.mediaId!==ORIGINAL_COURSE_MEDIA.mediaId
  ||binding.media.id!==lease.mediaId||binding.media.sha256!==lease.actualSha256||lease.mediaSha256!==lease.actualSha256)return '校正素材的原片字节或版本校验不匹配。';
 if(video.src!==lease.url||video.currentSrc!==lease.url||video.readyState<1)return '当前播放源不是已核验的原片。';
 if(!Number.isFinite(video.duration)||video.duration<=0||video.duration!==binding.media.durationSeconds)return '校正素材的实际媒体时长不可核验或已改变。';
 if(material.cues.some(c=>!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||c.end>video.duration))return '校正素材的句子范围超过实际媒体。';
 return null;
}
