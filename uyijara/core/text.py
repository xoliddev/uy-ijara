"""How people in Tashkent really type a place: Latin or Cyrillic, Uzbek or Russian spelling, with typos.

Every word is folded to a phonetic *key*, so "Чиланзар", "Chilanzar" and "Chilonzor" end up close enough to match:
search compares keys exactly, by prefix, or with a small edit distance. Copied from day 2 (navbatchi-dorixona).
"""

from __future__ import annotations

import re

CYRILLIC = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "j", "з": "z", "и": "i", "й": "y",
    "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
    "х": "x", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "", "ы": "i", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "ў": "o", "қ": "q", "ғ": "g", "ҳ": "h", "і": "i",
}
APOSTROPHES = "'`ʻʼ‘’´"
MAX_QUERY = 64
_NON_WORD = re.compile(r"[^a-z0-9čš]+")
_DOUBLE = re.compile(r"([a-zčš])\1+")
_C_SOFT = re.compile(r"c(?=[eiy])")


def translit(text: str) -> str:
    """Lower-case and spell Cyrillic (Uzbek and Russian) in Latin letters."""
    out = []
    for ch in text.lower():
        out.append(CYRILLIC.get(ch, ch))
    return "".join(out)


def fold_word(word: str) -> str:
    """One Latin word -> phonetic key. The order of the rules matters (the JS port applies the same order)."""
    if word.isdigit():
        return word
    w = word
    for a, b in (("sch", "š"), ("sh", "š"), ("ch", "č"), ("ph", "f"), ("th", "t"), ("kh", "x"), ("ck", "k"),
                 ("ts", "c"), ("tz", "c"), ("ks", "x"), ("cs", "x")):
        w = w.replace(a, b)
    w = _C_SOFT.sub("s", w)
    w = w.replace("c", "k").replace("q", "k").replace("w", "v").replace("y", "i").replace("h", "x")
    w = _DOUBLE.sub(r"\1", w)
    if len(w) > 4 and w.endswith("e"):
        w = w[:-1]
    return w


def words(text: str) -> list[str]:
    """Text -> list of keys (one per word). Apostrophes vanish so o'/g' match o/g."""
    latin = translit(text[:MAX_QUERY * 4])
    for ch in APOSTROPHES:
        latin = latin.replace(ch, "")
    return [fold_word(w) for w in _NON_WORD.split(latin) if w]


def distance(a: str, b: str, limit: int = 3) -> int:
    """Optimal string alignment distance (Levenshtein + adjacent swaps), capped at ``limit + 1``."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev2: list[int] = []
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        best = cur[0]
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            v = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                v = min(v, prev2[j - 2] + 1)
            cur[j] = v
            best = min(best, v)
        if best > limit:
            return limit + 1
        prev2, prev = prev, cur
    return min(prev[len(b)], limit + 1)


def allowed_typos(key: str) -> int:
    """Short words must match exactly; longer ones forgive one or two typos."""
    n = len(key)
    return 0 if n <= 4 else 1 if n <= 7 else 2


def word_score(q: str, w: str) -> int | None:
    """How well query key ``q`` matches name key ``w``: 0 exact, 1 prefix, 2+ typos; None = no match."""
    if q == w:
        return 0
    if len(q) >= 3 and w.startswith(q):
        return 1
    limit = allowed_typos(q)
    if limit == 0:
        return None
    d = distance(q, w, limit)
    if d <= limit:
        return 1 + d
    if len(q) >= 5 and len(w) > len(q):  # a typo in a word that is still being typed: "paratsitam"
        d = distance(q, w[: len(q)], limit)
        if d <= limit:
            return 2 + d
    return None
