"""Small shared pieces: the refusal error, input cleaning and the language codes."""

from __future__ import annotations

from .core.listing import clean as clean_text

LANGS = ("uz", "ru")
__all__ = ["LANGS", "Refused", "clean_text", "norm_lang"]


class Refused(Exception):
    """An action that is not allowed; ``code`` maps to an ``err.<code>`` text."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def norm_lang(code: str | None) -> str:
    return "ru" if code and code[:2].lower() == "ru" else "uz"
