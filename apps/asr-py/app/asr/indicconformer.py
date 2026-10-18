"""IndicConformerEngine: ai4bharat/indic-conformer-600m-multilingual (MIT, gated, docs/vendor-notes.md).

- CPU, 16 kHz mono, language code `gu` (the card's own example call is `model(wav, "gu", "ctc")`).
- The model repository is loaded at ONE pinned commit with trust_remote_code=True, only inside the container.
- `transformers` and `torch` are imported when the model is first used, so tests and CI never need them.
- No keyterm support is documented, no confidence is returned by the call: both stay unsupported/None.
"""

from __future__ import annotations

import os
from collections.abc import Callable

import numpy as np

from app.asr.local import UtteranceEngine
from app.asr.models import INDIC_CONFORMER, require_container
from app.asr.types import Capabilities
from app.vad import EnergyBackend, VADBackend, VADConfig


class IndicConformerEngine(UtteranceEngine):
    name = "indicconformer"
    version = f"600m-{INDIC_CONFORMER.revision[:8]}"
    capabilities = Capabilities(
        streaming_partials=False,
        keyterms=False,
        codemix=False,
        diarization=False,
        confidence=False,
        word_timestamps=False,
    )

    def __init__(
        self,
        decoding: str = "ctc",
        vad_backend: Callable[[], VADBackend] = EnergyBackend,
        vad_config: VADConfig | None = None,
    ) -> None:
        super().__init__(vad_backend, vad_config)
        if decoding not in ("ctc", "rnnt"):
            raise ValueError("decoding must be ctc or rnnt")
        self._decoding = decoding
        self._model: object | None = None

    def _load(self) -> object:
        require_container()
        from transformers import AutoModel  # noqa: PLC0415 - heavy, container only

        token = os.environ.get("HF_TOKEN") or None  # the repository is gated; never logged
        return AutoModel.from_pretrained(
            INDIC_CONFORMER.repo,
            revision=INDIC_CONFORMER.revision,  # the only commit whose code may run
            trust_remote_code=True,
            token=token,
        )

    def _decode(self, samples: np.ndarray, language: str | None) -> tuple[str, float | None]:
        import torch  # noqa: PLC0415

        if self._model is None:
            self._model = self._load()
        wav = torch.from_numpy(samples).unsqueeze(0)  # (1, N), already mono 16 kHz
        text = self._model(wav, language or "gu", self._decoding)  # type: ignore[operator]
        return str(text), None
