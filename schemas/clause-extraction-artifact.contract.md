# Clause extraction artifact v2 contract

The release-pinned JSON text is `clause-extraction-artifact.schema.json`. It uses only the v1b restricted Draft-07 keyword set and remains below 32 KiB/1,024 nodes. The Agent must not claim runtime validation until StructuredFileValidate is registered and granted.

| Area | Required bounded structure | Semantic invariant outside schema |
| --- | --- | --- |
| E1 identity | extraction id/time/executor/parser/ontology, upstream tuple, object tuple | exact source receipt must be Read |
| frozen parts | baseline v1, 1–64 entries, 5 MiB each | both part maps and part_count equal by stable id |
| E2–E10 | `payloads` has every named group; strict evidence records | quote has same-source FileDigest and native Grep evidence |
| coverage | exactly 19 strict rows | each catalog field group occurs exactly once |
| lifecycle | repair attempt 0–2 and ready/non-ready handoff branches | timeout/deadline/unavailable validation is HOLD |

A delivered part requires integer size, 64-character SHA-256, and null debt. An undelivered part requires null size/SHA and a non-empty typed debt; related coverage is blank or blocked, never not_present. A positive quote requires part, page, source SHA, exact quote, Grep state, and positions. `not_present` requires exhaustive same-source not_found evidence.

Lead independently reads the final artifact, uses v1a/v1b when available, FileDigest for each delivered source, and native Grep literals for each non-empty quote. It must HOLD on validation absence/failure, map mismatch, duplicate coverage, source mismatch, or active/unknown child state.
