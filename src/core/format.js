// SPDX-License-Identifier: GPL-2.0-or-later
//
// Small pure formatters. Node-testable.

export function relativeTime(timestamp, now = Date.now()) {
    if (!Number.isFinite(timestamp))
        return '';
    const delta = Math.max(0, now - timestamp);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (delta < 45 * 1000)
        return 'now';
    if (delta < hour)
        return `${Math.max(1, Math.round(delta / minute))}m`;
    if (delta < day)
        return `${Math.round(delta / hour)}h`;
    if (delta < 7 * day)
        return `${Math.round(delta / day)}d`;
    if (delta < 365 * day)
        return `${Math.round(delta / (7 * day))}w`;
    return `${Math.round(delta / (365 * day))}y`;
}

export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0)
        return '';
    if (bytes < 1024)
        return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function plural(value, singular, pluralForm) {
    return value === 1 ? singular : (pluralForm ?? `${singular}s`);
}

export function pad2(value) {
    return String(Math.max(0, Math.min(255, Math.round(value)))).padStart(2, '0');
}

export function clampInt(value, min, max, fallback = min) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, n));
}

export function clampFloat(value, min, max, fallback = min) {
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, n));
}
