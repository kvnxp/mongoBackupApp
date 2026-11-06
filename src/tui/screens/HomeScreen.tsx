import React, { useContext, useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { MongoBackup } from '../../MongoBackup';
import { configFile } from '../../config';
import { errorMessage, formatBytes, maskUri } from '../../utils';
import { AppContext } from '../context';
import { Frame, ListView, Pane, Row, Spinner } from '../components';
import { useListNav } from '../useListNav';
import { theme } from '../theme';

type Action = { key: string; label: string; detail: string; run: () => void };
type ServerInfo = { version: string; databases: number; size: number };

export function HomeScreen() {
    const ctx = useContext(AppContext);
    const session = ctx.session!;
    const [info, setInfo] = useState<ServerInfo | null>(null);
    const [infoError, setInfoError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const [build, dbs] = await Promise.all([
                    session.client.db().admin().buildInfo(),
                    MongoBackup.listDatabases(session.client),
                ]);
                if (alive) setInfo({ version: String(build.version), databases: dbs.length, size: dbs.reduce((s, d) => s + d.sizeOnDisk, 0) });
            } catch (error) {
                if (alive) setInfoError(errorMessage(error));
            }
        })();
        return () => { alive = false; };
    }, [session]);

    const actions: Action[] = [
        { key: 'b', label: 'Backup', detail: 'Export to files or copy to another server', run: () => ctx.navigate({ name: 'backupSelect' }) },
        { key: 'r', label: 'Restore', detail: 'Import a backup folder or .zip/.tar', run: () => ctx.navigate({ name: 'restorePick' }) },
        { key: 'c', label: 'Change connection', detail: 'Disconnect and pick another', run: () => { void ctx.disconnect().then(() => ctx.navigate({ name: 'connections' })); } },
        { key: 'q', label: 'Quit', detail: '', run: () => ctx.quit() },
    ];
    const { cursor } = useListNav(actions.length);

    useInput((input, key) => {
        if (key.return) {
            ctx.clearStatus();
            actions[cursor].run();
            return;
        }
        if (key.escape) {
            actions[2].run();
            return;
        }
        const action = actions.find(a => a.key === input);
        if (action) {
            ctx.clearStatus();
            action.run();
        }
    });

    return (
        <Frame title="Home" hints={[['↑↓', 'move'], ['enter', 'select'], ['b', 'backup'], ['r', 'restore'], ['c', 'connections'], ['q', 'quit']]}>
            <Box>
                <Pane title="Actions" focused width="50%">
                    <ListView
                        items={actions}
                        cursor={cursor}
                        height={actions.length}
                        renderRow={(a, _i, isCursor) => (
                            <Text bold={isCursor}><Text color={theme.accent}>{a.key}</Text>  {a.label}</Text>
                        )}
                    />
                    <Text color={theme.dim} wrap="truncate-end">{actions[cursor].detail || ' '}</Text>
                </Pane>
                <Pane title="Server" flexGrow={1}>
                    <Row left="Connection" right={session.conn.name} dimRight={false} labelWidth={11} />
                    <Row left="URI" right={maskUri(session.conn.url)} labelWidth={11} />
                    {info ? (
                        <>
                            <Row left="MongoDB" right={info.version} dimRight={false} labelWidth={11} />
                            <Row left="Databases" right={`${info.databases} · ${formatBytes(info.size)}`} dimRight={false} labelWidth={11} />
                        </>
                    ) : infoError ? (
                        <Text color={theme.danger} wrap="truncate-end">{infoError}</Text>
                    ) : (
                        <Text><Spinner /> <Text color={theme.dim}>Loading server info...</Text></Text>
                    )}
                </Pane>
            </Box>
            <Pane title="Paths">
                <Row left="Backup root" right={ctx.backupRoot} labelWidth={12} />
                <Row left="Config" right={configFile()} labelWidth={12} />
            </Pane>
        </Frame>
    );
}
