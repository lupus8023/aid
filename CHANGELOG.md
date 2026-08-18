# Changelog

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
