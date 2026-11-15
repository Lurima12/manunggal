// SPDX-License-Identifier: GPL-2.0-or-later
//
// Conservative clipboard classification. Pure JS, Node-testable.
//
// Categories are suggestions. The UI always offers a manual override, and
// ambiguous content stays "text" rather than pretending to be code.

import {parseColor} from './color.js';

const EMOJI_SEQUENCE_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3|\uFE0F|\u200D|\p{Emoji_Modifier})+$/u;
const EMOJI_CORE_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u;

const CODE_KEYWORDS = new RegExp(
    '\\b(?:function|const|let|var|class|interface|enum|struct|impl|def|lambda|import|export|' +
    'from|return|yield|async|await|public|private|protected|static|void|int|float|double|' +
    'string|bool|boolean|null|nil|true|false|if|else|elif|for|while|switch|case|break|' +
    'continue|try|catch|except|finally|throw|raise|new|delete|typeof|instanceof|package|' +
    'using|namespace|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WHERE|JOIN|#!/)\\b',
    '');

function graphemeCount(text) {
    try {
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
            return [...segmenter.segment(text)].length;
        }
    } catch {
        // Fall through to code-point counting.
    }
    return [...text].length;
}

/**
 * True when the string is made only of emoji sequences.
 * Letters, digits, punctuation and whitespace make it false.
 */
export function isEmojiOnly(text) {
    if (typeof text !== 'string')
        return false;
    const value = text.trim();
    if (!value || value.length > 96)
        return false;
    if (!EMOJI_SEQUENCE_RE.test(value))
        return false;
    if (!EMOJI_CORE_RE.test(value))
        return false;
    // A short string of emoji is an emoji entry. Very long runs are usually a
    // list or decorative text; keep those as text.
    return graphemeCount(value) <= 12;
}

function codeScore(text) {
    let score = 0;
    const reasons = [];
    const add = (n, reason) => {
        score += n;
        if (reason) reasons.push(reason);
    };

    const trimmed = text.trim();
    if (!trimmed)
        return {score: 0, reasons};

    // JSON (only if it parses), a very strong signal.
    if (/^[{[]/.test(trimmed)) {
        try {
            JSON.parse(trimmed);
            add(5, 'json');
        } catch {
            // Not JSON; other heuristics may still apply.
        }
    }

    const lines = trimmed.split('\n');
    if (lines.length >= 2)
        add(1, 'multiline');

    if (/^\s{2,}\S/m.test(trimmed) || /\t/m.test(trimmed))
        add(1, 'indentation');

    const punct = trimmed.match(/[{}();]/g);
    if (punct) {
        const density = punct.length / Math.max(1, trimmed.length);
        if (density > 0.015)
            add(2, 'punctuation');
        else if (punct.length >= 2)
            add(1, 'punctuation');
    }

    if (CODE_KEYWORDS.test(trimmed))
        add(2, 'keyword');

    if (/<\/?[a-z][\w:-]*(\s+[\w:-]+(=|>)|>)/i.test(trimmed))
        add(4, 'markup');

    if (/^(?:#!\/|[$#>]\s+\S)/m.test(trimmed))
        add(3, 'shell');

    if (/=>|->|::|:=|===|!==|&&|\|\||\+\+|--/.test(trimmed))
        add(1, 'operator');

    // A URL is not code even if it contains slashes and dots.
    if (/^(?:https?|ftp):\/\/\S+$/i.test(trimmed))
        score -= 3;

    // Prose with a single short sentence should stay text.
    if (lines.length === 1 && trimmed.length < 48 &&
        !/[{}();=<>[\]/\\]|^\s{2,}/.test(trimmed))
        score -= 2;

    return {score: Math.max(0, score), reasons};
}

export function looksLikeCode(text) {
    if (typeof text !== 'string')
        return {isCode: false, confidence: 0, reasons: []};
    const value = text.trim();
    if (!value || value.length > 100000)
        return {isCode: false, confidence: 0, reasons: []};

    const {score, reasons} = codeScore(value);
    const isCode = score >= 4;
    return {
        isCode,
        confidence: Math.min(1, score / 8),
        reasons,
    };
}

/**
 * @param {string} text
 * @param {{colors?: boolean, emoji?: boolean, code?: boolean}} [options]
 * @returns {{category: 'color'|'emoji'|'code'|'text', confidence: number}}
 */
export function detectCategory(text, options = {}) {
    const {colors = true, emoji = true, code = true} = options;
    if (typeof text !== 'string' || !text.trim())
        return {category: 'text', confidence: 0};

    if (colors && parseColor(text))
        return {category: 'color', confidence: 1};

    if (emoji && isEmojiOnly(text))
        return {category: 'emoji', confidence: 1};

    if (code) {
        const result = looksLikeCode(text);
        if (result.isCode)
            return {category: 'code', confidence: result.confidence};
    }

    return {category: 'text', confidence: 0};
}

export function effectiveCategory(entry) {
    return entry?.categoryOverride ?? entry?.category ?? 'text';
}
