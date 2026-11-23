"""Suggestion-only English spell checking for TrOCR output."""

import csv
import re
from pathlib import Path

try:
    from spellchecker import SpellChecker
except ImportError:  # Keep OCR available until backend requirements are installed.
    SpellChecker = None


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = PROJECT_ROOT / "custom_dataset"
LABELS_PATH = DATASET_DIR / "labels.csv"
CUSTOM_WORDS_PATH = DATASET_DIR / "custom_words.txt"
WORD_PATTERN = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*", re.UNICODE)
VALID_CUSTOM_WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*\Z", re.UNICODE)

_spell = SpellChecker(language="en", distance=1) if SpellChecker else None
_loaded_domain_words = set()
_word_buckets = None


def _load_domain_words():
    words = set()
    if LABELS_PATH.exists():
        try:
            with LABELS_PATH.open("r", encoding="utf-8-sig", newline="") as labels_file:
                for row in csv.DictReader(labels_file):
                    for match in WORD_PATTERN.finditer(row.get("text", "")):
                        words.add(match.group(0).casefold())
        except (OSError, csv.Error):
            pass

    if CUSTOM_WORDS_PATH.exists():
        try:
            for line in CUSTOM_WORDS_PATH.read_text(encoding="utf-8").splitlines():
                word = line.strip().casefold()
                if VALID_CUSTOM_WORD.fullmatch(word):
                    words.add(word)
        except OSError:
            pass
    return words


def _refresh_domain_words():
    global _word_buckets
    if _spell is None:
        return
    new_words = _load_domain_words() - _loaded_domain_words
    if new_words:
        _spell.word_frequency.load_words(new_words)
        _loaded_domain_words.update(new_words)
        _word_buckets = None


def _match_case(source, replacement):
    if source.isupper():
        return replacement.upper()
    if source[:1].isupper():
        return replacement.capitalize()
    return replacement


def _ranked_candidates(word, limit=5):
    candidates = [candidate for candidate in _spell.candidates(word) if len(candidate) >= 3]
    return sorted(candidates, key=lambda candidate: _spell.word_frequency[candidate], reverse=True)[:limit]


def _edit_distance(left, right, cutoff=2):
    if abs(len(left) - len(right)) > cutoff:
        return cutoff + 1
    previous = list(range(len(right) + 1))
    for row, left_char in enumerate(left, start=1):
        current = [row]
        for column, right_char in enumerate(right, start=1):
            current.append(min(
                current[-1] + 1,
                previous[column] + 1,
                previous[column - 1] + (left_char != right_char),
            ))
        if min(current) > cutoff:
            return cutoff + 1
        previous = current
    return previous[-1]


def _nearby_known_words(word, limit=4, max_distance=2):
    """Find common alternatives near an OCR word, even when it is valid."""
    global _word_buckets
    if _word_buckets is None:
        _word_buckets = {}
        for candidate, frequency in _spell.word_frequency.dictionary.items():
            if frequency > 0 and candidate.isalpha():
                _word_buckets.setdefault(len(candidate), []).append(candidate)

    nearby_by_length = {}
    for length in range(max(1, len(word) - max_distance), len(word) + max_distance + 1):
        for candidate in _word_buckets.get(length, ()):
            if candidate == word or len(candidate) < 2:
                continue
            distance = _edit_distance(word, candidate, max_distance)
            if 0 < distance <= max_distance:
                nearby_by_length.setdefault(length, []).append((distance, _spell.word_frequency[candidate], candidate))

    for entries in nearby_by_length.values():
        entries.sort(key=lambda entry: (entry[0], -entry[1], entry[2]))

    # Keep a useful mix of one-letter deletions and same-length alternatives;
    # frequency-only ranking tends to crowd out plausible OCR readings.
    selected = []
    shorter = nearby_by_length.get(len(word) - 1, [])
    if shorter:
        selected.append(shorter[0][2])
    same_length = nearby_by_length.get(len(word), [])
    selected.extend(entry[2] for entry in same_length[:max(0, limit - len(selected))])
    for length in (len(word) + 1, len(word) - 2, len(word) + 2):
        for _, _, candidate in nearby_by_length.get(length, []):
            if len(selected) >= limit:
                break
            if candidate not in selected:
                selected.append(candidate)
    return selected[:limit]


def suggest_corrections(text):
    """Return (suggested text, per-word suggestions); never mutates input."""
    if not text or _spell is None:
        return text or "", []

    _refresh_domain_words()
    corrections = []

    # TrOCR often splits a short handwritten word into a one-letter token and
    # a short uppercase token (for example, "S BX" for "SBX"). Offer
    # dictionary alternatives for the joined shape instead of silently
    # discarding both tokens as too short to check.
    split_token_pattern = re.compile(r"(?<![\w])([A-Z])\s+([A-Z]{2,3})(?![\w])")

    def replace_split_token(match):
        original = match.group(0)
        joined = (match.group(1) + match.group(2)).casefold()
        candidates = _ranked_candidates(joined)
        if not candidates:
            return original
        suggestion = _match_case(original, candidates[0])
        corrections.append({
            "original": original,
            "suggestion": suggestion,
            "candidates": [_match_case(original, candidate) for candidate in candidates],
        })
        return suggestion

    text = split_token_pattern.sub(replace_split_token, text)

    # TrOCR can split a short word into two separately recognized letters
    # (for example, "I S" for "is"). Keep it selectable so the user can
    # distinguish a joined word from two intentional single-letter tokens.
    split_letter_pattern = re.compile(r"(?<![\w])([A-Za-z])\s+([A-Za-z])(?![\w])")

    def replace_split_letters(match):
        original = match.group(0)
        joined = (match.group(1) + match.group(2)).casefold()
        if _spell.word_frequency[joined] <= 0:
            return original
        alternatives = _nearby_known_words(joined, limit=3, max_distance=1)
        corrections.append({
            "original": original,
            "suggestion": joined,
            "candidates": [joined] + alternatives,
        })
        return joined

    text = split_letter_pattern.sub(replace_split_letters, text)

    def replace_word(match):
        original = match.group(0)
        normalized = original.casefold()
        # Acronyms and very short words are easy to overcorrect.
        if len(normalized) < 3 or original.isupper():
            return original

        if normalized not in _spell.unknown([normalized]):
            # TrOCR may produce a valid but unintended short word (e.g. "arm"
            # for "am"). Keep the OCR output as-is, but offer nearby choices.
            alternatives = (
                _nearby_known_words(normalized)
                if len(normalized) <= 4 and _spell.word_frequency[normalized] < 8_000_000
                else []
            )
            if alternatives:
                corrections.append({
                    "original": original,
                    "suggestion": original,
                    "candidates": [_match_case(original, candidate) for candidate in alternatives],
                })
            return original

        candidates = _ranked_candidates(normalized)
        candidate = candidates[0] if candidates else _spell.correction(normalized)
        if not candidate or candidate == normalized:
            return original

        replacement = _match_case(original, candidate)
        corrections.append({
            "original": original,
            "suggestion": replacement,
            "candidates": [_match_case(original, candidate) for candidate in candidates],
        })
        return replacement

    suggested = WORD_PATTERN.sub(replace_word, text)
    return suggested, corrections


def add_custom_word(word):
    """Persist a user-approved word so future OCR won't flag it."""
    global _word_buckets
    normalized = (word or "").strip().casefold()
    if not normalized or len(normalized) > 64 or not VALID_CUSTOM_WORD.fullmatch(normalized):
        raise ValueError("Enter a single word containing letters or apostrophes.")
    if _spell is None:
        raise RuntimeError("Spell checking is unavailable; install backend requirements first.")

    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    existing = set()
    if CUSTOM_WORDS_PATH.exists():
        existing = {line.strip().casefold() for line in CUSTOM_WORDS_PATH.read_text(encoding="utf-8").splitlines()}
    if normalized not in existing:
        with CUSTOM_WORDS_PATH.open("a", encoding="utf-8", newline="\n") as custom_file:
            custom_file.write(normalized + "\n")
    _spell.word_frequency.load_words([normalized])
    _loaded_domain_words.add(normalized)
    _word_buckets = None
    return normalized


def is_spellchecker_available():
    return _spell is not None
