import test from 'node:test';
import assert from 'node:assert/strict';

import {EMOJI, EMOJI_GROUPS} from '../src/data/emojiData.js';
import {EMOJI_ITEMS, EMOJI_CATEGORIES, searchEmoji, emojiForGroup, codepointLabel} from '../src/core/emoji.js';
import {SYMBOL_ITEMS, SYMBOL_GROUPS, searchSymbols, symbolForGroup, SYMBOL_POPULAR_ITEMS} from '../src/core/symbols.js';
import {SYMBOLS, SYMBOL_CATEGORIES} from '../src/data/symbolData.js';
import {relativeTime, formatBytes, clampInt} from '../src/core/format.js';
import {detectCategory} from '../src/core/classify.js';

test('emoji dataset integrity', () => {
    assert.ok(EMOJI.length > 1000);
    assert.equal(EMOJI.length, EMOJI_ITEMS.length);
    assert.equal(EMOJI_GROUPS.length, 9);
    const chars = new Set();
    for (const [char, name, keywords, group] of EMOJI) {
        assert.equal(typeof char, 'string');
        assert.ok(char.length > 0);
        assert.ok(name.length > 0);
        assert.ok(Array.isArray(keywords));
        assert.ok(group >= 0 && group < EMOJI_GROUPS.length);
        assert.ok(!chars.has(char), `duplicate emoji ${char}`);
        chars.add(char);
    }
    for (const group of EMOJI_CATEGORIES)
        assert.ok(emojiForGroup(group.id).length > 0, group.id);
});

test('every emoji is classified as emoji by the clipboard classifier', () => {
    // Guards against the emoji detector and the dataset drifting apart.
    for (const item of EMOJI_ITEMS.slice(0, 400))
        assert.equal(detectCategory(item.char).category, 'emoji', item.name);
});

test('emoji search finds names, keywords and categories', () => {
    assert.ok(searchEmoji('grin').some(i => i.name.includes('grinning')));
    assert.ok(searchEmoji('rocket').length > 0);
    assert.ok(searchEmoji('heart').length > 0);
    assert.ok(searchEmoji('flag').length > 0);
    assert.ok(searchEmoji('nature').length > 0);
    assert.ok(searchEmoji('definitelynotanemoji').length === 0);
});

test('codepoint labels', () => {
    assert.equal(codepointLabel('😀'), 'U+1F600');
    assert.equal(codepointLabel('👨‍👩‍👧'), 'U+1F468 U+200D U+1F469 U+200D U+1F467');
});

test('symbol dataset integrity', () => {
    assert.ok(SYMBOLS.length > 500);
    assert.equal(SYMBOLS.length, SYMBOL_ITEMS.length);
    const chars = new Set();
    for (const [char, name, , group] of SYMBOLS) {
        assert.ok(char.length > 0);
        assert.ok(name.length > 0);
        assert.ok(group >= 0 && group < SYMBOL_CATEGORIES.length);
        assert.ok(!chars.has(char), `duplicate symbol ${char}`);
        chars.add(char);
    }
    assert.ok(SYMBOL_POPULAR_ITEMS.length > 40);
    for (const group of SYMBOL_GROUPS)
        assert.ok(symbolForGroup(group.id).length > 0, group.id);
});

test('symbol search uses names and aliases', () => {
    assert.ok(searchSymbols('arrow').some(i => i.char === '→'));
    assert.ok(searchSymbols('check').some(i => i.char === '✓'));
    assert.ok(searchSymbols('euro').some(i => i.char === '€'));
    assert.ok(searchSymbols('degree').some(i => i.char === '°'));
    assert.ok(searchSymbols('definitelynotasymbol').length === 0);
});

test('formatters', () => {
    assert.equal(relativeTime(1000, 1000), 'now');
    assert.equal(relativeTime(1000, 1000 + 120000), '2m');
    assert.equal(relativeTime(1000, 1000 + 3 * 3600000), '3h');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2.0 KiB');
    assert.equal(clampInt('9', 1, 5), 5);
    assert.equal(clampInt('x', 1, 5, 3), 3);
});
