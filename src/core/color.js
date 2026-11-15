// SPDX-License-Identifier: GPL-2.0-or-later
//
// Colour parsing and formatting. Pure JS: no GI imports, Node-testable.
//
// Supported input (complete strings only):
//   #rgb #rgba #rrggbb #rrggbbaa
//   rgb(r, g, b) / rgba(r, g, b, a)
//   rgb(r g b / a) / rgba(r g b / a)   (CSS Color 4)
//   hsl(h, s%, l%) / hsla(h, s%, l%, a) and space/slash variants
//
// Components are stored as r/g/b 0..255 (float) and a 0..1.

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_RE = /^([a-z]+)\((.*)\)$/is;

export function clamp(value, min, max) {
    if (Number.isNaN(value))
        return min;
    return Math.min(max, Math.max(min, value));
}

function parseNumber(value, scale = 1) {
    if (typeof value !== 'string')
        return NaN;
    const trimmed = value.trim();
    if (!trimmed)
        return NaN;
    if (trimmed.endsWith('%'))
        return parseFloat(trimmed.slice(0, -1)) * scale / 100;
    return parseFloat(trimmed);
}

function parseAlpha(value) {
    if (value === undefined)
        return 1;
    const n = parseNumber(value, 1);
    return Number.isNaN(n) ? 1 : clamp(n, 0, 1);
}

function splitFunctional(body) {
    // Accept commas or CSS4 whitespace and an optional slash before alpha.
    let alphaPart;
    let main = body;
    const slash = body.lastIndexOf('/');
    if (slash >= 0) {
        alphaPart = body.slice(slash + 1);
        main = body.slice(0, slash);
    }

    let parts;
    if (main.includes(',')) {
        parts = main.split(',').map(s => s.trim()).filter(Boolean);
        if (alphaPart === undefined && parts.length === 4)
            alphaPart = parts.pop();
    } else {
        parts = main.trim().split(/\s+/u).filter(Boolean);
        if (alphaPart === undefined && parts.length === 4)
            alphaPart = parts.pop();
    }
    return {parts, alphaPart};
}

function hexToColor(hex) {
    const expanded = hex.length <= 4
        ? [...hex].map(c => c + c).join('')
        : hex;
    const r = parseInt(expanded.slice(0, 2), 16);
    const g = parseInt(expanded.slice(2, 4), 16);
    const b = parseInt(expanded.slice(4, 6), 16);
    const a = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
    return {r, g, b, a, source: 'hex'};
}

function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);

    if (s === 0) {
        const v = l * 255;
        return {r: v, g: v, b: v};
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = t => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return {r: hue(h / 360 + 1 / 3) * 255, g: hue(h / 360) * 255, b: hue(h / 360 - 1 / 3) * 255};
}

/**
 * Parse a complete colour literal.
 * @param {string} input
 * @returns {{r: number, g: number, b: number, a: number, source: string}|null}
 */
export function parseColor(input) {
    if (typeof input !== 'string')
        return null;
    const text = input.trim();
    if (!text || text.length > 128)
        return null;

    const hex = HEX_RE.exec(text);
    if (hex)
        return hexToColor(hex[1]);

    const fn = FUNC_RE.exec(text);
    if (!fn)
        return null;

    const name = fn[1].toLowerCase();
    const {parts, alphaPart} = splitFunctional(fn[2]);
    if (parts.length !== 3)
        return null;

    if (name === 'rgb' || name === 'rgba') {
        const r = parseNumber(parts[0], 255);
        const g = parseNumber(parts[1], 255);
        const b = parseNumber(parts[2], 255);
        if ([r, g, b].some(Number.isNaN))
            return null;
        return {
            r: clamp(r, 0, 255),
            g: clamp(g, 0, 255),
            b: clamp(b, 0, 255),
            a: parseAlpha(alphaPart),
            source: name,
        };
    }

    if (name === 'hsl' || name === 'hsla') {
        const h = parseNumber(parts[0]);
        const s = parseNumber(parts[1], 1);
        const l = parseNumber(parts[2], 1);
        if ([h, s, l].some(Number.isNaN))
            return null;
        const rgb = hslToRgb(h, s, l);
        return {...rgb, a: parseAlpha(alphaPart), source: name};
    }

    return null;
}

export function isColorLiteral(text) {
    return parseColor(text) !== null;
}

function byte(v) {
    return Math.round(clamp(v, 0, 255));
}

function alphaString(a, digits = 3) {
    const rounded = Number(clamp(a, 0, 1).toFixed(digits));
    return String(rounded);
}

export function toHex(color, {includeAlpha = color.a < 1, uppercase = true} = {}) {
    const r = byte(color.r).toString(16).padStart(2, '0');
    const g = byte(color.g).toString(16).padStart(2, '0');
    const b = byte(color.b).toString(16).padStart(2, '0');
    let hex = `#${r}${g}${b}`;
    if (includeAlpha)
        hex += byte(color.a * 255).toString(16).padStart(2, '0');
    return uppercase ? hex.toUpperCase() : hex.toLowerCase();
}

export function toRgb(color) {
    return `rgb(${byte(color.r)}, ${byte(color.g)}, ${byte(color.b)})`;
}

export function toRgba(color, digits = 3) {
    return `rgba(${byte(color.r)}, ${byte(color.g)}, ${byte(color.b)}, ${alphaString(color.a, digits)})`;
}

export function toHsl(color) {
    const {r, g, b} = normalize(color);
    const rf = r / 255;
    const gf = g / 255;
    const bf = b / 255;
    const max = Math.max(rf, gf, bf);
    const min = Math.min(rf, gf, bf);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
        case rf: h = (gf - bf) / d + (gf < bf ? 6 : 0); break;
        case gf: h = (bf - rf) / d + 2; break;
        default: h = (rf - gf) / d + 4; break;
        }
        h *= 60;
    }
    return {h, s, l, a: color.a};
}

export function rgbToHsv(color) {
    const r = clamp(color.r, 0, 255) / 255;
    const g = clamp(color.g, 0, 255) / 255;
    const b = clamp(color.b, 0, 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        switch (max) {
        case r: h = ((g - b) / d) % 6; break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4; break;
        }
        h *= 60;
        if (h < 0) h += 360;
    }
    return {h, s: max === 0 ? 0 : d / max, v: max, a: color.a};
}

export function hsvToRgb({h, s, v, a = 1}) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1);
    v = clamp(v, 0, 1);
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let rp = 0;
    let gp = 0;
    let bp = 0;
    if (h < 60) [rp, gp, bp] = [c, x, 0];
    else if (h < 120) [rp, gp, bp] = [x, c, 0];
    else if (h < 180) [rp, gp, bp] = [0, c, x];
    else if (h < 240) [rp, gp, bp] = [0, x, c];
    else if (h < 300) [rp, gp, bp] = [x, 0, c];
    else [rp, gp, bp] = [c, 0, x];
    return {
        r: (rp + m) * 255,
        g: (gp + m) * 255,
        b: (bp + m) * 255,
        a: clamp(a, 0, 1),
    };
}

export function normalize(color) {
    return {
        r: byte(color.r),
        g: byte(color.g),
        b: byte(color.b),
        a: Number(clamp(color.a ?? 1, 0, 1).toFixed(3)),
    };
}

export function equalColor(a, b) {
    return normalize(a).r === normalize(b).r &&
        normalize(a).g === normalize(b).g &&
        normalize(a).b === normalize(b).b &&
        Math.abs((a.a ?? 1) - (b.a ?? 1)) < 0.002;
}

export function relativeLuminance(color) {
    const channel = v => {
        const c = clamp(v, 0, 255) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** Black or white, whichever is readable on the colour. */
export function readableTextColor(color) {
    return relativeLuminance(color) > 0.45 ? '#000000' : '#ffffff';
}

/** Parse a colour typed by the user, falling back to a default. */
export function parseOr(color, fallback) {
    return parseColor(color) ?? fallback;
}

/** CSS rgba() for St styles (St needs a valid CSS colour). */
export function toCss(color) {
    return toRgba(color, 3);
}
