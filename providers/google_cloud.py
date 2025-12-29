import os
from google.cloud import texttospeech
import db
from .base import TTSProvider

class GoogleTTSProvider(TTSProvider):
    def __init__(self):
        self._client = None
        self._voice_cache = None
        self._lang_cache = None

    def _get_client(self):
        if self._client is None:
            settings = db.get_provider_settings("google")
            creds_json = settings.get("google_service_account")
            
            if creds_json:
                import tempfile
                fd, path = tempfile.mkstemp(suffix=".json")
                try:
                    with os.fdopen(fd, 'w') as tmp:
                        tmp.write(creds_json)
                    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = path
                    self._client = texttospeech.TextToSpeechClient()
                finally:
                    pass
            else:
                self._client = texttospeech.TextToSpeechClient()
        return self._client

    def get_voices(self, language: str = None) -> list[str]:
        try:
            client = self._get_client()
            voices = client.list_voices(language_code=language)
            return sorted([v.name for v in voices.voices])
        except Exception as e:
            print(f"[ERROR] Failed to list Google voices: {e}")
            return ["en-US-Standard-A"] # Fallback

    def get_languages(self) -> list[str]:
        if self._lang_cache is None:
            try:
                client = self._get_client()
                voices = client.list_voices()
                langs = set()
                for v in voices.voices:
                    for lc in v.language_codes:
                        langs.add(lc)
                self._lang_cache = sorted(list(langs))
            except Exception as e:
                print(f"[ERROR] Failed to list Google languages: {e}")
                return ["en-US"] # Fallback
        return self._lang_cache

    def synthesize(self, text: str, voice: str, language: str, output_path: str, use_cuda: bool = True):
        client = self._get_client()
        synthesis_input = texttospeech.SynthesisInput(text=text)
        
        voice_params = texttospeech.VoiceSelectionParams(
            name=voice,
            language_code=language
        )

        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.LINEAR16
        )

        response = client.synthesize_speech(
            input=synthesis_input, voice=voice_params, audio_config=audio_config
        )

        with open(output_path, "wb") as out:
            out.write(response.audio_content)
