/** Card carousel motion profiles — presentation only. */
export type CarouselMotionId = 'depth-deck' | 'magnetic-reveal';

export interface CarouselMotionProfile {
 id:CarouselMotionId;
 focusScale:number;
 neighborScale:number;
 neighborOpacity:number;
 settleMs:number;
 snapOvershoot:number;
 stackOffsetY:number;
 stackScaleStep:number;
}

export const DEPTH_DECK:CarouselMotionProfile={
 id:'depth-deck',focusScale:1,neighborScale:.9,neighborOpacity:.42,settleMs:440,snapOvershoot:0,stackOffsetY:18,stackScaleStep:.06,
};

export const MAGNETIC_REVEAL:CarouselMotionProfile={
 id:'magnetic-reveal',focusScale:1.03,neighborScale:.86,neighborOpacity:.28,settleMs:560,snapOvershoot:22,stackOffsetY:10,stackScaleStep:.08,
};

export function carouselMotion(id:CarouselMotionId):CarouselMotionProfile{
 return id==='magnetic-reveal'?MAGNETIC_REVEAL:DEPTH_DECK;
}

export type LessonCardKind = 'fixed-pace' | 'dictation' | 'kids' | 'cafe-preview' | 'assisted';

export interface LessonCardSpec {
 id:string;
 title:string;
 titleZh:string;
 subtitle:string;
 subtitleZh:string;
 aspect:'landscape'|'portrait';
 posterSrc:string;
 videoSrc?:string;
 href:string;
 credit?:string;
 kind:LessonCardKind;
 cta?:string;
 ctaZh?:string;
}

/** Richer dual-aspect lesson catalog: NPS Studio paths + cafe media preview (not Studio cafe training). */
export const DEMO_LESSON_CARDS:LessonCardSpec[]=[
 {
  id:'connie-fixed',
  title:'Connie · Fixed pace',
  titleZh:'Connie · 定速跟音',
  subtitle:'NPS · 1× primary · assisted reference',
  subtitleZh:'NPS · 定速主训练 · 显示参考',
  aspect:'landscape',
  posterSrc:'/studio-assets/nps-connie/poster.jpg',
  videoSrc:'/studio-assets/nps-connie/connie-lau-education-ranger-720p.mp4',
  href:'/studio/',
  credit:'National Park Service · No claim to original U.S. Government works.',
  kind:'fixed-pace',
  cta:'Open Studio',
  ctaZh:'打开 Studio',
 },
 {
  id:'connie-dictation',
  title:'Connie · Hidden dictation',
  titleZh:'Connie · 隐藏听写',
  subtitle:'Fixed pace with reference hidden',
  subtitleZh:'定速听写 · 参考已隐藏',
  aspect:'landscape',
  posterSrc:'/studio-assets/nps-connie/poster.jpg',
  videoSrc:'/studio-assets/nps-connie/connie-lau-education-ranger-720p.mp4',
  href:'/studio/?dictation=1',
  credit:'National Park Service · No claim to original U.S. Government works.',
  kind:'dictation',
  cta:'Start dictation',
  ctaZh:'开始听写',
 },
 {
  id:'connie-kids',
  title:'Connie · Kids edition',
  titleZh:'Connie · 儿童版',
  subtitle:'Same training · softer HUD chrome',
  subtitleZh:'同一训练 · 更柔和的界面',
  aspect:'portrait',
  posterSrc:'/studio-assets/nps-connie/poster.jpg',
  videoSrc:'/studio-assets/nps-connie/connie-lau-education-ranger-720p.mp4',
  href:'/studio/?edition=kids',
  credit:'National Park Service · No claim to original U.S. Government works.',
  kind:'kids',
  cta:'Open Kids Studio',
  ctaZh:'打开儿童版',
 },
 {
  id:'cafe-preview-landscape',
  title:'Cafe · Media preview',
  titleZh:'咖啡馆 · 素材预览',
  subtitle:'Preview art only · Studio trains on verified NPS',
  subtitleZh:'仅预览画面 · Studio 仍用已核验 NPS',
  aspect:'landscape',
  posterSrc:'/studio-assets/06-cafe-poster.jpg',
  videoSrc:'/studio-assets/06-cafe.mp4',
  href:'/studio/',
  kind:'cafe-preview',
  cta:'Open Studio (NPS)',
  ctaZh:'打开 Studio（NPS）',
 },
 {
  id:'cafe-preview-portrait',
  title:'Cafe · Portrait preview',
  titleZh:'咖啡馆 · 竖版预览',
  subtitle:'Dual-aspect preview · not cafe Studio training',
  subtitleZh:'双画幅预览 · 非咖啡馆定速训练',
  aspect:'portrait',
  posterSrc:'/studio-assets/06-cafe-poster.jpg',
  videoSrc:'/studio-assets/06-cafe.mp4',
  href:'/studio/',
  kind:'cafe-preview',
  cta:'Open Studio (NPS)',
  ctaZh:'打开 Studio（NPS）',
 },
 {
  id:'connie-assisted',
  title:'Connie · Assisted typing',
  titleZh:'Connie · 辅助跟打',
  subtitle:'Reference visible · word underlines',
  subtitleZh:'显示参考 · 词下划线',
  aspect:'portrait',
  posterSrc:'/studio-assets/nps-connie/poster.jpg',
  videoSrc:'/studio-assets/nps-connie/connie-lau-education-ranger-720p.mp4',
  href:'/studio/',
  credit:'National Park Service · No claim to original U.S. Government works.',
  kind:'assisted',
  cta:'Practice with reference',
  ctaZh:'带参考练习',
 },
];
