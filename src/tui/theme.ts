export const theme = {
    accent: 'cyan',
    ok: 'green',
    warn: 'yellow',
    danger: 'red',
    dim: 'gray',
    border: 'gray',
    focusBorder: 'cyan',
} as const;

export type Tone = 'info' | 'ok' | 'warn' | 'error';

export const toneColor: Record<Tone, string> = {
    info: theme.accent,
    ok: theme.ok,
    warn: theme.warn,
    error: theme.danger,
};
