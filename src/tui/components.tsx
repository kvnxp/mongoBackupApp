import React, { ReactNode, useContext } from 'react';
import { Box, Text, useAnimation, useInput, usePaste, useWindowSize } from 'ink';
import { theme, toneColor } from './theme';
import { visibleWindow } from './useListNav';
import { AppContext } from './context';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner({ color = theme.accent }: { color?: string }) {
    const { frame } = useAnimation({ interval: 80 });
    return <Text color={color}>{SPINNER[frame % SPINNER.length]}</Text>;
}

export function ProgressBar({ ratio, width, color = theme.accent }: { ratio: number; width: number; color?: string }) {
    const w = Math.max(4, width);
    const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
    const filled = Math.round(r * w);
    return (
        <Text>
            <Text color={color}>{'█'.repeat(filled)}</Text>
            <Text color={theme.dim}>{'░'.repeat(w - filled)}</Text>
        </Text>
    );
}

export type Hint = [key: string, label: string];

export function KeyHints({ hints }: { hints: Hint[] }) {
    return (
        <Text wrap="truncate-end">
            {hints.map(([k, label], i) => (
                <Text key={k + label}>
                    {i > 0 ? <Text color={theme.dim}>  </Text> : null}
                    <Text color={theme.accent} bold>{k}</Text>
                    <Text color={theme.dim}> {label}</Text>
                </Text>
            ))}
        </Text>
    );
}

/**
 * Full screen layout: header, body (fills the terminal) and footer with key hints and status.
 */
export function Frame({ title, hints, children }: { title: string; hints: Hint[]; children: ReactNode }) {
    const { columns, rows } = useWindowSize();
    const ctx = useContext(AppContext);
    const right = ctx.session ? `● ${ctx.session.conn.name}` : '○ not connected';
    return (
        <Box flexDirection="column" width={columns} height={rows}>
            <Box paddingX={1} justifyContent="space-between">
                <Text wrap="truncate-end">
                    <Text bold color="black" backgroundColor={theme.accent}> MongoBackupApp </Text>
                    <Text color={theme.dim}>  ›  </Text>
                    <Text bold>{title}</Text>
                </Text>
                <Text color={ctx.session ? theme.ok : theme.dim}>{right}</Text>
            </Box>
            <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
                {children}
            </Box>
            <Box paddingX={1} flexDirection="column">
                <Text color={ctx.status ? toneColor[ctx.status.tone] : theme.dim} wrap="truncate-end">
                    {ctx.status ? ctx.status.text : ' '}
                </Text>
                <KeyHints hints={hints} />
            </Box>
        </Box>
    );
}

/** Bordered box with a title row; highlighted when focused. */
export function Pane({ title, right, focused = false, width, flexGrow, height, children, borderColor }: {
    title: string;
    right?: string;
    focused?: boolean;
    width?: number | string;
    flexGrow?: number;
    height?: number;
    borderColor?: string;
    children: ReactNode;
}) {
    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={borderColor ?? (focused ? theme.focusBorder : theme.border)}
            paddingX={1}
            width={width as any}
            flexGrow={flexGrow}
            height={height}
            overflow="hidden"
        >
            <Box justifyContent="space-between">
                <Box flexShrink={1} overflow="hidden">
                    <Text bold color={focused ? theme.accent : undefined} wrap="truncate-middle">{title}</Text>
                </Box>
                {right ? <Box flexShrink={0} marginLeft={1}><Text color={theme.dim}>{right}</Text></Box> : null}
            </Box>
            {children}
        </Box>
    );
}

/**
 * Virtualized list: only the rows that fit in `height` are rendered,
 * so long lists (thousands of collections) stay fast.
 */
export function ListView<T>({ items, cursor, height, renderRow, emptyText = 'Empty', showCursor = true }: {
    items: T[];
    cursor: number;
    height: number;
    renderRow: (item: T, index: number, isCursor: boolean) => ReactNode;
    emptyText?: string;
    showCursor?: boolean;
}) {
    if (items.length === 0) {
        return <Text color={theme.dim}>{emptyText}</Text>;
    }
    const { start, end } = visibleWindow(items.length, cursor, height);
    const rows: ReactNode[] = [];
    for (let i = start; i < end; i++) {
        const isCursor = showCursor && i === cursor;
        rows.push(
            <Box key={i}>
                <Text color={theme.accent}>{isCursor ? '❯ ' : '  '}</Text>
                <Box flexGrow={1}>{renderRow(items[i], i, isCursor)}</Box>
            </Box>,
        );
    }
    return <Box flexDirection="column">{rows}</Box>;
}

/** "3/120" position label for pane titles. */
export function position(cursor: number, count: number): string {
    return count === 0 ? '0/0' : `${cursor + 1}/${count}`;
}

/**
 * Single line text input. Typing, paste, Backspace, Ctrl+U (clear), Ctrl+W (delete word).
 * Arrows, Tab and Esc are left to the parent.
 */
export function TextInput({ value, onChange, onSubmit, placeholder = '', isActive = true, mask = false }: {
    value: string;
    onChange: (value: string) => void;
    onSubmit?: (value: string) => void;
    placeholder?: string;
    isActive?: boolean;
    mask?: boolean;
}) {
    useInput((input, key) => {
        if (key.return) {
            onSubmit?.(value);
        } else if (key.backspace || key.delete) {
            onChange(value.slice(0, -1));
        } else if (key.ctrl && input === 'u') {
            onChange('');
        } else if (key.ctrl && input === 'w') {
            onChange(value.replace(/\S+\s*$/, ''));
        } else if (input && !key.ctrl && !key.meta && !key.tab && !key.escape && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
            onChange(value + input.replace(/[\r\n]/g, ''));
        }
    }, { isActive });

    usePaste((text) => {
        onChange(value + text.replace(/[\r\n]/g, ''));
    }, { isActive });

    const shown = mask ? '•'.repeat(value.length) : value;
    return (
        <Text wrap="truncate-start">
            {shown.length === 0 && placeholder ? <Text color={theme.dim}>{placeholder}</Text> : <Text>{shown}</Text>}
            {isActive ? <Text inverse> </Text> : null}
        </Text>
    );
}

export function Checkbox({ state }: { state: 'all' | 'some' | 'none' }) {
    if (state === 'all') return <Text color={theme.ok}>[x]</Text>;
    if (state === 'some') return <Text color={theme.warn}>[-]</Text>;
    return <Text color={theme.dim}>[ ]</Text>;
}

/**
 * Row with a left text and a right aligned detail.
 * Default: the left side truncates and the detail keeps its width (lists).
 * With `labelWidth`: the left is a fixed width label and the detail truncates from the start (long paths).
 */
export function Row({ left, right, color, bold, dimRight = true, labelWidth }: {
    left: ReactNode;
    right?: ReactNode;
    color?: string;
    bold?: boolean;
    dimRight?: boolean;
    labelWidth?: number;
}) {
    return (
        <Box flexGrow={1} justifyContent="space-between">
            <Box flexShrink={labelWidth ? 0 : 1} flexGrow={labelWidth ? 0 : 1} width={labelWidth} overflow="hidden">
                <Text color={color} bold={bold} wrap="truncate-end">{left}</Text>
            </Box>
            {right !== undefined ? (
                <Box flexShrink={labelWidth ? 1 : 0} marginLeft={1} overflow="hidden">
                    <Text color={dimRight ? theme.dim : undefined} wrap={labelWidth ? 'truncate-start' : 'truncate-end'}>{right}</Text>
                </Box>
            ) : null}
        </Box>
    );
}
