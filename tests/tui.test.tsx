import React, { useState } from 'react';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { ListView, TextInput } from '../src/tui/components';
import { clampIndex, visibleWindow } from '../src/tui/useListNav';
import { CollectionPicker, PickerCollection, selectionStats } from '../src/tui/CollectionPicker';
import { RunScreen } from '../src/tui/screens/RunScreen';
import { ConnectionsScreen } from '../src/tui/screens/ConnectionsScreen';
import { selectionToTasks } from '../src/tui/screens/BackupScreens';
import { JobEvents, JobSummary, Task } from '../src/jobs';
import { JobSpec, Selection } from '../src/tui/routes';
import { KEY, makeContext, press, renderWithContext, tick, waitFor } from './helpers';

describe('list windowing', () => {
    test('visibleWindow keeps the cursor on screen', () => {
        expect(visibleWindow(5, 2, 10)).toEqual({ start: 0, end: 5 });
        expect(visibleWindow(100, 0, 10)).toEqual({ start: 0, end: 10 });
        expect(visibleWindow(100, 50, 10)).toEqual({ start: 45, end: 55 });
        expect(visibleWindow(100, 99, 10)).toEqual({ start: 90, end: 100 });
    });

    test('clampIndex', () => {
        expect(clampIndex(-1, 3)).toBe(0);
        expect(clampIndex(7, 3)).toBe(2);
        expect(clampIndex(5, 0)).toBe(0);
    });

    test('ListView renders only the visible rows of a long list', () => {
        const items = Array.from({ length: 5000 }, (_, i) => `item-${i}`);
        const { lastFrame } = render(<ListView items={items} cursor={2500} height={5} renderRow={(s) => <Text>{s}</Text>} />);
        const frame = lastFrame()!;
        expect(frame.split('\n')).toHaveLength(5);
        expect(frame).toContain('❯ item-2500');
        expect(frame).toContain('item-2498');
        expect(frame).not.toContain('item-0\n');
    });
});

describe('TextInput', () => {
    function Harness({ onSubmit }: { onSubmit: (v: string) => void }) {
        const [value, setValue] = useState('ab');
        return <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />;
    }

    test('types, deletes, clears and submits', async () => {
        let submitted = '';
        const { stdin, lastFrame } = render(<Harness onSubmit={v => { submitted = v; }} />);
        await press(stdin, 'c', 'd', KEY.backspace);
        expect(lastFrame()).toContain('abc');
        await press(stdin, '\x15', 'x', 'y', KEY.enter);
        expect(submitted).toBe('xy');
    });
});

const fakeCollections: Record<string, PickerCollection[]> = {
    shop: [
        { name: 'orders', detail: '10 docs', weight: 10 },
        { name: 'users', detail: '5 docs', weight: 5 },
    ],
    blog: [{ name: 'posts', detail: '7 docs', weight: 7 }],
};

describe('CollectionPicker', () => {
    const dbs = [{ name: 'blog', detail: '1 MB' }, { name: 'shop', detail: '2 MB' }];
    const load = async (db: string) => fakeCollections[db];

    test('space on a database selects all its collections; enter submits', async () => {
        const ctx = makeContext();
        let submitted: Selection | null = null;
        const { stdin, lastFrame } = renderWithContext(
            <CollectionPicker title="t" dbs={dbs} loadCollections={load} weightLabel={w => `${w} docs`} onBack={() => {}} onSubmit={s => { submitted = s; }} />,
            ctx,
        );
        await waitFor(() => lastFrame()!.includes('posts'));
        await press(stdin, KEY.down); // shop
        await waitFor(() => lastFrame()!.includes('orders'));
        await press(stdin, KEY.space);
        await waitFor(() => lastFrame()!.includes('2 collection(s) in 1 database(s) selected · 15 docs'));
        await press(stdin, KEY.enter);
        expect(submitted).not.toBeNull();
        expect([...submitted!.get('shop')!].sort()).toEqual(['orders', 'users']);
    });

    test('space again on a fully selected database clears it', async () => {
        const ctx = makeContext();
        const { stdin, lastFrame } = renderWithContext(
            <CollectionPicker title="t" dbs={dbs} loadCollections={load} weightLabel={w => `${w} docs`} onBack={() => {}} onSubmit={() => {}} />,
            ctx,
        );
        await waitFor(() => lastFrame()!.includes('posts'));
        await press(stdin, KEY.space);
        await waitFor(() => lastFrame()!.includes('[x] blog'));
        await press(stdin, KEY.space);
        await waitFor(() => lastFrame()!.includes('Nothing selected'));
        expect(lastFrame()).toContain('[ ] blog');
    });

    test('toggles single collections in the right pane', async () => {
        const ctx = makeContext();
        const { stdin, lastFrame } = renderWithContext(
            <CollectionPicker title="t" dbs={dbs} loadCollections={load} weightLabel={w => `${w} docs`} onBack={() => {}} onSubmit={() => {}} />,
            ctx,
        );
        await press(stdin, KEY.down);
        await waitFor(() => lastFrame()!.includes('orders'));
        await press(stdin, KEY.right, KEY.down, KEY.space);
        await waitFor(() => lastFrame()!.includes('1 collection(s) in 1 database(s) selected · 5 docs'));
        expect(lastFrame()).toContain('[-] shop');
        expect(lastFrame()).toContain('[x] users');
        expect(lastFrame()).toContain('[ ] orders');
    });

    test("'a' in the database pane selects everything, again clears", async () => {
        const ctx = makeContext();
        const { stdin, lastFrame } = renderWithContext(
            <CollectionPicker title="t" dbs={dbs} loadCollections={load} weightLabel={w => `${w} docs`} onBack={() => {}} onSubmit={() => {}} />,
            ctx,
        );
        await press(stdin, 'a');
        await waitFor(() => lastFrame()!.includes('3 collection(s) in 2 database(s) selected · 22 docs'));
        await press(stdin, 'a');
        await waitFor(() => lastFrame()!.includes('Nothing selected'));
    });

    test('enter with nothing selected warns instead of submitting; esc goes back', async () => {
        const ctx = makeContext();
        let back = false;
        let submitted = false;
        const { stdin } = renderWithContext(
            <CollectionPicker title="t" dbs={dbs} loadCollections={load} weightLabel={w => `${w}`} onBack={() => { back = true; }} onSubmit={() => { submitted = true; }} />,
            ctx,
        );
        await press(stdin, KEY.enter);
        expect(submitted).toBe(false);
        expect(ctx.statuses.at(-1)).toContain('Select at least one collection');
        await press(stdin, KEY.esc);
        expect(back).toBe(true);
    });

    test('selectionStats and selectionToTasks', () => {
        const cache = new Map(Object.entries(fakeCollections));
        const selection: Selection = new Map([['shop', new Set(['users', 'orders'])], ['blog', new Set(['posts'])]]);
        expect(selectionStats(selection, cache)).toEqual({ collections: 3, databases: 2, weight: 22 });
        expect(selectionToTasks(selection, cache)).toEqual([
            { db: 'blog', collection: 'posts', total: 7 },
            { db: 'shop', collection: 'orders', total: 10 },
            { db: 'shop', collection: 'users', total: 5 },
        ]);
    });
});

describe('RunScreen', () => {
    const tasks: Task[] = [
        { db: 'shop', collection: 'orders', total: 1000 },
        { db: 'shop', collection: 'users', total: 10 },
    ];

    function fakeJob(run: (signal: AbortSignal, events: JobEvents) => Promise<JobSummary>, onExit = () => {}): JobSpec {
        return { kind: 'backup', title: 'Backup · test', tasks, start: run, onExit };
    }

    test('shows progress and the final summary', async () => {
        let release!: () => void;
        const gate = new Promise<void>(r => { release = r; });
        let exited = false;
        const job = fakeJob(async (_signal, events) => {
            events.onPhase?.('running');
            events.onTaskStart?.(0);
            events.onTaskProgress?.(0, 500, 500);
            await gate;
            events.onTaskEnd?.(0, { status: 'done', docs: 1000 });
            events.onTaskStart?.(1);
            events.onTaskEnd?.(1, { status: 'error', error: 'boom' });
            events.onPhase?.('finished');
            return { results: [{ status: 'done', docs: 1000 }, { status: 'error', error: 'boom' }], docs: 1000, cancelled: false, elapsedMs: 1200, output: '/tmp/out' };
        }, () => { exited = true; });

        const { stdin, lastFrame } = renderWithContext(<RunScreen job={job} />, makeContext());
        await waitFor(() => lastFrame()!.includes('500 / ~1,000'));
        expect(lastFrame()).toContain('Backing up');
        release();
        await waitFor(() => lastFrame()!.includes('Finished with errors'));
        expect(lastFrame()).toContain('1 ok');
        expect(lastFrame()).toContain('1 failed');
        expect(lastFrame()).toContain('boom');
        expect(lastFrame()).toContain('/tmp/out');
        await press(stdin, KEY.enter);
        expect(exited).toBe(true);
    });

    test('esc asks to confirm; y aborts the job signal', async () => {
        let seenSignal: AbortSignal | null = null;
        const job = fakeJob((signal, events) => new Promise(resolve => {
            seenSignal = signal;
            events.onTaskStart?.(0);
            signal.addEventListener('abort', () => {
                events.onTaskEnd?.(0, { status: 'cancelled' });
                resolve({ results: [{ status: 'cancelled' }, { status: 'cancelled' }], docs: 0, cancelled: true, elapsedMs: 10 });
            });
        }));
        const { stdin, lastFrame } = renderWithContext(<RunScreen job={job} />, makeContext());
        await tick(50);
        await press(stdin, KEY.esc);
        await waitFor(() => lastFrame()!.includes('Cancel?'));
        expect(seenSignal!.aborted).toBe(false);
        await press(stdin, 'n');
        await waitFor(() => !lastFrame()!.includes('Cancel?'));
        await press(stdin, KEY.esc, 'y');
        await waitFor(() => lastFrame()!.includes('Cancelled'));
        expect(seenSignal!.aborted).toBe(true);
    });

    test('registers a Ctrl+C handler while running and removes it when finished', async () => {
        let handler: (() => void) | null = null;
        let finish!: () => void;
        const ctx = makeContext({ setInterruptHandler: h => { handler = h; } });
        const job = fakeJob(() => new Promise(resolve => {
            finish = () => resolve({ results: [], docs: 0, cancelled: false, elapsedMs: 1 });
        }));
        const { lastFrame } = renderWithContext(<RunScreen job={job} />, ctx);
        await tick(50);
        expect(handler).not.toBeNull();
        handler!();
        await waitFor(() => lastFrame()!.includes('Cancel?'));
        finish();
        await waitFor(() => handler === null);
    });
});

describe('ConnectionsScreen', () => {
    let home: string;
    const realHome = process.env.HOME;

    beforeAll(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'mbtest-home-'));
        process.env.HOME = home;
        fs.mkdirSync(path.join(home, '.mongobackupcli'));
        fs.writeFileSync(path.join(home, '.mongobackupcli', 'MBConfig.json'), JSON.stringify({
            dbList: [
                { name: 'alpha', url: 'mongodb://user:secret@alpha:27017' },
                { name: 'beta', url: 'mongodb://beta:27017' },
            ],
            config: { workingDir: '' },
        }));
    });

    afterAll(() => {
        process.env.HOME = realHome;
        fs.rmSync(home, { recursive: true, force: true });
    });

    test('lists connections with masked passwords', () => {
        const { lastFrame } = renderWithContext(<ConnectionsScreen />, makeContext());
        expect(lastFrame()).toContain('alpha');
        expect(lastFrame()).toContain('mongodb://user:****@alpha:27017');
        expect(lastFrame()).not.toContain('secret');
        expect(lastFrame()).toContain('+ New connection');
    });

    test('enter connects to the highlighted connection and goes home', async () => {
        const connected: string[] = [];
        const ctx = makeContext({ connect: async c => { connected.push(c.name); } });
        const { stdin } = renderWithContext(<ConnectionsScreen />, ctx);
        await press(stdin, KEY.down, KEY.enter);
        await waitFor(() => ctx.routes.length > 0);
        expect(connected).toEqual(['beta']);
        expect(ctx.routes.at(-1)).toEqual({ name: 'home' });
    });

    test('a failed connection shows the error and stays', async () => {
        const ctx = makeContext({ connect: async () => { throw new Error('ECONNREFUSED'); } });
        const { stdin } = renderWithContext(<ConnectionsScreen />, ctx);
        await press(stdin, KEY.enter);
        await waitFor(() => ctx.statuses.some(s => s.includes('ECONNREFUSED')));
        expect(ctx.routes).toEqual([]);
    });

    test('d asks for confirmation; n keeps it, y deletes it from the config file', async () => {
        const ctx = makeContext();
        const { stdin, lastFrame } = renderWithContext(<ConnectionsScreen />, ctx);
        await press(stdin, 'd', 'n');
        expect(lastFrame()).toContain('alpha');
        await press(stdin, 'd', 'y');
        await waitFor(() => !lastFrame()!.includes('alpha'));
        const saved = JSON.parse(fs.readFileSync(path.join(home, '.mongobackupcli', 'MBConfig.json'), 'utf8'));
        expect(saved.dbList.map((c: any) => c.name)).toEqual(['beta']);
    });

    test('q quits', async () => {
        const ctx = makeContext();
        const { stdin } = renderWithContext(<ConnectionsScreen />, ctx);
        await press(stdin, 'q');
        expect(ctx.quitCalled()).toBe(true);
    });
});
