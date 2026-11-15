// SPDX-License-Identifier: GPL-2.0-or-later
//
// Symbol data access. The dataset is generated at build time; the "Popular"
// category is curated here because popularity is a product decision, not a
// Unicode property.

import {SYMBOLS, SYMBOL_CATEGORIES} from '../data/symbolData.js';
import {searchItems} from './search.js';

export const POPULAR_SYMBOLS = [
    '→', '←', '↑', '↓', '↔', '⇒', '⇔', '↩', '↪', '⤴', '⤵',
    '✓', '✔', '✗', '✘', '⚠', '★', '☆', '♥', '♡',
    '•', '·', '…', '–', '—', '“', '”', '‘', '’', '«', '»',
    '©', '®', '™', '°', '±', '×', '÷', '≠', '≈', '≤', '≥', '∞',
    '€', '£', '¥', '$', '¢', '₹', '₽', '₿',
    '§', '¶', '†', '‡', '№', 'µ', '½', '¼', '¾',
    '⌘', '⌥', '⇧', '⏎', '⌫', '⌦', '⎋', '⌃',
    '♪', '♫', '♬', '☀', '☁', '☂', '☕', '☎', '✈', '⚑', '⚙', '⚡',
];

function decorate(tuple, index) {
    const [char, name, keywords, categoryIndex] = tuple;
    const category = SYMBOL_CATEGORIES[categoryIndex] ?? SYMBOL_CATEGORIES[0];
    return {
        id: `s${index}`,
        char,
        name,
        keywords,
        keywordsText: keywords.join(' '),
        group: category.id,
        groupLabel: category.label,
        subgroup: category.label,
    };
}

export const SYMBOL_ITEMS = SYMBOLS.map(decorate);

const byChar = new Map(SYMBOL_ITEMS.map(item => [item.char, item]));
export const SYMBOL_POPULAR_ITEMS = POPULAR_SYMBOLS
    .map(char => byChar.get(char))
    .filter(Boolean);

export const SYMBOL_GROUPS = [
    {id: 'popular', label: 'Popular', icon: 'starred-symbolic'},
    ...SYMBOL_CATEGORIES,
];

const BY_GROUP = new Map();
for (const item of SYMBOL_ITEMS) {
    if (!BY_GROUP.has(item.group))
        BY_GROUP.set(item.group, []);
    BY_GROUP.get(item.group).push(item);
}

export function symbolForGroup(groupId) {
    if (groupId === 'popular')
        return SYMBOL_POPULAR_ITEMS;
    return BY_GROUP.get(groupId) ?? [];
}

export function symbolByChar(char) {
    return byChar.get(char) ?? null;
}

export function searchSymbols(query, limit = 200) {
    return searchItems(SYMBOL_ITEMS, query, item => [
        {text: item.char, weight: 3},
        {text: item.name, weight: 2},
        {text: item.keywordsText, weight: 1.2},
        {text: item.groupLabel, weight: 0.5},
    ], {
        limit,
        sort: (a, b) => a.name.length - b.name.length,
    });
}

export function symbolDisplayName(item) {
    const name = item?.name ?? '';
    return name ? name[0].toUpperCase() + name.slice(1) : '';
}

export function symbolCodepoint(char) {
    return `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
}
