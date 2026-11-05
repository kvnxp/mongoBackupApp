/**
 * Cleanups that must run even if the user quits abruptly (e.g. extracted temp dirs).
 * They are run on quit and on process exit; each one runs at most once.
 */
const cleanups = new Set<() => void>();

export function registerCleanup(fn: () => void): () => void {
    cleanups.add(fn);
    return () => cleanups.delete(fn);
}

export function runCleanups(): void {
    for (const fn of [...cleanups]) {
        cleanups.delete(fn);
        try {
            fn();
        } catch {
            // best effort
        }
    }
}

process.on('exit', runCleanups);
