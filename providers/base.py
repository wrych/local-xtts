from abc import ABC, abstractmethod

class TTSProvider(ABC):
    @abstractmethod
    def get_voices(self, language: str = None) -> list[str]:
        pass

    @abstractmethod
    def get_languages(self) -> list[str]:
        pass

    @abstractmethod
    def synthesize(self, text: str, voice: str, language: str, output_path: str, use_cuda: bool = True):
        pass
