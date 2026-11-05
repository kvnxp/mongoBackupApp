import React, { useCallback, useContext, useMemo, useState } from 'react';
import * as path from 'path';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { BackupEntry, listBackups, listSubdirs, openArchive } from '../../archive';
import { MongoRestore } from '../../MongoRestore';
import { runRestoreJob, Task } from '../../jobs';
import { errorMessage, formatBytes, formatDate, formatNumber } from '../../utils';
import { AppContext } from '../context';
import { CollectionPicker, PickerCollection, PickerDb } from '../CollectionPicker';
import { Frame, ListView, Pane, Row, Spinner, position } from '../components';
import { useListNav } from '../useListNav';
import { RestoreSource, Selection } from '../routes';
import { theme } from '../theme';
import { registerCleanup } from '../cleanup';
import { selectionToTasks } from './BackupScreens';

function closeSource(source: RestoreSource): void {
    source.cleanup?.();
}

export function RestorePickScreen() {
    const ctx = useContext(AppContext);
    const { rows } = useWindowSize();
    const [entries, setEntries] = useState<BackupEntry[]>(() => listBackups(ctx.backupRoot));
    const [opening, setOpening] = useState<string | null>(null);
    const { cursor } = useListNav(entries.length, { isActive: opening === null });

    const open = async (entry: BackupEntry) => {
        if (entry.kind === 'folder') {
            ctx.navigate({ name: 'restoreSelect', source: { label: entry.name, projectDir: entry.path } });
            return;
        }
        setOpening(entry.name);
        ctx.setStatus(`Extracting ${entry.name}...`, 'info');
        try {
            const { projectDir, cleanup } = await openArchive(entry.path);
            const unregister = registerCleanup(cleanup);
            ctx.clearStatus();
            ctx.navigate({
                name: 'restoreSelect',
                source: { label: entry.name, projectDir, cleanup: () => { unregister(); cleanup(); } },
            });
        } catch (error) {
            setOpening(null);
            ctx.setStatus(`Could not open ${entry.name}: ${errorMessage(error)}`, 'error');
        }
    };

    useInput((input, key) => {
        if (opening) return;
        if (key.escape || input === 'q') {
            ctx.navigate({ name: 'home' });
        } else if (key.return && entries[cursor]) {
            void open(entries[cursor]);
        } else if (input === 'r') {
            setEntries(listBackups(ctx.backupRoot));
            ctx.setStatus('List refreshed', 'info');
        }
    });

    const kindLabel = (e: BackupEntry) => (e.kind === 'folder' ? 'folder' : e.kind);
    return (
        <Frame title="Restore · pick a backup" hints={[['↑↓', 'move'], ['enter', 'open'], ['r', 'refresh'], ['esc', 'back']]}>
            <Pane title={`Backups in ${ctx.backupRoot}`} right={position(cursor, entries.length)} focused flexGrow={1}>
                <ListView
                    items={entries}
                    cursor={cursor}
                    height={Math.max(3, rows - 8)}
                    emptyText="No backups found. Make a backup first or set BACKUPDIR."
                    renderRow={(e, _i, isCursor) => (
                        <Row
                            left={<Text><Text color={e.kind === 'folder' ? theme.accent : theme.warn}>{e.kind === 'folder' ? '▸' : '◆'}</Text> {e.name}</Text>}
                            right={`${kindLabel(e).padEnd(6)} ${e.size !== null ? formatBytes(e.size).padStart(8) : ''.padStart(8)}  ${formatDate(e.modified)}`}
                            bold={isCursor}
                        />
                    )}
                />
            </Pane>
            <Box paddingX={1} height={1}>
                {opening ? <Text><Spinner /> <Text color={theme.dim}>Extracting {opening}...</Text></Text> : <Text color={theme.dim}>Newest first. Archives are extracted to a temporary folder.</Text>}
            </Box>
        </Frame>
    );
}

export function RestoreSelectScreen({ source, selection }: { source: RestoreSource; selection?: Selection }) {
    const ctx = useContext(AppContext);

    const { dbs, dbError } = useMemo(() => {
        try {
            const list: PickerDb[] = listSubdirs(source.projectDir).map(name => {
                const files = MongoRestore.listBackupFiles(path.join(source.projectDir, name));
                return { name, detail: `${files.length} file(s)` };
            });
            return { dbs: list, dbError: null };
        } catch (error) {
            return { dbs: null, dbError: errorMessage(error) };
        }
    }, [source]);

    const loadCollections = useCallback(async (db: string): Promise<PickerCollection[]> => {
        return MongoRestore.listBackupFiles(path.join(source.projectDir, db))
            .map(f => ({ name: f.name, detail: formatBytes(f.size), weight: f.size }));
    }, [source]);

    return (
        <CollectionPicker
            title={`Restore · ${source.label}`}
            dbs={dbs}
            dbError={dbError}
            loadCollections={loadCollections}
            initialSelection={selection}
            weightLabel={w => formatBytes(w)}
            onBack={() => {
                closeSource(source);
                ctx.navigate({ name: 'restorePick' });
            }}
            onSubmit={(sel, cache) => ctx.navigate({ name: 'restoreConfirm', source, selection: sel, tasks: selectionToTasks(sel, cache) })}
        />
    );
}

export function RestoreConfirmScreen({ source, selection, tasks }: { source: RestoreSource; selection: Selection; tasks: Task[] }) {
    const ctx = useContext(AppContext);
    const { rows } = useWindowSize();
    const session = ctx.session!;
    const { cursor } = useListNav(tasks.length);
    const totalBytes = tasks.reduce((s, t) => s + t.total, 0);
    const databases = new Set(tasks.map(t => t.db));

    useInput((input, key) => {
        if (input === 'y') {
            const client = session.client;
            const projectDir = source.projectDir;
            ctx.navigate({
                name: 'run',
                job: {
                    kind: 'restore',
                    title: `Restore · ${source.label} → ${session.conn.name}`,
                    tasks,
                    start: (signal, events) => runRestoreJob({ client, projectDir, tasks, signal, events }),
                    onExit: () => {
                        closeSource(source);
                        ctx.navigate({ name: 'home' });
                    },
                },
            });
        } else if (input === 'n' || key.escape) {
            ctx.navigate({ name: 'restoreSelect', source, selection });
        }
    });

    return (
        <Frame title="Restore · confirm" hints={[['y', 'restore'], ['n/esc', 'back'], ['↑↓', 'scroll']]}>
            <Pane title="⚠ This replaces data" borderColor={theme.danger} focused>
                <Text>
                    The following <Text bold>{tasks.length}</Text> collection(s) in <Text bold>{databases.size}</Text> database(s) on{' '}
                    <Text bold color={theme.warn}>{session.conn.name}</Text> will be <Text bold color={theme.danger}>replaced</Text> with the backup contents ({formatBytes(totalBytes)}).
                </Text>
                <Text color={theme.dim}>Each collection is swapped only after its whole file is imported; on error it is left untouched. Existing indexes are kept.</Text>
            </Pane>
            <Pane title="Collections" right={position(cursor, tasks.length)} flexGrow={1}>
                <ListView
                    items={tasks}
                    cursor={cursor}
                    height={Math.max(3, rows - 12)}
                    renderRow={(t, _i, isCursor) => <Row left={`${t.db}.${t.collection}`} right={formatBytes(t.total)} bold={isCursor} />}
                />
            </Pane>
            <Box paddingX={1}>
                <Text>Press <Text bold color={theme.danger}>y</Text> to restore {formatNumber(tasks.length)} collection(s), <Text bold>n</Text> to go back.</Text>
            </Box>
        </Frame>
    );
}
