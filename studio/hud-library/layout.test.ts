import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignRects, clampRectToSafeBounds, resolveAnchoredRect, snapPositionToGrid,
  snapRectToGuides, type AlignmentMode, type Anchor, type GuideLine, type Rect,
} from './layout';

const rect: Rect = { x: 10, y: 20, width: 40, height: 20 };
const bounds: Rect = { x: -10, y: 5, width: 100, height: 80 };
const minSize = { width: 20, height: 10 };

test('all nine anchors resolve their position to the top-left corner', () => {
  const expected: Record<Anchor, [number, number]> = {
    'top-left': [100, 100], 'top-center': [80, 100], 'top-right': [60, 100],
    'center-left': [100, 90], center: [80, 90], 'center-right': [60, 90],
    'bottom-left': [100, 80], 'bottom-center': [80, 80], 'bottom-right': [60, 80],
  };
  for (const [anchor, [x, y]] of Object.entries(expected)) {
    assert.deepEqual(resolveAnchoredRect({ x: 100, y: 100 }, rect, anchor as Anchor), {
      x, y, width: 40, height: 20,
    });
  }
});

test('clamping preserves valid rectangles, bounds positions and independently resizes', () => {
  assert.deepEqual(clampRectToSafeBounds(rect, bounds, minSize), { ok: true, rect });
  assert.deepEqual(clampRectToSafeBounds({ x: 200, y: -100, width: 5, height: 200 }, bounds, minSize), {
    ok: true, rect: { x: 70, y: 5, width: 20, height: 80 },
  });
  assert.deepEqual(clampRectToSafeBounds({ ...rect, width: 1000, height: 1000 }, bounds, minSize), {
    ok: true, rect: bounds,
  });
});

test('impossible minimum returns dimension-specific errors and no unsafe rectangle', () => {
  const result = clampRectToSafeBounds(rect, bounds, { width: 101, height: 81 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0], /width \(100\).*minimum width \(101\)/);
    assert.match(result.errors[1], /height \(80\).*minimum height \(81\)/);
    assert.equal('rect' in result, false);
  }
  assert.deepEqual(clampRectToSafeBounds(rect, bounds, bounds), { ok: true, rect: bounds });
});

test('clamping is contained, minimum-sized and idempotent across a matrix of moves and sizes', () => {
  for (const x of [-200, -10, 0, 50, 200]) {
    for (const y of [-200, 5, 40, 200]) {
      for (const width of [1, 20, 67, 1000]) {
        for (const height of [1, 10, 63, 1000]) {
          const result = clampRectToSafeBounds({ x, y, width, height }, bounds, minSize);
          assert.equal(result.ok, true);
          if (!result.ok) continue;
          const r = result.rect;
          assert.ok(r.x >= bounds.x && r.y >= bounds.y);
          assert.ok(r.x + r.width <= bounds.x + bounds.width);
          assert.ok(r.y + r.height <= bounds.y + bounds.height);
          assert.ok(r.width >= minSize.width && r.height >= minSize.height);
          assert.deepEqual(clampRectToSafeBounds(r, bounds, minSize), result);
        }
      }
    }
  }
});

test('grid snapping handles fractional and negative coordinates with a documented tie-break', () => {
  assert.deepEqual(snapPositionToGrid({ x: 13, y: 28 }, 10), { x: 10, y: 30 });
  assert.deepEqual(snapPositionToGrid({ x: -15, y: 15 }, 10), { x: -10, y: 20 });
  assert.deepEqual(snapPositionToGrid({ x: 0.36, y: -0.36 }, 0.25), { x: 0.25, y: -0.25 });
  assert.deepEqual(snapPositionToGrid({ x: -0.1, y: -0 }, 1), { x: 0, y: 0 });
});

test('fractional safe bounds never leak a rounded edge outside the containing rectangle', () => {
  let state = 0x4a35b192;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let index = 0; index < 10000; index++) {
    const safe = { x: random() * 200 - 100, y: random() * 200 - 100, width: random() * 100 + 1, height: random() * 100 + 1 };
    const candidate = { x: 1000, y: 1000, width: random() * 100 + 1, height: random() * 100 + 1 };
    const result = clampRectToSafeBounds(candidate, safe, { width: 1, height: 1 });
    assert.ok(result.ok);
    if (!result.ok) continue;
    assert.ok(result.rect.x >= safe.x && result.rect.y >= safe.y);
    assert.ok(result.rect.x + result.rect.width <= safe.x + safe.width);
    assert.ok(result.rect.y + result.rect.height <= safe.y + safe.height);
    assert.deepEqual(clampRectToSafeBounds(result.rect, safe, { width: 1, height: 1 }), result);
  }
});

test('guide snapping matches all edges and centers independently on both axes', () => {
  for (const [position, edge, delta] of [[8, 'start', -2], [32, 'center', 2], [49, 'end', -1]] as const) {
    const result = snapRectToGuides(rect, [{ axis: 'x', position }, { axis: 'y', position: 42 }], 2);
    assert.deepEqual(result.rect, { ...rect, x: rect.x + delta, y: 22 });
    assert.deepEqual(result.guides, [
      { axis: 'x', position, edge, delta },
      { axis: 'y', position: 42, edge: 'end', delta: 2 },
    ]);
  }
  assert.equal(snapRectToGuides(rect, [{ axis: 'y', position: 29 }], 1).guides[0].edge, 'center');
  assert.equal(snapRectToGuides(rect, [{ axis: 'y', position: 21 }], 1).guides[0].edge, 'start');
});

test('guide tolerance is inclusive, zero allows exact matches, and absent matches preserve geometry', () => {
  assert.deepEqual(snapRectToGuides(rect, [], 5), { rect, guides: [] });
  assert.deepEqual(snapRectToGuides(rect, [{ axis: 'x', position: 53 }], 2), { rect, guides: [] });
  assert.deepEqual(snapRectToGuides(rect, [{ axis: 'x', position: 10 }], 0), {
    rect, guides: [{ axis: 'x', position: 10, edge: 'start', delta: 0 }],
  });
});

test('nearest guide wins and equidistant ties do not depend on input order', () => {
  const guides: GuideLine[] = [{ axis: 'x', position: 32 }, { axis: 'x', position: 8 }];
  const result = snapRectToGuides(rect, guides, 3);
  assert.deepEqual(result, snapRectToGuides(rect, [...guides].reverse(), 3));
  assert.equal(result.rect.x, 8);
  assert.equal(snapRectToGuides(rect, [...guides, { axis: 'x', position: 51 }], 3).rect.x, 11);
  const betweenEdges = snapRectToGuides(rect, [{ axis: 'x', position: 20 }], 10);
  assert.equal(betweenEdges.guides[0].edge, 'start');
});

test('alignment uses enclosing selection edges and centers, while preserving size and order', () => {
  const rects = [rect, { x: 60, y: 70, width: 20, height: 40 }];
  const positions: Record<AlignmentMode, [number, number][]> = {
    left: [[10, 20], [10, 70]], right: [[40, 20], [60, 70]],
    top: [[10, 20], [60, 20]], bottom: [[10, 90], [60, 70]],
    'horizontal-center': [[25, 20], [35, 70]],
    'vertical-center': [[10, 55], [60, 45]],
  };
  for (const [mode, coordinates] of Object.entries(positions)) {
    const result = alignRects(rects, mode as AlignmentMode);
    assert.deepEqual(result, rects.map((r, index) => ({ ...r, x: coordinates[index][0], y: coordinates[index][1] })));
    assert.deepEqual(alignRects([], mode as AlignmentMode), []);
    assert.deepEqual(alignRects([rect], mode as AlignmentMode), [rect]);
  }
});

test('all primitives accept frozen inputs and return fresh geometry', () => {
  const r = Object.freeze({ ...rect });
  const b = Object.freeze({ ...bounds });
  const min = Object.freeze({ ...minSize });
  const list = Object.freeze([r]);
  const guide = Object.freeze({ axis: 'x' as const, position: 10 });
  assert.notEqual(resolveAnchoredRect(r, r, 'top-left'), r);
  const clamped = clampRectToSafeBounds(r, b, min);
  assert.ok(clamped.ok);
  if (clamped.ok) assert.notEqual(clamped.rect, r);
  assert.notEqual(snapPositionToGrid(r, 10), r);
  const snapped = snapRectToGuides(r, Object.freeze([guide]), 0);
  assert.notEqual(snapped.rect, r);
  assert.notEqual(snapped.guides[0], guide);
  const aligned = alignRects(list, 'left');
  assert.notEqual(aligned, list);
  assert.notEqual(aligned[0], r);
  assert.deepEqual(r, rect);
});

test('invalid coordinates, dimensions and numeric options are rejected', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.throws(() => resolveAnchoredRect({ x: bad, y: 0 }, rect, 'center'), /finite/);
    assert.throws(() => clampRectToSafeBounds({ ...rect, y: bad }, bounds, minSize), /finite/);
    assert.throws(() => clampRectToSafeBounds(rect, { ...bounds, x: bad }, minSize), /finite/);
    assert.throws(() => snapPositionToGrid({ x: 0, y: bad }, 10), /finite/);
    assert.throws(() => snapPositionToGrid(rect, bad), /finite/);
    assert.throws(() => snapRectToGuides(rect, [{ axis: 'x', position: bad }], 2), /finite/);
    assert.throws(() => snapRectToGuides(rect, [], bad), /finite/);
    assert.throws(() => alignRects([{ ...rect, x: bad }], 'left'), /finite/);
  }
  for (const bad of [0, -1, NaN, Infinity]) {
    assert.throws(() => resolveAnchoredRect(rect, { width: bad, height: 1 }, 'center'), RangeError);
    assert.throws(() => clampRectToSafeBounds(rect, bounds, { width: 1, height: bad }), RangeError);
    assert.throws(() => clampRectToSafeBounds({ ...rect, height: bad }, bounds, minSize), RangeError);
    assert.throws(() => clampRectToSafeBounds(rect, { ...bounds, width: bad }, minSize), RangeError);
    assert.throws(() => snapRectToGuides({ ...rect, width: bad }, [], 1), RangeError);
    assert.throws(() => alignRects([{ ...rect, height: bad }], 'bottom'), RangeError);
    assert.throws(() => snapPositionToGrid(rect, bad), RangeError);
  }
  assert.throws(() => snapRectToGuides(rect, [], -1), /tolerance/);
});

test('malformed discriminants and overflowing calculations are rejected', () => {
  assert.throws(() => resolveAnchoredRect(rect, rect, 'invalid' as Anchor), /anchor/);
  assert.throws(() => resolveAnchoredRect(rect, rect, 'toString' as Anchor), /anchor/);
  assert.throws(() => alignRects([], 'invalid' as AlignmentMode), /alignment/);
  assert.throws(() => snapRectToGuides(rect, [{ axis: 'z', position: 1 } as unknown as GuideLine], 2), /axis/);
  assert.throws(() => snapPositionToGrid({ x: Number.MAX_VALUE, y: 0 }, Number.MIN_VALUE), /finite/);
  assert.throws(() => resolveAnchoredRect({ x: Number.MAX_VALUE, y: 0 }, { width: Number.MAX_VALUE, height: 1 }, 'top-left'), /finite/);
});
