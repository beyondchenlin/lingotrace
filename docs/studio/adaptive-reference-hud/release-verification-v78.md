# LingoTrace v78 · Release verification

## Scope and identity

This release improves local brightness-adaptive HUD readability, full-reference native typing and secondary settings. It also keeps valid listening records separate from Training history so normal recovery can proceed without changing stored records.

- Reviewed source: `bed4ad4dcb7ceb2a502b5634cc436d7e9e491210`. Its runtime and tests match independently reviewed `1372bf1cbd9af6523de25083472ab3ed33f5e104`; the final source commit adds paired documentation updates only.
- Existing public Site: https://lingotrace-training-demo.beyond-chenlin.chatgpt.site/studio/.
- BUILD_ID: `t3WKnlSV_PZXWt3jgxi2P`.
- Tested frozen build: 341 files; canonical tree SHA-256 `ae52c40f48e9d1054e032e267b5a8a6ddb41a50fde0b680360e39c714330fbc4`.
- Deployment assembly retains 19 previously published immutable assets, yielding 360 files and tree SHA-256 `140c0c9e41d3ebf2f405bb2fd99dafebe2c322e72f10d77a898f09d4eefe7a31`. All 194 overlapping immutable files have identical bytes. All 118 protected public assets are unchanged.
- Released v77 documentation is preserved. The release preparation changes only this evidence note and the v78 Detailed PRD status/evidence text beyond the reviewed source; requirement clauses and runtime/test/build bytes are unchanged.

## Completed verification

- Exact aggregate: 1,838 core/scene tests passed with no failures/skips; 815 media tests passed with one pre-existing optional recorded-MediaRecorder fixture skip; 93 HUD-library tests passed with no failures/skips. TypeScript and production static export passed.
- Independent UI review: 108 focused checks and 192 action-region containment probes. Independent history-reader review: 100 focused checks and 31 mixed-record pagination probes. The final documentation-only source delta was reviewed separately.
- Actual cloud-browser HUD checks exercised dark/intermediate/white video frames and smooth settling, including readable typing status/action glyphs on white. Native partial-word, pasted tab/newline, moved selection, hidden reference, strict listening, compact settings and narrow portrait behavior were exercised. Numerical linearity is supported by source tests; visual observation alone is not a numerical measurement.
- Exact final build was exercised on the retained origin using the product's normal recovery action. The former recovery warning disappeared, retained Training rows remained readable, listening history remained separately accessible, and normal History → Continue restored Café with working native input. No storage clearing, migration, record repair or deletion was used.
- Stored assistance remained explicit after Hide/reload and a genuine input/submit sequence. The isolated no-repaint disclosure-marker edge remains source-test evidence rather than a separately isolated browser result.

## Honest limits

These are cloud-browser and automated checks, not physical-device certification. Actual CORS-tainted fallback pixels, physical phone/software keyboard, hardware IME, camera/microphone acquisition, encoded recording-output parity, physical immersive fullscreen and genuine background-visibility behavior remain unverified. NPS cloud/HTTP restrictions were not bypassed. No sampled frame is uploaded or stored by the new brightness feature.

This note records pre-publication acceptance on 2026-10-11. Public HTTPS smoke is a separate post-deployment check; final release/deployment identity is supplied by the saved Site version record, rather than a self-referential hash inside these documents. No end-user visual acceptance is claimed.

The retained rollback is public v77, release `b834152bbb6fa36ab9e5ff15ff3e3f2234c03d67`, saved version `appgprj_6ac5ccefb20481918a883afab8a483b4~appgver_6fd6b291bb688191999f1cbabe48eaca`.
