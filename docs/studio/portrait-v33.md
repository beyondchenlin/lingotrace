# v33 portrait anchor correction

Baseline v32 `54e58595a37df9ef42f957191e18969a939ccbf2`. Only the independent `/portrait-preview/` export is published; existing Studio/story public bytes and six pending Practice files stay unchanged. Same TrainingEngine, storage, exports, clock and composite recording canvas; no fixture route.

Original anchor regions are preserved: goal upper-left, trend upper-right, camera right, input events lower-left, subtitle/input/player bottom-center. HUD shapes keep uniform 0.58 scale; headings and secondary labels use readable local font sizes. Original breathing guides and sampled glass are retained. Logical height follows usable CSS aspect and clamps 940–1400 with natural scrolling; no fixed 640px auto-width cap.

Auto layout reads window and parent CSS width, visual viewport and orientation changes. Suspected keyboard height shrink preserves the unoccluded geometry including blur-before-close. Width/angle changes or restored height release that guard. A height-only desktop resize while editing cannot always be distinguished from a keyboard; no physical keyboard/IME claim is made. Geometry changes preserve the existing engine/session/media/animation clock. Native input, hit zones and editor use the same geometry; in-progress drags cancel if viewport or container changes. Saved raw layout preferences are not rewritten by resizing.

Validation before publication: 283 primary tests, 52 media tests, typecheck and static export passed. Independent bounded code review passed. Twelve landscape PNG comparisons were byte-identical. Original106 public files outside portrait were hash-identical; all six pending main-checkout Practice files were hash-identical. Program Canvas frames are separate from pending browser/device verification.
