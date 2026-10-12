/** All coordinates use one caller-selected unit, with x rightward and y downward. */
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;

export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export type ClampResult =
  | { ok: true; rect: Rect }
  | { ok: false; errors: string[] };

/** x denotes a vertical guide; y denotes a horizontal guide. */
export type GuideLine = { axis: 'x' | 'y'; position: number };
export type SnapEdge = 'start' | 'center' | 'end';
export type SnappedGuide = GuideLine & { edge: SnapEdge; delta: number };
export type SnapResult = { rect: Rect; guides: SnappedGuide[] };
export type AlignmentMode =
  | 'left' | 'right' | 'top' | 'bottom'
  | 'horizontal-center' | 'vertical-center';

const anchorFractions: Record<Anchor, readonly [number, number]> = {
  'top-left': [0, 0],
  'top-center': [0.5, 0],
  'top-right': [1, 0],
  'center-left': [0, 0.5],
  center: [0.5, 0.5],
  'center-right': [1, 0.5],
  'bottom-left': [0, 1],
  'bottom-center': [0.5, 1],
  'bottom-right': [1, 1],
};

function assertFinite(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number.`);
  }
}

function assertPoint(point: Readonly<Point>, name: string): void {
  if (!point || typeof point !== 'object') throw new TypeError(`${name} must be a point.`);
  assertFinite(point.x, `${name}.x`);
  assertFinite(point.y, `${name}.y`);
}

function assertSize(size: Readonly<Size>, name: string): void {
  if (!size || typeof size !== 'object') throw new TypeError(`${name} must be a size.`);
  for (const dimension of ['width', 'height'] as const) {
    assertFinite(size[dimension], `${name}.${dimension}`);
    if (size[dimension] <= 0) throw new RangeError(`${name}.${dimension} must be greater than zero.`);
  }
}

function assertRect(rect: Readonly<Rect>, name: string): void {
  assertPoint(rect, name);
  assertSize(rect, name);
  assertFinite(rect.x + rect.width, `${name} right edge`);
  assertFinite(rect.y + rect.height, `${name} bottom edge`);
}

function checkedRect(rect: Rect): Rect {
  assertRect(rect, 'result');
  return rect;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, value));
}

/** The immediately preceding representable number, including on either side of zero. */
function nextDown(value: number): number {
  if (value === 0) return -Number.MIN_VALUE;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + (value > 0 ? -1n : 1n));
  return view.getFloat64(0);
}

function clampCoordinate(value: number, start: number, extent: number, length: number): number {
  const end = start + extent;
  let position = clamp(value, start, Math.max(start, end - length));
  // Rounded subtraction and addition are not exact inverses. Move inward when a
  // right/bottom edge rounds outside, rather than returning a subtly unsafe rect.
  while (position + length > end) position = Math.max(start, nextDown(position));
  return position;
}

/** Convert an anchor's position to the rectangle's top-left position. */
export function resolveAnchoredRect(
  position: Readonly<Point>, size: Readonly<Size>, anchor: Anchor,
): Rect {
  assertPoint(position, 'position');
  assertSize(size, 'size');
  if (!Object.hasOwn(anchorFractions, anchor)) throw new TypeError(`Unsupported anchor: ${String(anchor)}.`);
  const [horizontal, vertical] = anchorFractions[anchor];
  return checkedRect({
    x: position.x - size.width * horizontal,
    y: position.y - size.height * vertical,
    width: size.width,
    height: size.height,
  });
}

/**
 * Resize each dimension independently into [minSize, bounds], then clamp position.
 * An impossible minimum returns errors and no rectangle, never an unsafe fallback.
 * Invalid/non-finite inputs throw; the inputs themselves are never changed.
 */
export function clampRectToSafeBounds(
  rect: Readonly<Rect>, bounds: Readonly<Rect>, minSize: Readonly<Size>,
): ClampResult {
  assertRect(rect, 'rect');
  assertRect(bounds, 'bounds');
  assertSize(minSize, 'minSize');
  const errors: string[] = [];
  for (const dimension of ['width', 'height'] as const) {
    if (minSize[dimension] > bounds[dimension]) {
      errors.push(`Safe bounds ${dimension} (${bounds[dimension]}) cannot fit minimum ${dimension} (${minSize[dimension]}).`);
    }
  }
  if (errors.length) return { ok: false, errors };

  const width = clamp(rect.width, minSize.width, bounds.width);
  const height = clamp(rect.height, minSize.height, bounds.height);
  return {
    ok: true,
    rect: checkedRect({
      x: clampCoordinate(rect.x, bounds.x, bounds.width, width),
      y: clampCoordinate(rect.y, bounds.y, bounds.height, height),
      width,
      height,
    }),
  };
}

/** Snap to a zero-origin square grid. Half-way values round toward positive infinity. */
export function snapPositionToGrid(point: Readonly<Point>, grid: number): Point {
  assertPoint(point, 'point');
  assertFinite(grid, 'grid');
  if (grid <= 0) throw new RangeError('grid must be greater than zero.');
  const snap = (value: number): number => {
    const units = value / grid;
    assertFinite(units, 'grid coordinate');
    const snapped = Math.round(units) * grid;
    assertFinite(snapped, 'snapped coordinate');
    return snapped === 0 ? 0 : snapped;
  };
  return { x: snap(point.x), y: snap(point.y) };
}

/**
 * Snap the nearest start edge, center or end edge to one guide per axis, translating
 * without resizing. Tolerance is inclusive. Ties choose the smaller guide position,
 * then start, center, end, regardless of input guide ordering. Guides return x first.
 */
export function snapRectToGuides(
  rect: Readonly<Rect>, guideLines: readonly Readonly<GuideLine>[], tolerance: number,
): SnapResult {
  assertRect(rect, 'rect');
  assertFinite(tolerance, 'tolerance');
  if (tolerance < 0) throw new RangeError('tolerance must be zero or greater.');
  if (!Array.isArray(guideLines)) throw new TypeError('guideLines must be an array.');
  for (const [index, guide] of guideLines.entries()) {
    if (!guide || (guide.axis !== 'x' && guide.axis !== 'y')) {
      throw new TypeError(`guideLines[${index}].axis must be x or y.`);
    }
    assertFinite(guide.position, `guideLines[${index}].position`);
  }

  const result: Rect = { ...rect };
  const guides: SnappedGuide[] = [];
  const edges: readonly SnapEdge[] = ['start', 'center', 'end'];
  for (const axis of ['x', 'y'] as const) {
    const length = axis === 'x' ? rect.width : rect.height;
    let best: SnappedGuide | undefined;
    let bestDistance = Infinity;
    let bestEdgeIndex = Infinity;
    for (const guide of guideLines) {
      if (guide.axis !== axis) continue;
      for (const [edgeIndex, edge] of edges.entries()) {
        const delta = guide.position - (rect[axis] + length * (edgeIndex / 2));
        const distance = Math.abs(delta);
        if (distance > tolerance) continue;
        if (distance < bestDistance || (distance === bestDistance && (
          !best || guide.position < best.position ||
          (guide.position === best.position && edgeIndex < bestEdgeIndex)
        ))) {
          best = { axis, position: guide.position, edge, delta: delta === 0 ? 0 : delta };
          bestDistance = distance;
          bestEdgeIndex = edgeIndex;
        }
      }
    }
    if (best) {
      result[axis] += best.delta;
      guides.push(best);
    }
  }
  return { rect: checkedRect(result), guides };
}

/**
 * Align against the selection's enclosing rectangle, preserving size and order.
 * horizontal-center changes x; vertical-center changes y. Empty input returns [].
 */
export function alignRects(rects: readonly Readonly<Rect>[], mode: AlignmentMode): Rect[] {
  const modes: readonly AlignmentMode[] = ['left', 'right', 'top', 'bottom', 'horizontal-center', 'vertical-center'];
  if (!modes.includes(mode)) throw new TypeError(`Unsupported alignment mode: ${String(mode)}.`);
  if (!Array.isArray(rects)) throw new TypeError('rects must be an array.');
  rects.forEach((rect, index) => assertRect(rect, `rects[${index}]`));
  if (rects.length === 0) return [];

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  const midpoint = (start: number, end: number): number => {
    const span = end - start;
    return Number.isFinite(span) ? start + span / 2 : start / 2 + end / 2;
  };
  return rects.map((rect) => {
    const result = { ...rect };
    switch (mode) {
      case 'left': result.x = left; break;
      case 'right': result.x = right - rect.width; break;
      case 'top': result.y = top; break;
      case 'bottom': result.y = bottom - rect.height; break;
      case 'horizontal-center': result.x = midpoint(left, right) - rect.width / 2; break;
      case 'vertical-center': result.y = midpoint(top, bottom) - rect.height / 2; break;
    }
    return checkedRect(result);
  });
}
