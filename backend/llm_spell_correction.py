"""Optional, suggestion-only LLM assistance for noisy handwriting OCR."""

import asyncio
import json
import os
import re
import urllib.error
import urllib.request


WORD_PATTERN = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*", re.UNICODE)
_MAX_DISTANCE = 2


def is_llm_spellchecker_configured():
    """Return whether the server has credentials for its optional LLM provider."""
    return bool(os.getenv("OPENAI_API_KEY", "").strip())


def _edit_distance(left, right, cutoff=_MAX_DISTANCE):
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


def _match_case(source, candidate):
    if source.isupper():
        return candidate.upper()
    if source[:1].isupper():
        return candidate.capitalize()
    return candidate


def _original_occurs(text, original):
    pieces = original.split()
    if not pieces:
        return False
    pattern = r"(?<!\w)" + r"\s+".join(re.escape(piece) for piece in pieces) + r"(?!\w)"
    return re.search(pattern, text, flags=re.IGNORECASE) is not None


def _provider_request(text, local_corrections):
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None

    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    endpoint = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"

    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You help correct English text recognized from handwritten OCR. "
                    "For each OCR token or visibly split adjacent letter fragments, "
                    "suggest up to 5 plausible intended spellings using the full phrase "
                    "as context. Adjacent one-letter tokens like 'I S' may be the word "
                    "'is'; return the combined original as 'I S'. OCR errors may insert, omit, "
                    "or substitute one or two characters (for example, 'arm' may be "
                    "'am' or 'aim'). Preserve valid words unless a nearby alternative "
                    "fits context better. Return only JSON: {\"corrections\":["
                    "{\"original\":\"...\",\"best\":\"...\",\"candidates\":[\"...\"]}]}"
                ),
            },
            {
                "role": "user",
                "content": json.dumps({"ocr_text": text, "local_spellchecker": local_corrections}),
            },
        ],
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.loads(response.read().decode("utf-8"))
    content = result["choices"][0]["message"]["content"]
    return json.loads(content)


def _merge_suggestions(text, suggested_text, corrections, llm_result):
    local_by_word = {entry["original"].casefold(): dict(entry) for entry in corrections}
    merged = dict(local_by_word)

    for item in llm_result.get("corrections", []):
        if not isinstance(item, dict):
            continue
        original = item.get("original", "")
        if not isinstance(original, str) or not original:
            continue
        # Accept a token or multi-token fragment only if it occurs in OCR.
        if not _original_occurs(text, original):
            continue

        prior = merged.get(original.casefold(), {"original": original, "suggestion": original, "candidates": []})
        local_candidates = prior.get("candidates") or []
        llm_candidates = item.get("candidates") if isinstance(item.get("candidates"), list) else []
        best = item.get("best") if isinstance(item.get("best"), str) else ""
        candidates = []
        for candidate in ([best] + llm_candidates + local_candidates + [original]):
            if not isinstance(candidate, str):
                continue
            candidate = candidate.strip()
            if not re.fullmatch(r"[^\W\d_]+(?:['’][^\W\d_]+)*", candidate, re.UNICODE):
                continue
            normalized = candidate.casefold()
            compact_original = re.sub(r"[^\W\d_]", "", original.casefold(), flags=re.UNICODE)
            if normalized != compact_original and _edit_distance(compact_original, normalized) > _MAX_DISTANCE:
                continue
            if normalized not in {entry.casefold() for entry in candidates}:
                candidates.append(_match_case(original, candidate))
            if len(candidates) >= 5:
                break

        alternatives = [candidate for candidate in candidates if candidate.casefold() != original.casefold()]
        if not alternatives:
            continue
        # Trust an existing local correction first; otherwise use the LLM's
        # context-ranked best suggestion. Every option remains user-selectable.
        suggestion = prior.get("suggestion", original)
        if suggestion.casefold() == original.casefold():
            suggestion = _match_case(original, best) if best and best.casefold() in {c.casefold() for c in alternatives} else alternatives[0]
        merged[original.casefold()] = {
            "original": original,
            "suggestion": suggestion,
            "candidates": candidates,
        }

    # Keep local results and order, adding LLM-only token alternatives after.
    output = []
    seen = set()
    # Keep non-token local corrections (such as OCR's split-token "S BX")
    # which cannot be emitted by the normal word-token scan below.
    for entry in corrections:
        original = entry.get("original", "")
        if original and not WORD_PATTERN.fullmatch(original):
            output.append(merged.get(original.casefold(), entry))
    for token in WORD_PATTERN.findall(text):
        entry = merged.get(token.casefold())
        if entry and token.casefold() not in seen:
            output.append(entry)
            seen.add(token.casefold())

    # Apply multi-token fragment suggestions first, then ordinary word choices.
    rebuilt = text
    for entry in output:
        original = entry.get("original", "")
        if original and not WORD_PATTERN.fullmatch(original) and entry.get("suggestion") != original:
            rebuilt = re.sub(re.escape(original), lambda _match: entry["suggestion"], rebuilt, count=1, flags=re.IGNORECASE)
    best_by_word = {entry["original"].casefold(): entry["suggestion"] for entry in output if WORD_PATTERN.fullmatch(entry.get("original", ""))}
    rebuilt = WORD_PATTERN.sub(lambda match: _match_case(match.group(0), best_by_word.get(match.group(0).casefold(), match.group(0))), rebuilt)
    # Retain local split-token rewrites not represented as a normal word.
    if suggested_text != text:
        for entry in corrections:
            original = entry.get("original", "")
            if original and not WORD_PATTERN.fullmatch(original) and entry.get("suggestion") != original and original in rebuilt:
                rebuilt = rebuilt.replace(original, entry["suggestion"], 1)
    return rebuilt, output


async def enhance_spell_suggestions(text, suggested_text, corrections):
    """Return enhanced suggestions and status without blocking the WebSocket loop."""
    if not is_llm_spellchecker_configured():
        return suggested_text, corrections, "not_configured"
    try:
        result = await asyncio.to_thread(_provider_request, text, corrections)
        if not isinstance(result, dict):
            return suggested_text, corrections, "unavailable"
        enhanced_text, enhanced_corrections = _merge_suggestions(text, suggested_text, corrections, result)
        return enhanced_text, enhanced_corrections, "ready"
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print(f"LLM spell suggestions unavailable: {exc}")
        return suggested_text, corrections, "unavailable"
    except Exception as exc:
        print(f"LLM spell suggestions unavailable: {exc}")
        return suggested_text, corrections, "unavailable"


def _provider_request_next_words(sentence, limit):
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None

    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    endpoint = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"
    payload = {
        "model": model,
        "temperature": 0.35,
        "max_tokens": 60,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Predict useful next-word choices for a sentence being written by a user. "
                    f"Return exactly up to {limit} distinct, natural single-word continuations as JSON "
                    "with the shape {\"suggestions\":[\"word\"]}. Do not return punctuation, "
                    "explanations, phrases, or repeat a word already at the end of the sentence. "
                    "Offer varied choices when context permits."
                ),
            },
            {"role": "user", "content": json.dumps({"sentence_so_far": sentence})},
        ],
        "response_format": {"type": "json_object"},
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=7) as response:
        result = json.loads(response.read().decode("utf-8"))
    content = result["choices"][0]["message"]["content"]
    return json.loads(content)


async def suggest_next_words(sentence, limit=4):
    """Return optional LLM next-word choices and a status for the UI."""
    sentence = " ".join(str(sentence or "").split())[:1000]
    if not sentence:
        return [], "empty_context"
    if not is_llm_spellchecker_configured():
        return [], "not_configured"

    try:
        result = await asyncio.to_thread(_provider_request_next_words, sentence, limit)
        if not isinstance(result, dict) or not isinstance(result.get("suggestions"), list):
            return [], "unavailable"

        last_word = WORD_PATTERN.findall(sentence)
        last_word = last_word[-1].casefold() if last_word else ""
        suggestions = []
        seen = set()
        for value in result["suggestions"]:
            if not isinstance(value, str):
                continue
            candidate = value.strip().strip("\"'“”‘’.,!?;:")
            if not WORD_PATTERN.fullmatch(candidate):
                continue
            key = candidate.casefold()
            if key == last_word or key in seen:
                continue
            seen.add(key)
            suggestions.append(candidate)
            if len(suggestions) >= max(1, min(int(limit), 4)):
                break
        return suggestions, "ready" if suggestions else "empty"
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print(f"LLM next-word suggestions unavailable: {exc}")
        return [], "unavailable"
    except Exception as exc:
        print(f"LLM next-word suggestions unavailable: {exc}")
        return [], "unavailable"
