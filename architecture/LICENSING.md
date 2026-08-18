# Licensing

> **Status: PROPOSED.** Licensing is an architecture gate, not an afterthought.
> Evidence: `architecture/RECONNAISSANCE.md` section 12. The existing GenOffice
> license gates (`tools/check-licenses.mjs`, `apps/sheets/native/xlsx-engine/
> deny.toml`) are REUSED and extended only with permissive licenses.

## 1. The product license

Contractor GenOffice inherits GenOffice's licensing posture:

- **Root: Apache-2.0** (Copyright 2026 Mainfunc, Inc.). Permissive. Aligns
  with the master prompt's preferred licenses.
- **`ee/`: GenOffice Enterprise License** — source-available, dev/test only;
  production/hosting/distribution requires a Mainfunc enterprise agreement.
  **Currently empty** (reserved boundary). No Contractor domain authority
  lives here. Enforced via `.github/CODEOWNERS` (GenOffice).
- **No CLA.** Inbound = outbound Apache-2.0 section 5 ("the open-source core
  cannot be retroactively relicensed"). Stable for the fork.

## 2. Preferred vs. excluded licenses

### Preferred (allowlist)

```
MIT, MIT-0, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD,
BlueOak-1.0.0, CC0-1.0, CC-BY-4.0, Zlib, Unlicense, Python-2.0,
Unicode-3.0, OFL-1.1, MPL-2.0, LGPL-2.1 (with care)
```

This matches the existing GenOffice npm allowlist (`tools/check-licenses.mjs`)
plus MPL/LGPL (which the master prompt lists as acceptable but GenOffice's
gate currently excludes — extending the gate to allow MPL/LGPL is a
**DECISION PENDING** in ADR-0001 Q-lic1, because the master prompt explicitly
lists MPL as preferred but GenOffice's gate is stricter).

### Excluded (casually)

```
GPL-2.0, GPL-3.0, AGPL-3.0, CPAL-1.0, SSPL, BUSL (functional-source),
proprietary (unless enterprise-licensed and isolated)
```

No GPL/AGPL/CPAL in the core product or distributed Electron bundle. Verified
**absent** from current production npm deps (`node tools/check-licenses.mjs`
-> exit 0) and Rust deps (`cargo-deny` allowlist excludes them).

### If a copyleft dependency is approved

Document:

- why it is needed
- the isolation boundary (in-process / worker / child process / isolated
  service / reference-only)
- the obligations (source availability, attribution, etc.)
- the CI/license check that enforces the boundary

Do not assume legal compliance from technical isolation alone. Escalate
ambiguous legal questions to human/legal review.

## 3. The license gates (REUSE + extend)

### npm — `tools/check-licenses.mjs`

- Reads `package-lock.json` (no install needed).
- Allowlist: see section 2.
- Handles SPDX `OR`/`AND`/`WITH`; `/` dual-license shorthand.
- `EXCEPTIONS` map for packages with missing license fields (currently
  `@univerjs/telemetry: Apache-2.0`).
- Exits non-zero on violation.
- Run: `npm run licenses`.

**REUSE.** Extend the allowlist only with permissive licenses. Never weaken.

### Rust — `apps/sheets/native/xlsx-engine/deny.toml`

- `cargo-deny` (`cargo deny check licenses`).
- Allowlist: MIT, Apache-2.0, Apache-2.0 WITH LLVM-exception, BSD-2-Clause,
  BSD-3-Clause, 0BSD, Zlib, Unicode-3.0, Unlicense, CC0-1.0, BSL-1.0.
- Run as part of `npm test` (Rust sidecar tests).

**REUSE.** Extend only with permissive licenses.

### Third-party notices — `tools/gen-third-party-notices.mjs`

- Generates `THIRD-PARTY-NOTICES.txt` at packaging time (not checked in; ships
  in the bundle).
- Run: `npm run notices` (also runs as part of `dist:*`).

**REUSE.**

## 4. Specific dependency assessments

| Dependency | License | Assessment |
| --- | --- | --- |
| Electron | MIT | OK — desktop runtime |
| Univer core (`@univerjs/*`) | Apache-2.0 | OK — but **avoid Univer Pro** (license-gated; README references "license-gated Univer Pro chart package"). Stay on Apache core; verify per-feature. |
| pdf.js | Apache-2.0 | OK |
| pdf-lib | MIT | OK |
| PDFium (via `@embedpdf/pdfium`) | BSD-3-Clause | OK |
| Tiptap / ProseMirror | MIT | OK |
| Konva | MIT | OK — rendering primitive |
| HarfBuzz (wasm) | MIT | OK — shaping only |
| calamine + IronCalc (Rust) | MIT/Apache | OK — xlsx sidecar IO only |
| acorn | MIT | OK — AST parsing for AI scripts |
| Liberation / Carlito / Caladea / Noto CJK fonts | OFL/Apache-2.0 | OK |
| Unicode Character Database (radicals.ts) | Unicode-3.0 | OK (`LICENSE-UNICODE.txt`) |

### Future dependencies (evaluated, not adopted)

These are candidates for later phases. Each requires the assessment in
`third-party/README.md` before adoption:

- **MPXJ** (schedule file IO: .mpp/.xer/.pmxml) — license TBD; assess. Role:
  isolated interoperability component, never the scheduling authority.
- **web-ifc / ThatOpen components / Fragments** (BIM viewer) — MIT/Apache
  expected; verify. Role: viewer + measurement candidate source.
- **IfcOpenShell** (server-side IFC geometry) — license TBD; assess. Role:
  isolated service.
- **A Gantt library** — license TBD; assess. Role: rendering primitive only.

## 5. Trademark

**GenOffice and Genspark names and logos are trademarks of Mainfunc, Inc.**
The Apache-2.0 license does not grant permission to use them (section 6).
Forks must use their own branding.

**Action (REPLACE):** Contractor GenOffice fork must rebrand before any
public distribution:

- App name, package names, window titles, installer names.
- Logo, app icon.
- User-facing strings ("GenOffice" -> Contractor product name).
- The `genoffice` Genspark API key `key_name` (`billing_tag`) — re-evaluate
  for tenant-scoped auth (ADR-0005).

Internal references to "GenOffice" in architecture docs (describing the
upstream substrate) are fine. User-facing references must be rebranded.

## 6. `ee/` boundary policy

- No Contractor domain authority lives in `ee/`.
- No Contractor feature code lives in `ee/`.
- If a future enterprise feature is genuinely enterprise-only, it goes in
  `ee/` under the GenOffice Enterprise License — but only after explicit
  architectural + legal approval, and it must not break the Apache-2.0 core.
- The Apache-2.0 core stays plain. (GenOffice `ee/README.md`: "Keeping all
  enterprise code behind this single top-level directory keeps the license
  boundary auditable and lets the open-source core stay plain Apache-2.0
  permanently.")

## 7. Hard stops

If a proposed dependency:

- is GPL/AGPL/CPAL/SSPL/BUSL and would enter the core product or distributed
  Electron bundle: **STOP.** Escalate to legal/architecture review.
- has an ambiguous or missing license and cannot be verified: **STOP.** Do
  not add until verified and added to `EXCEPTIONS` (npm) or `deny.toml` (Rust)
  with evidence.
- would require weakening the license gate allowlist: **STOP.** Never weaken.
