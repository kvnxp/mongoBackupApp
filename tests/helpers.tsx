import React, { ReactNode } from 'react';
import { render } from 'ink-testing-library';
import { AppContext, AppContextValue } from '../src/tui/context';
import { Route } from '../src/tui/routes';

export const KEY = {
    enter: '\r',
    esc: '\x1b',
    tab: '\t',
    up: '\x1b[A',
    down: '\x1b[B',
    right: '\x1b[C',
    left: '\x1b[D',
    space: ' ',
    ctrlC: '\x03',
    backspace: '\x7f',
};

export const tick = (ms = 30) => Bun.sleep(ms);

export async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (check()) return;
        await tick(15);
    }
    throw new Error('waitFor: condition not met');
}

export type TestContext = AppContextValue & { routes: Route[]; statuses: string[]; quitCalled: () => boolean };

export function makeContext(overrides: Partial<AppContextValue> = {}): TestContext {
    const routes: Route[] = [];
    const statuses: string[] = [];
    let quit = false;
    const ctx: TestContext = {
        session: null,
        backupRoot: '/tmp/backups',
        status: null,
        setStatus: (text) => { statuses.push(text); },
        clearStatus: () => {},
        navigate: (r) => { routes.push(r); },
        connect: async () => {},
        disconnect: async () => {},
        quit: () => { quit = true; },
        setInterruptHandler: () => {},
        ...overrides,
        routes,
        statuses,
        quitCalled: () => quit,
    };
    return ctx;
}

export function renderWithContext(node: ReactNode, ctx: AppContextValue) {
    return render(<AppContext.Provider value={ctx}>{node}</AppContext.Provider>);
}

/** Sends keys one by one, letting React process each. */
export async function press(stdin: { write: (data: string) => void }, ...keys: string[]): Promise<void> {
    for (const k of keys) {
        stdin.write(k);
        await tick();
    }
}
