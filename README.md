# LingoTrace resource archive

All 33 original binary/large resource identities are preserved here as 39 uploaded objects, totaling 130,027,792 original bytes. Thirty originals are stored unchanged; three larger originals are split into the nine fixed chunks recorded in the manifests.

## Contents

- `originals/<Git blob SHA>`: 30 unchanged original files, including historical variants.
- `blobs/<original Git blob SHA>/chunk-NNN.bin`: nine ordered chunks for the two oversized videos and one WASM runtime.
- `resource-manifest.json`: archive paths, original source paths, exact byte lengths, Git blob SHA-1 values, SHA-256 values, and verification scope.
- `large-resources.json`: original/chunk identities and exact source-file placement for the verified source snapshots.

## Verification and limits

Every original or chunk was validated against its saved Git identity, byte length, and SHA-256 before upload. Each uploaded Git blob identity was confirmed, and the archive tree is checked for every file path, Git SHA, and byte length. The three oversized originals were also checked as complete files against their saved SHA-256 values.

Resource bytes are complete. The historical oversized-resource path map covers 146 accessible original Git commits, 12 additional snapshots proven by exact projected-source-tree identity, and the verified frozen candidate snapshot `b8285030fe8889a1de894f7cfe4ecb91b4d3746a`, whose projected source tree is `c8a344b1f1d864f944c0370c5bed3be6e80f8fa3`. The original plan covered 200 source identities; the remaining 41 path mappings have not been recovered and are not inferred. The candidate's original Git commit object has not been recovered; its mapped paths are verified from the exact reconstructed source snapshot.

## Restoring oversized bytes

Use the ordered chunks declared for an original in `large-resources.json`. Concatenate their raw bytes in that exact order to a new output file. Verify every chunk's byte length and SHA-256, then verify the reconstructed file's total byte length, SHA-256, and Git blob SHA-1 against the original entry. Select destination paths only from the manifest entry for the exact source identity you are restoring. Do not substitute a nearby version or overwrite unrelated files.

This branch is a resource archive, not a standalone application or a runtime acceptance test. It retains its initial commit ancestry and does not itself modify `main`.
