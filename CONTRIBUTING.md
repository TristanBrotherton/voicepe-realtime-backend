# Contributing

PRs and issues are welcome — this project got measurably better the first week
the community looked at it (the instant wake-pulse sensor was a Reddit
suggestion). That said, it runs in people's homes, so the bar is: **small,
tested, explained**.

## Before you write code

- **Bugs**: open an issue with the template. Logs beat prose — the add-on log
  (`Settings → Add-ons → → Log`) and, for device issues, the ESPHome log.
- **Features**: open an issue first and wait for a 👍 before investing real
  time. This protects your effort — features that don't fit the project's
  shape (thin firmware, one backend, agent-agnostic contracts) won't be merged
  however good the code is.
- **Questions**: the [FAQ](docs/faq.md) and [docs/](docs/) first, then an issue.

## What gets merged

- **One change per PR.** A fix and a refactor are two PRs.
- **Tested on real hardware.** State in the PR what you ran it on (device,
  HAOS version, add-on version) and what you observed. "Compiles" is not
  tested — this stack has bitten us with code that compiled and then talked
  over its own announcements.
- **The why in the description.** What breaks without this? What user-visible
  behavior changes? Link the issue.
- **Docs move with the code.** New option → `docs/configuration.md` + the
  translations file. New feature → `docs/features.md`. User-visible change →
  `CHANGELOG.md` entry under a new version heading.
- **No personal information** in examples, logs, or defaults — generic names,
  placeholder IPs (`192.168.1.x`), no real tokens. We audit for this.
- **Match the local style.** Comments explain *why*, not what the next line
  does. No drive-by reformatting.

## What gets closed

- Large unsolicited rewrites, framework swaps, or "modernization" PRs.
- AI-generated PRs that nobody ran. (Using AI to write code is fine — we do —
  but you must have executed it and be able to answer questions about it.)
- PRs that change shipped defaults without a strong case. Defaults are how
  existing installs behave after an update.
- Anything that moves smart-home control off the native Home Assistant tools.

## Repo layout

| Path | What |
|---|---|
| `openai_realtime_voice_agent/` | The Home Assistant add-on (Python, pipecat) |
| `openai_realtime_voice_agent/app/` | Backend source — start at `main.py` |
| `docs/` | User documentation |
| `examples/openclaw-bridge/` | Reference agent bridge (Node) |

Firmware lives in
[voicepe-realtime-firmware](https://github.com/TristanBrotherton/voicepe-realtime-firmware) —
same rules, plus: firmware PRs **must** state which device revision you flashed
and that wake word, timers, and enrollment still work.

## Testing a backend change locally

Install your branch as a local add-on: copy `openai_realtime_voice_agent/`
into the supervisor's local add-ons (`/addons` on HAOS), reload the add-on
store, install, and point a device stub at it. `docs/getting-started.md` has
the full flow. Watch the add-on log with debug on while you test.
