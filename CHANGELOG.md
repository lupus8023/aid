# Changelog

## 0.1.29 - 2026-08-23

### Added

- One-click Film is now a resumable unattended production runner covering screenplay/storyboards, production references, images, grouped H3 clips, local caching, Companion FFmpeg merge and final download.
- The One-click Film control now supports real pause/continue semantics. Pausing preserves all completed artifacts and already-submitted provider task IDs; continuing resumes at the first genuinely unfinished item.

### Fixed

- One-click Film no longer exits silently after a transient image, video, Companion or export failure. Recoverable stages retry with bounded 3/8/15/30/60-second backoff until completion or an explicit pause.
- Existing storyboard image URLs are authoritative even when an older saved status still says pending or generating, so completed references are not regenerated after refresh or resume.
- Interrupted paid 3×3 image tasks reconnect to the same APIMart task and re-split its result. A partially completed batch without a recoverable mother-grid task repairs only the missing shots instead of replacing finished images.
- Submitted single-image repair tasks and grid tasks are persisted and distinguished, preventing refresh recovery from treating a single-image job as a nine-panel grid.
- Saved ComfyUI video task IDs are re-polled after network timeouts; only an explicit terminal provider failure permits a replacement submission. Completed clips are skipped and final native export retries automatically.

### Tests

- Added regression coverage for artifact-first resume, paid-grid reattachment, partial single-shot repair, task-kind isolation and bounded unattended retry timing. Grid recovery, native local export and the production build pass.

## 0.1.28 - 2026-08-22

### Fixed

- Story video clips now carry a deterministic creative-input signature covering their storyboard images, actions, camera directions, dialogue, timing, continuity, aspect ratio and visual style. Editing or regenerating any of those inputs invalidates the affected segment instead of silently reusing an older local video and audio track.
- Persistent video cache keys now include the generation signature as well as project and storyboard identity, preventing an earlier clip from the same project from leaking obsolete narration into a newly edited film.
- 4K 3×3 storyboard generation now polls for up to nine minutes instead of reporting a false timeout after 4.5 minutes while the paid APIMart task is still healthy.

### Tests

- Added regression coverage for creative-revision cache isolation and automatic segment invalidation after image or dialogue changes. Production build, H3 audio/prompt, local export, grid recovery, segment planning and project isolation tests pass.

## 0.1.27 - 2026-08-22

### Improved

- Story now assigns every generated line to an explicit uploaded character before storyboard expansion. Lines from temporary or unnamed story actors stay visual-only instead of being reassigned to the lead.
- MiniMax H3 segment prompts now follow the official six-section Ref2VA contract and official shot/timestamp syntax. Each storyboard retains its own action, camera, timing, transition and authorized dialogue while avoiding custom pseudo-control fields that H3 could vocalize.
- The XianGong cloud MiniMax H3 T8 node was upgraded from v1.3.2 to v1.43.0; all three AID H3 workflows retain compatible core node types and the previous node version remains available as an external backup.

### Fixed

- Generated dialogue is quarantined when its named speaker is not visibly present in that storyboard. The frontend explains the blocked line, and the backend refuses to place it in `<d>` or build a voice reference from it.
- Story outline validation now retries malformed model output when a required line has no valid speaker, preventing dialogue ownership errors from propagating into image, video and native-audio generation.
- Video prompt overrides strip legacy `SPEECH GATE`, `DIALOGUE`, `SPOKEN_WORDS_ONLY` and `NON_SPOKEN_PERFORMANCE` fields so old projects cannot reintroduce spoken director instructions.

### Tests

- Added regression coverage for absent-speaker dialogue quarantine, outline speaker validation, official H3 shot formatting and legacy pseudo-control removal.

## 0.1.26 - 2026-08-22

### Improved

- Story's automatic segment editor now groups contiguous shots by their real action/dialogue budget, four-shot limit, three-line speech limit, and H3's 15-second ceiling. Location/sequence changes or model-written fade/dissolve hints no longer force every storyboard into a separate clip.
- Each storyboard inside a merged clip still retains its own time window, action, camera move, dialogue state and causal handoff; only the H3 generation batch changes.

### Fixed

- Manual splits, merges and boundary moves are now stored as an immediately persisted project-level director plan. Reloading, reopening, Canvas mode and One-click Film all reuse the same grouping instead of reverting to automatic single-shot segments.
- H3 visual-action, storyboard-description and override channels strip embedded quoted speech and vocal directions such as “shouts while panting”; the authoritative `<d>` block is the only place where real dialogue may appear.
- With Fish Audio configured, Story creates per-segment character references containing only the exact authorized lines and caches them by a dialogue signature. Editing dialogue invalidates and rebuilds the reference instead of leaking words from a generic timbre sample.
- Companion pads exact dialogue references shorter than two seconds with silence while preserving the 14.7-second total budget, preventing short lines from failing or falling back to an unrelated voice sample.

### Tests

- Added regression coverage for automatic cross-scene grouping, the 15-second budget, serialized manual director plans, visual-channel dialogue stripping, and short exact-dialogue padding. The full test suite and production build pass.

## 0.1.25 - 2026-08-22

### Improved

- Story now carries each screenplay beat's authoritative visible action into its storyboard instead of asking the final video prompt to infer motion from a still-image description.
- Every storyboard inside a grouped MiniMax H3 clip receives its own exact time window, action cadence and landing, camera move, dialogue state, caused sound and motivated cinematic handoff. Grouping several storyboards changes only the generation batch and never collapses their individual content.
- H3 action timing now enters on movement, completes the decisive contact or turn before the final reaction window, and preserves live secondary motion at real-time physical speed instead of stretching one gesture into apparent slow motion.
- First/last-frame continuity treats the final reference as a landing composition: the main action completes before the final 16% instead of uniformly interpolating between two still poses for the whole clip.

### Fixed

- Model-written performance prose such as “pause briefly, then speak firmly” is stripped from generated dialogue or reduced to the quoted spoken words before Story saves or regenerates the shot.
- Emotion, pause and delivery metadata are converted into non-spoken H3 control codes; only words inside the authoritative `<d>` block may be vocalized.
- Storyboard references preserve identity, wardrobe, location and light without locking pose, blocking or viewpoint, allowing complete action and camera movement to develop within each beat.
- The complete four-storyboard H3 structure remains within the provider's 7,000-character prompt limit without dropping actions, cameras, dialogue states or transitions.

### Tests

- Added regression coverage for grouped per-storyboard timelines, complete action/camera/dialogue contracts, cinematic handoffs, first/last-frame cadence, performance-direction filtering and H3 prompt budgets.

## 0.1.24 - 2026-08-21

### Added

- Added APIMart Nano Banana 2 (`gemini-3.1-flash-image-preview`) and official Grok Imagine 2.0 (`grok-imagine-image-2.0`) to the global image-model selector for Story grids and shots, character/scene references, Character Design, and Image-to-Image.
- Character designs saved from the standalone workspace now appear automatically in Story's reusable character history, including their production bible, role, age, personality, theme, costume and visual style.

### Improved

- All nine production styles now give storyboard grids a concrete medium/texture, motivated-light, lens/depth and color contract instead of relying on generic style labels.
- Natural Cinema more explicitly targets direct camera or phone capture with truthful pores, hair, fabric, finite dynamic range, optical depth and restrained lens behavior.
- Grid prompts preserve structural line breaks and trim panel descriptions at word boundaries while retaining all nine panel identities and exact-cast constraints.

### Fixed

- The shared APIMart image adapter now handles Grok's `aspect_ratio`, response-version header, 2K/three-reference limits and object task IDs, while preserving Nano Banana 2's 4K and fourteen-reference support.
- Story reference labels are capped together with their images, preventing missing or shifted `Reference image N` mappings when a provider accepts fewer inputs.
- Image-to-Image and Character Design adjust their reference limits to the selected model instead of submitting an unsupported payload.

### Tests

- Added regression coverage for model selection, provider-specific image payloads and task IDs, Story-compatible character-library migration, style-specific capture contracts and grid prompt structure.

## 0.1.23 - 2026-08-21

### Added

- Added a standalone Character Design workspace on the home page: combine a written brief with up to four references, explore four or nine selectable concepts, then expand the locked choice into a production-ready 4:3 character bible.
- Character bibles now carry role, approximate age, personality keywords and core theme into turnaround, silhouette, expression, pose, material, action-detail and continuity-palette modules.
- Character concept contact sheets support both 2×2 and 3×3 high-resolution splitting, downloading, regeneration and local character-library storage.

### Fixed

- MiniMax H3 dialogue prompts now follow the official format: speaker identity, action and delivery stay outside `<d>`, while `<d>` contains only the exact spoken language and words.
- Director-only phrases such as “no other character is present” or “other characters remain silent” are no longer requested as speech fields, repeated in the soundscape, or allowed to become generated dialogue in existing projects.
- `overall_soundscape` now contains only ambience, visible physical sounds and explicitly requested nonverbal background presence instead of dialogue-control prose.

### Tests

- Added regression coverage for H3 stage-direction leakage, exact dialogue placement, four/nine concept prompts, character-bible metadata and 2×2/3×3 grid splitting.

## 0.1.22 - 2026-08-21

### Fixed

- One-shot director batches no longer turn a valid one-item JSON array into a single object and then report `returned 0 shots, expected 1`.
- Storyboard direction now normalizes direct shot objects and common `shots`, `storyboards`, `items`, and `data` provider wrappers before enforcing the exact shot count.
- Structured-response extraction now preserves the true outer JSON shape, understands fenced or explanatory responses, and safely handles nested brackets and braces inside strings.

### Tests

- Added regression coverage for one-item arrays, direct one-shot objects, nested JSON punctuation, and common provider response wrappers.

## 0.1.21 - 2026-08-20

### Improved

- Story generation now locks a compact whole-film outline and exact shot map first, expands the detailed screenplay in sequence-bound batches of at most nine shots, and generates director/storyboard prompts in matching batches.
- Every batch receives the global story spine, the prior boundary state, and a short future roadmap. Continuing sequences preserve physical blocking and lighting, while a new sequence may explicitly reset time, location, composition, and light without losing character or plot state.
- The former generic “AI Expand” action is now “Adapt Screenplay”: it uses the selected 9–81 shot production target and approximate runtime to rewrite the source into exactly numbered, causally connected story beats before planning begins.

### Fixed

- Long films no longer ask DMX to return story structure, detailed screenplay, audio planning, and camera prompts for as many as 81 shots in one response. Each stage now has an independent output-token and timeout budget.
- A timed-out DMX request no longer repeats the same oversized payload through the alternate OpenAI transport, avoiding consecutive four-minute waits.
- Invalid JSON or an incorrect shot count is retried within the affected batch and reports the exact shot range instead of discarding the entire plan without a location.

### Tests

- Added staged-generation regression coverage for exact outline quotas, continuous indexes, sequence-safe 9-shot batching, prompt-stage separation, and matching director boundaries.

## 0.1.20 - 2026-08-20

### Improved

- Story storyboard direction now describes physically coherent camera distance, lens perspective, composition and occlusion, focus-plane depth, motivated lighting, finite exposure, material response, and capture-appropriate optical imperfections instead of generic cinematic adjectives.
- Production style now reaches the director and still-image generation paths, keeping one camera/rendering family and color response while allowing shot-specific optical differences.
- Nine-panel storyboard prompts use a compact project capture bible plus per-panel deltas, with a 3,500-character budget that preserves all nine scene identities, exact cast and essential image physics before trimming repeated continuity prose.

### Fixed

- Translucent accent selection cards no longer inherit the dark foreground and solid hover treatment intended only for filled accent buttons; Story aspect-ratio selections now retain readable theme-colored labels and icons.

### Tests

- Added regression coverage for still-image capture physics, compact optics prompts, provider prompt budgets, and preservation of panels 1–9.

## 0.1.19 - 2026-08-19

### Added

- Story export now downloads every completed H3 segment to durable Companion storage before starting FFmpeg, so a browser refresh no longer discards the film's source clips.
- Native export jobs persist their manifest, normalized intermediates, progress and final output under the Companion data directory and resume after a Companion restart.

### Fixed

- Story export no longer remains indefinitely at 5% while waiting for browser FFmpeg WASM; Companion v0.1.19 performs the merge with its bundled native FFmpeg.
- Segment download, per-segment normalization and final concatenation now retry independently up to three times. SHA-256-verified downloads and valid intermediate files are reused instead of repeated.
- Native export normalizes resolution, frame rate, pixel format and audio layout, including silent audio for clips without a sound track, before a stream-copy final merge.
- Failed native jobs retain a browser recovery marker and automatically restart when the same project returns to Export; completed files transfer only after native merging and never enter browser WASM memory.
- Final delivery uses a browser blob download instead of a blocked HTTPS-to-localhost top-level navigation.
- The optional browser-only exporter now times out with an actionable Companion message instead of hanging forever during FFmpeg initialization.

## 0.1.18 - 2026-08-19

### Fixed

- DMX GPT-5-family screenplay models now use the provider's Responses API first and fall back to Chat Completions only when needed.
- Story generation accepts standard Chat Completions, content arrays, structured parsed output, Responses API output, and common gateway wrappers instead of requiring only `choices[0].message.content`.
- Empty DMX responses now report a safe structural summary, truncation, refusal, or transport failure without logging prompts, generated content, or credentials.
- The web app explicitly asks for Companion v0.1.18 instead of silently sending long screenplay requests to a hosted timeout path when an older Companion is running.
- Storyboard image generation now identifies safety-sensitive scenes before submission, creates a separate non-graphic image prompt, and automatically retries progressively safer staging when APIMart rejects a task.
- Grid and single-image cards retain the original storyboard prompt while showing the diagnosed reason, candidate scene numbers, and automatic retry count.
- Reloading a project now resumes a grid only when one durable APIMart task can be identified; orphaned or conflicting `generating` locks are released with an actionable diagnosis instead of remaining stuck forever.
- Nested provider errors and legacy `[object Object]` failures are normalized into readable image-generation reasons.
- Legacy failed shots and refresh-time recovery failures now always retain an actionable diagnosis on their cards.

## 0.1.17 - 2026-08-19

### Improved

- All nine Story production styles now supply independent performance, motion, edit and sound direction to the final MiniMax H3 prompt instead of acting mainly as color presets.
- Natural Cinema now targets authentic direct-camera footage with truthful finite exposure, focus recovery, handheld inertia, rolling shutter, skin and fabric detail; Observational Documentary separately targets phone or field-camera immediacy.
- Style-specific soundscapes reject unexplained dialogue and bind Foley, ambience and accents to visible action.

## 0.1.16 - 2026-08-19

### Added

- Story video generation now uses a segment editor: AI groups consecutive storyboards into 1–4 beat, ≤15-second H3 clips, with click-based split, merge, and two-way boundary adjustment.
- Canvas now presents a structured story → 3×3 batch → storyboard → H3 segment → final timeline flow instead of a mechanical one-shot/one-video graph.
- Storyboard grids now generate a 4K mother image. Splitting preserves that source and delivers quality-first cropped cells capped at 1600 px, followed by aspect and 1.6 MB preprocessing before H3 submission.

### Improved

- MiniMax H3 prompts now follow the official Base/Ref2VA structures for reference definitions, retention, chronological shots, stable speaker IDs, soundscape, and music.
- Every H3 clip receives an explicit setup, escalation, turn, and landing, with transitions driven by visible causality, action handoffs, screen direction, and physical state.
- Style, cast, props, and performance are expressed through concise positive construction instead of repeated negative-token lists.
- Dialogue uses H3's `<d>[Language]…</d>` syntax; voice references bind timbre and delivery only, while dialogue-free shots keep non-speaking performance and motivated Foley.
- The clean-frame rule is injected once instead of repeating subtitle vocabulary in every storyboard beat.

## 0.1.15 - 2026-08-18

### Fixes

- Script generation now has explicit Auto, DMX-only, and APIMart-only routing; single-provider modes never switch providers silently.
- Companion uses independent public DNS for DMX and APIMart, bypassing proxy/VPN `172.19.x.x` fake-IP answers.
- Interrupted local screenplay requests now report a Companion error instead of falling back to a hosted function that can end as an HTML gateway page after 60 seconds.
- Auto mode preserves both DMX and APIMart failure reasons for actionable key, model, and network diagnostics.
- Image-to-image references are compressed in the browser and uploaded individually so generation routes receive URLs instead of an oversized multi-image Base64 payload.
- Image-to-image, costume, and single-storyboard generation now safely report empty, HTML gateway, and JSON error responses instead of `Unexpected end of JSON input`.

## 0.1.14 - 2026-08-18

### Fixes

- Story's connection check no longer downloads and parses the unrelated, large character-replacement workflow on a fresh computer.
- The check now reports device-key, H3 workflow, and ComfyUI API stages separately and gives actionable browser/local-network errors.
- Unavailable SSH hosts, ports, or instances now fail quickly with a specific error instead of hanging until the browser reports `Load failed`.
- Companion authorization and Story requests now share public-DNS resolution, fixing false “authorized” states when a proxy/VPN maps the X-GPU hostname to a private fake IP.

## 0.1.13 - 2026-08-18

### Fixes

- Story continuity now hands motion across clips before the terminal still and trims both sides of the join.
- MiniMax H3 audio is restricted to approved dialogue and minimal motivated production sound; voice references no longer supply script content.
- Image and video prompts enforce an exact per-beat cast to prevent duplicate or extra characters.
- Story planning defaults to visual storytelling and no longer invents dialogue, narration, subtitles, or incidental voices.
- Companion setup now explains that every computer owns a distinct device key and must be authorized separately.
