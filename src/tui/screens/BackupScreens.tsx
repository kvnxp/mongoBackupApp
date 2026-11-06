import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { MongoBackup } from '../../MongoBackup';
import { CompressionKind } from '../../archive';
import { runBackupJob, Task } from '../../jobs';
import { defaultProjectName, errorMessage, formatBytes, formatNumber, isValidProjectName } from '../../utils';
import { AppContext } from '../context';
import { CollectionCache, CollectionPicker, PickerCollection, PickerDb } from '../CollectionPicker';
import { Frame, ListView, Pane, Row, TextInput } from '../components';
import { Selection } from '../routes';
import { theme } from '../theme';

/** Tasks in database/collection order, with the cached estimates as totals. */
export function selectionToTasks(selection: Selection, cache: CollectionCache): Task[] {
    const tasks: Task[] = [];
    for (const db of [...selection.keys()].sort()) {
        const weights = new Map((cache.get(db) ?? []).map(c => [c.name, c.weight]));
        for (const collection of [...selection.get(db)!].sort()) {
            tasks.push({ db, collection, total: weights.get(collection) ?? 0 });
        }
    }
    return tasks;
}

export function BackupSelectScreen({ selection }: { selection?: Selection }) {
    const ctx = useContext(AppContext);
    const client = ctx.session!.client;
    const [dbs, setDbs] = useState<PickerDb[] | null>(null);
    const [dbError, setDbError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        MongoBackup.listDatabases(client).then(
            list => alive && setDbs(list.map(d => ({ name: d.name, detail: formatBytes(d.sizeOnDisk) }))),
            error => alive && setDbError(errorMessage(error)),
        );
        return () => { alive = false; };
    }, [client]);

    const loadCollections = useCallback(async (db: string): Promise<PickerCollection[]> => {
        const cols = await MongoBackup.listCollections(client.db(db));
        return cols.map(c => ({ name: c.name, detail: `${formatNumber(c.count)} docs`, weight: c.count }));
    }, [client]);

    return (
        <CollectionPicker
            title="Backup · select collections"
            dbs={dbs}
            dbError={dbError}
            loadCollections={loadCollections}
            initialSelection={selection}
            weightLabel={w => `~${formatNumber(w)} docs`}
            onBack={() => ctx.navigate({ name: 'home' })}
            onSubmit={(sel, cache) => ctx.navigate({ name: 'backupOptions', selection: sel, tasks: selectionToTasks(sel, cache) })}
        />
    );
}

const COMPRESSION: { value: CompressionKind | null; label: string }[] = [
    { value: null, label: 'Folder (no compression)' },
    { value: 'zip', label: '.zip' },
    { value: 'tar', label: '.tar' },
];

const DESTINATIONS: { value: 'file' | 'server'; label: string }[] = [
    { value: 'file', label: 'Files' },
    { value: 'server', label: 'Another server' },
];

type Field = 'dest' | 'name' | 'compress';

/** Horizontal set of options; the selected one is highlighted (inverse when the row has focus). */
function Choice({ label, options, selected, focused }: { label: string; options: string[]; selected: number; focused: boolean }) {
    return (
        <Box>
            <Text color={focused ? theme.accent : theme.dim} bold={focused}>{label.padEnd(9)}</Text>
            {options.map((o, i) => (
                <Text key={o} color={i === selected ? theme.accent : theme.dim} bold={i === selected} inverse={i === selected && focused}>
                    {` ${o} `}
                </Text>
            ))}
        </Box>
    );
}

export function BackupOptionsScreen({ selection, tasks, destination: initialDestination = 'file' }: { selection: Selection; tasks: Task[]; destination?: 'file' | 'server' }) {
    const ctx = useContext(AppContext);
    const { rows } = useWindowSize();
    const [destIdx, setDestIdx] = useState(() => Math.max(0, DESTINATIONS.findIndex(d => d.value === initialDestination)));
    const [name, setName] = useState(() => defaultProjectName());
    const [compressIdx, setCompressIdx] = useState(0);
    const [focus, setFocus] = useState<Field>('dest');

    const toServer = DESTINATIONS[destIdx].value === 'server';
    const fields: Field[] = toServer ? ['dest'] : ['dest', 'name', 'compress'];
    const compress = COMPRESSION[compressIdx].value;
    const trimmed = name.trim();
    const destination = path.join(ctx.backupRoot, trimmed) + (compress ? `.${compress}` : '');
    const exists = trimmed !== '' && (fs.existsSync(path.join(ctx.backupRoot, trimmed)) || (compress !== null && fs.existsSync(destination)));
    const totalDocs = tasks.reduce((s, t) => s + t.total, 0);

    const perDb = useMemo(() => {
        const map = new Map<string, { collections: number; docs: number }>();
        for (const t of tasks) {
            const e = map.get(t.db) ?? { collections: 0, docs: 0 };
            e.collections++;
            e.docs += t.total;
            map.set(t.db, e);
        }
        return [...map.entries()];
    }, [tasks]);

    const startFileBackup = () => {
        if (!isValidProjectName(trimmed)) {
            setFocus('name');
            ctx.setStatus('Invalid name: it cannot be empty or contain / or \\', 'error');
            return;
        }
        ctx.clearStatus();
        const client = ctx.session!.client;
        const backupRoot = ctx.backupRoot;
        ctx.navigate({
            name: 'run',
            job: {
                kind: 'backup',
                title: `Backup · ${trimmed}`,
                tasks,
                start: (signal, events) => runBackupJob({ client, backupRoot, project: trimmed, tasks, compress, signal, events }),
                onExit: () => ctx.navigate({ name: 'home' }),
            },
        });
    };

    const next = () => {
        if (toServer) {
            ctx.clearStatus();
            ctx.navigate({ name: 'copyTarget', selection, tasks });
        } else if (focus === 'compress') {
            startFileBackup();
        } else {
            setFocus(fields[fields.indexOf(focus) + 1]);
        }
    };

    const cycle = (delta: number) => {
        if (focus === 'dest') setDestIdx(i => (i + DESTINATIONS.length + delta) % DESTINATIONS.length);
        else if (focus === 'compress') setCompressIdx(i => (i + COMPRESSION.length + delta) % COMPRESSION.length);
    };

    useInput((input, key) => {
        if (key.escape) {
            ctx.clearStatus();
            ctx.navigate({ name: 'backupSelect', selection });
        } else if (key.tab || key.downArrow) {
            setFocus(f => fields[(fields.indexOf(f) + 1) % fields.length]);
        } else if (key.upArrow) {
            setFocus(f => fields[(fields.indexOf(f) + fields.length - 1) % fields.length]);
        } else if (focus !== 'name' && (key.leftArrow || input === 'h')) {
            cycle(-1);
        } else if (focus !== 'name' && (key.rightArrow || input === 'l' || input === ' ')) {
            cycle(1);
        } else if (focus !== 'name' && key.return) {
            next();
        }
    });

    const enterLabel = toServer ? 'choose server' : focus === 'compress' ? 'start backup' : 'next';
    return (
        <Frame title="Backup · options" hints={[['tab', 'next field'], ['←→', 'change'], ['enter', enterLabel], ['esc', 'back']]}>
            <Pane title="Options" focused>
                <Choice label="To" options={DESTINATIONS.map(d => d.label)} selected={destIdx} focused={focus === 'dest'} />
                {toServer ? (
                    <Text color={theme.dim}>Copy the selected collections directly to another saved server (or a new one). Next: choose the server.</Text>
                ) : (
                    <>
                        <Box>
                            <Text color={focus === 'name' ? theme.accent : theme.dim} bold={focus === 'name'}>{'Name'.padEnd(9)}</Text>
                            <Box flexGrow={1}>
                                <TextInput value={name} onChange={setName} onSubmit={next} isActive={focus === 'name'} />
                            </Box>
                        </Box>
                        <Choice label="Format" options={COMPRESSION.map(c => c.label)} selected={compressIdx} focused={focus === 'compress'} />
                        <Row left="Path" right={destination} labelWidth={8} color={theme.dim} />
                        {exists ? <Text color={theme.warn}>⚠ Destination already exists: files with the same name will be overwritten.</Text> : null}
                    </>
                )}
            </Pane>
            <Pane title="Summary" right={`${tasks.length} collection(s) · ~${formatNumber(totalDocs)} docs`} flexGrow={1}>
                <ListView
                    items={perDb}
                    cursor={0}
                    showCursor={false}
                    height={Math.max(1, rows - 13)}
                    renderRow={([db, e]) => <Row left={db} right={`${e.collections} collection(s) · ~${formatNumber(e.docs)} docs`} />}
                />
            </Pane>
        </Frame>
    );
}
