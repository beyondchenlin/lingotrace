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
}

/** Dual-aspect demo deck: cafe landscape + Connie portrait-framed landscape media. */
export const DEMO_LESSON_CARDS:LessonCardSpec[]=[
 {
  id:'cafe-landscape',
  title:'Cafe Conversation',
  titleZh:'咖啡馆对话',
  subtitle:'Landscape practice · 16:9',
  subtitleZh:'横版练习 · 16:9',
  aspect:'landscape',
  posterSrc:'/studio-assets/06-cafe-poster.jpg',
  videoSrc:'/studio-assets/06-cafe.mp4',
  href:'/studio/',
 },
 {
  id:'connie-landscape',
  title:'Education Ranger',
  titleZh:'教育护林员',
  subtitle:'NPS Connie Lau · landscape',
  subtitleZh:'NPS Connie Lau · 横版',
  aspect:'landscape',
  posterSrc:'/studio-assets/nps-connie/poster.jpg',
  videoSrc:'/studio-assets/nps-connie/connie-lau-education-ranger-720p.mp4',
  href:'/studio/',
  credit:'National Park Service · No claim to original U.S. Government works.',
 },
 {
  id:'cafe-portrait-frame',
  title:'Cafe · Portrait frame',
  titleZh:'咖啡馆 · 竖版框',
  subtitle:'Same media, portrait card',
  subtitleZh:'同一素材 · 竖版卡片',
  aspect:'portrait',
  posterSrc:'/studio-assets/06-cafe-poster.jpg',
  videoSrc:'/studio-assets/06-cafe.mp4',
  href:'/studio/',
 },
 {
  id:'connie-portrait-frame',
  title:'Ranger · Portrait frame',
  titleZh:'护林员 · 竖版框',
  subtitle:'Portrait card · dual aspect',
  subtitleZh:'竖版卡片 · 双画幅',
  aspect:'portrait',
  posterSrc:'/studio-assets/nps-connie/poster.jpg',
  videoSrc:'/studio-assets/nps-connie/connie-lau-education-ranger-720p.mp4',
  href:'/studio/',
  credit:'National Park Service · No claim to original U.S. Government works.',
 },
];
