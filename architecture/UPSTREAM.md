# Upstream Strategy

> **Status: PROPOSED.** Pins the upstream baseline and defines the drift
> management process. Evidence: `architecture/RECONNAISSANCE.md` section 0/11.

## 1. The fork

```
upstream GenOffice (genspark-ai/genoffice)
        |
   pinned commit
        |
Contractor GenOffice fork (pectoraux/contros-2.0)
```

### Verified state

| Field | Value |
| --- | --- |
| Product repository | `pectoraux/contros-2.0` |
| Origin | `https://github.com/pectauraux/contros-2.0.git` |
| Upstream | `https://github.com/genspark-ai/genoffice.git` |
| Fork relationship | `fork: true`, `parent: genspark-ai/genoffice` (GitHub API) |
| Default branch | `main` |
| Fork baseline commit | `04a994b9e92eb55a6806eaa1e6be18e381c9d9df` |
| Baseline commit subject | `Sync snapshot (2026-08-16) (#99)` |
| Divergence at baseline | none (merge-base == HEAD == upstream/main) |

The fork is genuine and has not diverged. Baseline = upstream HEAD at fork
time.

## 2. Pin the baseline

The fork baseline is **pinned** at `04a994b9e92eb55a6806eaa1e6be18e381c9d9df`.
This is recorded as the starting point. Upstream is **not** blindly tracked.

## 3. Upstream is a mirror

Per `CONTRIBUTING.md`:

> "This GitHub repository is a mirror: development happens in a private tree,
> and `main` here advances through single squashed snapshot commits
> (`Sync snapshot (<date>)`). That is why every file in a sync shows the same
> last-commit message, and why nobody — maintainers included — pushes to
> `main` directly."

Implications:

- `git log upstream/main` does **not** show PR-level history. It shows
  periodic "Sync snapshot" squashed commits.
- Drift management cannot cherry-pick individual upstream PRs from `git log`.
- Diffing must be at the **snapshot** level: `git diff <old-baseline>..
  <new-upstream-head>`.

## 4. Drift management process

When upstream advances (a new "Sync snapshot" commit lands on
`genspark-ai/genoffice` `main`):

```
1. fetch          git fetch upstream
2. diff           git diff <pinned>..upstream/main --stat
                  git diff <pinned>..upstream/main -- <path>
3. license scan   npm run licenses  (after install if deps changed)
                  cargo deny check licenses  (in apps/sheets/native/xlsx-engine)
4. architecture review   compare against architecture/ + ADRs
                         does the change rewrite a Contractor authority?
                         does it touch ee/? the license gate? a security boundary?
                         does it change the file-as-source-of-truth model?
5. tests          npm run typecheck && npm test && npm run lint
6. intentional merge
                  git merge upstream/main  (or rebase pinned branch)
                  resolve conflicts explicitly
                  re-run steps 3-5
7. re-pin         update the pinned-baseline record in this file
8. commit          "chore: sync upstream genoffice <new-sha>"
```

**Never:** auto-merge upstream. **Never:** `git pull upstream main` without
the review steps. **Never:** let upstream rewrite Contractor authorities.

## 5. What upstream changes are safe to absorb

- Bug fixes to the Office engines (`docx-engine`, `pptx-engine`,
  `pptx-render`, `xlsx-engine`) — high value, low architectural risk.
- Security hardening (renderer lockdown, IPC validation, `safeExternalUrl`,
  AST interpreter) — high value, low risk.
- License-gate allowlist additions (permissive only) — safe.
- New office-format fidelity — safe.
- Performance / memory improvements to engines — safe.

## 6. What upstream changes require architecture review

- Any change to `@genoffice/project-store` (affects the local-convenience-store
  boundary; Contractor domain authorities are separate, but the contract
  matters).
- Any change to `@genoffice/agent-core` / `@genoffice/ai-provider` /
  `@genoffice/ai-search` (affects the AI boundary; Contractor wraps these).
- Any change to `@genoffice/electron-utils` security helpers (affects the
  security boundary).
- Any change to the `WorkbookAdapter` contract (`getSnapshot`/`plan`/`apply`/
  `undo`) — affects the adapter pattern Contractor domain adapters follow.
- Any change to the IPC architecture / preload bridge.
- Any change to the build system (electron-vite, electron-builder, workspace
  layout).
- Any change to `ee/` (the enterprise boundary).
- Any change to the license gate allowlist (must not weaken it).

## 7. What upstream changes are blocked

- Changes that would make `ee/` code enter the Contractor domain-authority
  path.
- Changes that introduce GPL/AGPL/CPAL/SSPL/BUSL into production deps.
- Changes that weaken the renderer sandbox / IPC validation / `safeExternalUrl`
  / AST interpreter.
- Changes that silently make Univer (or any external engine) the domain
  authority.
- Changes that alter the file-as-source-of-truth model in a way that breaks
  the Contractor "office file is a representation" rule (ADR-0002).

## 8. Re-pin record

When a sync completes, append to this section:

```
### Sync <YYYY-MM-DD>
- upstream HEAD: <sha>
- previous pinned: <sha>
- new pinned: <sha>
- changes: <summary>
- license scan: pass/fail
- architecture review: pass (notes)
- tests: pass/fail
```

(No syncs yet. Baseline = `04a994b9e92eb55a6806eaa1e6be18e381c9d9d9df`.)

## 9. The legacy repository

`pectoraux/contros` is **reference material only**. It is NOT the product
foundation. It is NOT tracked as upstream. It is consulted selectively when
porting proven domain behavior (PricingEngine, EstimateRevision semantics,
BOQ domain, ProgrammeRevision, scheduling logic, PlanMeasurement, audit
conventions, tenant invariants, replay tests) — but only behavior/contracts,
not implementation boundaries (Next.js architecture, Prisma architecture,
legacy UI/routes/infrastructure). See ARCHITECTURE.md section 2 invariant 12
and the master prompt section 28.
