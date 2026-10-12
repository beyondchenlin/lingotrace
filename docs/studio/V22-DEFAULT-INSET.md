# v22: lower only the actual default inset

The user reported that the upper-right camera region visually crossed the top shaded band and asked for a slight downward move. The parent confirmed the issue in the actual Windows browser at1672×941and1920×1080: approximately44.6pxand51.1px of visual band overlap, while the progress line retained at least20.8pxand23.9px horizontal clearance. The frame had no separate shadow beyond its roughly2logical-pixel edge.

The actual default inset moves from logical y46to108. Its x1378,width273,height218and37pixel status-footer reservation remain unchanged. The top band still ends at y89, leaving19logical pixels, approximately17after allowing for the observed outer edge. Both course-primary camera inset and camera-primary course inset share the change. The large split pane retains its prior geometry.

Canvas rendering, composite-recording pixels and the DOM camera hit target use the same inset resolver. Layout editing uses the same default rectangle. Removing an inset override or resetting the actual layout returns to y108. No storage schema or saved-layout value is rewritten; any explicit valid saved/custom rect, including the old y46position, retains priority. A user can choose Reset to apply the new default. Reset labels now say default layout, not original-image layout.

The original reference asset and its clearly labeled simulated reference mode remain at y46. Reference photo patches use original absolute coordinates and are unchanged. The normal default and original reference deliberately differ for this user-requested correction; the interface and this record do not claim exact positional identity.

## Verification boundary

Program checks cover both desktop baseline scales, saved-layout preservation, per-item/reset semantics, reference priority, split preservation and actual Canvas inset geometry. Recording draws the same Canvas and uses the same resolver; a new real-browser recorded-output check is still needed. No camera or microphone is opened by these tests. Existing learning state, scoring, recorder lifecycle and storage behavior are unchanged.

Before editing, v21 was backed up. The prior final finite browser/audio acceptance remains in the independently saved v21 ledger. This change does not declare all1:1visual, real-device, native IME, long-recording or cross-browser requirements complete.
