# MCP toollar ma'lumotnomasi

> Avtomatik generatsiya qilingan (`pnpm gen:docs`, manba: `apps/server/src/mcp/tools`). Qo'lda tahrirlamang.

Javob formati: `{ ok: true, data } | { ok: false, error: { code, retryable, hint, message?, details? } }`.
Xato kodlari: [errors.md](errors.md).

Jami: **58** tool, **4** prompt.

## Muhit

### `env_check` — Check environment · faqat o'qish

Checks everything a build needs: server, AE panel online, After Effects running, project folder selected in the panel, ffmpeg, active job. Call first. ready=false comes with issues[] (code + hint) to tell the user.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `device_id` | uuid |  | Device id from devices_list; usually not needed (resolved from the project or the only/recent device) |
| `project_id` | uuid |  | Resolve the device the project is bound to |

### `devices_list` — List devices · faqat o'qish

Lists the user's connected AE panels (devices) with online status, AE version and open folder.

Parametrsiz.

### `ae_info` — After Effects info · faqat o'qish

Asks After Effects for its version, the open .aep, its compositions and installed font families (fonts=null on AE < 24 with fonts_note). Read-only.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `device_id` | uuid |  | Device id from devices_list; usually not needed (resolved from the project or the only/recent device) |
| `project_id` | uuid |  | Resolve the device the project is bound to |

## Loyiha va plan

### `project_create` — Create / open project

Opens an existing folder on the user's machine as a project through the AE panel: creates source/ audio/ frames/ out/ logs/ subfolders inside it, registers the project and makes it the panel's active folder. root_path must be absolute and must already exist (e.g. D:/Videos/reel); ask the user for it.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `root_path` | string | ha | Absolute folder path on the user's computer · ≤ 1024 belgi |
| `device_id` | uuid |  |  |

### `project_list` — List projects · faqat o'qish

Lists the user's projects (folders) with device status, latest plan version and latest job.

Parametrsiz.

### `project_get` — Project details · faqat o'qish

Project details: assets summary (by kind and status), plan versions, recent jobs and the active job.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |

### `plan_write` — Write plan

Saves a new Video Spec version for the project (never overwrites; returns version). Validated strictly: SPEC_INVALID errors list exact JSON Pointer paths in error.details. Media must be asset:<key> from assets_list.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `spec` | object | ha | Video Spec object (see spec_schema) |

### `plan_patch` — Patch plan

Applies an RFC 6902 JSON Patch to a plan version (default: latest) and saves the result as a new version. Example: [{"op":"replace","path":"/scenes/1/dur","value":3}].

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `patch` | object[] | ha |  |
| `base_version` | integer |  | ≥ 1, ≤ 9007199254740991 |

### `plan_get` — Get plan · faqat o'qish

Returns a plan version (default latest) with its spec, plus the list of all versions.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `version` | integer |  | ≥ 1, ≤ 9007199254740991 |

### `spec_schema` — Video Spec schema · faqat o'qish

JSON Schema of the Video Spec (plan.json) accepted by plan_write, plus the closed lists of animations, positions, transitions and output presets. Read once before writing a plan.

Parametrsiz.

## Fayllar

### `assets_scan` — Scan project files

Asks the panel to scan the project's source/ folder with ffprobe (type, size, duration, resolution) and store thumbnails. Waits up to 90 s; if still running returns status=running — call assets_list a bit later.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |

### `assets_list` — List project files · faqat o'qish

Lists scanned files: key (use as asset:<key> in the spec), kind, status (ok|corrupt|unsupported|missing), resolution, duration. Only status=ok assets can be used.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `kind` | `video` \\| `image` \\| `audio` \\| `other` |  |  |
| `status` | `ok` \\| `corrupt` \\| `unsupported` \\| `missing` |  |  |

### `asset_preview` — Preview a file · faqat o'qish

Shows you an image or video from the project as small JPEGs: mode=image → one picture (video: frame at 10%); mode=frames → several frames (times in seconds, or count evenly spaced, max 8). Use it to understand media before planning.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `key` | string | ha | Asset key from assets_list · ≤ 128 belgi |
| `mode` | `image` \\| `frames` |  | default `"image"` |
| `times` | number[] |  |  |
| `count` | integer |  | ≥ 1, ≤ 8 |
| `max_px` | integer |  | default `768`, ≥ 128, ≤ 1280 |

## Audio (ElevenLabs)

### `audio_tasks_status` — Audio tasks status · faqat o'qish

Status of audio tasks (TTS, music, SFX, STT, dubbing …): queued → running → done | failed | skipped, cached (no credits spent), duration, local file in the project's audio/ folder once the panel downloaded it. Filter by task ids, job or project.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `task_ids` | uuid[] |  |  |
| `job_id` | uuid |  |  |
| `project_id` | uuid |  |  |
| `limit` | integer |  | default `30`, ≥ 1, ≤ 100 |

### `el_tts` — Text to speech

Generates speech with ElevenLabs (with per-character timestamps for subtitles and TTS-first timing). Default model eleven_v4 (the only family that supports Uzbek). The file is stored on the server and downloaded into the project's audio/ folder. Same parameters → cached, no credits.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `text` | string | ha | ≤ 10000 belgi |
| `voice_id` | string | ha | From el_voices · ≤ 64 belgi |
| `model_id` | string |  | ≤ 64 belgi |
| `language` | string |  | ISO 639-1/3, e.g. uz |
| `voice_settings` | object |  |  |
| `pronunciation` | string[] |  | Dictionary slugs from el_pronunciation |
| `project_id` | uuid |  | Project whose audio/ folder receives the file (optional for pure generation) |
| `label` | string |  | ≤ 200 belgi |
| `fresh` | boolean |  | Bypass cache (regenerate) |
| `wait_s` | integer |  | Seconds to wait for the result (0 = return task_id immediately; poll audio_tasks_status) · default `30`, ≥ 0, ≤ 55 |

### `el_voices` — List voices · faqat o'qish

Lists ElevenLabs voices available to the user (premade, cloned, designed). Use voice_id in el_tts / spec voiceover.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `search` | string |  | ≤ 100 belgi |

### `el_models` — List models · faqat o'qish

Lists ElevenLabs models with supported languages. For Uzbek TTS use eleven_v4 / eleven_v4_turbo; STT: scribe_v2.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `language` | string |  |  |

### `el_pronunciation` — Pronunciation dictionary

Creates or replaces a pronunciation dictionary (brand names, Uzbek words) under a slug; reference it in spec voiceover.pronunciation or el_tts. Without rules → lists saved dictionaries.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `slug` | string |  |  |
| `rules` | object[] |  |  |

### `el_usage` — ElevenLabs usage · faqat o'qish

ElevenLabs plan, used and remaining characters/credits, reset date.

Parametrsiz.

### `el_estimate` — Estimate credits · faqat o'qish

Approximate ElevenLabs credits for a plan's audio (project_id + optional plan_version) or for given items, compared to the remaining quota. If it does not fit → ask_user: true (ask before spending).

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid |  |  |
| `plan_version` | integer |  | ≥ 1, ≤ 9007199254740991 |
| `items` | object[] |  |  |

### `el_dialogue` — Dialogue

Multi-voice dialogue (Text to Dialogue, default model eleven_v3) as one audio file.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `lines` | object[] | ha |  |
| `model_id` | string |  | ≤ 64 belgi |
| `language` | string |  |  |
| `project_id` | uuid |  | Project whose audio/ folder receives the file (optional for pure generation) |
| `label` | string |  | ≤ 200 belgi |
| `fresh` | boolean |  |  |
| `wait_s` | integer |  | Seconds to wait for the result (0 = return task_id immediately; poll audio_tasks_status) · default `30`, ≥ 0, ≤ 55 |

### `el_sfx` — Sound effect

Generates a sound effect from a description (0.5–30 s; without duration ElevenLabs picks one). Use for transitions, accents, ambience.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `prompt` | string | ha | ≤ 500 belgi |
| `duration_s` | number |  | ≥ 0.5, ≤ 30 |
| `loop` | boolean |  |  |
| `prompt_influence` | number |  | ≥ 0, ≤ 1 |
| `project_id` | uuid |  | Project whose audio/ folder receives the file (optional for pure generation) |
| `label` | string |  | ≤ 200 belgi |
| `fresh` | boolean |  |  |
| `wait_s` | integer |  | Seconds to wait for the result (0 = return task_id immediately; poll audio_tasks_status) · default `30`, ≥ 0, ≤ 55 |

### `el_music` — Music

Generates music: either prompt (+ exact duration_s 3–600, instrumental) or a composition_plan from el_music_plan (sections with exact durations). Not both.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `prompt` | string |  | ≤ 2000 belgi |
| `duration_s` | number |  | ≥ 3, ≤ 600 |
| `instrumental` | boolean |  | default `true` |
| `composition_plan` | object |  |  |
| `project_id` | uuid |  | Project whose audio/ folder receives the file (optional for pure generation) |
| `label` | string |  | ≤ 200 belgi |
| `fresh` | boolean |  |  |
| `wait_s` | integer |  | Seconds to wait for the result (0 = return task_id immediately; poll audio_tasks_status) · default `30`, ≥ 0, ≤ 55 |

### `el_music_plan` — Music composition plan · faqat o'qish

Creates a music composition plan (global styles + sections with exact durations) from a prompt. Edit it if needed and pass to el_music.composition_plan.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `prompt` | string | ha | ≤ 2000 belgi |
| `duration_s` | number |  | ≥ 3, ≤ 600 |

### `el_stt` — Transcribe (Scribe)

Transcribes a project video/audio with ElevenLabs Scribe (scribe_v2): word timestamps, speakers (diarize), audio events. The panel extracts the audio locally; then read words with transcript_get. Uzbek accuracy tier: Good.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `key` | string | ha | Audio or video asset key from assets_list · ≤ 128 belgi |
| `wait_s` | integer |  | Seconds to wait for the result (0 = return task_id immediately; poll audio_tasks_status) · default `30`, ≥ 0, ≤ 55 |
| `language` | string |  |  |
| `diarize` | boolean |  | default `false` |
| `num_speakers` | integer |  | ≥ 1, ≤ 32 |

### `el_align` — Forced alignment

Aligns a known text to a project audio/video → exact word timings (for subtitles of a recorded voice).

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `key` | string | ha | Audio or video asset key from assets_list · ≤ 128 belgi |
| `wait_s` | integer |  | Seconds to wait for the result (0 = return task_id immediately; poll audio_tasks_status) · default `30`, ≥ 0, ≤ 55 |
| `text` | string | ha | ≤ 10000 belgi |

### `el_isolate` — Isolate voice

Removes background noise/music from a project video/audio, leaving clean speech (new file in audio/).

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `key` | string | ha | Audio or video asset key from assets_list · ≤ 128 belgi |
| `wait_s` | integer |  | Seconds to wait for the result (0 = return task_id immediately; poll audio_tasks_status) · default `30`, ≥ 0, ≤ 55 |

### `transcript_get` — Get transcript · faqat o'qish

Full transcript of an el_stt / el_align task: text and words with start/end (and speaker). Edited version if transcript_edit was used.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `task_id` | uuid | ha |  |

### `transcript_edit` — Edit transcript

Fixes transcript words without changing timings (Uzbek spelling, names): either words:[{index,text}] or the full corrected text with the same number of words. Subtitles use the edited version.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `task_id` | uuid | ha |  |
| `words` | object[] |  |  |
| `text` | string |  | ≤ 20000 belgi |

### `el_voice_change` — Change voice

Speech-to-speech: re-voices a project recording with another voice, keeping timing and emotion.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `key` | string | ha | Audio or video asset key from assets_list · ≤ 128 belgi |
| `voice_id` | string | ha | ≤ 64 belgi |
| `remove_background_noise` | boolean |  | default `false` |
| `wait_s` | integer |  | Seconds to wait for the result (0 = return task_id immediately; poll audio_tasks_status) · default `30`, ≥ 0, ≤ 55 |

### `el_dub` — Dub

Dubs a project video/audio into another language (asynchronous on ElevenLabs, polled up to 30 min). Returns the dubbed audio in audio/. Use wait_s=0 and poll audio_tasks_status for long media.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `key` | string | ha | Audio or video asset key from assets_list · ≤ 128 belgi |
| `target_lang` | string | ha |  |
| `source_lang` | string |  |  |
| `num_speakers` | integer |  | ≥ 0, ≤ 32 |
| `wait_s` | integer |  | Seconds to wait for the result (0 = return task_id immediately; poll audio_tasks_status) · default `30`, ≥ 0, ≤ 55 |

### `el_voice_design` — Design a voice

Creates voice previews from a description (listen in the panel's Audio screen / audio/). To keep one, call again with save:{generated_voice_id, name} → returns voice_id for el_tts.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `description` | string | ha | ≤ 1000 belgi |
| `text` | string |  | Preview text (100–1000 chars); auto if omitted · ≤ 1000 belgi |
| `save` | object |  |  |
| `project_id` | uuid |  |  |
| `wait_s` | integer |  | Seconds to wait for the result (0 = return task_id immediately; poll audio_tasks_status) · default `30`, ≥ 0, ≤ 55 |

### `el_voice_clone` — Clone a voice (consent required)

Instant voice clone from project recordings. ONLY with the voice owner's explicit permission: consent must be true (confirm with the user first). Returns voice_id. Logged in the security journal.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `keys` | string[] | ha |  |
| `name` | string | ha | ≤ 100 belgi |
| `description` | string |  | ≤ 500 belgi |
| `consent` | `true` | ha |  |

## Qurish

### `preflight` — Preflight · faqat o'qish

Checks a plan against the scanned files without touching AE: missing[] (unknown/corrupt/missing asset refs), compile errors, op count, scenes, total duration, key times for VERIFY, warnings and the .aep path the build would write. Fix everything here before build_start.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `plan_version` | integer |  | ≥ 1, ≤ 9007199254740991 |

### `build_start` — Start build

Starts a job that builds the plan in After Effects (CHECK → PLAN → INGEST → PREFLIGHT → BUILD → VERIFY …). Returns job_id immediately; poll job_status. dry_run=true only compiles and returns the op list summary and time estimate. One active job per device (JOB_ACTIVE).

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `plan_version` | integer |  | ≥ 1, ≤ 9007199254740991 |
| `dry_run` | boolean |  | default `false` |

### `job_status` — Job status · faqat o'qish

Job state, progress (done/total ops, %), current error, patch count, .aep path, last log lines and next_step advice. Poll every 5-10 s while the job runs.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `job_id` | uuid | ha |  |
| `log_limit` | integer |  | default `15`, ≥ 0, ≤ 100 |

### `job_resume` — Resume job

Continues a BLOCKED job from where it stopped (after the cause is fixed) or un-pauses a paused job. Already built parts are reused, nothing is duplicated.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `job_id` | uuid | ha |  |

### `job_cancel` — Cancel job

Cancels a job. Whatever was already built stays in the .aep (nothing is deleted); the job finishes with a report (outcome=cancelled).

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `job_id` | uuid | ha |  |

### `job_list` — List jobs · faqat o'qish

Recent jobs (all projects or one project) with state and outcome.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid |  |  |
| `limit` | integer |  | default `10`, ≥ 1, ≤ 50 |

## Tekshirish

### `frames_capture` — Capture frames · faqat o'qish

Renders still frames of the built video (main composition) in After Effects and shows them to you as separate images. Default times = the key moments of the plan, max 8. Prefer contact_sheet (one grid image, faster to read). With spec.variants, pass variant (e.g. "16:9") to check that format too.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `job_id` | uuid | ha |  |
| `times` | number[] |  |  |
| `max_px` | integer |  | default `768`, ≥ 128, ≤ 1280 |
| `variant` | `9:16` \\| `1:1` \\| `16:9` |  |  |

### `contact_sheet` — Contact sheet · faqat o'qish

One grid image of the built video for VERIFY: each cell is a frame with its time written under it. times "auto" (default) = the key moments of the plan (scene hits, transitions, end). Faster and cheaper to read than separate frames. grid "3x2" = 3 columns x 2 rows. With spec.variants, pass variant.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `job_id` | uuid | ha |  |
| `times` | `"auto"` \\| number[] |  | default `"auto"` |
| `max_px` | integer |  | Cell width in pixels · default `540`, ≥ 128, ≤ 1280 |
| `grid` | string |  | columns x rows · default `"3x2"` |
| `variant` | `9:16` \\| `1:1` \\| `16:9` |  |  |

### `verify_approve` — Approve result

Approves the built video after checking its frames. The job continues to RENDER and REPORT; poll job_status, then report_get.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `job_id` | uuid | ha |  |

### `verify_patch` — Patch and rebuild

Fixes the video during VERIFY (or a BLOCKED job): give either a full corrected spec or an RFC 6902 JSON patch against the job's current plan. Saves a new plan version and rebuilds into a NEW .aep version (the previous file is kept). Max 3 patches per job; after that LOOP_PATCH_LIMIT → ask the user.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `job_id` | uuid | ha |  |
| `spec` | object |  |  |
| `patch` | object[] |  |  |
| `reason` | string |  | What was wrong (goes to the job log) · ≤ 500 belgi |

## Effektlar va AE tekshiruvi

### `ae_effects` — Installed effects · faqat o'qish

Lists effects installed in After Effects (built-in and third-party plugins) with matchName and category. Use a matchName in spec effects[].fx when AE Studio has no alias for it. query filters by name, matchName or category (e.g. "blur", "glow", "Sapphire", "Distort").

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `query` | string |  | ≤ 128 belgi |
| `limit` | integer |  | default `100`, ≥ 1, ≤ 500 |
| `device_id` | uuid |  | Usually not needed |
| `project_id` | uuid |  | Resolve the device of this project |

### `fx_params` — Effect parameters · faqat o'qish

Shows the exact parameters of an effect: 1-based index, display name, matchName, type (number, point2d, color, group …), default value, min/max — by adding it to a temporary layer in AE. Use it before setting params of unfamiliar or third-party effects. In spec effects[].params the key can be the index ("3"), the name or the matchName; values: numbers, [x, y] points in layer px, "#RRGGBB" colors. Also lists the param aliases AE Studio maps for that effect.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `fx` | string | ha | Alias (gaussian_blur, glow …) or effect matchName · ≤ 128 belgi |
| `device_id` | uuid |  | Usually not needed |
| `project_id` | uuid |  | Resolve the device of this project |

### `ae_inspect` — Inspect composition · faqat o'qish

Reads back what is actually built in After Effects. Without layer: the composition's layers (type, timing, parent, effects, masks). With layer: that layer's property tree (values, keyframe counts, expressions) to depth. comp = composition name (scene comps are named like 01_<scene_id>, the main comp has the output name; default: the active comp); layer = layer name (the layer id from the spec).

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `comp` | string |  | ≤ 255 belgi |
| `layer` | string |  | ≤ 255 belgi |
| `depth` | integer |  | default `3`, ≥ 0, ≤ 6 |
| `device_id` | uuid |  | Usually not needed |
| `project_id` | uuid |  | Resolve the device of this project |

## Render

### `render_presets` — Render presets · faqat o'qish

Output presets for the final MP4 (spec output.preset / render_start). The video is rendered by After Effects (aerender) and encoded by ffmpeg on the user's machine into out/.

Parametrsiz.

### `render_start` — Render again

Renders an already finished (DONE) job again, optionally with another preset. Runs in the background: poll job_status (renders[]). Never overwrites: a new file name is chosen if needed. During VERIFY use verify_approve instead — it renders automatically.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `job_id` | uuid | ha |  |
| `preset` | `h264_social` \\| `h264_hq` |  |  |

## Shablonlar

### `templates_list` — List templates · faqat o'qish

Templates available to the user (built-in library + own): slug, title, formats, duration range, slots (type, required, default) and preview_url. Filter by format or tag.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `format` | `9:16` \\| `1:1` \\| `16:9` |  |  |
| `tag` | string |  | ≤ 32 belgi |

### `template_get` — Get template · faqat o'qish

Full template: slots with types/defaults/limits, duration range, formats, source (recipe = layer recipe, aep = After Effects file) and an example scene to put into a Spec (scene.template + scene.slots).

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `slug` | string | ha |  |
| `version` | integer |  | ≥ 1, ≤ 9007199254740991 |

### `template_apply` — Apply template

Fills a template's slots and saves a new plan version: mode 'append' adds the scene to the latest plan (replaces a scene with the same scene_id), mode 'new' starts a fresh Spec in the template's format (or the given one). Slots are validated immediately. Then run preflight → build_start.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `slug` | string | ha |  |
| `slots` | object |  | default `{}` |
| `dur` | number |  | ≤ 3600 |
| `scene_id` | string |  |  |
| `mode` | `append` \\| `new` |  | default `"append"` |
| `format` | `9:16` \\| `1:1` \\| `16:9` |  |  |
| `output_name` | string |  |  |

### `template_save` — Save template

Saves a scene of the project's plan as a reusable template (new version if the slug exists). source 'recipe' (default): the scene's layers become the recipe, layers with an id become slots (text/media). source 'aep': uploads the built .aep of a finished job (VERIFY or later) and uses the scene comp; layers with an id become slots by layer name.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `scene_id` | string | ha |  |
| `slug` | string | ha |  |
| `source` | `recipe` \\| `aep` |  | default `"recipe"` |
| `job_id` | uuid |  |  |
| `plan_version` | integer |  | ≥ 1, ≤ 9007199254740991 |
| `title` | string |  | ≤ 100 belgi |
| `description` | string |  | ≤ 1000 belgi |
| `formats` | `9:16` \\| `1:1` \\| `16:9`[] |  |  |
| `duration` | object |  |  |

## Brand kit

### `brands_list` — List brand kits · faqat o'qish

The user's brand kits: colors, fonts (PostScript names + fallbacks), logo asset, caption style, default voice and music style. A Spec uses one via spec.brand (slug; 'default' if saved).

Parametrsiz.

### `brand_save` — Save brand kit

Creates or updates a brand kit by slug. Applied by the compiler: default text font (body) and color, scene background, template tokens ({{brand.primary}} …, heading font, logo), caption style; the AUDIO step uses voice (when voiceover.voice_id is omitted) and music_style (when music.prompt is omitted). Fonts are checked in AE at PREFLIGHT: missing font → fallback list → AE_FONT_MISSING. Save slug 'default' to apply it to every Spec without spec.brand.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `brand` | object | ha |  |

## Batch

### `batch_start` — Start batch

Template + CSV → one video per row. The CSV header names columns; by default a column whose name equals a slot fills that slot (or pass mapping {column: slot}); an optional 'name' column sets the output file name. All rows are validated first (SPEC_INVALID lists bad rows); then jobs run one after another without VERIFY (auto-approved), each with its own render. Poll batch_status.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `project_id` | uuid | ha |  |
| `template` | string | ha |  |
| `csv` | string | ha | ≤ 1000000 belgi |
| `mapping` | object |  |  |
| `format` | `9:16` \\| `1:1` \\| `16:9` |  |  |
| `variants` | `9:16` \\| `1:1` \\| `16:9`[] |  |  |
| `dur` | number |  | ≤ 3600 |
| `brand` | string |  |  |

### `batch_status` — Batch status · faqat o'qish

Batch progress: per row status (pending/running/done/failed), job_id, output MP4 paths or the error; report (markdown table) when finished.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `batch_id` | uuid | ha |  |

### `batch_cancel` — Cancel batch

Stops a running batch: pending rows are marked failed, the running job is cancelled.

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `batch_id` | uuid | ha |  |

## Hisobot

### `report_get` — Get report · faqat o'qish

Final report of a job as markdown: what was built, file paths (.aep, rendered MP4 in out/), how to edit it in AE, warnings. Show it to the user. Available once the job reached REPORT/DONE (also for cancelled jobs).

| Parametr | Turi | Majburiy | Izoh |
|---|---|---|---|
| `job_id` | uuid | ha |  |

## Promptlar

- **/new-reel** — Brief va fayllardan After Effects'da qisqa video: reja → qurish → kadrlarni tekshirish → render → hisobot (hozircha audio'siz). Argumentlar: `brief` (majburiy) — Video nima haqida, kim uchun, qanday uslubda; `folder` — Ish papkasi (absolyut yo'l), ixtiyoriy; `format` — 9:16 (default), 1:1 yoki 16:9; `duration` — Taxminiy davomiylik, soniya.
- **/subtitle-video** — Mavjud video: (toza ovoz) → transkript (Scribe) → tahrir → subtitrli video. Argumentlar: `video` — Video asset kaliti yoki fayl nomi; `language` — Til kodi (default uz); `style` — karaoke_bold (default), bold_pop yoki minimal.
- **/dub-video** — Videoni boshqa tilga dublyaj qilish (ElevenLabs Dubbing) va AE'da yig'ish. Argumentlar: `video` — Video asset kaliti; `target_lang` (majburiy) — Maqsad tili (masalan en, ru).
- **/from-template** — Tayyor shablonni (hook, lower third, CTA …) slotlarini to'ldirib video qilish. Argumentlar: `template` — Shablon slug'i (bo'sh — ro'yxatdan tanlanadi); `content` — Matnlar va fayllar haqida qisqacha; `format` — 9:16, 1:1 yoki 16:9.
