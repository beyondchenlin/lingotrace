# v21: protect inset content from its status footer

The v20 browser matrix found that a portrait or square lesson shown in the inset with camera-primary layout was covered by its bottom REC/preview status strip. The renderer contained media in the entire273×218 logical-pixel frame and then painted a37pixel footer over that area. For portrait and square sources this hid the bottom37pixels of the contained result;16:9 also slightly intersected the footer.

The normal inset now reserves the existing37pixel footer before containing its camera/lesson content. Its outer rect, resize/dock controls, footer location and every main HUD rect are unchanged. Split layout has no such footer and is unchanged. The explicitly simulated reference-image mode retains its original picture and REC rendering for honest comparison.

Two program tests execute actual Canvas draws across landscape/portrait/square sources, camera-primary/course-primary modes, recording on/off, and default/custom inset sizes. They verify source ratio, bounds and no source/footer intersection. They do not prove browser recording output, audio synchronization or1:1 visual acceptance. The two desktop reference-mode program PNGs are compared before/after separately; browser confirmation is still required for the affected inset.

The parent-reported v20 browser evidence is preserved at V20-FINAL-ACCEPTANCE.json. Its nine synthetic silent recordings fully encoded, played and downloaded, but initial WebM duration was Infinity before becoming finite on complete playback. That observation is not a proof of initial seek usability, physical camera operation, audio mixing or a specific muxing cause.
