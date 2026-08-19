# Changelog

## 0.1.19 - 2026-08-19

### Added

- Story export now downloads every completed H3 segment to durable Companion storage before starting FFmpeg, so a browser refresh no longer discards the film's source clips.
- Native export jobs persist their manifest, normalized intermediates, progress and final output under the Companion data directory and resume after a Companion restart.

### Fixed

- Story export no longer remains indefinitely at 5% while waiting for browser FFmpeg WASM; Companion v0.1.19 performs the merge with its bundled native FFmpeg.
- Segment download, per-segment normalization and final concatenation now retry independently up to three times. SHA-256-verified downloads and valid intermediate files are reused instead of repeated.
- Native export normalizes resolution, frame rate, pixel format and audio layout, including silent audio for clips without a sound track, before a stream-copy final merge.
- Failed native jobs retain a browser recovery marker and automatically restart when the same project returns to Export; completed jobs stream directly from Companion without loading the whole film into browser WASM memory.
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
