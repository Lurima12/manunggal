// SPDX-License-Identifier: GPL-2.0-or-later
//
// Emoji data access. The dataset is generated at build time.

import {EMOJI, EMOJI_GROUPS} from '../data/emojiData.js';
import {searchItems} from './search.js';

export const EMOJI_CATEGORIES = EMOJI_GROUPS;

function decorate(tuple, index) {
    const [char, name, keywords, groupIndex, subgroup] = tuple;
    const group = EMOJI_GROUPS[groupIndex] ?? EMOJI_GROUPS[0];
    return {
        id: `e${index}`,
        char,
        name,
        keywords,
        keywordsText: keywords.join(' '),
        group: group.id,
        groupLabel: group.label,
        subgroup,
    };
}

export const EMOJI_ITEMS = EMOJI.map(decorate);

const BY_GROUP = new Map();
for (const item of EMOJI_ITEMS) {
    if (!BY_GROUP.has(item.group))
        BY_GROUP.set(item.group, []);
    BY_GROUP.get(item.group).push(item);
}

export function emojiForGroup(groupId) {
    return BY_GROUP.get(groupId) ?? [];
}

export function emojiByChar(char) {
    return EMOJI_ITEMS.find(item => item.char === char) ?? null;
}

export function searchEmoji(query, limit = 200) {
    return searchItems(EMOJI_ITEMS, query, item => [
        {text: item.char, weight: 3},
        {text: item.name, weight: 2},
        {text: item.keywordsText, weight: 1},
        {text: item.groupLabel, weight: 0.5},
        {text: item.subgroup, weight: 0.4},
    ], {
        limit,
        sort: (a, b) => a.name.length - b.name.length,
    });
}

export function groupCount(groupId) {
    return emojiForGroup(groupId).length;
}

/** Display name: "grinning face" → "Grinning face". */
export function displayName(item) {
    const name = item?.name ?? '';
    return name ? name[0].toUpperCase() + name.slice(1) : '';
}

export function codepointLabel(char) {
    return [...char]
        .map(c => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
        .join(' ');
}
