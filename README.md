# LingoTrace resource archive (partial)

This branch preserves exact resource bytes used by the LingoTrace source and historical snapshots.

Status: 23 original resource files are stored and verified by Git blob identity. Seven additional original model/runtime files and nine chunks representing three larger originals are still pending. This branch is not a complete backup or a standalone runnable application.

- `originals/<Git blob SHA>` contains the unchanged original bytes.
- `resource-manifest.json` records each expected object, its byte length, SHA-256, known original source path(s), archive path, and upload status.
- The complete historical oversized-resource path map is still pending recovery. Pending archive paths do not yet exist in this tree. No empty placeholder is substituted for missing bytes.

The intended frozen source identity is `b8285030fe8889a1de894f7cfe4ecb91b4d3746a`. Source and historical branches preserve their own file placement; the deduplicated objects here keep resources reachable independently.

This archive was created from the repository's initial commit as its parent. It does not change `main`.
