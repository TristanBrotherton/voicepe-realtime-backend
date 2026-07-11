# FAQ

### Can I go back to the stock firmware?

Yes — fully reversible, nothing about the hardware is changed. Two ways:

- Open the official [Voice PE web installer](https://esphome.io/projects/?type=voice)
  in Chrome/Edge with the device connected over **USB**, and it reflashes the
  factory firmware.
- Or click **Install** on the stock firmware config in ESPHome Builder.

Then re-adopt the device in Home Assistant as normal.

### Does it run on a Raspberry Pi?

The **add-on** does — it needs Home Assistant OS (or Supervised) for add-on
support, and it's I/O-bound: a Pi 4/5 running HAOS handles it (speaker-ID
inference is a few hundred ms on CPU, off the audio path). The heavy lifting —
speech understanding and generation — is OpenAI's cloud, so device requirements
are modest.

The **firmware** is Voice PE-only — it drives that device's XMOS mic array and
audio chain; other satellites aren't supported.

**Wake-word training** is the one heavy job, and it's optional and occasional:
it runs in ~2 hours on any spare Apple Silicon or NVIDIA machine, not on your HA
box.

### What does it cost?

Usage-based OpenAI Realtime pricing — you pay per audio token only while actually
conversing. Wake-word detection is on-device and free; idle sessions cost nothing
meaningful. A busy household day of a few dozen short exchanges typically lands
in the **tens of cents**; check your OpenAI usage dashboard after a normal day
for your own number.

Cost levers: `max_context_messages` caps per-reply history cost, a trimmed
`mcp_tool_allowlist` reduces per-session overhead, `gpt-realtime-mini` is a
cheaper model, and each web search is a few cents (mini/nano search models are
cheaper still).

### What about privacy — what leaves my network?

- **Wake-word detection runs on the device.** Nothing streams anywhere until a
  wake fires.
- **After a wake**, mic audio goes to OpenAI's Realtime API for the conversation
  (that's the product), and web-search queries go to OpenAI when used.
- **Everything else stays home**: enrollment recordings
  (`/share/voice-enrollment/`), wake captures (`/share/voice-probes/`), voice
  prints (`/share/voice-prints/`), and memory notes (`/share/voice-memory/`)
  live on your HA box and are never uploaded by this add-on. Speaker
  identification runs locally in the add-on. During voice enrollment, OpenAI
  hears nothing at all — mic audio flows only to the local recorder.

### What are the secrets in the firmware config?

Neither is a cloud credential — both are device-local, and you generate your own:

- **`api_key`** is an **ESPHome Noise/API encryption key** — it encrypts the
  device↔Home Assistant connection. NOT a Home Assistant token, NOT your OpenAI
  key. 32 random bytes, base64: `openssl rand -base64 32` (or let ESPHome
  Builder generate it).
- **`ota_password`** protects over-the-air firmware flashes. Any password you
  choose; keep it matching what the device was last flashed with.

Your OpenAI key lives only in the add-on configuration, never on the device.

### Which wake word do new installs get?

**"Hey Leonard"** — this project's custom-trained model. Prefer a standard one?
Switch to **Hey Jarvis** or **Okay Nabu** in the device's "Wake word" dropdown in
Home Assistant — no reflash. Or [train your own](features.md#wake-words).

### Does it speak other languages?

The Realtime model is multilingual. Set `transcription_language` to your ISO code
and write your `instructions` in your language, keeping the LANGUAGE / STYLE /
BEHAVIOR structure of the default prompt. The configuration UI even ships a full
Dutch translation. The shipped instructions are English-tuned, and the enrollment
coach prompts are English (PRs welcome).

### Do I need the agent integration?

No. Everything except instant deep recall and long-running task delegation works
standalone: conversation, smart-home control, web search, timers, memory notes,
speaker recognition, enrollment, sensors. When you want those superpowers,
[OpenClaw](https://openclaw.ai) is what this project is built around and pairs
with best — but the contract is agent-agnostic:
[one URL and two POST shapes](agent-integration.md).

### Why does it say "still working on that"?

You asked for something long-running (research, a multi-step agent task). Rather
than keeping you waiting at the speaker — or failing when the voice turn times
out — the assistant ends the turn and lets the agent keep working. When the task
finishes, the result is **announced out loud in the room you asked from** (or
sent to you by text if the device is unreachable). See
[Long-running task delegation](features.md#long-running-task-delegation).

### Does it need Home Assistant OS?

Yes — the add-on assumes HAOS/Supervised (add-on installs, supervisor APIs for
tools/sensors/timers). Container/Core installs would need to run the backend
manually and lose the supervisor integrations — not a supported path today.

### It answers itself / answers nobody / crackles — help?

Quick hits:

- Crackle at reply start → raise `playback_prebuffer_ms` to ~250.
- Ghost turns (it answers its own echo) → raise `wake_open_delay_ms` /
  `follow_up_open_delay_ms`.
- Mishears in noise → try `noise_reduction: far_field` (default off; the
  device's XMOS already filters).
- Wake word too eager or too deaf → the device's "Wake word sensitivity" select
  in HA.
- Rarely, the assistant may stop itself on a word in its own reply that sounds
  like "stop" — just ask again.

### Why does it briefly reconnect about once an hour?

OpenAI caps a Realtime session at 60 minutes. The add-on refreshes proactively
during a quiet moment, so you'll rarely notice — at worst an occasional 1–2 s
pause. Conversation context survives the refresh.
