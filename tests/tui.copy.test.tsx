import React from 'react';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { MongoClient } from 'mongodb';
import { BackupOptionsScreen } from '../src/tui/screens/BackupScreens';
import { CopyConfirmScreen, CopyTargetScreen, copyTargets } from '../src/tui/screens/CopyScreens';
import { ConnectionFormScreen } from '../src/tui/screens/ConnectionFormScreen';
import { Session } from '../src/tui/context';
import { Route, Selection } from '../src/tui/routes';
import { Task } from '../src/jobs';
import { KEY, makeContext, press, renderWithContext, waitFor } from './helpers';

const source = { name: 'src', url: 'mongodb://src:27017' };
const fakeClient = {} as MongoClient;
const session: Session = { conn: source, client: fakeClient };
const tasks: Task[] = [
    { db: 'shop', collection: 'orders', total: 10 },
    { db: 'shop', collection: 'users', total: 5 },
];
const selection: Selection = new Map([['shop', new Set(['orders', 'users'])]]);

beforeAll(() => {
    const dir = path.join(process.env.HOME!, '.mongobackupcli');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'MBConfig.json'), JSON.stringify({
        dbList: [source, { name: 'staging', url: 'mongodb://u:pw@staging:27017' }, { name: 'alias-of-src', url: 'mongodb://src:27017' }, { name: 'prod', url: 'mongodb://prod:27017' }],
        config: { workingDir: '' },
    }));
});
afterAll(() => fs.rmSync(path.join(process.env.HOME!, '.mongobackupcli'), { recursive: true, force: true }));

describe('copyTargets', () => {
    test('excludes the source by name and by URL', () => {
        const conns = [source, { name: 'a', url: 'mongodb://a' }, { name: 'b', url: source.url }];
        expect(copyTargets(conns, source).map(c => c.name)).toEqual(['a']);
    });
});

describe('BackupOptionsScreen destination', () => {
    test('choosing "Another server" hides file options and enter goes to the server list', async () => {
        const ctx = makeContext({ session });
        const { stdin, lastFrame } = renderWithContext(<BackupOptionsScreen selection={selection} tasks={tasks} />, ctx);
        expect(lastFrame()).toContain('Format');
        await press(stdin, KEY.right);
        await waitFor(() => !lastFrame()!.includes('Format'));
        expect(lastFrame()).toContain('Another server');
        await press(stdin, KEY.enter);
        expect(ctx.routes.at(-1)).toEqual({ name: 'copyTarget', selection, tasks });
    });

    test('files destination keeps the backup flow (name -> format -> run)', async () => {
        const ctx = makeContext({ session });
        const { stdin } = renderWithContext(<BackupOptionsScreen selection={selection} tasks={tasks} />, ctx);
        await press(stdin, KEY.enter, KEY.enter, KEY.enter);
        const route = ctx.routes.at(-1) as Extract<Route, { name: 'run' }>;
        expect(route.name).toBe('run');
        expect(route.job.kind).toBe('backup');
    });
});

describe('CopyTargetScreen', () => {
    test('lists the other servers (not the source), masked, plus "new connection"', () => {
        const { lastFrame } = renderWithContext(<CopyTargetScreen selection={selection} tasks={tasks} />, makeContext({ session }));
        const frame = lastFrame()!;
        expect(frame).toContain('staging');
        expect(frame).toContain('prod');
        expect(frame).toContain('mongodb://u:****@staging:27017');
        expect(frame).not.toContain('alias-of-src');
        expect(frame).toContain('+ New connection');
        expect(frame).toContain('Copy 2 collection(s) from src');
    });

    test('preselect highlights a connection', () => {
        const { lastFrame } = renderWithContext(<CopyTargetScreen selection={selection} tasks={tasks} preselect="prod" />, makeContext({ session }));
        expect(lastFrame()).toContain('❯ prod');
    });

    test('n opens the connection form and returns here', async () => {
        const ctx = makeContext({ session });
        const { stdin } = renderWithContext(<CopyTargetScreen selection={selection} tasks={tasks} />, ctx);
        await press(stdin, 'n');
        expect(ctx.routes.at(-1)).toEqual({ name: 'connectionForm', returnTo: { name: 'copyTarget', selection, tasks } });
    });

    test('esc goes back to the options with "server" selected', async () => {
        const ctx = makeContext({ session });
        const { stdin } = renderWithContext(<CopyTargetScreen selection={selection} tasks={tasks} />, ctx);
        await press(stdin, KEY.esc);
        expect(ctx.routes.at(-1)).toEqual({ name: 'backupOptions', selection, tasks, destination: 'server' });
    });

    test('an unreachable server shows the error and stays', async () => {
        const dir = path.join(process.env.HOME!, '.mongobackupcli');
        const file = path.join(dir, 'MBConfig.json');
        const saved = fs.readFileSync(file, 'utf8');
        fs.writeFileSync(file, JSON.stringify({ dbList: [source, { name: 'down', url: 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200' }] }));
        try {
            const ctx = makeContext({ session });
            const { stdin } = renderWithContext(<CopyTargetScreen selection={selection} tasks={tasks} />, ctx);
            await press(stdin, KEY.enter);
            await waitFor(() => ctx.statuses.some(s => s.startsWith('Cannot copy to down')), 5000);
            expect(ctx.routes).toEqual([]);
        } finally {
            fs.writeFileSync(file, saved);
        }
    });
});

describe('CopyConfirmScreen', () => {
    const target: Session = { conn: { name: 'staging', url: 'mongodb://staging' }, client: fakeClient };

    test('marks collections that will be replaced and starts a copy job on y', async () => {
        const ctx = makeContext({ session });
        let closed = 0;
        const { stdin, lastFrame } = renderWithContext(
            <CopyConfirmScreen selection={selection} tasks={tasks} target={target} existing={new Set(['shop.users'])} closeTarget={() => { closed++; }} />,
            ctx,
        );
        const frame = lastFrame()!;
        expect(frame).toContain('This replaces data on the target');
        expect(frame).toMatch(/shop\.orders\s+new/);
        expect(frame).toMatch(/shop\.users\s+replace/);
        await press(stdin, 'y');
        const route = ctx.routes.at(-1) as Extract<Route, { name: 'run' }>;
        expect(route.job.kind).toBe('copy');
        expect(route.job.title).toBe('Copy · src → staging');
        route.job.onExit();
        expect(closed).toBe(1);
        expect(ctx.routes.at(-1)).toEqual({ name: 'home' });
    });

    test('nothing to replace shows a calm message; n closes the target and goes back', async () => {
        const ctx = makeContext({ session });
        let closed = 0;
        const { stdin, lastFrame } = renderWithContext(
            <CopyConfirmScreen selection={selection} tasks={tasks} target={target} existing={new Set()} closeTarget={() => { closed++; }} />,
            ctx,
        );
        expect(lastFrame()).toContain('nothing will be replaced');
        await press(stdin, 'n');
        expect(closed).toBe(1);
        expect(ctx.routes.at(-1)).toEqual({ name: 'copyTarget', selection, tasks, preselect: 'staging' });
    });
});

describe('ConnectionFormScreen returnTo', () => {
    test('esc returns to the given route', async () => {
        const ctx = makeContext({ session });
        const returnTo: Route = { name: 'copyTarget', selection, tasks };
        const { stdin } = renderWithContext(<ConnectionFormScreen returnTo={returnTo} />, ctx);
        await press(stdin, KEY.esc);
        expect(ctx.routes.at(-1)).toEqual(returnTo);
    });
});
