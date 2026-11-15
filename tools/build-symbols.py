#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""
Regenerates src/data/symbolData.js.

The set is intentionally curated: common, monochrome Unicode symbols that are
safe to insert into text. Emoji-style characters are excluded so the Symbol tab
does not duplicate the Emoji tab. Names come from Python's unicodedata and are
augmented with a small alias list for words people actually search for.

Usage: python3 tools/build-symbols.py
"""

import json
import os
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "data", "symbolData.js")

CATEGORIES = [
    ("arrows", "Arrows", "go-next-symbolic"),
    ("math", "Math", "accessories-calculator-symbolic"),
    ("currency", "Currency", "emblem-money-symbolic"),
    ("punctuation", "Punctuation", "font-x-generic-symbolic"),
    ("letterlike", "Letterlike", "font-x-generic-symbolic"),
    ("geometric", "Shapes", "view-grid-symbolic"),
    ("technical", "Technical", "applications-engineering-symbolic"),
    ("box", "Box drawing", "view-grid-symbolic"),
    ("dingbats", "Dingbats", "starred-symbolic"),
    ("misc", "Miscellaneous", "applications-other-symbolic"),
    ("fractions", "Fractions", "accessories-calculator-symbolic"),
    ("typography", "Typography", "font-x-generic-symbolic"),
    ("superscript", "Super & sub", "font-x-generic-symbolic"),
]

RANGES = [
    ("arrows", [(0x2190, 0x21FF), (0x27F0, 0x27FF), (0x2900, 0x297F), (0x2B00, 0x2B3F)]),
    ("math", [(0x2200, 0x22FF)]),
    ("currency", [(0x20A0, 0x20C0)]),
    ("punctuation", [(0x2000, 0x206F), (0x3000, 0x303F)]),
    ("letterlike", [(0x2100, 0x214F)]),
    ("geometric", [(0x25A0, 0x25FF)]),
    ("technical", [(0x2300, 0x23FF)]),
    ("box", [(0x2500, 0x257F)]),
    ("dingbats", [(0x2700, 0x27BF)]),
    ("misc", [(0x2600, 0x26FF)]),
    
    ("fractions", [(0x00BC, 0x00BE), (0x2150, 0x215F)]),
    ("typography", [(0x00A9, 0x00BF)]),
    ("superscript", [(0x2070, 0x209F)]),
]

# Words people search for that do not appear in the Unicode name.
ALIASES = {
    "→": ["right", "arrow", "next"],
    "←": ["left", "arrow", "back"],
    "↑": ["up", "arrow"],
    "↓": ["down", "arrow"],
    "↔": ["left", "right", "arrow", "swap"],
    "⇒": ["implies", "then", "arrow"],
    "⇐": ["implied by", "arrow"],
    "⇔": ["if and only if", "iff", "arrow"],
    "✓": ["check", "tick", "done", "yes", "ok"],
    "✔": ["check", "tick", "done", "yes", "ok"],
    "✗": ["cross", "x", "no", "wrong"],
    "✘": ["cross", "x", "no", "wrong"],
    "★": ["star", "favourite", "favorite"],
    "☆": ["star", "outline", "empty"],
    "♥": ["heart", "love"],
    "♡": ["heart", "outline", "love"],
    "•": ["bullet", "dot", "list"],
    "…": ["ellipsis", "dots", "more"],
    "©": ["copyright"],
    "®": ["registered", "trademark"],
    "™": ["trademark"],
    "°": ["degree", "temperature"],
    "±": ["plus", "minus", "plus-minus"],
    "×": ["multiply", "times", "multiplication"],
    "÷": ["divide", "division"],
    "≠": ["not equal", "unequal"],
    "≤": ["less than", "equal", "at most"],
    "≥": ["greater than", "equal", "at least"],
    "≈": ["approximately", "about"],
    "∞": ["infinity", "endless"],
    "€": ["euro", "currency"],
    "£": ["pound", "currency"],
    "¥": ["yen", "yuan", "currency"],
    "$": ["dollar", "currency"],
    "¢": ["cent", "currency"],
    "₹": ["rupee", "currency"],
    "₽": ["ruble", "currency"],
    "₿": ["bitcoin", "currency"],
    "§": ["section", "paragraph"],
    "¶": ["pilcrow", "paragraph"],
    "†": ["dagger", "footnote"],
    "‡": ["double dagger", "footnote"],
    "№": ["numero", "number"],
    "µ": ["micro", "mu"],
    "½": ["half", "one half"],
    "¼": ["quarter", "one quarter"],
    "¾": ["three quarters"],
    "⅓": ["third", "one third"],
    "⅔": ["two thirds"],
    "–": ["en dash", "dash"],
    "—": ["em dash", "dash"],
    "‘": ["quote", "single", "left"],
    "’": ["quote", "single", "right", "apostrophe"],
    "“": ["quote", "double", "left"],
    "”": ["quote", "double", "right"],
    "«": ["quote", "guillemet", "left"],
    "»": ["quote", "guillemet", "right"],
    "¡": ["exclamation", "inverted"],
    "¿": ["question", "inverted"],
    "·": ["middle dot", "interpunct"],
    "‽": ["interrobang", "question", "exclamation"],
    "⌘": ["command", "cmd", "key"],
    "⌥": ["option", "alt", "key"],
    "⇧": ["shift", "key"],
    "⏎": ["return", "enter", "key"],
    "⌫": ["backspace", "delete", "key"],
    "⌦": ["delete", "forward", "key"],
    "⎋": ["escape", "esc", "key"],
    "⌃": ["control", "ctrl", "key"],
    "──": ["line", "box drawing"],
}


def is_usable(ch: str, emoji_chars: set[str]) -> bool:
    if ch in emoji_chars:
        return False
    cat = unicodedata.category(ch)
    if cat[0] in "CZ" or cat in ("Mn", "Me"):
        return False
    if ch.isspace():
        return False
    # Control pictures and similar non-printing helpers are not useful in text.
    if 0x2400 <= ord(ch) <= 0x245F:
        return False
    return True


def name_for(ch: str) -> str:
    try:
        name = unicodedata.name(ch)
    except ValueError:
        return ""
    return name.lower()


def keywords_for(ch: str, name: str) -> list[str]:
    words = [w for w in name.replace("-", " ").split() if len(w) > 1]
    words += ALIASES.get(ch, [])
    seen = set()
    out = []
    for w in words:
        w = w.lower()
        if w and w not in seen:
            seen.add(w)
            out.append(w)
    return out


def main() -> int:
    emoji_path = os.path.join(HERE, "..", "src", "data", "emojiData.js")
    emoji_chars = set()
    if os.path.exists(emoji_path):
        import re
        text = open(emoji_path, encoding="utf-8").read()
        for line in text.splitlines():
            m = re.match(r'^    \["(.*?)",', line)
            if m:
                emoji_chars.add(m.group(1))

    categories = []
    entries = []
    seen = set()
    cat_index = {c[0]: i for i, c in enumerate(CATEGORIES)}
    for cat_id, ranges in RANGES:
        for lo, hi in ranges:
            for cp in range(lo, hi + 1):
                ch = chr(cp)
                if ch in seen or not is_usable(ch, emoji_chars):
                    continue
                name = name_for(ch)
                if not name:
                    continue
                seen.add(ch)
                entries.append([ch, name, keywords_for(ch, name), cat_index[cat_id]])

    # Keep the category order and drop empty categories.
    used = {e[3] for e in entries}
    keep = [i for i in range(len(CATEGORIES)) if i in used]
    remap = {old: new for new, old in enumerate(keep)}
    cats = [CATEGORIES[i] for i in keep]
    for e in entries:
        e[3] = remap[e[3]]

    cat_lines = "\n".join(
        f'    {{id: {json.dumps(c[0])}, label: {json.dumps(c[1])}, icon: {json.dumps(c[2])}}},'
        for c in cats
    )
    rows = "\n".join(f"    {json.dumps(e, ensure_ascii=False)}," for e in entries)

    out = f"""// SPDX-License-Identifier: GPL-2.0-or-later
//
// Generated by tools/build-symbols.py. Do not edit by hand.
// Names derive from the Unicode Character Database (Unicode 15.1/16.0).
// See data/LICENSE-UNICODE.txt.
//
// Tuple layout: [character, name, search keywords, category index]

export const SYMBOL_CATEGORIES = [
{cat_lines}
];

export const SYMBOLS = [
{rows}
];
"""
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"symbols: {len(entries)} entries, {len(cats)} categories, {len(out) / 1024:.0f} KiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
