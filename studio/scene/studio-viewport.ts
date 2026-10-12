export type StudioLayoutMode = 'auto' | 'portrait' | 'landscape';

export interface StudioViewportSize {
  width: number;
  height: number;
}

export interface StudioViewportState {
  portrait: boolean;
  /** Visible CSS bounds, including visual-viewport occlusion and pinch zoom. */
  usableWidth: number;
  usableHeight: number;
  /** Bounds used for auto layout, before suspected keyboard occlusion. */
  stableWidth: number;
  stableHeight: number;
  keyboardSuppressed: boolean;
  /** Last valid window measurements, used if a later sample is invalid. */
  layoutWidth: number;
  layoutHeight: number;
  /** Window width associated with the stable bounds, even in a narrow container. */
  stableLayoutWidth: number;
  orientationAngle?: number;
}

export interface StudioViewportInput {
  layoutViewport: StudioViewportSize;
  containerWidth?: number;
  visualViewport?: StudioViewportSize & { scale?: number };
  editableFocused?: boolean;
  orientationAngle?: number;
  previous?: StudioViewportState;
  manualMode?: StudioLayoutMode;
}

const positive = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const dimension = (value: number | undefined, fallback: number | undefined) =>
  positive(value) ? value : positive(fallback) ? fallback : 1;

// Allow CSS rounding and small browser-chrome changes, not a width breakpoint.
const nearWidth = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, b * 0.01);

const normalizedAngle = (angle: number | undefined) =>
  typeof angle === 'number' && Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : undefined;

/**
 * Resolve layout from CSS geometry only. A square uses portrait. Invalid window
 * dimensions reuse the previous valid dimension, or 1 CSS px on the first call;
 * invalid optional dimensions are ignored. No screen pixels, DPR, UA or clock.
 *
 * Focus plus a height reduction at nearly unchanged window/container widths is
 * only a keyboard heuristic. It also suppresses a real height-only resize while
 * editing; geometry alone cannot distinguish those cases. Width/angle changes,
 * or restored height release that suppression. Blur alone keeps a known keyboard
 * occlusion until its viewport animation restores the height, avoiding a brief
 * landscape flip between focusout and the closing keyboard resize. Without
 * an earlier sample (or an unoccluded layout viewport), an already-open keyboard
 * cannot be inferred. Pass the returned state back as `previous` on each call.
 *
 * Pinched visual bounds remain useful as visible CSS measurements, but are not
 * orientation evidence: auto layout uses the layout viewport while scale != 1.
 * Manual mode controls the result without replacing the auto-layout baseline.
 */
export function resolveStudioViewport(input: StudioViewportInput): StudioViewportState {
  const previous = input.previous;
  const layoutWidth = dimension(input.layoutViewport.width, previous?.layoutWidth);
  const layoutHeight = dimension(input.layoutViewport.height, previous?.layoutHeight);
  const containerWidth = positive(input.containerWidth) ? Math.min(layoutWidth, input.containerWidth) : layoutWidth;
  const visualWidth = dimension(input.visualViewport?.width, layoutWidth);
  const visualHeight = dimension(input.visualViewport?.height, layoutHeight);
  const visualScale = dimension(input.visualViewport?.scale, 1);
  const pinched = Math.abs(visualScale - 1) > 0.000001;
  const usableWidth = Math.min(containerWidth, visualWidth);
  const usableHeight = Math.min(layoutHeight, visualHeight);
  const modeWidth = pinched ? containerWidth : usableWidth;
  const modeHeight = pinched ? layoutHeight : usableHeight;
  const currentAngle = normalizedAngle(input.orientationAngle);
  const previousAngle = normalizedAngle(previous?.orientationAngle);
  const orientationChanged = currentAngle !== undefined && previousAngle !== undefined && currentAngle !== previousAngle;
  const validBaseline = previous && positive(previous.stableWidth) && positive(previous.stableHeight) && positive(previous.stableLayoutWidth);
  const sameFrame = validBaseline && !orientationChanged &&
    nearWidth(layoutWidth, previous.stableLayoutWidth) && nearWidth(modeWidth, previous.stableWidth);

  // On the first sample, a full-height layout viewport can itself supply the
  // unoccluded baseline when only the visual viewport shrank around an input.
  const baselineWidth = sameFrame ? previous.stableWidth : containerWidth;
  const baselineHeight = sameFrame ? previous.stableHeight : layoutHeight;
  const canInferOcclusion = sameFrame || (!previous && !pinched && nearWidth(modeWidth, containerWidth));
  const keyboardSuppressed = Boolean((input.editableFocused || (sameFrame && previous?.keyboardSuppressed)) && canInferOcclusion && modeHeight < baselineHeight);
  const stableWidth = keyboardSuppressed ? baselineWidth : modeWidth;
  const stableHeight = keyboardSuppressed ? baselineHeight : modeHeight;
  const stableLayoutWidth = keyboardSuppressed && sameFrame ? previous.stableLayoutWidth : layoutWidth;
  const autoPortrait = stableHeight >= stableWidth;
  const portrait = input.manualMode === 'portrait' ? true : input.manualMode === 'landscape' ? false : autoPortrait;

  return {
    portrait,
    usableWidth,
    usableHeight,
    stableWidth,
    stableHeight,
    keyboardSuppressed,
    layoutWidth,
    layoutHeight,
    stableLayoutWidth,
    orientationAngle: currentAngle ?? previousAngle,
  };
}


/** Fit one complete logical scene inside the stable usable CSS rectangle.
 * Keyboard occlusion keeps the stable scene dimensions; input scrolling is a
 * separate concern. A very short surface still fits, but reports reduced
 * readability/touch size rather than cropping any component.
 */
export function fitStudioSurface(viewport:Pick<StudioViewportState,'stableWidth'|'stableHeight'>,logicalWidth:number,logicalHeight:number){
 const width=dimension(viewport.stableWidth,1),height=dimension(viewport.stableHeight,1);
 const w=dimension(logicalWidth,1),h=dimension(logicalHeight,1);
 // Round down the fitted width to avoid a fractional-pixel overflow/scrollbar loop.
 const fittedWidth=Math.floor(Math.min(width,height*w/h)*100)/100,scale=fittedWidth/w;
 return {width:fittedWidth,height:h*scale,scale,compact:scale<.85};
}


/** The conditional small-space notice must not choose the orientation that
 * makes itself appear. It does still consume the fitted surface height. */
export function splitToolbarHeight(totalHeight:number,noticeHeight=0,rowGap=0){
 const total=Number.isFinite(totalHeight)?Math.max(0,totalHeight):0;
 const extra=noticeHeight>0&&Number.isFinite(noticeHeight)?Math.min(total,noticeHeight+(Number.isFinite(rowGap)?Math.max(0,rowGap):0)):0;
 return {orientationHeight:total-extra,fitExtraHeight:extra};
}
