/** Kids/cartoon edition tokens — presentation only; never alters training facts. */
export type StudioVisualEdition = 'pro' | 'kids';

export interface EditionSurface {
 id:StudioVisualEdition;
 /** Accent used for goal ticks / flow bars (Canvas stroke). */
 tone:string;
 /** Trend stroke. */
 traceTone:string;
 /** Soft plate alpha multiplier for HUD backing (1 = unchanged). */
 plateAlpha:number;
 /** Slightly rounder drafting breath amplitude. */
 breathScale:number;
 /** HUD plate corner radius (Canvas). */
 plateRadius:number;
 /** Warm fill tint over standard plate (0–1). */
 warmLift:number;
}

export const VISUAL_EDITION_STORAGE_KEY='lingotrace-studio-visual-edition-v1';

export const PRO_EDITION:EditionSurface={
 id:'pro',tone:'#ffc15f',traceTone:'#9bddff',plateAlpha:1.04,breathScale:1,plateRadius:18,warmLift:0.02,
};

/** Softer, warmer cartoon pass — still glanceable game HUD, not a toy strip. */
export const KIDS_EDITION:EditionSurface={
 id:'kids',tone:'#ffb347',traceTone:'#7ad7ff',plateAlpha:1.16,breathScale:1.28,plateRadius:22,warmLift:.12,
};

export function editionSurface(id:StudioVisualEdition|undefined):EditionSurface{
 return id==='kids'?KIDS_EDITION:PRO_EDITION;
}

export function normalizeVisualEdition(value:unknown):StudioVisualEdition{
 return value==='kids'?'kids':'pro';
}

export function readVisualEdition(storage:Pick<Storage,'getItem'>|null):StudioVisualEdition{
 try{return normalizeVisualEdition(storage?.getItem(VISUAL_EDITION_STORAGE_KEY))}catch{return 'pro'}
}

export function writeVisualEdition(storage:Pick<Storage,'setItem'>|null,edition:StudioVisualEdition):boolean{
 try{if(!storage)return false;storage.setItem(VISUAL_EDITION_STORAGE_KEY,edition);return true}catch{return false}
}
