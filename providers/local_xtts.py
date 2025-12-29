from TTS.api import TTS
from config import MODEL_NAME, SPEAKERS, LANGUAGES
from .base import TTSProvider

class LocalTTSProvider(TTSProvider):
    def __init__(self):
        self._tts_gpu = None
        self._tts_cpu = None

    def _get_tts(self, use_cuda: bool) -> TTS:
        if use_cuda:
            if self._tts_gpu is None:
                print("[INFO] Loading XTTS model for GPU…")
                self._tts_gpu = TTS(MODEL_NAME)
                try:
                    self._tts_gpu.to("cuda")
                except Exception as e:
                    print(f"[WARN] Failed to move model to CUDA: {e}")
            return self._tts_gpu
        else:
            if self._tts_cpu is None:
                print("[INFO] Loading XTTS model for CPU…")
                self._tts_cpu = TTS(MODEL_NAME)
                self._tts_cpu.to("cpu")
            return self._tts_cpu

    def get_voices(self, language: str = None) -> list[str]:
        return SPEAKERS

    def get_languages(self) -> list[str]:
        return LANGUAGES

    def synthesize(self, text: str, voice: str, language: str, output_path: str, use_cuda: bool = True):
        tts = self._get_tts(use_cuda)
        tts.tts_to_file(
            text=text,
            file_path=output_path,
            speaker=voice,
            language=language,
        )
