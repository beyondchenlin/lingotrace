/** Card carousel motion profiles — presentation only. */
export type CarouselMotionId = 'depth-deck' | 'magnetic-reveal';

export interface CarouselMotionProfile {
 id:CarouselMotionId;
 /** Active card scale. */
 focusScale:number;
 /** Neighbor scale / opacity for depth. */
 neighborScale:number;
 neighborOpacity:number;
 /** Settle spring-ish duration in ms (ignored when reduced motion). */
 settleMs:number;
 /** Extra magnetic snap overshoot in CSS px. */
 snapOvershoot:number;
}

export const DEPTH_DECK:CarouselMotionProfile={
 id:'depth-deck',focusScale:1,neighborScale:.92,neighborOpacity:.55,settleMs:420,snapOvershoot:0,
};

export const MAGNETIC_REVEAL:CarouselMotionProfile={
 id:'magnetic-reveal',focusScale:1.02,neighborScale:.88,neighborOpacity:.4,settleMs:520,snapOvershoot:18,
};

export function carouselMotion(id:CarouselMotionId):CarouselMotionProfile{
 return id==='magnetic-reveal'?MAGNETIC_REVEAL:DEPTH_DECK;
}

export interface LessonCardSpec {
 id:string;
 titleKey:string;
 aspect:'landscape'|'portrait';
 posterSrc:string;
 href:string;
}

/** Demo deck — uses existing studio poster until kids art lands. */
export const DEMO_LESSON_CARDS:LessonCardSpec[]=[
 {id:'cafe-landscape',titleKey:'studio.media',aspect:'landscape',posterSrc:'/studio-assets/06-cafe-poster.jpg',href:'/studio/'},
 {id:'cafe-portrait',titleKey:'studio.media',aspect:'portrait',posterSrc:'/studio-assets/06-cafe-poster.jpg',href:'/studio/'},
];
