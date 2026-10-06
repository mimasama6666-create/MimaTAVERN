# MimaTAVERN Novel Studio DLC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Owner explicitly requested batch implementation first, then one integrated verification pass, then interaction simulation. Do not run the test suite between implementation tasks unless a syntax/runtime blocker prevents further work.

**Goal:** Build MimaTAVERN v1.3.0 with a first-class Novel Studio DLC for TXT novel continuation, canonical narrative memory, draft/accept generation lifecycle, real minimum-length continuation, Preset/Worldbook reuse, and four built-in visual themes without regressing v1.2.0 RP behavior.

**Architecture:** Keep the v1.2.0 RP Session pipeline intact and add Novel Studio as a sibling domain. `novel-engine.js`, `novel-memory.js`, and `novel-prompt-assembler.js` remain pure/mostly-pure helpers; `standalone-core.js` remains the canonical state owner and route authority; `novel-studio.js` owns Novel UI/runtime; `theme-engine.js` owns built-in theme selection. Existing Preset, Worldbook, API transport, fonts, backup, CSS preset, and streaming infrastructure are reused through explicit bridges rather than duplicated.

**Tech Stack:** Browser JavaScript (IIFE modules), IndexedDB, HTML/CSS, existing OpenAI-compatible API client/SSE reader, Node-based smoke tests.

**Spec:** `docs/superpowers/specs/2026-10-06-novel-studio-dlc-design.md`

## Global Constraints

- Exact baseline: SHA-256 `45d2070792710bf395ac04d3e41caae2cf9197b28a2ba9bb5903c834fd082b81` from `MimaTAVERN-main-v1.2.0-CANONICAL-FULL.zip`.
- Baseline Git tag: `backup/v1.2.0-canonical-before-novel-studio`.
- Preserve v1.2.0 Session, Persona, Worldbook, Preset, Regex, Safe HTML, BOND hydration, SSE streaming, Assistant Studio, Font, API, and backup behavior.
- Schema migration is additive: v3 data becomes v4 without deletion or reinterpretation.
- Novel projects are not RP Sessions and Novel prose is never stored as fake RP messages.
- Draft text is non-canonical until explicit accept.
- Director Note is request-scoped and does not become canonical memory by itself.
- Minimum continuation length is enforced by code using append attempts under one stable generation identity.
- Memory failures never erase accepted prose or verified existing memory.
- Built-in theme < typography/appearance < user custom CSS in styling precedence.
- No unrelated cleanup/refactor.
- Per owner request: implement all planned production code first; execute the complete verification suite only after implementation is finished; then perform interaction simulation.

## Review Focus

1. **Old v3 backup import** — must restore all old domains and create empty Novel/theme defaults without data loss; covered in final migration/backup smoke tests.
2. **Interrupted or under-length generation** — must preserve one draft/generation identity, append rather than restart, and never auto-accept partial prose; covered in Novel lifecycle smoke tests.
3. **Malformed AI memory output** — must fail closed, keep prior verified memory, and mark memory stale/degraded rather than replacing it with empty data; covered in memory validation tests.
4. **Old chapter edited after later chapters exist** — must invalidate dependent summary/memory revisions visibly without deleting canonical prose; covered in revision/staleness tests.
5. **Theme/custom CSS interaction** — theme switching must not override typography or user CSS and must not make RP/Novel data inaccessible; covered in theme/static UI tests and final simulated interaction.

---

### Task 1: Canonical v4 State and Theme Foundation

**Files:**
- Modify: `local-store.js`
- Create: `theme-engine.js`
- Modify: `standalone-core.js`
- Modify: `index.html`

**Interfaces:**
- `window.MimaThemeEngine.normalizeSettings(input) -> ThemeSettings`
- `window.MimaThemeEngine.apply(settings) -> ThemeSettings`
- `window.MimaThemeEngine.getBuiltins() -> ThemeDescriptor[]`
- `standalone-core.normalizeState()` produces schemaVersion 4 with `novelProjects` and `themeSettings` while preserving all v3 arrays.
- New local routes: `GET /theme`, `PATCH /theme`.

- [ ] Bump canonical state persistence from schemaVersion 3 to 4 in `local-store.js`; add default `novelProjects: []` and default theme settings while preserving all existing arrays exactly.
- [ ] Implement `theme-engine.js` with built-ins `default`, `midnight`, `eink`, `paper`; apply the selected theme through a stable root attribute/class and CSS variables rather than rewriting component DOM.
- [ ] Extend `standalone-core.js` state normalization and persistence for v4/theme settings without changing RP normalizers.
- [ ] Add `/theme` read/update routes and expose only the minimum theme bridge needed by UI code.
- [ ] Load `theme-engine.js` before application UI scripts in `index.html` and update release markers to v1.3.0.

### Task 2: Novel Domain Engine and TXT Import

**Files:**
- Create: `novel-engine.js`
- Modify: `standalone-core.js`

**Interfaces:**
- `MimaNovelEngine.normalizeProject(project) -> NovelProject`
- `MimaNovelEngine.createProjectFromText({title, sourceName, sourceEncoding, text}) -> NovelProject`
- `MimaNovelEngine.parseChapters(text) -> ParsedChapter[]`
- `MimaNovelEngine.getChapterText(chapter) -> string`
- `MimaNovelEngine.editChapter(project, chapterId, operations) -> NovelProject`
- `MimaNovelEngine.exportProjectText(project) -> string`
- `MimaNovelEngine.countVisibleChars(text) -> number`
- Core routes: `GET/POST /novels`, `GET/PATCH/DELETE /novels/:id`, `POST /novels/import`, chapter mutation routes, JSON/TXT export helpers.

- [ ] Implement canonical NovelProject/Chapter/Segment/Draft/Generation normalizers, stable IDs, timestamps, revision counters, and source snapshot/hash support.
- [ ] Implement TXT normalization and chapter heading recognition for Chinese `第X章`/卷 forms plus English `Chapter N` and common numeric/Roman variants; fallback to one `正文` chapter.
- [ ] Preserve immutable `sourceText/sourceHash` while chapter edits operate on canonical chapter segments only.
- [ ] Implement rename/split/merge/reorder/delete chapter operations with revision increments and dependency invalidation hooks.
- [ ] Implement canonical TXT export from source/manual/accepted segments only; never include rejected/unaccepted drafts.
- [ ] Add Novel CRUD/import/chapter/export routes in `standalone-core.js`; deleting a Preset/Worldbook/CSS asset must also safely detach references from Novel projects where applicable.

### Task 3: Canonical Narrative Memory Engine

**Files:**
- Create: `novel-memory.js`
- Modify: `novel-engine.js`
- Modify: `standalone-core.js`

**Interfaces:**
- `MimaNovelMemory.normalizeSummary(input) -> ChapterSummary`
- `MimaNovelMemory.normalizeState(input) -> NarrativeState`
- `MimaNovelMemory.validateAnalysisPayload(input) -> {ok,value,error}`
- `MimaNovelMemory.mergeDelta(previous, delta, context) -> NarrativeState`
- `MimaNovelMemory.isSummaryStale(chapter) -> boolean`
- `MimaNovelMemory.invalidateFromChapter(project, chapterId) -> NovelProject`
- Routes: chapter summary generation/rebuild, project memory rebuild/update/edit.

- [ ] Implement structured chapter summary and NarrativeState schemas with arrays/objects normalized without silently converting malformed model output into empty canonical memory.
- [ ] Implement source revision/hash tracking and stale detection.
- [ ] Implement downstream invalidation when an older chapter changes; preserve prior memory as visible stale/degraded data until rebuilt.
- [ ] Implement user-edited memory override metadata so subsequent AI merges preserve explicit manual values unless the user removes them.
- [ ] Add code-owned delta merge rules for facts, open threads, foreshadowing, relationships, locations, current situation, and timeline.
- [ ] Add core memory routes that perform validated model analysis using shared API transport but never overwrite canonical memory on parse/validation failure.

### Task 4: Novel Prompt Assembler and Worldbook Selection

**Files:**
- Create: `novel-prompt-assembler.js`
- Modify: `standalone-core.js`

**Interfaces:**
- `MimaNovelPromptAssembler.assemble({project, presets, worldbooks, directorNote, mode, draftText}) -> {messages, inspector}`
- `inspector` includes section sizes, selected worldbook entries, estimated input tokens, chapter ranges, summary sources, and final messages.
- Route: `POST /novels/:id/prompt-preview`.

- [ ] Build a Novel-only continuation contract distinct from RP Session system prompts.
- [ ] Assemble in locked order: contract → Presets → selected Worldbook material → NarrativeState → historical summaries → recent/full chapter prose budget → one-shot Director Note → output/minimum-length constraints.
- [ ] Reuse existing Worldbook records and activation semantics without duplicating records; adapt activation scan input to Novel chapter/summary/director context.
- [ ] Add deterministic context budgeting that prefers recent raw prose over older summary material and never discards the source project itself.
- [ ] Add prompt inspector diagnostics and route.

### Task 5: Novel Generation, Draft, Minimum-Length, and Settlement Lifecycle

**Files:**
- Modify: `novel-engine.js`
- Modify: `standalone-core.js`

**Interfaces:**
- `POST /novels/:id/continue` starts or resumes one NovelGeneration and returns/streams one NovelDraft.
- `PATCH /novels/:id/drafts/:draftId` edits draft text only.
- `POST /novels/:id/drafts/:draftId/regenerate` creates a replacement draft intent without accepting old prose.
- `POST /novels/:id/drafts/:draftId/accept` performs the only canonical prose commit.
- `DELETE /novels/:id/drafts/:draftId` rejects/removes draft without changing chapter/memory.

- [ ] Add stable NovelGeneration ownership fields and bounded append attempt tracking.
- [ ] Reuse `callModelWithConfig()` and current SSE progress callback for Novel generation without changing RP `processStoryTurn()`.
- [ ] Count visible prose characters after each response; if below minimum, issue an append prompt from exact draft tail under the same generation ID and concatenate safely.
- [ ] If append limit is exhausted, keep draft with explicit incomplete counts/status; do not report success falsely.
- [ ] Preserve partial streamed draft on interruption, mark interrupted, and never auto-accept.
- [ ] Implement draft edit/reject/regenerate/continue actions without mutating chapter text.
- [ ] Implement accept transaction: append `ai_accepted` segment → increment chapter revision → mark summary/memory stale → persist canonical prose → attempt memory update. Memory failure may mark degraded but may not roll back accepted prose.

### Task 6: Novel Studio UI

**Files:**
- Create: `novel-studio.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`

**Interfaces:**
- `window.MimaNovelStudio.open(projectId?)`
- `window.MimaNovelStudio.close()`
- `window.MimaNovelStudio.importTxt(file)`
- `window.MimaNovelStudio.refresh()`
- Main app exposes a top-level Novel entry without changing RP drawer/session navigation semantics.

- [ ] Add top-level `✒ 小说续写` entry and standalone Novel Studio shell/modal/surface.
- [ ] Implement desktop three-column layout: projects/chapters, reader/editor, inspector/controls.
- [ ] Implement mobile `正文 / 剧情档案 / 设置` tabs/sheets rather than compressed columns.
- [ ] Implement project creation/import, chapter list, active chapter reader/editor, rename/split/merge/reorder/delete UI.
- [ ] Implement director note, minimum chars, model settings, Preset/Worldbook mount controls, prompt inspector access, and generation progress.
- [ ] Render streaming output into `.novel-draft`; expose edit/regenerate/continue/reject/accept actions; never render Novel prose as arbitrary Safe HTML.
- [ ] Implement memory dossier cards and restrained stale/degraded indicators plus rebuild/update actions.
- [ ] Add project JSON/TXT export and input file handlers.

### Task 7: Built-In Themes, Typography, and CSS Styling Contract

**Files:**
- Modify: `theme-engine.js`
- Modify: `style.css`
- Modify: `app.js`
- Modify: `novel-studio.js`

**Interfaces:**
- Stable public Novel selectors from the spec.
- Stable reader tokens: `--reader-bg`, `--reader-text`, `--reader-muted`, `--reader-line` plus existing app tokens.
- Theme selection global; Novel appearance may override reader typography only.

- [ ] Add complete `midnight`, `eink`, and `paper` visual layers without altering the existing default theme.
- [ ] Ensure E-Ink removes/attenuates glow, blur, gradients, and animation while using warm/neutral gray paper and deep gray text.
- [ ] Add Novel reader typography settings: font, size, line height, letter spacing, paragraph spacing, first-line indent, max width.
- [ ] Preserve font/typography selection across theme changes.
- [ ] Keep user Custom CSS as final styling authority and preserve `?noCss=1` emergency bypass.

### Task 8: CSS Preset and Assistant Studio Adaptation

**Files:**
- Modify: `standalone-core.js`
- Modify: `app.js`
- Modify: `assistant-studio.js`
- Modify: `style.css`

**Interfaces:**
- CSS scope compatibility accepts legacy `story/global/app` plus new surface metadata for `novel` and `assistant` without breaking old records.
- Appearance preview surface selector: `chat | novel | assistant`.

- [ ] Extend CSS preset normalization in a backward-compatible way; legacy presets keep existing behavior.
- [ ] Add Novel/Assistant targeting helpers without changing the raw-app override behavior of existing `app` scope.
- [ ] Extend CSS editor UI with clear scope labels and safety explanation.
- [ ] Add preview surface switcher and a representative Novel preview containing heading, prose, memory card, director box, draft, and continuation button.
- [ ] Update CSS Assistant system prompt/context with stable Novel selectors/tokens and theme precedence so generated CSS knows about the new surface.

### Task 9: Backup, Versioning, Documentation, and Compatibility Wiring

**Files:**
- Modify: `local-store.js`
- Modify: `standalone-core.js`
- Modify: `app.js`
- Modify: `index.html`
- Modify: `README.txt`
- Create/Modify: release report for v1.3.0

**Interfaces:**
- Whole-library export/import round-trips `novelProjects` + `themeSettings`.
- Full settings snapshot includes theme choice/appearance state without duplicating API keys outside existing API config behavior.

- [ ] Extend whole-library backup/import and settings snapshot compatibility for v4.
- [ ] Ensure importing v3 creates default Novel/theme data and does not remove old content.
- [ ] Update asset cache/release markers consistently to v1.3.0.
- [ ] Document Novel Studio use, minimum-length semantics, memory stale states, themes, CSS scopes, backup/export behavior, and recovery rules.
- [ ] Add a concise construction/release report listing changed files and compatibility invariants.

### Task 10: Build the Integrated Verification Suite (Do Not Run Earlier Tasks Individually)

**Files:**
- Create: `tests/smoke-v1.3.0.js`
- Create: additional focused smoke helpers only if the single file becomes unreadable

**Interfaces:**
- Tests use the same browser stubs/patterns as existing smoke scripts and exercise actual exported/module routes rather than duplicating production logic.

- [ ] Add v3→v4 migration and backup round-trip tests.
- [ ] Add TXT parsing/no-heading/Chinese-heading/English-heading tests.
- [ ] Add Novel CRUD/chapter operations/source snapshot tests.
- [ ] Add prompt ordering, Worldbook/Preset mount, director-note one-shot, and inspector tests.
- [ ] Add under-length append/same generation ID/interrupted draft/no auto-accept tests.
- [ ] Add accept → revision → stale → memory update tests and malformed-memory fail-closed tests.
- [ ] Add TXT export exclusion of drafts and project JSON round-trip tests.
- [ ] Add theme normalization and static selectors/script-order/CSS compatibility tests.
- [ ] Add regression assertions that original Session routes and v1.2.0 data remain unchanged.

### Task 11: One Large Verification Pass

**Files:**
- No production changes unless a test exposes a real defect; fixes must target the first invalid state, not hide the symptom.

- [ ] Run `node --check` against every JavaScript source and smoke test file.
- [ ] Run `git diff --check`.
- [ ] Run every existing v1.1.x/v1.2.0 smoke script.
- [ ] Run the new v1.3.0 Novel Studio smoke suite.
- [ ] If anything fails, trace symptom → call chain → first invalid state → propagation, fix the producing point, then rerun the full affected suite.
- [ ] Inspect final Git diff for accidental deletions, schema regressions, broken script order, duplicate settlement paths, and negative optimization.

### Task 12: Simulated User Interaction / Capability Acceptance

**Files:**
- Use production files from the completed branch; create only temporary fixtures outside canonical data.

- [ ] Start a local static server and confirm all assets load HTTP 200.
- [ ] Simulate importing a representative multi-chapter Chinese TXT.
- [ ] Inspect detected chapters and perform rename/split/merge/reorder.
- [ ] Mount a Preset and Worldbook and inspect Novel prompt preview.
- [ ] Continue with blank Director Note and with a supplied Director Note.
- [ ] Exercise minimum-length append behavior, edit a draft, reject/regenerate, and accept a final draft.
- [ ] Inspect chapter summary/global memory; edit an old chapter and verify stale state; rebuild memory.
- [ ] Switch default → Midnight → E-Ink → Paper and verify typography survives.
- [ ] Apply a custom CSS preset above a built-in theme and verify emergency CSS bypass still works.
- [ ] Export TXT/JSON and verify only canonical accepted/manual prose appears in TXT.
- [ ] Return to an RP Session and exercise send/continue/regenerate/settings to confirm Novel Studio did not regress normal Tavern behavior.
- [ ] Only after all above checks pass, create the final implementation commit/package and report any untestable external-provider behavior explicitly.
