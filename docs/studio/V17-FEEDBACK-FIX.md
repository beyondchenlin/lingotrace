# v17: invalidate judgments when the draft changes

The v16 browser test found that scoring correctly invalidated a changed draft, but a separate scene message still said the sentence was matched. The bug affected presentation, not earned credit.

All current judgment text, checked-token colors, Next label and transient reward visibility now use the exact current cue, session/round, material version, draft version and visible text. During IME composition, the previous judgment is hidden. Typed edits, deletion and paste show an unjudged draft until a valid submission. Returning to the old correct text after an edit is still a new version and requires checking. Cancelling IME without changing text may restore the still-valid result.

Historical attempts and earned positions remain immutable. Refresh uses the same version-bound display rule. No score is deducted for editing or pausing. Loading notices remain separate from judgment state; the renderer rejects stale success text even if an old scene field still contains it.

Nine added tests cover exact matching, typing/deletion/paste, reverting text, IME commit/cancel, refresh, cue changes and an actual Canvas text-output regression. The Canvas test specifically rejects old success, Next and a stale gain while requiring an unjudged prompt. These tests do not replace real-browser event ordering.

Focused browser retest: complete one correct answer, then type/delete/paste and confirm the success/Next/highlight disappear without changing accumulated credit. Repeat with IME start/commit/cancel, changing back to the original text, and refresh after an edited draft. Submit again and verify the displayed attempt/version and export agree.

Visual scope is frozen at v16. The already-reported1px glyph edges, darker glass, subtitle translucency, flatter player background and small REC reconstruction artifacts remain disclosed. This candidate does not claim final1:1 visual acceptance.

Transient rewards also retain their own submitted attempt ID. Entering a historical event view cannot relabel a live gain as belonging to the replayed attempt. A rendered regression verifies this case.
