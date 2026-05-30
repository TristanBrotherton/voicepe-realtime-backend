"""Log the conversation transcript (assistant + user) into the add-on log.

WHY: with gpt-realtime the model hears the user's audio natively and bursts the
whole spoken reply as audio — the only window into *what it actually said* used to
be the OpenAI tool-call arguments. This processor surfaces the assistant's spoken
text (and, when input transcription is enabled, the user's transcript) as plain
INFO lines so the add-on log alone explains a turn.

How the text reaches us (verified against pipecat 0.0.97
`OpenAIRealtimeLLMService`):
  - The realtime service handles `response.audio_transcript.delta` and pushes
    one `LLMTextFrame` per delta, wrapped by `LLMFullResponseStartFrame` /
    `LLMFullResponseEndFrame`. We accumulate the deltas between those brackets and
    log the full sentence once, instead of spamming a line per token.
  - `conversation.item.input_audio_transcription.completed` pushes a
    `TranscriptionFrame` with the user's final transcript — but ONLY when input
    transcription is configured (see main.py: transcription is None unless a
    TRANSCRIPTION_LANGUAGE is pinned). So the user line may be absent; the
    assistant line is always present.

Both flow DOWNSTREAM out of the OpenAI service, so this processor is placed right
after it in the pipeline. It is pure instrumentation: it never transforms or
drops a frame, it just forwards everything unchanged. (Listed for removal under
CLAUDE.md roadmap #5 once the system is stable.)
"""
import logging

from pipecat.frames.frames import (
    Frame,
    LLMTextFrame,
    LLMFullResponseStartFrame,
    LLMFullResponseEndFrame,
    TranscriptionFrame,
)
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection

logger = logging.getLogger(__name__)


class TranscriptLogger(FrameProcessor):
    """Forward-only processor that logs assistant + user transcript lines."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._assistant_buf: list[str] = []
        self._capturing = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        # Assistant spoken text: accumulate deltas between the response brackets,
        # log once at the end so it's one readable line per reply.
        if isinstance(frame, LLMFullResponseStartFrame):
            self._assistant_buf = []
            self._capturing = True
        elif isinstance(frame, LLMTextFrame):
            if self._capturing or not self._assistant_buf:
                # Capture even if we somehow missed the start bracket.
                self._assistant_buf.append(frame.text or "")
        elif isinstance(frame, LLMFullResponseEndFrame):
            text = "".join(self._assistant_buf).strip()
            self._capturing = False
            self._assistant_buf = []
            if text:
                logger.info(f"🤖 assistant: {text}")
        elif isinstance(frame, TranscriptionFrame):
            # User's final transcript (only present when input transcription is on).
            text = (frame.text or "").strip()
            if text:
                logger.info(f"🗣️ user: {text}")

        await self.push_frame(frame, direction)
