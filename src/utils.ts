export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function formatNumber(n: number): string {
    return n.toLocaleString('en-US');
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatDate(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Hides the password of a MongoDB URI: mongodb://user:****@host */
export function maskUri(uri: string): string {
    const m = uri.match(/^(mongodb(?:\+srv)?:\/\/)([^/?]*)(.*)$/);
    if (!m) return uri;
    const [, scheme, authority, rest] = m;
    // The host starts after the last '@', so a password containing '@' is fully hidden
    const at = authority.lastIndexOf('@');
    const colon = authority.indexOf(':');
    if (at < 0 || colon < 0 || colon > at) return uri;
    return `${scheme}${authority.slice(0, colon + 1)}****${authority.slice(at)}${rest}`;
}

/** Valid backup project name: non-empty, no path separators, not "." or "..". */
export function isValidProjectName(name: string): boolean {
    const trimmed = name.trim();
    return trimmed.length > 0 && !/[\/\\]/.test(trimmed) && trimmed !== '.' && trimmed !== '..';
}

export function defaultProjectName(now: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export class AbortError extends Error {
    constructor() {
        super('Cancelled');
        this.name = 'AbortError';
    }
}

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AbortError();
}
