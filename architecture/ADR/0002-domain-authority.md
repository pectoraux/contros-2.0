# ADR-0002: Domain authority vs. office-file-as-source-of-truth

> **Status: PROPOSED.** Resolves the central tension between GenOffice's
> byte-preserving file-as-source-of-truth philosophy and Contractor GenOffice's
> revisioned domain-authority model.

## Context

GenOffice's unifying philosophy (README): "The original file is the source of
truth, edits are applied as narrow patches, and everything the editor didn't
touch survives the round trip untouched."

- Docs: `.docx` is authoritative; `docx-engine` patches dirty paragraphs.
- Sheets: `.xlsx` is authoritative; `xlsx-gateway` rewrites only the target
  worksheet, atomic rename.
- Slides: `.pptx` is authoritative.
- PDF: `.pdf` is authoritative.
- Markdown: `.md` is authoritative.

Contractor GenOffice needs revisioned, immutable, tenant-scoped domain
authorities: `EstimateRevision`, `ProgrammeRevision`, `PlanMeasurement`,
`ProjectActual`, `Goal`. These cannot be "the .xlsx file" because:

1. A file is not tenant-scoped, not revisioned, not reconstructable from
   canonical inputs + algorithm version.
2. A file cannot enforce immutability-once-finalized.
3. A file cannot be the canonical authority *and* a representation that the
   user edits freely — that creates a second authority (ARCHITECTURE.md
   invariant 2).

But the Office substrate's value **is** byte-preserving fidelity. We must not
break that. So the two models must coexist.

## Decision

**The office file is a representation of canonical domain state. The domain
authority is the revisioned, tenant-scoped, DB-backed record.**

- `EstimateRevision` (authority) <-> estimate workbook (representation).
- `ProgrammeRevision` (authority) <-> Gantt/.mpp/.xer file (representation).
- `PlanMeasurement` (authority) <-> BIM viewer state + source artifact
  (representation / evidence).
- `ProjectActual` (authority) <-> field reports / progress dashboards
  (representation).
- `Goal` (intent authority) + derived achievement <-> KPI dashboard
  (representation).

### Reconciliation rules

1. **Editing a representation edits the representation.** The application
   service finalizes the authority. The UI never writes the authority
   directly.
2. **A representation can be regenerated from the authority.** The reverse
   is never silently true.
3. **The Office substrate's byte-preserving fidelity is preserved for the
   representation.** When a user edits the estimate workbook, the
   `xlsx-gateway` still byte-preserves the `.xlsx` (GenOffice's value). The
   `EstimateRevision` is finalized separately, from the same inputs, through
   the application service.
4. **The `WorkbookAdapter` pattern mediates.** GenOffice's `WorkbookAdapter`
   (`getSnapshot`/`plan`/`apply`/`undo`) already abstracts editor-agnostic
   AI planning, transaction safety, and audit. Contractor domain adapters
   follow the same pattern: the adapter exposes `getSnapshot`/`plan`/`apply`/
   `undo` against the *representation*, and the application service finalizes
   the *authority* from the accepted plan.
5. **AI candidates edit the representation (provisionally).** Finalization to
   the authority goes through the application service (AI-as-advisory,
   ARCHITECTURE.md invariant 8).

### Concrete example (Estimate)

```
User edits estimate workbook (Univer UI)
  -> WorkbookAdapter.plan(change)        # representation-level plan
  -> user approves
  -> application service.finalizeEstimateRevision(inputs, audit)
       └─ ONE db.tx(): repository.create(...) + audit.append(...) commit
          together (ADR-0007 Decision 18 — Audit Atomicity). If either
          fails, both roll back.
  -> EstimateRevision (immutable authority) + audit event persist together
```

The `.xlsx` file on disk is still byte-preserved by `xlsx-gateway`. The
`EstimateRevision` is the canonical commercial truth. The workbook is a view
that can be regenerated from the revision.

## Q2 — Exact synchronization semantics

**PARTIALLY UNRESOLVED.**

- **QUESTION:** When the user edits the workbook representation and then the
  service finalizes an `EstimateRevision`, what is the exact relationship
  between the on-disk `.xlsx` and the `EstimateRevision`? Specifically:
  - Is the `.xlsx` the *input* to the revision (the user authored it, the
    service reads it)? Or is the `.xlsx` a *generated output* of the revision
    (the service owns the revision, the `.xlsx` is rendered from it)?
  - What happens if the `.xlsx` and the `EstimateRevision` diverge (e.g. the
    user edits the `.xlsx` outside the app)?
- **CURRENT EVIDENCE:** GenOffice today has no domain authority, so the
  `.xlsx` *is* the only truth. Contractor OS introduces the authority, which
  is new ground.
- **OPTIONS:**
  1. **Authority-first.** The `EstimateRevision` is canonical. The `.xlsx`
     is always a generated representation. Users edit a *working copy* of the
     `.xlsx`; finalizing promotes the working copy's content into an
     `EstimateRevision`, after which the canonical `.xlsx` is regenerated
     from the revision. Divergence = the working copy is dirty.
  2. **File-first.** The `.xlsx` is canonical (GenOffice's model). The
     `EstimateRevision` is a *snapshot* derived from the `.xlsx` at finalize
     time. Divergence is not possible (the file IS the truth; the revision is
     a historical snapshot).
  3. **Bidirectional with explicit promotion.** Either can be edited; an
     explicit "promote" action reconciles them. (Complex; risks two
     authorities.)
- **TRADE-OFFS:**
  - Option 1 is cleanest authority-wise but breaks GenOffice's
    file-as-source-of-truth for Contractor domain entities. Requires the
    service to regenerate the canonical `.xlsx` from the revision (the
    `xlsx-gateway` would need a "generate from EstimateRevision" path, which
    it does not have today).
  - Option 2 preserves GenOffice's model fully but means the
    `EstimateRevision` is a snapshot, not a true authority (it can't be
    replayed from canonical inputs if the `.xlsx` is the input). This
    weakens the revision rule (ARCHITECTURE.md invariant 3).
  - Option 3 is the most flexible but the most dangerous (second authority
    risk).
- **RECOMMENDATION:** Option 1 (authority-first) for Contractor domain
  entities, **pending Principal Architect confirmation**. The
  `EstimateRevision` is canonical; the `.xlsx` is a generated representation
  for Contractor domain entities. GenOffice's byte-preserving fidelity
  continues to apply to *non-domain* office files (a user's standalone
  `.docx` memo, a `.pdf` contract, etc.) — those remain file-as-source-of-
  truth, with no Contractor authority. Only domain entities (estimates,
  programmes, measurements, actuals, goals) get the authority treatment.
- **STATUS: UNRESOLVED** — pending confirmation. The recommendation is to
  treat domain entities as authority-first and leave non-domain office files
  as GenOffice does today.

## Consequences

- The office engines are untouched (DO NOT TOUCH).
- A new domain-authority layer is built (tenant-scoped, DB-backed, behind
  application services).
- The `WorkbookAdapter` pattern is extended to domain adapters.
- AI candidates edit representations; services finalize authorities.
- Non-domain office files keep GenOffice's file-as-source-of-truth model.

## Verification

- This ADR is design-only. No code changes in the baseline commit.
- The reconciliation is testable once the domain layer exists: finalize an
  `EstimateRevision` from a workbook, regenerate the workbook, verify
  content equivalence; mutate the working copy, verify the authority is
  unaffected; replay the revision from canonical inputs, verify equivalence.
