# Typed history partition correction

Baseline: `c5e47a783a24a1f2508f2246d92a80616621c77c`.

## Reproduced condition

Using only real repository write APIs with valid fixtures:

1. Save/admit a complete NPS listening session envelope.
2. Save a newer ordinary Café Training session.
3. Read Training history and perform ordinary default-course bootstrap.

The baseline Training-only list treats the valid listening envelope's intentional
compatibility sentinel as an unsupported Training schema. Ordinary NPS lookup
then fails on that row. The listening reader still validates the entire envelope.
This establishes a source-level defect; it does not identify the unavailable row
from a particular browser origin or prove that origin's root cause.

## Scope

The Training history list excludes only a listening envelope that passes the
existing full validator, including its actual IndexedDB primary-key identity.
Malformed recognized envelopes remain error rows, even if their sentinel was
changed into a superficially valid Training snapshot. Unknown formats continue
through the existing fail-closed Training reader. Pagination counts only the
Training partition and retains its original keyset ordering and bounded result.

No stored row, event, latest pointer, permission, admission, schema, or score is
rewritten. Direct Training detail/export acceptance is unchanged. A latest valid
listening session still restores as its full envelope; older listening records
remain available to their own reader/export path. Ordinary bootstrap's selection
policy is unchanged: it does not strip an older listening envelope into a plain
Training snapshot to use it as a saved NPS candidate.

## Verification

- Initial eight-case regression: four failures on the baseline, then eight passes.
- Final twelve-case regression additionally covers 101 listening rows preceding
  an older NPS Training row, a listening-only store, and wrong/non-string keys.
- 105 focused repository, bootstrap, exact-host course/admission, and partition
  tests pass with zero skips.
- `npm run typecheck` and `git diff --check` pass.
- Separate read-only fixtures verified v78 reference exposure followed by real
  input/submission/save/read for NPS and Café, and actual local-video selection
  followed by Café course admission. These normal paths remained readable.
- Aggregate tests, production build, and preserved-origin browser recovery are
  integration gates owned by the parent task; not run by this candidate.
