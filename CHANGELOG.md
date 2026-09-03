## 0.1.185 - 2026-09-04

- Remove the remaining hard-coded 18-shot summary and legacy project-count labels from series actions, progress cards, and current/historical job titles. Script tabs, shot totals, and ready badges now show the actual saved episode length.
- Clarify four-panel reference batching without implying a fixed shot count for every episode. This is a web-only UI release; existing scripts and assets are unchanged, and Companion 0.1.184 remains compatible without an update.

## 0.1.184 - 2026-09-04

- Replace Story's nine-panel reference generation with native 2×2 four-panel sheets. Prompt layout, batching, server-side crop geometry, canvas previews, progress labels, error text, and split requests now all use four shots per batch.
- Replace the 9/18-based shot selector with every multiple of four from 4 through 80 and make 16 shots the new ordinary-story and generated-series default. Authored screenplays still retain their exact original shot count, with a partial final four-panel batch when needed.
- Preserve paid work across the upgrade: every new grid task stores its 2×2 geometry, while interrupted pre-upgrade 3×3 tasks are recognized and recovered with their original nine-cell crop instead of being resubmitted or mis-split.

## 0.1.183 - 2026-09-03

- Let every missing character card, scene reference, and automatic prop reference be generated independently from its own card. A recoverable task ID is resumed; an explicit manual retry may start one fresh paid attempt only when the previous submission cannot be resumed.
- Treat a user-specified character image and a library-selected character as approved production imagery. Automatic preparation may fill missing voice or other assets but never redraw those approved characters or user-uploaded props.
- Keep bulk preparation useful after partial manual setup: completed and specified assets remain locked, other assets continue independently, and failure messages now point directly to the per-asset recovery controls.

## 0.1.182 - 2026-09-03

- Rebuild storyboard-to-H3 conversion around the authored camera plan: every shot now reads linearly as framing, concrete action and expression, camera path, ending state, exact dialogue, and sound instead of burying the scene beneath repeated meta-contracts.
- Cut the current dialogue-shot prompt by roughly one third while preserving all four approved `videoDirection` fields and every exact `<d>` line. Subject, picture, and audio bindings remain explicit; repeated retention, material, edit, and speech prose is consolidated.
- Prevent subtitle vocabulary from becoming a generation cue: dialogue prompts now ask positively for clean camera-original imagery and audio-only speech without enumerating subtitles, captions, phonetics, or romanization. This remains generation-time prompt control and adds no OCR, subtitle QC, or cleanup pass. The prompt contract advances to `h3-v39`.

## 0.1.181 - 2026-09-03

- Rebuild native H3 generation prompts around the official six-section structure: visual direction stays English, only exact Chinese dialogue remains inside `<d>[Chinese]`, and clean-frame, series-look, repair, and film-ending instructions now live before the authored shot prose instead of trailing the final dialogue.
- Prevent voice-reference calibration speech from leaking into the opening: mark every bound audio input as timbre-only without copying its original signal, remove rigid per-line dialogue onset timestamps, and keep the pre-dialogue sound bed explicitly non-vocal.
- Preserve the approved screenplay's complete action, visible detail, camera path, ending position, dialogue order, and wording in the H3 prompt. The prompt contract advances to `h3-v38`, so older affected video cache entries are regenerated without adding subtitle or audio QC passes.

## 0.1.180 - 2026-09-03

- Remove the arbitrary 90–150 second delivery gate. Series films now retain their actual screenplay and exported-timeline duration, whether shorter or longer than two minutes.
- Keep the necessary delivery safeguards: the uploaded film must still have a readable positive duration, video and audio tracks, the project aspect ratio, and a locally verified untruncated export timeline.
- Replace the obsolete “18 shots / about 2 minutes” home-page promise with project-driven shot count and duration wording.

## 0.1.179 - 2026-09-03

- Treat every manually added series prop as a narrative requirement: automatically queue episode-story rewriting, preserve historical deliveries, and require the prop to perform a concrete visible role in at least one episode and its detailed shots instead of remaining a library-only asset.
- Protect formed screenplays during authorized prop insertion: the model may append only a short visible prop interaction while every original action/image-prompt word, exact dialogue line, shot boundary, and order remain intact.
- Remove the last hard-coded 18-shot series production preflight. Story planning, delivery audit, queue labels, and production contracts now validate against each project's actual `shotCount`, including the current 9-shot authored project.

## 0.1.178 - 2026-09-03

- Allow one-episode series projects from both the creation form and domain validation; pasted formed screenplays still auto-detect as a single episode with their authored shot count.
- In authored-screenplay mode, keep the user's natural prop wording unchanged and treat validated `objectIds` as the asset binding. Retained drafts no longer enter an impossible rewrite loop merely because “black mask” differs from the registered canonical prop name; generated scripts keep the stricter textual-grounding check.
- Preserve explicit authored prop bindings during later asset rescans and show the project's real shot count in queue job names instead of always saying “18-shot screenplay”.

## 0.1.177 - 2026-09-03

- Recognize pasted, numbered shooting scripts as authoritative screenplays instead of story ideas: retain their original shot count and exact action, framing, camera, atmosphere, image prompt, dialogue, and order without inventing additional episodes or plot.
- Expand only technically impossible shot durations so exact dialogue can finish; finalized character, location, and prop IDs are still reconciled, while model-written replacements for authored action or dialogue are rejected. Existing padded projects migrate on their next queued retry while retaining prepared assets and historical deliveries.
- Keep Chinese `<d>` dialogue as soundtrack/lip-sync data only and place an explicit no-visible-dialogue rule after all shot prose. The H3 prompt contract advances to `h3-v37`, invalidating affected old video cache entries without adding subtitle OCR, quality checks, or removal passes.

## 0.1.176 - 2026-09-03

- Remove the contradictory director instructions that told Chinese projects to write `videoDirection` in both Chinese and English; all examples, output fields and preflight rules now consistently require English visual prose while preserving only registered Chinese character and object names.
- Strengthen retained-draft repair with an explicit registered-name whitelist and semantic validation before checkpointing, so quoted dialogue concepts or other Chinese text cannot be accepted as a successful patch.
- Repair up to six contaminated fields in one bounded request while preserving every valid storyboard field and the existing retry ceiling.

## 0.1.175 - 2026-09-03

- Reconcile each 18-shot screenplay against the finalized character and fixed-prop registry before storyboard production: safely restore valid speaking cast, repair all ungrounded prop references in one bounded pass, and normalize shot count without changing or reordering dialogue.
- Make manual 18-shot generation queue unfinished shared-asset preparation first; one-click production performs the same reconciliation automatically before entering Story.
- Persist and display a per-episode record of automatic asset-authoritative screenplay corrections instead of silently changing the draft.

## 0.1.174 - 2026-09-03

- Show a persistent “Saved to library” badge on up-to-date series character cards and an immediate inline success confirmation after saving; automatically clear the badge when the card appearance or reusable voice changes.

## 0.1.173 - 2026-09-03

- Add per-character card generation jobs that can be queued independently, plus one-click saving of completed series characters and their reusable voice metadata to the browser character library.
- Distinguish outline-discovered props from user-specified props: automatic props receive isolated continuity reference images during preparation, while uploaded product or real-object references remain immutable user sources.
- Restore the preparation action for legacy projects whose automatically discovered props do not yet have images, with backward-compatible source inference and checkpoint-safe image generation.

## 0.1.172 - 2026-09-03

- Make incremental director-field repair prompts output English visual prose, matching H3 validation and preventing Chinese productions from looping after a contaminated or over-budget draft.

## 0.1.171 - 2026-09-03

- Restore English-only H3 visual direction for Chinese productions while keeping exact Chinese dialogue inside `<d>[Chinese]`; use one concise clean-frame instruction and translate legacy visual metadata to neutral English fallbacks to reduce burned subtitle risk.
- Remove automatic image-cast and video duplicate/subtitle vision gates from one-click production, relying on locked references and prompt contracts without blocking or regenerating completed media.
- Run independent video segments in bounded two-wide batches while preserving explicit previous-tail dependencies, task recovery, and compatible previously paid clips; new prompts use `h3-v36`.

## 0.1.144

- Fix the cross-platform Companion release check so the image-safety test resolves its shared TypeScript module under clean GitHub runners.

## 0.1.143

- Add one series-wide visual reference that carries only culture, palette, color temperature, lens language and lighting through character cards, locations, storyboards and video prompts; changing it archives prior visual generations while retaining scripts, voices and delivered films.
- Make GPT Image 2 live-action prompts read like concise on-set photography direction, including the explicit “ultra-real” intent, authored action and camera evidence without CG/VFX rendering jargon.
- Strengthen autonomous production with durable image submission recovery, preserved provider refusals, reviewed adult-clarity retries, bounded interruption recovery and complete 18-shot export hydration.
- Audit generated video for confirmed duplicate character bodies and final-shot speech, preserving paid task history and repairing only the affected segment when evidence supports it.
- Support Midjourney V8.2 content references plus independent `sref`/`sw` style control with minimal provider payloads and one image per storyboard shot.
- Allow individual failed production jobs to be deleted without removing scripts, media, checkpoints or completed deliveries.

## 0.1.142

- Reserve a natural one-second ending without dialogue or narration only for the film's final shot, identified from the complete screenplay. Intermediate shots and generation segments do not receive this rule.
- Protect only the film ending from pacing acceleration in preview and browser/native export; reordering moves the protection. Preserve source audio and picture without forced muting, black frames or freeze padding. Previously generated speech is not automatically re-timed.

## 0.1.141

- Share the 720-character motion-brief budget across fields. Accept complete descriptions that exceed an individual writing target when the combined brief and final 7,000-character H3 prompt still fit; keep visual/dialogue validation intact.

## 0.1.140

- Retain intermediate camera-field repairs even when another field still exceeds its budget. Transport failures have a separate bounded retry allowance so they do not consume content-repair attempts.

## 0.1.139

- Write narrative camera directions as concrete starting views, motivated paths/focus transfers, speed and visible endpoints. Keep observational and surveillance capture behavior separate.
- Remove framing locks that contradicted camera movement while preserving reference identity, materials and exact first/last frames.
- Explicit prompt refresh redesigns motion against available storyboard images; ordinary preview still reuses valid directions and completed media stays intact.
- Repair vague or contradictory new camera directions and overlong fields without needlessly rewriting valid visual details.

## 0.1.138

- Persist individual storyboard outputs in asset storage before completion. Storage failures retain the paid generation task for recovery instead of submitting a new image.

## 0.1.137

- Resolve conflicting cast/anatomy checks against the original approved reference before regenerating an image. Intentional anthropomorphic designs no longer fail solely for differing from natural zoology.
- Confirmed missing/substituted roles still fail; unavailable review remains unknown.

## 0.1.136

- Reattach recently active paid image tasks without spending content-repair attempts.
- Give explicit congestion and pre-TLS connection failures a separate six-attempt backoff budget; do not broaden retries for uncertain paid submissions, credentials or balance failures.

## 0.1.135

- Apply visible-anatomy evidence rules to both cast audit passes, preventing false mermaid repairs for cropped or concealed tails while retaining checks for visible species conflicts.
- Show the current shot when automatic image generation falls back to individual frames.

## 0.1.134

- Preserve full structured GPT Image prompts at submission; the legacy 4,000-character truncation discarded cast/reference mapping and trailing output constraints.

## 0.1.133

- GPT实拍角色先生成单张定妆主图，再扩展辅助多视图卡；制作始终绑定主图，防止多视图再次引入CG媒介或错误解剖。
- 主图与角色卡分别保存任务断点；加入独立摄影质感检查，失败或未知如实记录，不伪装通过。
- 重选角色或修改外观会清理旧主图；保留既有已定稿资产。

## 0.1.132

- GPT实拍角色卡改为定妆摄影参考，锁定身份、服装和物种，不继承旧参考图的CG媒介；明确的动漫/CG/参考风格不变。
- GPT场景采用单幅勘景照片，单镜和九宫格统一身份与摄影风格的职责。
- 角色补图中断后先恢复缺图，再执行视觉核验；已有素材不覆盖。

## 0.1.131

- MJ 分镜改为逐镜生成，移除九宫格及自动转用其他生图模型；其他模型保持原流程。
- 有参考图的单镜使用实测通过的 V8.2 编辑请求，完整保留角色身份、参考图映射、服装与镜头动作；固定原始参考，避免逐镜累积漂移。
- 每镜核验人物与单画面构图，先检查已付费候选，再有限次局部重试；未知核验结果保留警告，不伪装通过。
- 单镜任务号立即同步到断点，保留已有合格图片及视频。

## 0.1.130

- 连续剧新增1:1方形画幅，从项目保存、Story制作到成片交付保持一致；修复方形成片被误判为横屏规格的问题。
- 保持既有项目画幅和已生成素材不变。

## 0.1.129

- 所有集共用导演字段局部修稿：自动重写超长、非英文或混入声音指令的运镜字段，不截断文本，不重写已通过的分镜和台词。
- 提示词刷新复用相同纠错规则，临时请求失败保留原稿；整季台词超时改用独立局部修稿上下文。
- 保持原有限额、有限次重试与断点缓存，网页和 Companion 同步使用完整运镜简报。

## 0.1.128

- 修稿同步视频分段的独立对白合同，避免分镜已改而 H3 仍生成旧台词。
- 开始制作前自动修复旧断点的对白不一致，仅清理受影响片段，保留其他已付费视频及所有图片、音色。

## 0.1.127

- 自动检测相邻镜头对白错配到不同角色，按本镜职责和动作局部修稿；保留图片与固定音色，仅重制受影响的视频片段。
- 修稿缓存绑定源剧本，避免复用过期台词；拒绝只替换虚词而保留错误角色含义的修稿。

# Changelog

## 0.1.126 - 2026-08-31

- Bound same-origin storyboard responses to H3-ready 1600px and 1.6MB, retaining original project image URLs and paid task identities.

## 0.1.125 - 2026-08-31

- Read APIMart storyboard images through a same-origin server route before H3 preprocessing, preserving original images and task identities.
- Restrict source hosts, reject redirects, and enforce a 45-second timeout and streamed 25MB limit.

## 0.1.124 - 2026-08-31

- On refresh, recover only missing grid cells; never replace completed single-image repairs or invalidate paid videos by re-splitting an old grid.

## 0.1.123 - 2026-08-31

- Synchronize frame state before and after targeted repair so deferred React updates cannot skip generation.
- Limit the frame-only anatomy pass to nonhuman creatures; ignore empty extra-character findings and avoid cropped-tail false positives.

## 0.1.122 - 2026-08-31

### Fixed

- Audit series frame identities before video generation and repair only mismatched frames with two persisted attempts, retaining completed segments.
- Record unavailable/refused visual checks as review warnings rather than passes; stop provider fallback on content refusals.
- Keep voice-only roles out of required image casts and preserve creature anatomy; distinguish crimson color descriptions from injury.

## 0.1.121 - 2026-08-31

### Fixed

- Budget all nine grid panels, complete casts and reference mappings before composing the prompt; preserve the result at the provider boundary instead of truncating later shots.
- Automatically use individual image generation with recovery when a grid cannot fit its mandatory content.

## 0.1.120 - 2026-08-31

### Fixed

- Audit series episodes against their approved six-part episodic contract while retaining seven narrative milestones for standalone Story projects.
- Preflight approved shots, exact dialogue, fixed voices and speech timing before direction; safely rebuild older series plans from saved screenplays.
- Preserve ordered A-B-A turns and intentional repeated dialogue inside approved shots, retaining cross-shot segment boundaries.

## 0.1.119 - 2026-08-31

### Fixed

- Adapt approved series screenplays directly to direction, preserving A-B-A exchanges, exact dialogue, sound and timing without a redundant writing pass. Ordinary Story generation is unchanged.
- Expand automatic Fish casting to public catalog candidates when needed, preserving source provenance and validating audition language before locking. Public visibility is not a platform license assertion.

## 0.1.118 - 2026-08-31

### Fixed

- Require explicit invisible design evidence before accepting generated voice-only roles; flashbacks, portraits and recorded appearances require character cards.
- Allow editing character appearance type while retaining fixed voices and delivered versions, and pass appearance types into episode writing context.
- Label voice-only placeholders and voice readiness explicitly.

## 0.1.117 - 2026-08-30

### Fixed

- Browse and search Fish public, licensed and workspace voice catalogs directly from series roles, play existing samples, and pin a chosen voice without using a character name as the search query.
- Keep public visibility separate from usage rights; require confirmation for non-platform-licensed selections and verify manually chosen references in the project language.
- Mark roles without automatic candidates for selection while preparing other cast and locations; account, network and storage failures still stop immediately.
- Preserve character artwork and historical deliveries when changing a voice; clear stale voice candidates, references and errors.

## 0.1.116 - 2026-08-30

### Fixed

- Preserve per-shot ambience and action Foley in shared Story/series video prompts instead of truncating a flattened multi-shot sound list to four entries.
- Request audible supporting ambience under dialogue, consistent beds within a location and intentional silence when authored; guide writing toward concrete sound sources instead of universally faint or non-audible visual descriptions.
- Existing videos remain unchanged; no automatic regeneration or external audio overlay is introduced. Native model mixing still requires listening review.

## 0.1.115 - 2026-08-30

### Fixed

- Save the latest story plan alongside submitted video IDs instead of a stale asynchronous closure snapshot.
- Clear historical errors when resuming or claiming a job, and do not display a previous pause as an active failure.

## 0.1.114 - 2026-08-30

### Fixed

- Bind structured, approved series actions, cast, timing and exact dialogue before directing instead of reparsing role-labelled display text.
- Reject reordered source shots, unregistered speakers and missing voices before direction while preserving writing and directing checkpoints.
- Bind approved environments per shot and map each grid environment reference to its shot numbers instead of always using the first location.

## 0.1.113 - 2026-08-30

### Fixed

- Resume completed writing when the source, shot count and voices still match; persist it before directing so direction failures do not restart writing.
- Retain individual writing/directing drafts and revalidate before reuse. Report oversized motion fields together and leave headroom under existing limits.
- Keep the actual production stage visible when a routine checkpoint is saved.

## 0.1.112 - 2026-08-30

### Fixed

- Repair all overlong dialogue with explicit per-line budgets while retaining 18 shots, shot timing, speakers, visuals and actions. Revalidate without extending the film or dropping lines.
- Preserve resumable script drafts and reject unsafe dialogue patches.

## 0.1.111 - 2026-08-30

### Fixed

- Report all missing episode text fields with exact paths and request only those values, retaining the rest of the draft while still enforcing cast, location, promise and user revision checks.
- Reject invalid repair patches without replacing recoverable drafts, and reuse valid cached results after restart without buying the same writing again.

## 0.1.110 - 2026-08-30

### Fixed

- Recover generated images rejected by storage size limits by uploading a WebP encoding of the same source, trying lossless first and then high quality while preserving resolution, orientation and transparency. Never request regeneration.
- Bound download size and decoded pixels, retain task IDs on failure, and never treat network or account errors as image-size failures.

## 0.1.109 - 2026-08-30

### Added

- Delete current and historical failed production tasks while retaining scripts, production checkpoints, assets and delivered films. Only the task record and its saved configuration are removed.
- Validate project ownership and failed status inside the persistent database transaction; reject deletion of active, queued, paused or completed tasks. Older Companion builds display an update requirement.

### Verification

- 25 series regression tests, TypeScript checks, isolated API smoke tests and browser deletion/reload checks pass, including preservation of other tasks, projects and delivered media.

## 0.1.108 - 2026-08-30

### Fixed

- Series casting no longer treats source-language tags as hard TTS capability limits. Prefer native references, then audition cross-language voices from the licensed library and owned workspace.
- Cross-language trials require detected-language and transcript checks before locking a voice. Persist audio and verification results; ASR outages never resynthesize existing audio, and cached older trials can be verified in place.
- Separate current tasks from historical results and display update times. Reject obsolete retries and duplicate active work on the server.

### Verification

- 268 tests and TypeScript checks pass. A real He Jin trial produced approximately 9 seconds of English, detected as en with a 100% standard-text match; its audio is cached. No image, video or season generation was started.

## 0.1.107 - 2026-08-30

### Fixed

- Companion obtains scoped upload signatures from the website when local Cloudinary credentials are absent. Media uploads directly to Cloudinary; account secrets are never bundled in the desktop app.
- Voice references preflight storage and retain synthesized audio across upload failures/restarts. Concurrent identical requests share work; storage, quota and transport failures no longer cycle through paid voice candidates.
- Series writing validates and checkpoints one episode at a time, includes the exact promise schedule, and repairs retained drafts instead of rewriting a whole batch. Invalid output is never accepted by inserting promise IDs.
- Automatic series casting searches owned workspace voices as well as platform-licensed voices, retaining truthful provenance and filtering language, gender, availability and duplicates.

### Verification

- 260 tests and TypeScript checks pass, including failure/restart recovery without repeated synthesis and missing-p4 draft repair. Provider generation is mocked; real acting quality is not certified.

## 0.1.106 - 2026-08-30

### Added

- Series Studio now has a confirmed Delete Series action and a recoverable sidebar trash. Outlines, characters, locations, checkpoints and historical deliveries remain intact; ordinary Story projects and the source character library are untouched.
- Running tasks must pause and save checkpoints before deletion. Queued tasks are paused atomically; trashed series cannot be edited, retried or produced. Restoring never resumes paid generation automatically.
- This is reversible deletion, retaining media files rather than reclaiming disk space. Requires Companion v0.1.106 or newer.

### Verification

- All 253 tests, type checks, isolated trash/restore API checks and browser confirmation/cancel/restore checks pass. Retained media is downloadable after restore; stale writes and retries are rejected. No user project was deleted or paid generation triggered.

## 0.1.105 - 2026-08-30

### Fixed

- Shared character/location preparation now requires the outline and asset lists, independently of unfinished or outdated episodes. Script and production still require valid season stories. The page explains blockers and shows the latest failed development task.
- Series casting retains full-card, concept and matching historical image addresses. Failed cards fall back to usable saved references; selection persists the image that actually loaded, without carrying failed card URLs into production or regenerating characters.
- Unavailable image candidates show a recoverable error and cannot be selected. Independent preparation requires Companion v0.1.105 or newer.

### Verification

- All 251 tests, type checks, isolated preparation API checks and browser fallback/select/save checks pass without real generation or changes to existing stories and failed jobs.

## 0.1.104 - 2026-08-30

### Fixed

- Series Studio navigation now follows outline → characters and locations → episode stories → production queue → films. Opening or switching a series defaults to its outline.
- This is a website navigation update only; scripts, assets, queue behavior and stored projects are unchanged. Companion v0.1.103 remains compatible and does not need reinstalling.

## 0.1.103 - 2026-08-30

### Added

- Series characters can cast an existing actor from character designs or Story history. Search and preview saved appearances without changing the episode character's name, dramatic role, relationships, or storyline.
- Reuse complete character cards or existing reference images without new image generation. Inherit saved voices and only synthesize missing voice samples; preserve deliberate per-role voice overrides when the selected actor has no stored voice.
- Cast changes invalidate production only for affected episodes and preserve scripts and old deliveries. Re-selecting the same actor preserves completed preparation.
- Legacy local image thumbnails are persisted through the existing image host only when selected. The library is read without modifying its original records and remains scoped to the browser and site.

### Verification

- All 249 tests, TypeScript checks, isolated casting API checks, and browser search/select/save checks pass without paid generation. Library casting requires Companion v0.1.103 or newer.

## 0.1.102 - 2026-08-30

### Added

- Series Studio at `/series`: season outlines, episode stories, planned payoffs and cliffhangers, and editable 18-shot scripts targeting two minutes per episode.
- Shared character and location preparation, with automatic discovery of licensed Fish Audio voice candidates, synthesis availability checks, and persistent voice locking across episodes.
- Local persistent production queues with pause, recovery, duplicate prevention, and an independent Companion worker that continues while the website is closed.
- Per-episode production, batch production, validated MP4 delivery, individual downloads, and retained historical versions. User story edits invalidate dependent drafts without deleting old films.

### Verification and requirements

- All 244 repository tests and the Companion production build pass. Isolated queue/API, media validation, range-download, desktop, and narrow-screen checks pass without paid generation.
- Series Studio requires Companion v0.1.102 or newer for local storage and background execution. Existing Story projects remain isolated from series jobs.
- Real provider-generated voice and video quality still require sample production; automatic voice selection currently checks metadata fit and synthesis availability, not acting quality.

## 0.1.101 - 2026-08-30

### Fixed

- Automatic production now retains segment-authoritative dialogue while refreshing current media and task state, matching manual generation and avoiding unnecessary paid reruns.
- Completed manual clips are recognized after automatic resume or project restoration. Older raw-dialogue caches remain reusable only when their compiled segment speech is unchanged; changed images or edited segment dialogue still invalidate them.

## 0.1.100 - 2026-08-30

### Fixed

- Story video segments now start from their selected storyboard by default. Shared or missing sequence/location metadata and legacy narrative-continuity flags cannot silently replace it with an earlier video's tail.
- Added an explicit first-frame source selector. Tail-frame handoff requires a completed adjacent segment, matching nonempty sequence/location IDs, and no scene-change transition; it cannot skip missing segments.
- Segment thumbnails always show original storyboard images. Generated video remains a separately labelled preview; legacy automatic handoffs are flagged for regeneration and blocked from final merging while keeping their paid artifacts recoverable.
- Unchanged v0.1.99-and-earlier storyboard-start clips remain reusable; obsolete automatic handoff clips must be regenerated. New signatures use h3-v34.
- Prompt previews for ComfyUI now compile in the same Companion as actual submission. Companion v0.1.100 is required and includes the previously hosted-only observational prompt changes.

### Verification

- Added regressions for default first-frame identity, empty metadata, scene changes, multi-shot predecessors, missing segments, legacy artifact compatibility, preview separation, and Companion prompt CORS.

## 0.1.99 - 2026-08-30

### Changed

- Rebuilt capture prompting around two separate causal tracks: subjects remain occupied by the scene while cameras observe and react only after visible movement begins.
- Broadcast candid, documentary, bystander phone, news telephoto, home-video, surveillance, and cinematic presets now use concrete task-trigger-response-return behavior instead of generic natural-performance adjectives.
- Still-image prompts select one physically possible instant from an action rather than compressing a full sequence into one frame; nine-panel prompts distribute distinct action phases while preserving all nine shots.
- H3 temporal direction now preserves pauses, unfinished adjustments, delayed camera corrections, low-activity intervals, and residual recovery without turning the subject into a continuous performer.
- Silent visual directions remove ambiguous pseudo-speech cues such as self-talk, speech-like mouth movement, or hearing a sound, preventing native H3 from interpreting them as unscripted dialogue.
- Long H3 prompt compaction now preserves shot chronology, action causality, camera response, and authoritative dialogue constraints.

### Verification

- All 29 repository regression suites pass, including capture-preset, nine-panel completeness, H3 prompt, image-provider, story-stage, object-consistency, and subtitle-safety coverage.
- Next.js production compilation, lint/type validation, static generation, and diff validation pass.
- This is a hosted prompt-generation update and does not require a Companion update.

## 0.1.98 - 2026-08-29

### Changed

- Added a dedicated GPT-Image-2 prompt compiler for cleaner photographic output. Live-action requests now use one coherent physical capture system instead of mixing phone, mirrorless, cinema, and broadcast language; non-photographic styles retain their native medium.
- `gpt-image-2-official` now explicitly requests the high-fidelity quality tier, while the standard GPT-Image-2 route remains the faster option.
- Every referenced product or prop is now treated as an immutable design source across GPT-Image-2, Seedream, Nano Banana, Grok, Midjourney, and local image generation. Shape, proportions, component layout, materials, finish, color, markings, and scale remain locked while only viewpoint, placement, lighting, and physically possible articulation may change.
- Product labels and logos that physically belong to a reference object are preserved in place without weakening the global ban on captions, subtitles, watermarks, UI, and newly invented text.
- Referenced scene objects now receive priority when a provider's image-reference limit would otherwise discard them. Midjourney also uses a moderately stronger image-reference weight for product-bearing story shots and grids.
- Nine-panel storyboard prompts carry explicit character, environment, and object roles while preserving all nine unique shot descriptions within the provider prompt budget.

### Verification

- All repository regression suites pass, including new GPT-Image-2, Midjourney, reference-object, nine-panel completeness, and provider-payload coverage.
- Next.js production compilation, lint/type validation, static generation, and diff validation pass.
- This is a hosted web update and does not require a Companion update.

## 0.1.97 - 2026-08-29

### Changed

- Promoted the production-tested DaSiWa four-step H3 stack for single-image and first/last-frame video: the installed pruned FL2VA INT8 base, verified DaSiWa four-step adapter, INT8 text encoder, Sage attention, 4/12/3 sampling, and no approximate cache.
- Existing browser settings migrate once from the former balanced eight-step default to DaSiWa four-step; the eight-step and legacy profiles remain selectable rollback options.
- Multi-reference Ref2VA remains on its existing remote workflow until a separate multi-reference quality test passes.
- Story video generation now requires Companion v0.1.97 so the hosted UI cannot submit the new profile through an older local service.

### Verification

- Verified the DaSiWa adapter against its published SHA-256 before installation on the 4090D node.
- A paid eight-second Nana Shanghai broadcast-candid I2VA smoke test completed in 156.8 seconds at 1280×736/24fps with full eight-second AAC audio.
- Frame-by-frame review passed identity, wardrobe, anatomy, foreground-occlusion, first-frame, and temporal-stability checks; the low-level ambience produced no credible Whisper speech detection.
- H3 regression coverage and the Next.js production build pass.

## 0.1.96 - 2026-08-29

### Fixed

- Fixed completed fal H3 Max jobs failing during status/result retrieval with HTTP 405.
- fal submissions continue to use `minimax/h3-max/image-to-video`, while queue polling now follows the official client and resolves against the parent `minimax/h3-max` app.
- Existing persisted `fal:request_id` tasks recover through the corrected route without purchasing or submitting another render.

### Verification

- Reproduced HTTP 405 on the previous route with the completed production request and confirmed its generated fal media asset remains available.
- Added exact queue status/result URL assertions; fal, automatic-production, and video-segment regressions plus the Next.js production build pass.

## 0.1.95 - 2026-08-29

### Added

- Added `fal · MiniMax H3 Max` as a video provider for both Story production and the standalone image-to-video workspace, with native picture, dialogue, ambience, and sound-effects generation.
- Added 5–15 second renders, 480P/768P output, optional last-frame guidance, asynchronous queue recovery, and Cloudinary delivery fallback.
- Added a dedicated masked fal API Key field in Settings. The key is stored with the existing browser-local app settings and sent only to AID's server-side fal proxy when submitting or polling a fal task.
- Added an optional project-wide fixed seed for reproducibility experiments. It is explicitly presented as a sampling seed, not a voice ID or guaranteed speaker lock.

### Changed

- Prompt expansion defaults to disabled so fal cannot silently rewrite exact AID dialogue.
- When fal has no audio reference, only English voice-style direction may be added outside dialogue tags; Chinese cast notes remain excluded from H3 directing prose.
- Story segment signatures now include the selected video provider and fal seed so changed settings cannot reuse stale video output.

### Verification

- Added fal queue payload, default-policy, seed, status, and completed-result regression coverage.
- All 216 regression tests and the Next.js production build pass.
- This hosted integration does not require a Companion update.

## 0.1.94 - 2026-08-29

- Added a persisted end-to-end production timer from one-click production start through final merged export.
- Timing survives refresh, project import/export, pause, and resume; user-paused intervals are excluded.
- Segment editing shows live running/paused/completed production time, while export keeps the final total visible.
- Unrecoverable automation errors now pause timing instead of inflating elapsed production time after the run stops.

## 0.1.93 - 2026-08-29

### Added

- Added project-level capture modes beside the Story production-style bible: broadcast candid, observational documentary, bystander phone, news telephoto, home video, surveillance, studio commercial, cinematic narrative, and follow-reference.
- Broadcast Candid consistently directs distant long-lens observation, unstaged posture, foreground pedestrian occlusion, off-center framing, slight edge crops, motion blur, restrained broadcast compression, and truthful skin texture.
- Story batch Excel files may provide an optional Capture Mode column; cinematic narrative remains the default.

### Fixed

- Capture mode now reaches the storyboard director, the final Midjourney V8.2 request, Nano Banana grid/single-shot prompts, and the final H3 prompt compiled inside Companion.
- Midjourney story shots now treat character references as identity-only and explicitly ignore reference-card layout, names, and typography.
- Changing capture mode invalidates affected scene images, storyboard images, videos, and H3 cache signatures instead of reusing results from the previous mode.
- The H3 prompt cache contract is bumped to `h3-v33`, and Story video generation now requires Companion v0.1.93.

### Verification

- A paid end-to-end Nana “shopping on a Shanghai street / broadcast candid” test passed through Midjourney V8.2 with profile `votj2t8` and an eight-second H3 render, with no subtitles, dialogue, or music; Whisper produced an empty transcript.
- Added capture-mode regressions across directing, Midjourney, grids, H3, persistence, and cache invalidation; relevant tests, TypeScript validation, and the production build pass.

## 0.1.92 - 2026-08-28

### Added

- Added storyboard-aware smart pacing for final-film export. The default Standard profile protects emotional close-ups and dialogue while accelerating ordinary narrative, establishing, insert, montage, and action beats at different rates.
- Added Original, Cinematic, Standard, and Compact pacing profiles to the video editor, with the actual whole-film average speed shown before export.
- Multi-shot H3 clips now retain per-storyboard pacing windows, so two or three shots inside one generated segment can be retimed independently and rejoined without changing the authored dialogue.

### Changed

- Preview playback, trimming, timeline duration, seeking, Companion job recovery, and FFmpeg export now share the same source-to-output time map.
- Video and synchronous speech are retimed together with pitch-preserving `atempo`; the click-safe audio tail fade is applied only after retiming. Native export now requires Companion v0.1.92.

### Verification

- Added pacing classification, duration, trimming, reversible time-mapping, and Original-mode regressions.
- Native FFmpeg coverage verifies mixed-rate sections, audio-bearing and silent inputs, aspect-ratio normalization, recoverable jobs, and a shorter paced master.
- All 195 regression tests, TypeScript validation, and the production build pass.

## 0.1.91 - 2026-08-28

### Fixed

- Fixed segments being estimated at six seconds and then rejected because the final dialogue timeline needed 6.2 seconds after waiting for the speaking character's storyboard to appear.
- Video duration now probes the final speech compiler one second at a time: 6.2 seconds is promoted automatically to seven seconds, up to H3's 15-second limit, without rewriting authoritative dialogue or speeding up playback.
- The server recomputes the minimum playable duration, so stale projects or pages that submit an undersized duration are corrected before generation.
- If delayed dialogue still cannot fit within 15 seconds, automatic cinematic grouping splits the segment in advance; manual groups receive an actionable split error instead of submitting a task that must fail.
- The H3 segment cache contract is bumped to `h3-v32`, and Story video generation now requires Companion v0.1.91 so older duration logic cannot process the updated segment contract.

### Verification

- Added regressions for the 6.0/6.2-second boundary and automatic splitting when delayed speech onset cannot fit within 15 seconds.
- All 191 regression tests, TypeScript validation, and the production build pass.

## 0.1.90 - 2026-08-28

### Added

- Added a production `balanced8` acceleration profile for I2VA/FL2VA: the pruned FL2VA INT8 checkpoint, NVFP4 text encoder, official 768P eight-step Turbo LoRA, Sage Attention, eight NFEs, and video/audio shifts of 6/3 are now applied as one indivisible stack.
- Settings now expose the active FL2VA profile and retain an explicit legacy rollback option without changing the separate multi-reference Ref2VA path.

### Fixed

- Removed the saved-workflow mismatch that loaded a four-step LoRA while executing eight sampler steps. The compiled API prompt now locks and validates the UNET → Sage → LoRA → sampler chain before submission, so stale remote widgets cannot silently mix incompatible checkpoints and schedules.
- Connection diagnostics now validate the selected model and LoRA names against the live ComfyUI node definitions and report the exact acceleration profile applied to each workflow.
- Story video generation now requires Companion v0.1.90, preventing the hosted UI from submitting production FL2VA jobs through a Companion that does not enforce the balanced profile.

### Verification

- The official 1.96 GB 768P eight-step LoRA was installed on the production ComfyUI host and matched its published SHA-256 checksum.
- A same-prompt, same-reference, same-seed 6.584-second A/B render completed with stable identity, environment, hands, costume and mermaid-tail detail; both outputs contain 960×960 H.264 video at 24 fps and synchronized AAC audio with nearly identical loudness.
- A forced full hot-cache resample completed in 147.9 seconds versus 151.7 seconds for the legacy stack on the same source clip, while cold model-switch runs completed in 168–174 seconds.
- The latest 14-second first/last-frame Hybrid clip was replayed through the installed v0.1.90 Companion production API. It produced 14.375 seconds of 960×960, 24 fps H.264 video with AAC audio, used the complete locked 8/6/3 stack, and completed in 460.0 seconds versus 483.6 seconds for the legacy render (about 4.9% faster).
- All 189 regression tests, TypeScript validation, live ComfyUI model/profile validation, and the production build pass.

## 0.1.89 - 2026-08-28

### Changed

- Multi-shot H3 prompts now budget actor direction across the whole segment: the primary performer keeps the most detail while supporting actors retain their essential visible expressions and reactions.
- Repeated temporal, eyeline, and reference-retention instructions are consolidated without modifying exact `<d>` dialogue, shot actions, picture bindings, or cinematic cut grammar.
- The H3 prompt cache contract is bumped to `h3-v31`, and Story generation now requires Companion v0.1.89 so hosted planning cannot submit the new prompt contract through an older local engine.

### Fixed

- Fixed merged two-to-four-shot segments failing before submission when verbose performance direction expanded the H3 prompt beyond the 7,000-character limit.
- Removed duplicate generic expression instructions when a shot already contains detailed actor performance cues, preventing both prompt inflation and competing acting direction.
- Prompt overflow fallback now reports whether exact dialogue or actor tasks genuinely require a segment split instead of repeatedly retrying an unchanged oversized request.

### Verification

- A four-shot continuity stress case with three performers per shot, verbose action/expression/gaze/breath direction, two exact dialogue lines, and voice references produces a 6,952-character prompt while preserving every shot and dialogue line.
- 181 release regression tests pass across story planning, cinematic segmentation, H3 prompts/audio, voice casting, image generation, recovery, automatic production, and project isolation; production website and Companion builds also pass.

## 0.1.88 - 2026-08-28

### Added

- Story generation now shows a live three-stage thinking panel for story architecture, cinematic shot direction, and delivery validation, with rotating activity detail, elapsed time, and the target shot count.
- Long-form screenplay planning now separates the whole-film dramatic spine from bounded sequence beat maps, avoiding one oversized outline response while retaining a single causal authority across the film.

### Changed

- Automatic video segmentation now groups only genuine editorial phrases—shot/reverse-shot dialogue, action/reaction, master-to-coverage progression, inserts, montage, and explicit match bridges—while long takes, long dialogue, performance close-ups, and final hero images remain fidelity-locked single shots.
- Multi-shot H3 prompts now direct the exact cut relationship between pictures and preserve the 180-degree axis, eyelines, screen direction, match-on-action phase, spatial geography, and intentional framing progression.
- Reference pictures in a multi-shot segment are explicitly treated as discrete photographed setups rather than interpolation targets; morphing, identity blending, repeated coverage, and unmotivated soft transitions are prohibited.
- Saved automatic segment plans now carry a versioned cinematic-editing contract and rebuild stale v0.1.87 all-single boundaries; manual segment choices remain unchanged.
- Story and cinematic segment generation now require Companion v0.1.88 so the website cannot submit the new planning and H3 contracts through an older local engine.

### Fixed

- Restored cinematic multi-shot organization lost when v0.1.87 isolated every storyboard, without giving up I2VA/FL2VA fidelity for protected hero shots.
- Reduced long-outline truncation and invalid partial JSON by generating a compact spine first and requesting exact-count beat maps in batches of at most six shots.

### Verification

- 170 release regression tests pass across story planning, staged screenplay delivery, cinematic segmentation, H3 prompts/audio, voice casting, image generation, project isolation, recovery, and automatic production; TypeScript validation and production builds also pass.

## 0.1.87 - 2026-08-27

### Changed

- Automatic Story video production now creates one H3 clip per storyboard, allowing each storyboard image to remain the actual motion source instead of being averaged with several composition references.
- Single-storyboard generation now wires the image into H3's `first_frame` input and uses I2VA; voice-timbre references retain that locked frame through Hybrid conditioning, while continuity shots continue to use FL2VA.
- H3 prompts now declare reference priority, immutable identity/wardrobe/environment attributes, allowed motion, photographic material detail, and a three-phase performance timeline derived from each shot.
- The Story video channel now requires Companion v0.1.87 so an older Ref2VA-only local build cannot silently process a fidelity-locked request.

### Fixed

- Corrected the single-image workflow that previously submitted every storyboard through `ref_images` as Ref2VA, allowing faces, costumes, and environments to be redrawn before motion began.
- Visible cast binding now also considers performance cues and authoritative speech, preventing an actor described in the shot from remaining unbound to a reference subject.
- Consecutive same-character dialogue no longer deletes, replaces, or invents screenplay punctuation when compiled into one H3 vocal block.
- Existing paid multi-shot video artifacts remain restorable after the new fidelity-first automatic segmentation becomes active.

### Verification

- 90 H3 audio, H3 prompt, video-segment, story-delivery, and staged-screenplay tests pass together with TypeScript validation and the production build.

## 0.1.86 - 2026-08-27

### Added

- A one-sentence brief can now expand into a complete cinematic screenplay with character objectives, conflict, turning points, choices, and a resolved ending.
- Every visible character receives shot-specific performance direction for blocking, gesture, micro-expression, gaze, breath, reaction, and subtext.
- The storyboard review screen now exposes executable action direction, exact dialogue, and actor performance cards before image or video generation.

### Changed

- Long story-planning and directing responses now stream keep-alive events and a final structured payload instead of waiting for one monolithic JSON response.
- Character gender and age-group metadata now remain available to the screenplay writer for more consistent characterization and voice casting.
- Story generation now requires Companion v0.1.86 so the website and local screenplay engine always share the same schema and routing behavior.

### Fixed

- When the browser cannot reach the local Companion, screenplay generation now stops with a precise local-network permission message instead of silently falling back to a hosted request that later returns an HTML gateway error.
- Companion availability is retried before failure, and mid-request connection loss returns a structured error that the Story interface can display safely.

### Verification

- Production build, staged screenplay, story engine, story delivery, H3 prompt, streaming-response, and Companion-routing tests pass.

## 0.1.85 - 2026-08-26

### Changed

- Rebuilt video prompts around MiniMax's official `h3-prompt-writing` guidance: Ref2VA uses the six-section English structure, first/last-frame prompts use the three-section structure, and only `<d>` retains the dialogue's original language.
- Dialogue now carries only an onset timestamp and one `<d>` tag; speech end times, duration filling, “say once,” mouth-closing, and stop-speaking directions are no longer submitted.
- Chinese shot material is converted into concise English physical action at the video-prompt stage, reducing the chance that H3 vocalizes directing prose as extra dialogue.
- The H3 prompt cache contract is bumped to `h3-v28`, and the minimum Story video Companion version is now v0.1.85.

### Fixed

- The final submission boundary removes legacy controls such as `final word`, `mouth closes`, `stop speaking`, and their Chinese equivalents while preserving exact dialogue inside `<d>`.
- Saved legacy JSON, Chinese control contracts, and other stale prompt overrides are regenerated through the new prompt builder instead of being submitted unchanged.
- Corrected first/last-frame reference alignment so `Picture 1` is the opening frame and `Picture 2` is the ending frame.

### Verification

- H3 prompt, reference-audio, no-subtitle, video-segment, and story-delivery suites pass together with TypeScript validation and the production build.

## 0.1.84 - 2026-08-26

### Changed

- Chinese H3 prompts now use short, literal production language for people, objects, actions, expressions, framing, camera movement, continuity, and sound instead of contract-like terminology.
- Shot prose now reads like direct on-set instructions, such as “the panda doctor holds the mask,” “the camera stays fixed,” and “do not suddenly change position.”
- Dialogue timing remains onset-only and is stated plainly: start once at the timestamp, speak only the tagged line, and close the mouth after the final word.
- The H3 prompt cache contract is bumped to `h3-v27`, preventing reuse of clips created with the previous verbose wording.
- The minimum Story video Companion version is now v0.1.84 so the website cannot silently submit prompts through an older local generator.

### Fixed

- Removed every generated Chinese directing phrase containing `可见`; the final ComfyUI submission boundary also strips the cue from saved or cached prompts while preserving exact `<d>` dialogue.
- Abstract action prose such as “summarizes the mask's value” is removed instead of being sent as a filmable action and accidentally vocalized.
- Replaced terms such as object contracts, eyeline axes, screen sides, blocking, perspective relations, and decisive consequences with simple camera-observable sentences.

### Verification

- H3 prompt, reference-audio, story-delivery, and no-subtitle regression suites pass together with TypeScript validation and the production build.

## 0.1.83 - 2026-08-26

### Changed

- H3 Ref2VA prompts now follow the official six-section natural-language format; custom `timeline_json`, schemas, contracts, and pseudo-API fields have been removed from the submitted prompt.
- Each shot is written as an official `[Shot N]` paragraph with a concrete reference frame, framing, visible cast and objects, physical action, expression, camera, and spatial continuity.
- Dialogue is placed directly in its matching shot with one onset timestamp and one official `<d>[Language] exact text</d>` tag; no speech end timestamp or duration target is sent.
- First/last-frame generation now uses the official three-field base format, and no-score clips use `non_diegetic_music: N/A`.
- The H3 prompt cache contract is bumped to `h3-v26`, preventing reuse of clips generated from the previous JSON prompt format.

### Fixed

- Removed abstract screenplay outcomes, audience interpretation, relationship meaning, and model-readable JSON labels that H3 could mistake for dialogue.
- Subtitle, caption, title, logo, watermark, interface, and readable-text prohibitions remain explicit natural-language visual direction.
- Reference-audio definitions now bind timbre to the local H3 speaker alias while excluding source words, pauses, and timing.

### Verification

- H3 prompt, reference-audio, no-subtitle, and video-segment regression suites pass, together with TypeScript validation and the production build.

## 0.1.82 - 2026-08-26

### Changed

- Dialogue timing remains onset-only: `first_word_at` contains a pure timestamp, with compact non-vocal enums defining silence before onset and one exact start at onset.
- The prompt schema is upgraded to `aid_h3_timeline_v8`, and the cache contract is bumped to `h3-v25` so previously generated clips with result prose are not reused.

### Fixed

- `可见后果:` and `Visible result:` are now hard truncation boundaries; the label and everything after it are removed before any visual direction reaches H3.
- Abstract screenplay consequences are never appended to model-facing actions, including segment-reference shots whose local `speech` array is empty.
- Every action is filtered to camera-observable body, expression, prop, position, and physical-state changes; story-writing prompts now keep efficacy, value, rationale, and audience interpretation in screenplay metadata only.

### Verification

- 74 H3 prompt, video-segment, and staged-story tests pass together with TypeScript validation and the production build.

## 0.1.81 - 2026-08-26

### Changed

- H3 shot contracts now contain only observable expression, action, dialogue-event references, composition, camera, and spatial relation.
- Dialogue text remains exclusively in `dialogue_events[].spoken_once`; shot contracts refer to `D1`/`D2` IDs without duplicating readable speech.
- The prompt schema is upgraded to `aid_h3_timeline_v7`, and the cache contract is bumped to `h3-v24` so clips created with narrative-heavy visual contracts are not reused.

### Fixed

- Narrative relationship prose such as audience understanding, acceptance, questions, or expectations can no longer leak from `stateBefore`, `stateAfter`, or `editBridge` into the H3 payload and be vocalized as dialogue.
- Removed `blocking_relation`, `motion_physics`, duplicated per-shot sound, narrative transitions, and verbose continuity prose from model-facing shot contracts.
- Story generation now limits relationship state to directly visible distance, orientation, eyeline axis, and screen side.

### Verification

- 93 H3 prompt, reference-audio, video-segment, and staged-story tests pass together with TypeScript validation and the production build.

## 0.1.80 - 2026-08-26

### Changed

- H3 dialogue events no longer contain `duration_policy`, `natural_from_exact_text`, or any other open-ended natural-duration instruction.
- The prompt schema is upgraded to `aid_h3_timeline_v6`, and the cache contract is bumped to `h3-v23` so outputs created under the natural-duration policy are not reused.

### Fixed

- The closing dialogue-tag boundary is now the absolute voice stop: all human vocalization ends immediately, the mouth closes, and only room tone may remain.
- Explicitly forbids continuing, improvising, adding syllables or words, or filling the remaining clip after the exact tagged text.
- Special dialogue closing tokens occur only inside `spoken_once`, preventing duplicated control tokens in readable director instructions.

### Verification

- 55 H3 prompt, no-subtitle, video-segment, and auto-production tests pass together with TypeScript validation and the production build.

## 0.1.79 - 2026-08-26

### Changed

- H3 dialogue timing is now represented only by `dialogue_events[].first_word_at`; visual timeline intervals contain only their shot contract and visual action phase.
- The prompt schema is upgraded to `aid_h3_timeline_v5`, and the cache contract is bumped to `h3-v22` so previous clips with implicit speech windows are never reused.

### Fixed

- Removed `dialogue`, `voice`, and lip-expression state from visual interval rows, preventing a visual window such as `00:00.800-00:10.300` from being interpreted as a required speech duration.
- A line now starts once at its exact onset, runs for the natural duration of its tagged text, and returns to room tone without any explicit or implicit end boundary.
- Speaking shots whose semantic prose is removed for vocal safety now receive a restrained observable performance fallback instead of emitting an empty `action` contract.

### Verification

- 55 H3 prompt, no-subtitle, video-segment, and auto-production tests pass together with TypeScript validation and the production build.

## 0.1.78 - 2026-08-26

### Changed

- H3 dialogue events now publish only an exact `first_word_at` onset. Estimated speech endings remain internal capacity checks and are no longer sent to the model.
- The H3 timeline contract is upgraded to `aid_h3_timeline_v4`, and the cache contract is bumped to `h3-v21` so clips created under the old end-timestamp rules cannot be reused.

### Fixed

- Removed `window`, `final_word_complete_by`, `CONTINUE_TO_FINAL_WORD`, and completion-boundary controls that could make H3 prolong speech or invent syllables and words to fill an estimated duration.
- Dialogue now runs once at its natural pace, stops immediately after the exact tagged text, closes the mouth, and returns to room tone without a target end timestamp.
- Visual shot boundaries no longer terminate or restart an ongoing line; they can only schedule a new dialogue onset at an explicit `first_word_at`.

### Verification

- H3 prompt, no-subtitle, video-segment, auto-production, TypeScript, and production-build checks pass.

## 0.1.77 - 2026-08-26

### Changed

- H3 dialogue-active timeline rows now contain only non-vocal enum controls such as `D1_START_ONCE` and `D1_CONTINUE_NO_RESTART`; readable action, expression, and transition prose lives in separate visual shot contracts.
- The Step 5 prompt editor now displays the complete prompt that is actually sent to ComfyUI. Opening an empty editor generates it first, and an explicitly saved edit is submitted verbatim instead of being nested as a visual-only supplement.
- ComfyUI returns the final post-sanitization prompt with the task response, so the persisted project and editor reflect the exact provider payload.

### Fixed

- Prevented H3 from vocalizing `timeline[].boundary`, action-phase, expression, or transition prose in the middle of a continuous same-speaker line.
- Filtered story-planning scaffold names such as `centralDramaticQuestion`, `causal trigger`, and `audienceInference` from Chinese video transitions before they reach H3.
- Temporary SSH/status polling failures now preserve the already-submitted ComfyUI task id and reattach after backoff instead of marking the render failed or purchasing a duplicate task.
- Prompt previews now account for continuity-first-frame reference numbering, matching the image ordering used by the final H3 request.

### Verification

- H3 prompt, no-subtitle, video-segment, auto-production, TypeScript, and production-build checks pass.

## 0.1.76 - 2026-08-26

### Changed

- Dialogue now belongs to the video segment plan. A segment first locks one ordered dialogue list; its storyboards only supply visual beats, action, camera, blocking, and timing references.
- One segment may contain several speakers in order, including A→B and A→B→C. Each identity still receives one continuous speech block, while A→B→A is split or rejected because it would require the same voice to restart.
- Consecutive generated lines for the same speaker are authored as one natural long utterance rather than retaining sentence endings that H3 could interpret as separate starts.
- Segment duration and automatic grouping now budget one continuous dialogue train against the visual timeline instead of adding a separate speech allowance to every storyboard.

### Fixed

- Multi-storyboard clips can no longer revive old per-storyboard dialogue or submit two same-speaker lines with a silent hole between them.
- Saved v1 segment plans are migrated to v2 on load while retaining valid manual boundaries; current voice changes are also written into the authoritative segment dialogue.
- Prompt previews, H3 submission, generation signatures, validation, and the Step 5 dialogue whitelist now consume the same materialized segment-level dialogue.

### Verification

- All 183 automated tests, TypeScript validation, and the production build pass.

## 0.1.75 - 2026-08-26

### Changed

- MiniMax H3 prompts now use the `aid_h3_timeline_v3` contract: the authoritative audio-event lock and exact dialogue events come first, followed by reference-audio rules, visual contracts, shot contracts, and one continuous second-indexed timeline.
- Every timeline interval explicitly binds its time window, shot, action phase, expression, dialogue state, voice state, camera, blocking, and boundary behavior. The intervals cover the complete segment without implicit gaps.
- Story writing, adaptation, speech compilation, and video segmentation now keep each character to one continuous speech block per H3 segment. Consecutive lines from the same character are merged into a longer natural line, while alternating recurrence such as A-B-A is rejected or split into another segment.
- Chinese generated dialogue targets 24–48 Han characters per speaking block and English dialogue targets 12–28 words, giving H3 a single coherent delivery instead of several short starts and stops.

### Fixed

- Removed silent gaps between consecutive lines from the same character, which could make H3 continue with invented words, reference-audio fragments, or filler sounds.
- Speaker handoffs use a short 0.12-second transition rather than a long silent hole, while each speaker's first word still cannot precede the source shot and the segment retains clean opening and ending headroom.
- Exact dialogue is declared only once at the top level and referenced by event ID from the timeline, preventing action, expression, camera, or sound directions from becoming a second competing speech instruction.

### Verification

- All 181 automated tests, TypeScript validation, and the production build pass.

## 0.1.74 - 2026-08-26

### Changed

- MiniMax H3 keeps its official outer Context-IR section order while each segment's dense shot timeline is now serialized as valid JSON. Shot range, visual action, camera, transition, synchronized sound, and dialogue are no longer compressed into one ambiguous prose stream.
- Exact dialogue is isolated in `shots[].dialogue_events[].spoken_once`; first-word and complete-final-word boundaries are independent fields, and all JSON keys plus non-dialogue values are explicitly non-vocal control data.
- The text-free frame policy is now a structured boolean contract covering subtitles, captions, titles, speech bubbles, logos, watermarks, UI, and readable text.

### Fixed

- Multi-shot segments no longer place dialogue tags beside long natural-language director instructions that H3 could misread as extra speech, especially in later compact segments.
- Compact JSON remains within H3's 7000-character limit without dropping exact dialogue, dialogue timing, causal action, camera intent, or inter-shot transitions.

### Verification

- All 177 automated tests, TypeScript validation, and the production build pass.

## 0.1.73 - 2026-08-26

### Changed

- MiniMax H3 dialogue is now expressed as one authoritative start/end window placed before visual action prose. The first and final words receive explicit boundaries, while mouths and intelligible voices remain closed outside the window.
- Speaking shots now quarantine dialogue meaning from action, consequence, and listener-state prose, preventing H3 from vocalizing semantic restatements before the tagged screenplay line.
- Video-prompt previews now use the current runtime voice bindings, matching the prompt that Companion submits.

### Fixed

- First/last-frame H3 prompts preserve `<Picture 2>` and explicitly bind subjects and voice references across both frames instead of replacing the final frame with a mixed-language placeholder.
- Dialogue-shot physical directions retain names containing periods, such as `Dr. Pan`, while removing abstract product-value and audience-learning clauses.

### Verification

- All 177 automated tests, TypeScript validation, and the production build pass.

## 0.1.72 - 2026-08-26

### Fixed

- Native MiniMax H3 dialogue conditioning now always supplies the workflow-required `audio_denoise_strength` field with the full-native value `1`, fixing task submission failures from `MiniMaxH3AudioConditioningT8` after the one-pass dialogue migration.
- Added a regression assertion that the one-pass native graph keeps `audio_denoise_strength: 1` while omitting the removed `drive_audio` path.

### Verification

- All 175 automated tests, TypeScript validation, and the production build pass.

## 0.1.71 - 2026-08-25

### Changed

- Story dialogue clips now use one native MiniMax H3 audiovisual generation. The delivered soundtrack comes directly from the main H3 AV decode instead of a separately synthesized speech drive, post-mastered dialogue track, or second full H3 ambience pass.
- Fish Audio remains a timbre-only reference. Each scripted line appears exactly once inside an official H3 `d` dialogue tag, and internal Story speaker IDs are no longer exposed to H3.
- Chinese and English prompts now carry an explicit dialogue whitelist: prose outside dialogue tags is silent direction and section labels, timestamps, actions, sound instructions, and reference-sample words must never be spoken.

### Fixed

- Removes the competing speech, drive-audio, source-separation, and mastering paths that could introduce duplicate voices, stray words, audio artifacts, or inconsistent dialogue.
- The opening dialogue window now reserves clean location tone with closed mouths and explicitly rejects filler, hum, stray phonemes, and reference-sample leakage.
- Dialogue scheduling reserves a longer natural tail, and the prompt requires the complete final word before the speaker closes their mouth instead of imposing a hard cutoff that could swallow the ending.
- Companion validates that the final submitted H3 prompt contains exactly the screenplay's dialogue tags, in order and in the selected project language, before submitting the single native generation.

### Verification

- All 175 regression tests pass; TypeScript validation and the production Next.js build complete successfully.

## 0.1.70 - 2026-08-25

### Fixed

- The Image Creation console no longer deadlocks at `0/0 REFERENCES` when ComfyUI Z-Image-Turbo is selected. Its text-only workflow now accepts a prompt without requiring or uploading a reference image.
- Z-Image-Turbo now has a dedicated prompt-only interface and backend validation, while reference-capable models continue to require at least one image.
- Switching temporarily to Z-Image-Turbo no longer erases uploaded reference images; they remain available when switching back to an image-editing model.
- Prompt construction now explicitly separates reference-guided studio editing from reference-free Z-Image generation, so the local workflow is never told to use images it did not receive.

### Verification

- All 180 regression tests pass; TypeScript validation and the production Next.js build complete successfully.

## 0.1.69 - 2026-08-25

### Improved

- MiniMax H3 video prompts now use separate complete Chinese and English Context-IR renderers. Canonical field and reference tags remain intact, while directing, timing, performance, soundscape and music constraints stay in the selected project language.
- GPT-Image-2 storyboard and reference prompts now lead with one visual goal, assign exactly one role to every character, environment and object reference, and explicitly separate requested changes from preserved identity, world and material invariants.
- All nine production styles have more precise still-image capture contracts; anime, cinematic 3D and stop-motion now use their own line, topology, material, lighting, perspective and artifact exclusions instead of a generic rendering profile.

### Fixed

- Story Director's English still-image prompt and description no longer leak into H3 video direction, eliminating duplicated LOOK prose, mixed-language fragments and unrelated partial instructions such as `points to`.
- English speech-directive cleanup now matches whole words, so product terms such as `mask` are no longer truncated by the `asks` detector.
- Chinese H3 ambience/Foley-bed prompts and prompt-budget compaction remain Chinese, including long-action joiners and retention fallbacks.
- Every image-to-video provider boundary now adds one explicit text-free frame contract prohibiting subtitles, captions, titles, speech bubbles, logos, watermarks, UI and readable characters.

### Verification

- All 178 regression tests pass; TypeScript validation and the production Next.js build complete successfully.

## 0.1.68 - 2026-08-25

### Fixed

- Exact H3 dialogue no longer depends on ASR or speaker-similarity nodes. Voice bindings, exact-text plans and timeline structure remain fail-closed, while model-dependent similarity scores can no longer reject a generation.
- Every decoded turn is capped to its storyboard slot, faded at the edit boundary and padded to an exact-width sample block before serial assembly. Short takes cannot pull later lines earlier, and synthesis headroom cannot overflow the segment master.
- Missing, incomplete, overlapping, out-of-range or sub-millisecond dialogue timings and invalid master durations now fail before a ComfyUI graph is queued instead of silently dropping a turn or constructing an impossible timeline.
- A final sample-domain ceiling protects both the speech-only drive track and the delivered soundscape master from cumulative rounding or legacy-request overflow.
- The obsolete post-ASR report link has been removed; audio is no longer connected to the string-only Speech Finalize report input.
- When the Story contract prohibits music, the separated Bass, Drums and Vocals stems are all discarded and only the ambience/Foley-oriented Other stem reaches the master. Permitted scores continue to retain all non-vocal stems.

### Verification

- The H3 audio regression suite, TypeScript validation and the production Next.js build complete successfully; the generated graph was also checked against the live ComfyUI node schemas and implementations for Trim, Fade, Concat, Decode, Speech Finalize and Dialogue Safe Master.

## 0.1.67 - 2026-08-25

### Fixed

- H3 speaker-identity similarity remains completely disabled; its unmeasured `0.000` placeholder never participates in acceptance.
- The faster-whisper-small text score is now diagnostic-only. Chinese homophones, names, short lines and model-specific transcription differences can no longer reject usable dialogue or trigger a second generation pass.
- Each dialogue turn receives text-aware synthesis headroom beyond the brisk storyboard timing estimate, reducing deterministic sentence-tail truncation before the audio is placed back on the exact segment timeline.
- ASR still preserves its transcript report and trims a confidently recognized exact target, while structural voice binding, turn limits, silent-segment handling and non-vocal sound-bed safeguards remain enforced.

### Verification

- 173 regression tests pass across H3 audio and prompts, story generation and delivery, video segmentation, voice casting, project recovery and Companion export; TypeScript validation and the production Next.js build complete successfully.

## 0.1.66 - 2026-08-25

### Fixed

- Exact H3 dialogue now performs one lazy, fresh-seed regeneration when the first candidate fails the strict ASR text threshold. The accepted first take remains fast, while a stochastic wording failure no longer forces the user to restart the complete video segment manually.
- A second rejected candidate still fails closed, so approximate, truncated or improvised dialogue cannot enter the video master.
- Speech-verification errors now distinguish the active ASR text score from a disabled speaker check; `speaker_similarity=0.000` is no longer presented as an apparent voice-identity failure when speaker verification was not run.

### Verification

- 69 focused H3 audio, prompt, story-delivery, video-segment and Companion regression tests pass; TypeScript validation and the production Next.js build complete successfully.

## 0.1.65 - 2026-08-25

### Fixed

- Spoken H3 segments now fail closed when exact-speech preparation, voice binding or the required faster-whisper model is unavailable; they can no longer silently fall back to unverified native dialogue generation.
- Every dialogue turn is generated and strictly ASR-verified independently, then assembled with the Story timeline's opening silence and inter-turn pauses before becoming the full-duration video drive track. Repeated turns from one character are no longer merged into one uninterrupted sentence.
- Legacy speaker-ID hash collisions are resolved to unique segment-local voice-profile IDs instead of silently dropping the second character's voice and line.
- The screenplay, storyboard and H3 layers now share the three-turn limit while retaining a fourth overflow sentinel for an explicit error instead of silently truncating dialogue.
- Delivery audit diagnostics align semantic turns to delivered speech identity, preventing one quarantined line from producing a cascade of false errors for later valid turns.
- Dialogue-free ambience generation is visually independent, removes its generated vocal stem before mastering, and explicitly prohibits music when the Story audio plan specifies none.

### Verification

- 107 focused H3 audio, prompt, story, delivery, adaptation, video-segment and audio-tail regression tests pass; TypeScript validation and the production Next.js build complete successfully.

## 0.1.64 - 2026-08-25

### Fixed

- Voice-casting row content now aligns to the top, keeping character details, selectors, the Fish Audio reference field and preview controls on one consistent upper edge even when helper text is present.

### Verification

- The voice-casting regression suite and production Next.js build complete successfully.

## 0.1.63 - 2026-08-25

### Fixed

- H3 dialogue-safe mastering now explicitly pads or trims the independently generated ambience bed when its quantized audio clock differs from the requested master by a few milliseconds. This prevents strict sample-count failures without trimming dialogue or time-stretching audio.
- Re-rendered ComfyUI segments now scope their persistent browser cache to the exact task ID. A refresh can no longer restore the previous render and stop polling a newer completed task when both renders share the same creative signature.

### Verification

- H3 audio and project-isolation regression suites pass, including coverage for the explicit ambience fit policy and repeated renders of one creative revision; the production Next.js build completes successfully.

## 0.1.62 - 2026-08-25

### Improved

- Fish Audio character references now use a naturally articulated calibration read instead of sustained filler vowels, capturing consonants and timbre without the voiced residue that could leak into H3 clip tails. Existing references are versioned out and regenerate once per character on demand.
- Voice-casting rows reserve a shorter reference-id field and more room for playback and regeneration controls.

### Fixed

- Dialogue clips now run a second H3 audio-only pass that locks the already generated picture, creates continuous perspective-correct ambience and Foley from each timed storyboard beat, and masters that bed underneath the independently verified exact-dialogue stem.
- The delivered soundtrack no longer depends on the speech-only drive audio for ambience, eliminating silent gaps while preserving exact words, speaker identity and lip timing.
- Audio-tail cleanup is reduced to a click-safe 50 ms endpoint ramp so valid room tone, weather and physical Foley continue naturally up to editorial cuts without restoring the former static residue.

### Verification

- Two production ComfyUI samples passed exact Whisper transcription, continuous ambience/Foley, tail-spectrum and frame-motion checks. H3 audio, H3 prompt, voice-casting, video-segment, audio-tail and local-export suites pass; the production Next.js build completes successfully.

## 0.1.61 - 2026-08-24

### Improved

- “Adapt screenplay” now validates its result against the production Story JSON boundary before returning it. It retries complete rewrites for missing or skipped shots, malformed dialogue, directing instructions spoken as dialogue, excessive turns and speech that cannot fit MiniMax H3's 15-second limit.
- Ordinary source dialogue may be compressed without changing its speaker, facts, intent or response relationship; only explicitly locked verbatim lines remain immutable and may be distributed across adjacent shots.

### Fixed

- MiniMax H3 exact-speech conditioning now uses the workflow's real 17-frame-block-aligned duration, eliminating unmanaged trailing frames that could become static or buzz.
- Story H3 prompts reserve a clean final location-tone tail and explicitly prohibit hiss, static, digital residue and abrupt audio cuts.
- Completed ComfyUI Story clips receive a 0.35-second audio-tail cleanup while preserving encoded video frames; Companion export and browser FFmpeg export apply the same cleanup as fallback.
- Companion export gives generated silence a finite duration, preventing audio-less clips from hanging in the reverse-fade filter.

### Verification

- H3 audio, H3 prompt, screenplay adaptation, audio-tail and local export suites pass; the production Next.js build completes successfully.

## 0.1.60 - 2026-08-24

### Fixed

- ComfyUI task recovery now checks both prompt history and the live running/pending queues. A persisted task id absent from all three places is reported as terminally stale instead of “processing” forever.
- Story immediately unlocks stale persisted video tasks after refresh while preserving genuinely queued or running work.

### Verification

- Added queue-shape coverage for running, pending and missing prompt ids; H3 audio, video-segment and production build checks pass.

## 0.1.59 - 2026-08-24

### Fixed

- Verbose single-shot H3 visual overrides are now arc-compacted before assembly, preserving their opening intent and final payoff while keeping the authoritative action, camera timeline, exact dialogue and sound contract intact.
- The final H3 budget fitter collapses duplicated retention prose before rejecting a prompt, so a valid 7,023-character shot is no longer blocked by the 7,000-character ceiling.
- Action-arc compaction now reserves its tail from the actual end; repeated sentences can no longer cause a prefix slice to delete the visible consequence.

### Verification

- Added a deliberately oversized one-shot override regression case and verified the compiled prompt stays within 7,000 characters, retains both ends of the visual direction, keeps the timed action and emits the exact dialogue once.
- All 21 H3 prompt-structure tests and all 19 H3 audio tests pass.

## 0.1.58 - 2026-08-24

### Fixed

- Story no longer leaves a video segment permanently marked as generating when preprocessing or Companion submission fails before a durable ComfyUI task id is returned.
- Reloading a project now releases an unsubmitted segment as failed/retryable while preserving genuinely queued segments whose leader has a recoverable task id.
- Pre-enqueue failures synchronize React state, the latest storyboard ref and project storage immediately instead of waiting for the 30-second autosave window.

### Verification

- Added regression coverage for both an orphaned multi-shot generating segment and a valid running segment whose task id is stored only on its leader.
- Video-segment and H3 audio suites pass together with the production build.

## 0.1.57 - 2026-08-24

### Fixed

- Multi-speaker H3 dialogue keeps each character's global Story speaker ID on its voice profile while addressing the experimental Dialogue Script node through its required local `S1/S2/S3` aliases.
- Global speaker combinations such as `S3 + S1` no longer collapse both turns onto one profile and fail with “joint dialogue EXP requires 2 or 3 distinct speakers”.

### Verification

- Reproduced Segment 3's exact `A-Luo=S3` and `人鱼公主=S1` ordering against the installed ComfyUI node implementation and added a regression test that compiles it as local `S1/S2` dialogue over globally preserved `S3/S1` profiles.

## 0.1.56 - 2026-08-24

### Fixed

- Exact-dialogue generation now determines single- versus multi-speaker conditioning from distinct screenplay speaker IDs, not from the number of uploaded timbre-reference files.
- Duplicate voice references for one character and references belonging to silent cast members are removed before H3 conditioning, preventing one-speaker scenes from being rejected by `MiniMaxH3JointDialogueConditioningT8`.

### Verification

- Added a regression case with two inherited references and two lines from the same `S2` character; the compiled workflow contains one voice profile and the single-speaker conditioning node, with no Joint Dialogue node.
- Confirmed the preceding Segment 2 generation completed successfully on the production ComfyUI instance with its original `S2 · Tide Officer` binding.

## 0.1.55 - 2026-08-24

### Fixed

- Exact-dialogue continuity segments now select MiniMax H3 `Hybrid` conditioning whenever real first/last-frame connections coexist with the verified dialogue drive track, instead of failing execution under an incompatible `Ref2VA` task.
- H3 voice profiles now preserve each screenplay speaker ID across Story prompts, Fish Audio timbre references and exact-dialogue conditioning. A sole speaking `Subject 2` is no longer renumbered to `S1`, preventing a silent listener such as the mermaid princess from inheriting the Tide Officer's male voice and lip movement.

### Verification

- Confirmed both failures against the actual recent ComfyUI prompt history, including the mismatched `Subject 2 / S2` prompt and `S1` voice profile.
- H3 audio, prompt-structure and video-segment suites pass, together with the production website and Companion builds.

## 0.1.54 - 2026-08-24

### Added

- Added the official ComfyUI Z-Image-Turbo BF16 text-to-image workflow as a global image provider for Story grids, individual storyboards, character concepts, costume sheets and scene references.
- Image tasks now use a dedicated `comfyui-image:` identity, survive browser refreshes, resume through the local Companion and return either a persistent Cloudinary URL or a lossless local PNG payload.
- The global model selector exposes Z-Image-Turbo's real capability boundary: text-to-image is supported, while reference-image editing remains on APIMart instead of silently discarding edit inputs.

### Improved

- Text-only Z-Image generation retains character and object descriptions when visual references cannot be consumed, and allows the longer prompt budget required by nine-panel Story contact sheets.
- Companion CORS coverage now includes every still-image generation and status route used by the hosted AID interface.

### Verification

- Installed the official BF16 diffusion model, Qwen 3 4B text encoder and Flux VAE on the 49GB 4090D ComfyUI instance; all files match their official byte sizes and ComfyUI recognizes them after a queue-safe restart.
- Generated and downloaded a real 1344×768 Z-Image-Turbo validation frame in 8 steps. Production web build, Companion build, image-model, character-design, grid-recovery and Companion CORS tests pass.

## 0.1.53 - 2026-08-24

### Improved

- Story now authors one global dialogue manuscript after the causal outline and locks every speaker, exact line, semantic evidence, subtext and listener result before per-shot execution, preventing short disconnected slogans from replacing the story.
- The full-film spine explicitly carries seven milestones, audience knowledge shifts and an authored edit bridge through screenplay, storyboard, H3 prompting, segment cache signatures and delivery audit.
- Detailed screenplay execution is generated one shot at a time while retaining the authoritative global event and dialogue, avoiding partial-array failures without fragmenting narrative continuity.
- H3 montage prompts preserve each included storyboard's timed action, camera, dialogue and motivated physical handoff; automatic grouping still combines compatible beats within the 15-second limit.

### Fixed

- APIMart GPT-4o requests stay within the provider's 16K output ceiling, and long 18–81-shot plans no longer fail because a final execution batch returned only one item.
- English projects deterministically repair ignored translated execution fields instead of discarding an otherwise valid locked English outline and dialogue manuscript.
- The Story delivery gate now detects missing milestones, edit bridges, shortened locked lines, lost dialogue meaning and reordered exchanges before video generation.

### Verification

- A real 18-shot English adaptation completed with 7 structural milestones, 23/23 locked dialogue turns and 18 directed 1:1 storyboards. End-to-end delivery audit returned zero errors.
- Automatic editing produced 14 H3 segments, including 4 multi-shot montage segments; every segment remained within MiniMax H3's 15-second limit. Focused Story, delivery, segmentation and H3 suites plus the production build pass.

## 0.1.52 - 2026-08-24

### Improved

- Story now persists a semantic dialogue contract from outline through screenplay, director beats and H3 segments, preserving each speaker, dramatic function, response relationship and intended audience takeaway.
- Adjacent question/answer and challenge/response beats are reserved as viable shared H3 segments when their combined duration permits, instead of being separated by the greedy grouping pass.
- Every directed shot carries its visible consequence into the authoritative H3 action contract, so movement resolves into a readable story change rather than a slow held pose.
- Manual single-segment generation now creates and persists a missing reusable Fish Audio timbre reference on first use, matching unattended one-click production and avoiding false “voice bound” dead ends in older projects.

### Fixed

- The Story delivery audit now reports missing dialogue turns, mismatched speakers/functions, incomplete response units and absent listener reactions before video generation.
- Outline normalization repairs unambiguous adjacent response beats that were assigned a new dialogue-unit ID by the planning model.
- H3 cache contract v14 invalidates earlier clips that lacked the semantic dialogue and visible-consequence contract while retaining completed storyboard images and segment planning.

### Verification

- Focused Story staging, delivery, segmentation, H3 prompt and audio-reference suites pass together with the production build.
- A real 12.25-second 1:1 two-shot Story segment was generated and cached. Whisper transcribed only the single scheduled English line, word-for-word, with no extra narration; the post-dialogue tail retained stereo environmental audio at approximately -26 dB and no frozen interval was detected.

## 0.1.51 - 2026-08-24

### Release baseline

- Published the verified Story/H3 exact-dialogue pipeline as a dedicated rollback point before the next screenplay, storyboard and montage-narrative revision.
- This release intentionally contains no production-behavior change from v0.1.50.

### Verification

- The existing exact-dialogue, Story delivery, H3 prompt and Companion production checks remain the release gate for this baseline.

## 0.1.50 - 2026-08-24

### Fixed

- Character voice references now use a versioned non-lexical Fish Audio timbre probe, so ordinary sample words can no longer leak into the beginning of MiniMax H3 dialogue. Saved and imported legacy lexical references are invalidated and regenerated once per speaking character.
- Story dialogue now uses a two-stage native H3 path: H3 first synthesizes the exact screenplay text in the locked character timbre, faster-whisper verifies and trims that speech, and the verified H3 track then drives the final Ref2VA performance and lip sync while H3 remixes the environmental soundscape.
- The final video prompt treats the verified audio as authoritative dialogue instead of a loose voice reference. Direction prose, reference phonemes, narration and ad-lib are excluded from the vocal layer while visible-action ambience and Foley remain available.

### Verification

- A real 13.67-second 1:1 Story clip was regenerated from the existing storyboard. Whisper transcribed exactly the two scheduled Tide Officer lines, with no leading reference word, action narration or extra speech; the post-dialogue tail retained non-silent environmental audio.
- TypeScript, the focused Story/H3/voice/segmentation regression suite and the Companion production build pass with the H3 v13 cache contract.

## 0.1.49 - 2026-08-24

### Improved

- Story now plans the complete film as a causal outline before writing smaller screenplay batches. Each beat retains its source-shot mapping, dramatic turn, audience information, dialogue function, action, camera, sound and physical handoff instead of collapsing long adaptations into disconnected visual moments.
- The staged writer has a larger structured-output budget, dialogue-aware batch sizing and bounded correction retries, so 18–81-shot projects can finish valid JSON without the misleading “returned 0 shots” failure caused by a truncated outer object.
- Every generated speaking role becomes part of the effective production cast with a reusable character card, explicit gender/age/role metadata, deterministic Fish Audio timbre and a Story-side voice control entry. Automatic fallback never crosses gender pools.
- MiniMax H3 receives a timed contract for every included storyboard: concrete action phases, camera behavior, exact tagged dialogue, environmental sound, caused Foley and a physical transition. Dense multi-shot segments use a lossless compact form that keeps the prompt within H3's hard size limit.

### Fixed

- Required dialogue survives outline normalization, detailed screenplay batching, director conversion and segment grouping; direction prose, unnamed visible identities and repeated lines are blocked before they can become audible speech.
- Supporting characters discovered by the screenplay are now available to storyboard generation, reference-card generation, voice-reference generation and resumed projects instead of appearing as blank cards or inheriting the lead voice.
- Story performs a delivery audit before directing and reports missing causal links, cast bindings or required lines at the screenplay stage. Safety refusals receive a non-graphic fiction rewrite retry while user-locked facts and dialogue remain unchanged.
- Development Companion requests accept loopback Story origins on alternate local ports, while production origin checks remain unchanged.

### Verification

- Added Story delivery, staged screenplay, ensemble voice casting and H3 prompt-budget regressions; TypeScript, production build and the Companion release test matrix pass before tagging.

## 0.1.48 - 2026-08-23

### Fixed

- Story migrates the retired Fish Audio reference previously assigned to A-Luo before generating exact dialogue, so legacy projects no longer stall at `Reference not found`.
- If Fish removes another AID-assigned public reference, exact-dialogue and reusable voice-reference generation now rotate through the deterministic automatic voice pool. A user-entered custom reference remains authoritative and is never silently replaced.
- New automatic casting no longer assigns the retired reference. Existing completed image and video segments remain cached; unattended production resumes from the first unfinished audio/video segment.

## 0.1.47 - 2026-08-23

### Fixed

- Story now separates H3's generated audio into vocals and non-vocal stems before final muxing. The generated guide voice is discarded completely; bass, transients, environment and Foley are rebuilt as one continuous bed, then the single authoritative Fish Audio dialogue track is mixed on top.
- The sound bed receives only light dialogue headroom ducking after vocal removal, so water, weather, mechanisms and caused action sounds remain audible beneath approved speech instead of disappearing with the unwanted guide voice.
- H3 v12 invalidates v11 clips that may contain both the generated guide performance and the selected character voice while preserving storyboard images and the director's segment plan.

### Verification

- A real 12-second H3 clip whose raw generated track spoke from the opening frame was separated and remuxed without rerendering its image. Whisper detected only the scheduled Tide Officer line, silence detection found no silent interval, and the non-dialogue windows retained an average sound-bed level around -20 dB.

## 0.1.46 - 2026-08-23

### Fixed

- Story now deterministically selects ComfyUI's final `-audio.mp4` mux instead of the temporary video-only MP4 that may appear first in the output list. Generated dialogue, environment ambience and Foley can no longer disappear during frontend caching.
- H3 now regenerates a complete native soundtrack from the exact dialogue stem as its voice/timing reference, then mixes the authoritative prerecorded line over that soundscape with automatic ducking. Quiet intervals retain continuous room tone, water, weather and action Foley without allowing generated guide speech to compete with the approved voice.
- English women in officer, commander or captain roles now use a separate calm authoritative female reference; the former Tide Officer voice is removed from that role.
- H3 v11 invalidates any v10 clip cached from the silent temporary output while keeping storyboard images and segment grouping intact.

### Verification

- The same cloud render was probed as two outputs: the temporary 12.25-second MP4 had no audio stream, while the final `-audio.mp4` contained stereo AAC. A real `reference_only` H3 run retained continuous audible sound across all 12 seconds and transcribed only the scheduled line; the exact-stem mix kept the same full sound bed. Regression coverage reproduces the mux ordering, requires the audio mix node, and locks officer casting to the new role-specific voice.

## 0.1.45 - 2026-08-23

### Fixed

- Exact Story dialogue is now used as a lightly remixed timing and phoneme anchor instead of replacing the complete H3 soundtrack. The generated clip keeps the authorized words and speaker identity while restoring synchronized location ambience and visibly caused Foley.
- H3 action beats begin immediately, reach contact or decision in the first third, and show their consequence before the final third. Default action, reaction, insert, establishing and montage budgets are shorter so ordinary movement no longer expands into an unintended slow-motion performance.
- H3 v10 invalidates silent-bed and slow-cadence cached clips while retaining completed storyboard images and the director's segment plan.

### Verification

- Added workflow regression coverage for `remix_source` at 0.20 strength and AV Decode audio delivery, plus prompt checks that preserve exact dialogue as the sole vocal layer while allowing non-vocal ambience and Foley.

## 0.1.44 - 2026-08-23

### Fixed

- Removed a mislabeled legacy English reference whose measured delivery was masculine despite being stored in the young-feminine pool. Automatically cast young English heroines now use a verified public warm female reference instead.
- H3 v9 invalidates every clip and exact dialogue track that could contain the former protagonist voice; completed storyboard images and the director's 16-segment plan remain reusable.

### Verification

- The first regenerated two-speaker clip was transcribed with exactly the two authorized English lines and no extra words. Voice-range diagnostics exposed the old heroine reference at roughly 133 Hz versus the verified female references at roughly 170–219 Hz, enabling deterministic correction before the remaining film was produced.

## 0.1.43 - 2026-08-23

### Improved

- Ensemble voice casting now reserves a distinct deterministic Fish voice for each automatically cast speaker where an appropriate voice is available. Young leads, supporting women, mothers and elder or creature roles no longer collapse onto the same reference voice.
- Exact dialogue is sent to Fish S2-Pro with at most one concise non-spoken delivery cue derived from the screenplay emotion field. The audible wording remains the exact authoritative line while urgency, restraint, grief, warmth and determination receive controlled vocal shape.
- H3 v8 invalidates earlier voice-reference clips so resumed production regenerates remaining dialogue with the corrected cast and performance contract while preserving completed storyboard images.

### Verification

- Added ensemble uniqueness and exact-line isolation regressions alongside the existing Story, H3, segmentation and voice-binding suites.

## 0.1.42 - 2026-08-23

### Improved

- H3 v7 dialogue direction now turns each line into a compact visible performance arc: breath and eyeline establish pressure, facial tension changes on the key phrase, and the emotional result passes to the listener instead of becoming uniform shouting or theatrical gesture.
- Dialogue coverage preserves the established eyeline axis and each character's screen side across close-ups and over-shoulder reverses, while allowing an axis change only after a visible neutral crossing.
- The new performance language remains inside each sub-15-second segment and keeps the official H3 prompt below its 7,000-character ceiling.

### Fixed

- Cached clips made with the previous, flatter H3 direction are invalidated so resumed unattended production regenerates them with the new timing and performance contract.

## 0.1.41 - 2026-08-23

### Fixed

- Protagonist aliases are now canonicalized only in screenplay identity fields and action prose, never inside quoted dialogue. Exact lines such as “Princess Lanxi…” and “Lanxi!” can no longer be mutated and silently removed during final StoryPlan validation.
- Required dialogue is checked again after the complete structured screenplay is sanitized; generation now fails with the exact missing shot numbers instead of producing a visually complete film with missing speech.
- The browser reapplies the StoryPlan voice cast after directing, including automatically discovered supporting roles, and project saves retain automatic voice profiles and their source.

### Verification

- Added regression coverage for protagonist names spoken inside another character's line, direct address, and two-speaker exchanges. Story planning, film speech, voice casting, H3 audio, segment grouping and the production build all pass.

## 0.1.40 - 2026-08-23

### Improved

- Story adaptation now designs complete scene-level dialogue units instead of forcing every generated line to be short. Questions, refusals, decisions, promises and callbacks retain their shared context across shots, while isolated slogan fragments are rejected.
- The screenplay and director contracts carry dialogue-unit identity, obligation, listener change and montage syntax through planning, blocking and grouped H3 direction. Required story dialogue can no longer be silently downgraded to a visual-only beat.
- H3 v6 keeps each grouped shot's real-time action and motivated transition while exposing only visible listener performance to the video model; abstract screenplay prose remains outside audiovisual channels.

### Fixed

- Every speaking character now receives one deterministic, role-appropriate Fish Audio voice for the whole film. A young female mermaid is automatically cast to a young feminine voice, user-selected voices remain authoritative, and old projects are migrated on load/import.
- Fish Audio generation and voice-reference routes now reject missing `voiceId` values instead of silently falling back to an uncontrolled default voice that could change gender or identity between clips.
- Voice IDs are preserved on every authoritative speech line and included in H3 cache signatures, preventing clips or locked dialogue tracks made with the previous wrong voice from being reused.

### Verification

- Added deterministic voice-casting and missing-voice rejection coverage. All Story, H3, segmentation, unattended-production, recovery, export and Companion route suites pass, together with the production build.

## 0.1.39 - 2026-08-23

### Improved

- Explicit screenplay dialogue is now authoritative through planning, directing and grouped H3 production. Up to four ordered lines may remain in one shot when the source requires an exchange, while narrator labels and stage directions never become speakers.
- H3 segment duration reserves the same speech lead-in and tail used by the exact-audio compiler, and rounds the required duration upward so grouped dialogue is never squeezed into an undersized clip.

### Fixed

- Story progress, generated grids, split storyboard images, screenplay updates, video-cache completions, imports and pause state are persisted immediately instead of waiting for the next periodic save.
- Current projects now use a versioned storage authority. A stale tab from an older deployment may still update the legacy compatibility key, but can no longer overwrite the current storyboard grouping, video task IDs or completed timeline.
- Pausing and immediately resuming one-click production now waits for the previous orchestration lock to unwind and then starts a replacement run from the first incomplete stage.
- Importing a project updates both the live story-plan reference and durable project snapshot before unattended production resumes.

### Verification

- Re-ran the latest square Story project end to end: 27 storyboard images, 16 grouped MiniMax H3 clips, local caching and Companion FFmpeg merge completed successfully into a 158.21-second 960×960 film.
- Whisper verification recovered every source-authoritative dialogue record with no added Chinese dialogue, stage directions or unexplained spoken lines. The targeted Story, segment, H3 prompt, unattended-production and project-isolation suites all pass, as does the production build.

## 0.1.36 - 2026-08-23

### Fixed

- Companion-composed dialogue timelines are now persisted in its local media directory and served through a validated immutable audio endpoint. Exact H3 audio no longer depends on Cloudinary credentials being copied into the desktop app.
- The locked-dialogue path skips obsolete per-character Cloudinary reference uploads. Story stores only the durable local track URL, while the generated WAV is fetched and embedded transiently when the ComfyUI task is submitted.
- Story and grouped H3 generation now require Companion v0.1.36 so exact-audio persistence, CORS and ComfyUI lock-source injection are deployed as one compatible unit.

### Tests

- Extended Companion route-allowlist regression coverage. All 113 tests, TypeScript validation and both production and Companion builds pass.

## 0.1.35 - 2026-08-23

### Fixed

- The Companion now grants the production site's CORS/private-network preflight for `/api/generate-audio`. The browser can submit exact dialogue timelines after confirming Companion health instead of failing with `Failed to fetch` before H3 starts.
- Story and grouped H3 generation now require Companion v0.1.35 so the web UI cannot pair the locked-audio workflow with an older Companion whose route allowlist is incomplete.

### Tests

- Added Companion route-allowlist regression coverage. All 113 tests, TypeScript validation and both production and Companion builds pass.

## 0.1.34 - 2026-08-23

### Fixed

- Exact H3 dialogue timelines are now composed through the local Companion instead of the hosted Netlify function. This guarantees access to the bundled FFmpeg binary and prevents `spawn .../ffmpeg ENOENT` before a video task is submitted.

### Tests

- Revalidated all 112 tests, TypeScript validation, the production build and the installed Companion before repeating the live H3 dialogue test.

## 0.1.33 - 2026-08-23

### Improved

- Grouped H3 segments continue to carry every storyboard as a complete timed action, camera, dialogue-performance and physical-handoff unit; combining shots changes only the render container and no longer weakens the shot-level narrative.
- Exact Fish Audio dialogue is now assembled into a full-duration segment timeline at the screenplay's scheduled positions. The same track drives lip synchronization and is preserved as the final MP4 soundtrack.

### Fixed

- MiniMax H3 can no longer reinterpret a short voice reference and append an unscripted second line. Locked dialogue prompts contain no generative `<d>` wording, and the ComfyUI workflow runs in `lock_source` mode with the exact source connected to both conditioning and final mux audio.
- Dialogue-free segments receive an exact full-duration silent track, preventing incidental human speech, narration, breathy words or other unexplained voices.
- Legacy audio references and H3 v4 video caches are invalidated before a resumed production, so an existing project regenerates with the exact-dialogue contract instead of reusing clips made by the older native-audio path.
- Story and grouped H3 generation now require Companion v0.1.33, keeping the hosted UI, local timeline composer and cloud workflow injection in sync.

### Tests

- Added locked-audio prompt and ComfyUI graph-wiring regression coverage. All 112 tests, TypeScript validation and the production build pass.

## 0.1.32 - 2026-08-23

### Improved

- Story screenplay and director stages now apply selected `video-shotcraft` directing principles: one primary action arc per shot, acceleration into a decisive contact, a short readable settle, emotion-motivated camera movement and one physical handoff grammar per seam.
- H3 segment direction now assigns every grouped storyboard a complete timed action, camera, dialogue and physical-transition beat while preserving motion vector, speed and screen direction instead of relying on dissolves or decorative drift.

### Fixed

- Abstract screenplay explanations such as trigger, pressure, choice and audience interpretation are no longer repeated inside H3's audiovisual description, preventing Ref2VA from vocalizing silent director prose as invented narration.
- H3 prompts explicitly declare the exact number of authorized vocal events. Only text inside scheduled dialogue tags may be spoken; narration, ad-libs, singing, source-audio wording and background intelligible speech are forbidden.
- H3 prompt-contract changes now invalidate clips produced by an older prompt engine, so a resumed project cannot silently reuse a cached segment with obsolete dialogue or motion rules.
- Story and grouped H3 generation now require Companion v0.1.32, ensuring the hosted UI and local generation API use the same directing and speech contract.

### Tests

- Added regression coverage for silent explanatory prose, exact H3 vocal-event counts, ShotCraft-inspired action/transition rules and prompt-contract cache invalidation. All 109 tests, TypeScript validation and the production build pass.

## 0.1.31 - 2026-08-23

### Fixed

- Long screenplay generation now requires Companion v0.1.31 so the local 27–81 shot API cannot silently return an older schema that drops the central dramatic question, audience knowledge, dialogue purpose and montage fields.
- The compact-outline token budget now scales with the expanded per-shot narrative schema, preventing a valid 27-shot plan from being truncated into an apparent zero-shot response.
- Story outline, screenplay and director batches now make three spaced attempts, so a transient APIMart TLS reset or timeout does not exhaust both correction attempts immediately.
- When Companion's public-DNS HTTPS transport fails before receiving a response, APIMart screenplay calls retry through the system network stack. This preserves DNS protection on affected computers without breaking machines that already use a working system proxy.
- A certificate-host mismatch is now treated as polluted public DNS. After the first such failure (or pre-response reset), the running Companion stays on the verified system network path for subsequent screenplay and director batches.
- Exact spoken lines are deterministically removed from director descriptions before validation and merging. Repeated model attempts can no longer copy dialogue into visual directions that H3 might vocalize.
- Dialogue removal now tolerates punctuation/quote variations (for example `Again.` versus `“Again—”`) and strips isolated Cyrillic fragments without accepting a full wrong-language description.
- Director batches reject multilingual contamination, stray Cyrillic fragments and visual descriptions that repeat exact dialogue. Invalid batches receive a correction retry before they can reach image or H3 generation.
- Speech validation now treats the exact visible-cast list as the authority, so English action prose may naturally say “the mermaid princess” while the voice binding still preserves the uploaded identity `人鱼公主`.
- Every non-visual outline dialogue purpose must now name an uploaded speaker before screenplay expansion. Plans that assign dialogue to no valid voice are converted to visible story information instead of looping between missing speech and forbidden temporary-character speech.
- If a model adds a temporary character's reply beside valid bound dialogue, the screenplay keeps the uploaded character's line and deterministically removes only the unowned addition instead of failing the entire batch or synthesizing an unknown voice.
- An AI-planned dialogue function with no user-locked line may fall back to a visual payoff when the model cannot produce a valid bound line. User-locked dialogue remains mandatory, preventing both endless retries and invented replacement speech.
- One-click Film now holds a browser-wide, per-project orchestration lock. Opening or refreshing multiple Story tabs can no longer submit the same paid image/video segment more than once; a standby tab automatically takes over only if the owner closes or crashes.
- While one tab owns an active one-click run, stale tabs skip their periodic autosave instead of overwriting the newest segment plan, task IDs and cache state with an older project snapshot.

### Tests

- Added director-language, exact-dialogue isolation and cross-tab orchestration-lock regression coverage. The latest 27-shot project is used for a full one-click production verification.

## 0.1.30 - 2026-08-23

### Improved

- Story planning now carries a central dramatic question, audience promise, dialogue arc and montage strategy into every sequence. Each shot must add a concrete piece of audience knowledge and preserve the question that motivates the next shot.
- Screenplay beats now distinguish visible action, dramatic change, information gain, dialogue purpose and montage role. Questions, revelations, choices, promises and callbacks are planned across shots instead of producing isolated slogans or a list of attractive events.
- Purposeful dialogue is no longer suppressed by a blanket one-line rule. A shot may contain two ordered, voice-bound lines when the action and 15-second budget support a clear initiation/response or reveal/decision exchange.
- Director and MiniMax H3 prompts now compile the screenplay's trigger, pressure, visible choice, consequence and audience information into each timed shot. Causal, parallel and contrast montage relationships drive physical transitions without fades or added exposition.

### Fixed

- The static storyboard image prompt no longer overrides the screenplay's authoritative moving action when building an H3 clip.
- Multi-line dialogue in one storyboard is scheduled sequentially with explicit lead, response gap and reaction tail; exact lines remain the only text allowed inside H3 dialogue tags.
- Narrative dialogue plans that omit a speaker, readable line, story function or visible character now fail validation and receive a structured correction retry instead of becoming silent or disconnected downstream.
- H3 cache signatures now include causal story, information, dialogue-purpose and montage fields, so narrative revisions cannot reuse an obsolete clip.

### Tests

- Added regression coverage for story/audience contracts, two-line dialogue scheduling, causal H3 compilation and narrative-aware clip invalidation. All 103 tests, TypeScript validation and the production build pass.

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
