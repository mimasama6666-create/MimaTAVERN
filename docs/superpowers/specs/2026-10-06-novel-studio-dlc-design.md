# MimaTAVERN Novel Studio DLC Design

Date: 2026-10-06
Status: approved concept -> written specification pending user review
Baseline: exact SHA-256 verified `MimaTAVERN-main-v1.2.0-CANONICAL-FULL.zip`
Baseline local git tag: `backup/v1.2.0-canonical-before-novel-studio`

## 1. Goal

Add a first-class Novel Studio DLC to MimaTAVERN without degrading or reinterpreting the existing roleplay Session system. Novel Studio must import TXT novels, manage chapters, continue prose with an AI, maintain long-range canonical narrative memory, reuse Preset and Worldbook assets, enforce a real minimum continuation length, keep unaccepted generations as drafts, and integrate with MimaTAVERN's appearance/CSS system.

The same release also introduces built-in global themes: current/default, Midnight dark mode, E-Ink gray paper mode, and warm Paper mode. Theme work must include Novel Studio surfaces and CSS Studio preview/scope support.

## 2. Non-goals

V1 does not add collaborative editing, DOCX/EPUB import, relationship graphs, automatic future-outline planning, cloud sync, or a full version-control tree for chapters. Existing RP Session semantics, message roles, Regex behavior, Persona behavior, Safe HTML behavior, API behavior, fonts, Worldbooks, Presets, Assistant Studio, and backup compatibility must remain intact unless explicitly adapted below.

## 3. Current-source facts

The current canonical application is a static browser app. `local-store.js` owns a single IndexedDB database and stores the application state under `state`. `standalone-core.js` normalizes canonical data and exposes a local route-compatible API through `MimaStandalone.handle()`. `app.js` owns the RP UI. `assistant-studio.js` is a separate large workspace that reuses the main API connection while keeping assistant-specific model settings and conversations. `style.css` provides global theme tokens plus component selectors.

The current canonical state schema is version 3 with these top-level domains: sessions, masks, presets, worldbooks, cssPresets, regexPacks. The new feature must use an additive schema migration and preserve all existing domains unchanged.

## 4. Architecture decision

Novel Studio is a sibling product surface to RP Session, not a special Session mode.

Shared infrastructure:
- IndexedDB persistence
- API Base URL / API Key / headers / endpoint transport
- model calling and streaming implementation
- Preset library
- Worldbook library
- font infrastructure
- full-library backup/import
- theme tokens and custom CSS system

Independent Novel domain:
- projects
- chapters
- source snapshots
- drafts
- generation lifecycle
- chapter summaries
- narrative state
- novel-specific mounts and model settings

No Novel object may be stored as a fake RP message. No RP Session may be used as the canonical storage for an imported novel.

## 5. Canonical data model

Bump canonical library schema additively from v3 to v4.

Top-level state adds:
- `novelProjects: NovelProject[]`
- `themeSettings: ThemeSettings`

Existing top-level arrays remain unchanged.

### 5.1 NovelProject

Required fields:
- `id`
- `title`
- `createdAt`
- `updatedAt`
- `sourceName`
- `sourceEncoding`
- `sourceText`
- `sourceHash`
- `chapters`
- `chapterOrder`
- `activeChapterId`
- `presetIds`
- `worldbookIds`
- `modelSettings`
- `generationSettings`
- `narrativeState`
- `appearance`

`sourceText` is an immutable import snapshot for recovery/re-analysis. Editing chapters must not silently rewrite it.

### 5.2 NovelChapter

Required fields:
- `id`
- `projectId`
- `title`
- `order`
- `segments`
- `revision`
- `summary`
- `summarySourceRevision`
- `summarySourceHash`
- `createdAt`
- `updatedAt`

### 5.3 NovelSegment

A chapter is composed of ordered segments so imported text and accepted AI additions remain distinguishable.

Fields:
- `id`
- `kind`: `source | ai_accepted | manual`
- `content`
- `createdAt`
- `updatedAt`
- optional `generationId`

### 5.4 NovelDraft

Drafts are not canonical story text.

Fields:
- `id`
- `projectId`
- `chapterId`
- `generationId`
- `content`
- `status`: `generating | ready | interrupted | rejected | accepted`
- `createdAt`
- `updatedAt`
- `metadata`

Draft deletion/rejection must not change chapter text or narrative memory.

### 5.5 NovelGeneration

One user continuation action has exactly one generation identity even if the model must append because the minimum length was not reached.

Fields:
- `id`
- `projectId`
- `chapterId`
- `status`
- `directorNote`
- `minimumChars`
- `attempts`
- `startedAt`
- `completedAt`
- `draftId`
- `inputSnapshot`
- `error`

Generation success is distinct from draft acceptance and memory settlement.

### 5.6 ChapterSummary

Structured summary fields:
- `overview`
- `events`
- `characterChanges`
- `revealedFacts`
- `openThreads`
- `foreshadowing`
- `endingState`
- `sourceRevision`
- `sourceHash`
- `generatedAt`

A summary is stale when its source revision/hash differs from the current chapter.

### 5.7 NarrativeState

Canonical long-range memory must separate past facts from future intent.

Fields:
- `storyOverview`
- `currentSituation`
- `characterStates[]`
- `relationships[]`
- `timeline[]`
- `openThreads[]`
- `foreshadowing[]`
- `revealedFacts[]`
- `locations[]`
- `lastUpdatedAt`
- `sourceChapterRevisions`

The memory updater may propose a delta, but application code merges only validated supported fields. Director notes never become canonical memory unless the resulting accepted prose makes them true.

## 6. TXT import pipeline

Flow:
1. read TXT as bytes/text
2. normalize BOM/newline/control characters
3. retain original `sourceText`
4. detect chapter headings
5. build chapter list and segments
6. create project
7. optionally run initial memory analysis

V1 chapter heading recognition should support common Chinese and English forms, including `第X章`, `第XXX章`, `卷X/第X卷`, `Chapter N`, and common Roman/Arabic numbering variants.

If no heading is detected, create one chapter named `正文` rather than failing.

The UI must allow rename, split, merge, reorder, and delete operations with explicit confirmation for destructive changes.

## 7. Novel prompt assembly

Create a dedicated Novel prompt assembler. Do not reuse the RP Session prompt as if it represented the same semantics.

Prompt order:
1. immutable Novel continuation contract
2. mounted Presets
3. relevant Worldbook material
4. canonical NarrativeState
5. historical chapter summaries
6. recent full chapter text / current chapter tail
7. current chapter full text when within budget
8. one-shot Director Note
9. output requirements including minimum prose target

Director Note is request-scoped and never persisted into canonical memory by itself.

The assembler must expose an inspector similar to the existing RP prompt inspector: section sizes, selected worldbook entries, estimated input tokens, chapter text range used, summary sources, and final message preview.

## 8. Worldbook reuse

Novel Studio mounts existing Worldbook IDs. The existing Worldbook canonical records remain single-source-of-truth.

Keyword activation for Novel Studio scans:
- current chapter text
- recent accepted prose
- relevant chapter summaries
- director note only for the current generation

No Novel-specific copy of a Worldbook is created.

## 9. Preset reuse

Novel Studio mounts existing Preset IDs. Presets may control prose style, viewpoint, dialogue/narration conventions, formatting, and output constraints.

No separate “novel style preset” database is introduced in V1.

## 10. Model settings

Novel Studio shares connection credentials with the main MimaTAVERN API configuration but stores its own model-generation settings per project:
- model override
- temperature
- sendTemperature
- streaming
- max output tokens when supported

Changing Novel model settings must not mutate RP Session model behavior or Assistant Studio profiles.

## 11. Minimum continuation length

`minimumChars` is a real post-generation contract, not a prompt-only suggestion.

Visible prose character counting ignores whitespace and known formatting/control wrappers.

After the first model response:
- if count >= minimum: mark draft ready
- if count < minimum: continue the same NovelGeneration and append from the exact draft tail
- use a bounded append-attempt limit
- never restart the whole generation merely to satisfy length
- if the bound is exhausted, keep the partial draft and surface the exact achieved/required counts as an explicit incomplete result

An incomplete result is not silently labeled complete.

## 12. Draft -> accept lifecycle

Generated prose is a draft first.

Draft actions:
- edit
- regenerate
- continue generation
- reject/delete
- accept

Accept is the only action that:
1. appends the draft as an `ai_accepted` chapter segment
2. increments chapter revision
3. marks summary stale
4. triggers incremental summary/memory analysis

If the analysis step fails, accepted prose remains canonical text but memory must be marked degraded/stale; the system must not roll back or silently invent memory.

## 13. Narrative memory update lifecycle

Initial import may generate summaries in batches.

Normal accepted continuation flow:
1. capture accepted text and previous chapter summary
2. request a structured chapter-summary update
3. request or derive a structured narrative delta
4. validate output shape and types
5. merge into NarrativeState
6. persist summary source revision/hash

No AI response directly overwrites the entire narrative state without validation.

Old chapter edits invalidate all summaries/memory that depend on the changed revision. The UI must show stale state and provide an explicit rebuild/update action.

## 14. Failure and settlement rules

NovelGeneration owns generation settlement.
NovelDraft owns draft content state.
NovelChapter owns canonical prose.
NarrativeState owns accepted-story memory.

These ownership boundaries must prevent double settlement.

Streaming interruption:
- partial text may remain visible in a draft
- partial text must not be auto-accepted
- retry/continue must reuse the same generation intent without duplicating accepted prose

Read/import failure must not replace a valid project with empty data.

Memory-analysis failure must not erase existing verified memory.

## 15. UI structure

Add a first-class top-level Novel Studio entry.

Desktop layout:
- left: project list + chapter list + import/new controls
- center: reading/editor surface for the active chapter and draft continuation
- right: continuation controls + memory inspector/mounts

Mobile layout:
- single main surface
- tabs/sheets for `正文`, `剧情档案`, `设置`
- no compressed three-column desktop layout

Main center reading surface should visually resemble a reader/editor rather than RP message bubbles.

The end-of-chapter continuation panel includes:
- optional Director Note textarea
- minimum character input
- mounted Preset summary
- mounted Worldbook summary
- Continue button
- generation progress

## 16. Narrative memory UI

Provide a readable dossier, not raw JSON.

Primary cards:
- story overview
- current situation
- character states
- relationships
- open threads
- foreshadowing
- revealed facts
- timeline
- chapter archive

Stale summaries use a restrained `需要更新` state, not destructive-error styling.

Users can inspect and edit memory. Manual edits are canonical user overrides and must be preserved through subsequent merges unless explicitly removed.

## 17. Theme architecture

Theme order:
1. Core CSS
2. Built-in Theme
3. Appearance/Typography settings
4. user Custom CSS Preset

Custom CSS remains highest-priority user styling.

Built-in themes:
- `default`: current MimaTAVERN appearance
- `midnight`: charcoal dark mode; no pure-black overuse
- `eink`: warm/neutral gray paper, deep-gray text, minimal borders, near-zero glow/gradient/animation
- `paper`: warm off-white paper, dark brown-gray text, restrained paper-like surfaces

Theme selection is global by default. Novel project appearance may override typography/reader-specific presentation without mutating the global theme.

## 18. Typography separation

Themes control color/surface/border/shadow/interaction treatment.
Typography controls font family, font size, line height, letter spacing, paragraph spacing, first-line indent, and reader max width.

Theme changes must not silently discard typography choices.

## 19. Stable CSS styling contract

Novel Studio must expose stable public selectors/tokens for CSS presets and the CSS assistant.

Minimum selectors:
- `.novel-studio`
- `.novel-sidebar`
- `.novel-reader`
- `.novel-reader-paper`
- `.novel-inspector`
- `.novel-chapter-list`
- `.novel-draft`
- `.novel-director-box`
- `.novel-memory-card`
- `.novel-generation-panel`

Minimum theme tokens include existing tokens plus semantic reader tokens:
- `--bg`
- `--panel`
- `--text`
- `--muted`
- `--line`
- `--accent`
- `--reader-bg`
- `--reader-text`
- `--reader-muted`
- `--reader-line`

Avoid exposing brittle `nth-child` based contracts.

## 20. CSS Studio / Assistant Studio adaptation

CSS preset editor adds surface scope metadata:
- global
- chat
- novel
- assistant

Legacy CSS presets without scope remain global for compatibility.

CSS Assistant prompt context must document Novel Studio selectors and theme tokens.

Appearance preview adds surface preview choices:
- chat
- novel
- assistant

Novel preview must include a chapter heading, prose, memory card, director box, draft, and continuation button so themes can be evaluated without entering a real project.

## 21. Backup/import/export

Full library backup includes Novel projects and theme settings.

Importing a v3 backup produces v4 state with empty `novelProjects` and default theme settings. No old data is removed.

Novel project export supports at least:
- complete project JSON for round-trip backup
- TXT export that concatenates chapters in project order using canonical accepted/manual text only

Drafts are excluded from normal TXT export unless explicitly accepted.

## 22. Security and data integrity

No new use of `eval`.
Do not execute imported TXT content.
Do not render generated Novel prose as arbitrary HTML by default.
Preserve existing Safe HTML behavior for RP only unless explicitly enabled in a future Novel feature.
Reject malformed structured memory updates rather than coercing them into empty memory.
Never reset canonical state after a transient read error.

## 23. Compatibility requirements

Must preserve:
- existing Session load/edit/delete/import/export
- Persona mounts and macro resolver
- Presets
- Worldbooks
- Regex packs
- Safe HTML
- BOND/progress hydration
- true SSE streaming
- non-duplicating RP retry behavior
- Assistant Studio
- Fonts
- current CSS presets
- API config/import/export
- full settings backup/restore

Existing v1.2.0 smoke tests remain part of the final suite.

## 24. File/module direction

Expected additive modules, subject to implementation-plan refinement after source review:
- `novel-engine.js`: normalization, chapter/project operations, lifecycle helpers
- `novel-prompt-assembler.js`: Novel-specific context assembly and diagnostics
- `novel-memory.js`: structured summary/delta validation + canonical merge
- `novel-studio.js`: UI controller/rendering and event bridge
- `theme-engine.js`: built-in theme selection and theme tokens

Expected existing-file integration points:
- `local-store.js`: v3 -> v4 additive migration and backup persistence
- `standalone-core.js`: shared API transport exposure / Novel routes or bridges without contaminating RP assembler
- `index.html`: Novel Studio shell, file inputs, script order, top-level entry
- `app.js`: navigation bridge, appearance/CSS preview integration, global data backup UI hooks
- `assistant-studio.js`: CSS assistant knowledge/surface scope
- `style.css`: stable Novel components + built-in theme token layers + responsive layout
- `README.txt`: Novel Studio and theme usage

Do not refactor unrelated mature files merely to make them prettier.

## 25. Verification strategy

Implementation is intentionally batched before the large verification pass, per owner instruction. However final completion requires all of the following:

Static/structural:
- JS syntax checks
- diff/whitespace checks
- old v1.2.0 smoke suite
- v3 -> v4 migration
- Novel project CRUD
- TXT chapter parsing
- Preset/Worldbook mounts
- prompt assembly ordering and diagnostics
- draft lifecycle
- minimum-length append lifecycle
- structured summary validation
- stale-summary detection
- backup round trip
- TXT export excludes unaccepted drafts
- theme selection and legacy CSS compatibility

Failure paths:
- interrupted stream
- malformed memory JSON
- memory update failure after accepted prose
- edited old chapter invalidation
- invalid TXT / empty TXT
- retry without duplicate prose
- theme/CSS failure does not make data inaccessible

Interaction simulation:
1. import representative multi-chapter Chinese TXT
2. inspect parsed chapters
3. mount Preset + Worldbook
4. request continuation with blank Director Note
5. enforce minimum length across append calls
6. edit draft
7. reject and regenerate a draft
8. accept a draft
9. inspect chapter summary and global narrative state
10. edit an old chapter and confirm stale indicators
11. rebuild/update memory
12. switch default -> Midnight -> E-Ink -> Paper
13. apply custom CSS above a built-in theme
14. export project TXT and JSON
15. return to RP chat and verify old Session behavior remains intact

No claim of completion is allowed until the real final verification is run and inspected.
