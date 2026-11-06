import React, { useContext, useMemo, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { MongoClient } from 'mongodb';
import { DbConnection, readDbConnections } from '../../config';
import { getInteractiveClient } from '../../mongoConnection';
import { runCopyJob, Task } from '../../jobs';
import { isSameServer } from '../../MongoCopy';
import { errorMessage, formatNumber, maskUri } from '../../utils';
import { AppContext, Session } from '../context';
import { Frame, ListView, Pane, Row, Spinner, position } from '../components';
import { useListNav } from '../useListNav';
import { Selection } from '../routes';
import { theme } from '../theme';
import { registerCleanup } from '../cleanup';

type Item = { kind: 'conn'; conn: DbConnection } | { kind: 'new' };

const taskKey = (t: { db: string; collection: string }) => `${t.db}.${t.collection}`;

/** Connects to `conn` and pings it. Closes the client on failure. */
async function connectTarget(conn: DbConnection): Promise<MongoClient> {
    const client = getInteractiveClient(conn.url);
    try {
        await client.connect();
        await client.db().admin().ping();
        return client;
    } catch (error) {
        await client.close().catch(() => {});
        throw error;
    }
}

/** "db.collection" keys of `tasks` that already exist on the target server. */
export async function existingOnTarget(client: MongoClient, tasks: Task[]): Promise<Set<string>> {
    const existing = new Set<string>();
    for (const db of new Set(tasks.map(t => t.db))) {
        const names = new Set((await client.db(db).listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
        for (const t of tasks) if (t.db === db && names.has(t.collection)) existing.add(taskKey(t));
    }
    return existing;
}

/** Saved connections that can be a copy target: everything except the current source. */
export function copyTargets(conns: DbConnection[], source: DbConnection): DbConnection[] {
    return conns.filter(c => c.name !== source.name && c.url !== source.url);
}

/** Closes the target session; also registered so quitting the app closes it. */
function trackTarget(client: MongoClient): () => void {
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        unregister();
        void client.close().catch(() => {});
    };
    const unregister = registerCleanup(close);
    return close;
}

export function CopyTargetScreen({ selection, tasks, preselect }: { selection: Selection; tasks: Task[]; preselect?: string }) {
    const ctx = useContext(AppContext);
    const { rows } = useWindowSize();
    const source = ctx.session!.conn;
    const targets = useMemo(() => copyTargets(readDbConnections(), source), [source]);
    const items: Item[] = [...targets.map(conn => ({ kind: 'conn' as const, conn })), { kind: 'new' }];
    const [connecting, setConnecting] = useState<string | null>(null);
    const initial = preselect ? Math.max(0, targets.findIndex(c => c.name === preselect)) : 0;
    const { cursor } = useListNav(items.length, { isActive: connecting === null, initial });
    const self = { name: 'copyTarget' as const, selection, tasks };

    const choose = async (conn: DbConnection) => {
        setConnecting(conn.name);
        ctx.setStatus(`Connecting to ${conn.name}...`, 'info');
        try {
            const client = await connectTarget(conn);
            const close = trackTarget(client);
            let existing: Set<string>;
            try {
                if (await isSameServer(ctx.session!.client, client)) {
                    throw new Error(`it is the same server as ${source.name} (copying would overwrite the source)`);
                }
                existing = await existingOnTarget(client, tasks);
            } catch (error) {
                close();
                throw error;
            }
            ctx.clearStatus();
            ctx.navigate({ name: 'copyConfirm', selection, tasks, target: { conn, client }, existing, closeTarget: close });
        } catch (error) {
            setConnecting(null);
            ctx.setStatus(`Cannot copy to ${conn.name}: ${errorMessage(error)}`, 'error');
        }
    };

    useInput((input, key) => {
        if (connecting) return;
        if (key.escape) {
            ctx.clearStatus();
            ctx.navigate({ name: 'backupOptions', selection, tasks, destination: 'server' });
        } else if (input === 'n' || (key.return && items[cursor]?.kind === 'new')) {
            ctx.navigate({ name: 'connectionForm', returnTo: self });
        } else if (key.return) {
            const item = items[cursor];
            if (item?.kind === 'conn') void choose(item.conn);
        }
    });

    return (
        <Frame title="Backup · copy to server" hints={[['↑↓', 'move'], ['enter', 'select'], ['n', 'new connection'], ['esc', 'back']]}>
            <Pane title={`Copy ${tasks.length} collection(s) from ${source.name} to...`} right={position(cursor, items.length)} focused flexGrow={1}>
                <ListView
                    items={items}
                    cursor={cursor}
                    height={Math.max(3, rows - 8)}
                    renderRow={(item, _i, isCursor) => item.kind === 'new'
                        ? <Text color={theme.accent} bold={isCursor}>+ New connection</Text>
                        : <Row left={item.conn.name} right={maskUri(item.conn.url)} bold={isCursor} />}
                />
            </Pane>
            <Box paddingX={1} height={1}>
                {connecting
                    ? <Text><Spinner /> <Text color={theme.dim}>Connecting to {connecting}...</Text></Text>
                    : targets.length === 0
                        ? <Text color={theme.dim}>No other saved servers. Press n to add one.</Text>
                        : <Text color={theme.dim}>The current connection ({source.name}) is the source and is not listed.</Text>}
            </Box>
        </Frame>
    );
}

export function CopyConfirmScreen({ selection, tasks, target, existing, closeTarget }: {
    selection: Selection;
    tasks: Task[];
    target: Session;
    existing: Set<string>;
    closeTarget: () => void;
}) {
    const ctx = useContext(AppContext);
    const { rows } = useWindowSize();
    const source = ctx.session!;
    const { cursor } = useListNav(tasks.length);
    const replaced = tasks.filter(t => existing.has(taskKey(t))).length;
    const totalDocs = tasks.reduce((s, t) => s + t.total, 0);

    useInput((input, key) => {
        if (input === 'y') {
            ctx.navigate({
                name: 'run',
                job: {
                    kind: 'copy',
                    title: `Copy · ${source.conn.name} → ${target.conn.name}`,
                    tasks,
                    start: (signal, events) => runCopyJob({ source: source.client, target: target.client, tasks, signal, events }),
                    onExit: () => {
                        closeTarget();
                        ctx.navigate({ name: 'home' });
                    },
                },
            });
        } else if (input === 'n' || key.escape) {
            closeTarget();
            ctx.navigate({ name: 'copyTarget', selection, tasks, preselect: target.conn.name });
        }
    });

    return (
        <Frame title="Copy · confirm" hints={[['y', 'copy'], ['n/esc', 'back'], ['↑↓', 'scroll']]}>
            <Pane title={replaced ? '⚠ This replaces data on the target' : 'Copy to server'} borderColor={replaced ? theme.danger : theme.focusBorder} focused>
                <Text>
                    Copy <Text bold>{tasks.length}</Text> collection(s) (~{formatNumber(totalDocs)} docs) from{' '}
                    <Text bold color={theme.accent}>{source.conn.name}</Text> to <Text bold color={theme.warn}>{target.conn.name}</Text>, into databases with the same names.
                </Text>
                {replaced ? (
                    <Text><Text bold color={theme.danger}>{replaced}</Text> collection(s) already exist on {target.conn.name} and will be <Text bold color={theme.danger}>replaced</Text>.</Text>
                ) : (
                    <Text color={theme.ok}>None of them exist on {target.conn.name}: nothing will be replaced.</Text>
                )}
                <Text color={theme.dim}>Documents, indexes and collection options are copied. Each collection is swapped in only after it was fully copied.</Text>
            </Pane>
            <Pane title="Collections" right={position(cursor, tasks.length)} flexGrow={1}>
                <ListView
                    items={tasks}
                    cursor={cursor}
                    height={Math.max(3, rows - 13)}
                    renderRow={(t, _i, isCursor) => (
                        <Row
                            left={taskKey(t)}
                            right={existing.has(taskKey(t)) ? <Text color={theme.danger}>replace</Text> : <Text color={theme.ok}>new</Text>}
                            bold={isCursor}
                        />
                    )}
                />
            </Pane>
            <Box paddingX={1}>
                <Text>Press <Text bold color={replaced ? theme.danger : theme.accent}>y</Text> to copy, <Text bold>n</Text> to choose another server.</Text>
            </Box>
        </Frame>
    );
}
