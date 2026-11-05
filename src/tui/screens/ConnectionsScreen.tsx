import React, { useContext, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { DbConnection, readDbConnections, saveDbConnections, checkMongoConnection } from '../../config';
import { errorMessage, maskUri } from '../../utils';
import { AppContext } from '../context';
import { Frame, Hint, ListView, Pane, Row, Spinner, position } from '../components';
import { useListNav } from '../useListNav';
import { theme } from '../theme';

type Item = { kind: 'conn'; conn: DbConnection } | { kind: 'new' };
type Mode = 'list' | 'confirmDelete' | 'connecting' | 'testing';

export function ConnectionsScreen() {
    const ctx = useContext(AppContext);
    const { rows } = useWindowSize();
    const [conns, setConns] = useState<DbConnection[]>(() => readDbConnections());
    const [mode, setMode] = useState<Mode>('list');

    const items: Item[] = [...conns.map(conn => ({ kind: 'conn' as const, conn })), { kind: 'new' }];
    const { cursor } = useListNav(items.length, { isActive: mode === 'list' });
    const current = items[cursor];
    const currentConn = current?.kind === 'conn' ? current.conn : null;

    const connect = async (conn: DbConnection) => {
        setMode('connecting');
        ctx.setStatus(`Connecting to ${conn.name}...`, 'info');
        try {
            await ctx.connect(conn);
            ctx.clearStatus();
            ctx.navigate({ name: 'home' });
        } catch (error) {
            ctx.setStatus(`Could not connect to ${conn.name}: ${errorMessage(error)}`, 'error');
            setMode('list');
        }
    };

    const test = async (conn: DbConnection) => {
        setMode('testing');
        ctx.setStatus(`Testing ${conn.name}...`, 'info');
        try {
            await checkMongoConnection(conn.url);
            ctx.setStatus(`${conn.name}: connection OK`, 'ok');
        } catch (error) {
            ctx.setStatus(`${conn.name}: ${errorMessage(error)}`, 'error');
        }
        setMode('list');
    };

    useInput((input, key) => {
        if (mode === 'confirmDelete') {
            if (input === 'y' && currentConn) {
                const next = conns.filter(c => c !== currentConn);
                saveDbConnections(next);
                setConns(next);
                ctx.setStatus(`Deleted ${currentConn.name}`, 'ok');
                setMode('list');
            } else if (input === 'n' || key.escape) {
                ctx.clearStatus();
                setMode('list');
            }
            return;
        }
        if (mode !== 'list') return;

        if (key.return) {
            if (current?.kind === 'new') ctx.navigate({ name: 'connectionForm' });
            else if (currentConn) void connect(currentConn);
        } else if (input === 'n') {
            ctx.navigate({ name: 'connectionForm' });
        } else if (input === 'd' && currentConn) {
            ctx.setStatus(`Delete connection '${currentConn.name}'? (y/n)`, 'warn');
            setMode('confirmDelete');
        } else if (input === 't' && currentConn) {
            void test(currentConn);
        } else if (input === 'q' || key.escape) {
            ctx.quit();
        }
    });

    const hints: Hint[] = mode === 'confirmDelete'
        ? [['y', 'delete'], ['n', 'cancel']]
        : [['↑↓', 'move'], ['enter', 'connect'], ['n', 'new'], ['t', 'test'], ['d', 'delete'], ['q', 'quit']];

    const listHeight = Math.max(3, rows - 9);
    return (
        <Frame title="Connections" hints={hints}>
            <Pane title="Saved connections" right={position(cursor, items.length)} focused flexGrow={1}>
                <ListView
                    items={items}
                    cursor={cursor}
                    height={listHeight}
                    renderRow={(item, _i, isCursor) => item.kind === 'new'
                        ? <Text color={theme.accent} bold={isCursor}>+ New connection</Text>
                        : <Row left={item.conn.name} right={maskUri(item.conn.url)} bold={isCursor} />}
                />
            </Pane>
            <Box paddingX={1} height={1}>
                {mode === 'connecting' || mode === 'testing'
                    ? <Text><Spinner /> <Text color={theme.dim}>{mode === 'connecting' ? 'Connecting' : 'Testing'}...</Text></Text>
                    : conns.length === 0
                        ? <Text color={theme.dim}>No saved connections yet. Press n to add one.</Text>
                        : <Text color={theme.dim}>Connections are stored in ~/.mongobackupcli/MBConfig.json</Text>}
            </Box>
        </Frame>
    );
}
