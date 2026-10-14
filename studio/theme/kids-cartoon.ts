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
}

export const PRO_EDITION:EditionSurface={
 id:'pro',tone:'#e8b86d',traceTone:'#e8b86d',plateAlpha:1,breathScale:1,
};

/** Softer, warmer cartoon pass — still glanceable game HUD, not a toy strip. */
export const KIDS_EDITION:EditionSurface={
 id:'kids',tone:'#ffb347',traceTone:'#7ad7ff',plateAlpha:1.08,breathScale:1.15,
};

export function editionSurface(id:StudioVisualEdition|undefined):EditionSurface{
 return id==='kids'?KIDS_EDITION:PRO_EDITION;
}
