// SPDX-License-Identifier: GPL-2.0-or-later
//
// Search scoring shared by clipboard, emoji and symbols.
// Pure JS, Node-testable. No fuzzy magic that hides why something matched.

const MAX_QUERY = 80;

export function fold(value) {
    if (typeof value !== 'string')
        return '';
    try {
        return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    } catch {
        return value.toLowerCase();
    }
}

export function tokenize(query) {
    return fold(query)
        .slice(0, MAX_QUERY)
        .split(/\s+/u)
        .map(t => t.trim())
        .filter(t => t.length > 0)
        .slice(0, 8);
}

function isSubsequence(needle, haystack) {
    let i = 0;
    for (let j = 0; j < haystack.length && i < needle.length; j++) {
        if (haystack[j] === needle[i])
            i++;
    }
    return i === needle.length;
}

/**
 * Score one term against one field.
 * 1000 exact · 600 prefix · 450 word prefix · 250 substring · 40–120 fuzzy
 */
export function matchScore(term, text) {
    if (!term)
        return 0;
    const needle = fold(term);
    const hay = fold(text);
    if (!needle || !hay)
        return 0;
    if (hay === needle)
        return 1000;

    let best = 0;
    if (hay.startsWith(needle))
        best = 600;

    const wordIndex = hay.search(new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}`, 'u'));
    if (wordIndex >= 0)
        best = Math.max(best, 450);

    const index = hay.indexOf(needle);
    if (index >= 0) {
        // Earlier matches are better, and a match in a short field is stronger.
        const early = Math.max(0, 60 - index);
        best = Math.max(best, 250 + early);
    }

    if (best === 0 && needle.length >= 2 && needle.length <= 12 && isSubsequence(needle, hay)) {
        const ratio = needle.length / Math.max(1, hay.length);
        best = 40 + Math.round(ratio * 80);
    }
    return best;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string[]} terms
 * @param {Array<{text: string, weight?: number}>} fields
 * @returns {number} 0 when any term is missing
 */
export function scoreFields(terms, fields) {
    if (!terms.length)
        return 0;
    let total = 0;
    for (const term of terms) {
        let best = 0;
        for (const field of fields) {
            if (!field?.text)
                continue;
            const score = matchScore(term, field.text) * (field.weight ?? 1);
            if (score > best)
                best = score;
        }
        if (best === 0)
            return 0;
        total += best;
    }
    return total;
}

/**
 * Generic item search. `fields(item)` supplies searchable text.
 * @template T
 * @param {T[]} items
 * @param {string} query
 * @param {(item: T) => Array<{text: string, weight?: number}>} fields
 * @param {{limit?: number, sort?: (a: T, b: T) => number}} [options]
 * @returns {T[]}
 */
export function searchItems(items, query, fields, options = {}) {
    const terms = tokenize(query);
    if (!terms.length)
        return [];
    const {limit = 200, sort} = options;
    const scored = [];
    for (const item of items) {
        const score = scoreFields(terms, fields(item));
        if (score > 0)
            scored.push({item, score});
    }
    scored.sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        return sort ? sort(a.item, b.item) : 0;
    });
    return scored.slice(0, limit).map(entry => entry.item);
}

/** Short, single-line excerpt for previews and toasts. */
export function excerpt(value, max = 120) {
    const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
    if (text.length <= max)
        return text;
    return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
