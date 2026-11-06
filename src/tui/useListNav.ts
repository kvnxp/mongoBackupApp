import { useEffect, useState } from 'react';
import { useInput } from 'ink';

/** Visible window [start, end) that keeps `cursor` on screen. */
export function visibleWindow(count: number, cursor: number, height: number): { start: number; end: number } {
    const size = Math.max(1, height);
    if (count <= size) return { start: 0, end: count };
    const start = Math.min(Math.max(0, cursor - Math.floor(size / 2)), count - size);
    return { start, end: start + size };
}

export function clampIndex(index: number, count: number): number {
    return count === 0 ? 0 : Math.min(Math.max(0, index), count - 1);
}

/**
 * Keyboard navigation for a list: ↑/↓ (k/j), PgUp/PgDn, Home/End (g/G).
 * Keeps the cursor inside the list when it shrinks.
 */
export function useListNav(count: number, options: { isActive?: boolean; pageSize?: number; initial?: number } = {}) {
    const { isActive = true, pageSize = 10, initial = 0 } = options;
    const [cursor, setCursor] = useState(() => clampIndex(initial, count));

    useEffect(() => {
        setCursor(c => clampIndex(c, count));
    }, [count]);

    useInput((input, key) => {
        if (count === 0) return;
        if (key.upArrow || input === 'k') setCursor(c => (c > 0 ? c - 1 : count - 1));
        else if (key.downArrow || input === 'j') setCursor(c => (c < count - 1 ? c + 1 : 0));
        else if (key.pageUp) setCursor(c => clampIndex(c - pageSize, count));
        else if (key.pageDown) setCursor(c => clampIndex(c + pageSize, count));
        else if (key.home || input === 'g') setCursor(0);
        else if (key.end || input === 'G') setCursor(count - 1);
    }, { isActive });

    return { cursor, setCursor };
}
