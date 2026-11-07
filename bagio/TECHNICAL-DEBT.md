# Technical debt — architecture audit baseline

Audit tasks, not assertions of defects. Keep existing project-specific technical debt and planning authoritative.

| ID | Status | Resolution evidence |
| --- | --- | --- |
| ENG-001 | Audit | Identify host-language original-source parsers/extractors, synthetic dictionary and address maps, and execution-token rewrites. Replace with original native load/XC mechanisms. |
| ENG-002 | Audit | Verify complete original-style source loading, compilation, runtime and target image. |
| ENG-003 | Audit | Trace native hardware adaptations to original source and get advance approval for deviations. |
| ENG-004 | Audit | Separate source tests, real native builds, ROM verification, MAME and hardware results. |

Close only with repository-specific evidence and commits. Refer to ../ENGINEERING-RULES.md.
