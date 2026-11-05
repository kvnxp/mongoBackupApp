import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { errorMessage, formatNumber } from '../utils';
import { AppContext } from './context';
import { Checkbox, Frame, Hint, ListView, Pane, Row, Spinner, position } from './components';
import { useListNav } from './useListNav';
import { Selection } from './routes';
import { theme } from './theme';

export type PickerDb = { name: string; detail: string };
export type PickerCollection = { name: string; detail: string; weight: number };
export type CollectionCache = Map<string, PickerCollection[]>;

type Props = {
    title: string;
    /** null while loading */
    dbs: PickerDb[] | null;
    dbError?: string | null;
    loadCollections: (db: string) => Promise<PickerCollection[]>;
    initialSelection?: Selection;
    /** Label for the selection weight in the summary (e.g. "docs") */
    weightLabel: (total: number) => string;
    onSubmit: (selection: Selection, cache: CollectionCache) => void;
    onBack: () => void;
};

/** Total selected collections and weight. */
export function selectionStats(selection: Selection, cache: CollectionCache): { collections: number; databases: number; weight: number } {
    let collections = 0;
    let weight = 0;
    for (const [db, cols] of selection) {
        collections += cols.size;
        for (const c of cache.get(db) ?? []) if (cols.has(c.name)) weight += c.weight;
    }
    return { collections, databases: selection.size, weight };
}

/**
 * Two pane picker: databases on the left, collections of the highlighted database on the right.
 * Collections are loaded lazily (and cached) when a database is highlighted.
 */
export function CollectionPicker({ title, dbs, dbError, loadCollections, initialSelection, weightLabel, onSubmit, onBack }: Props) {
    const ctx = useContext(AppContext);
    const { columns, rows } = useWindowSize();
    const [pane, setPane] = useState<'db' | 'col'>('db');
    const [cache, setCache] = useState<CollectionCache>(() => new Map());
    const [errors, setErrors] = useState<Map<string, string>>(() => new Map());
    const [selection, setSelection] = useState<Selection>(() => new Map(initialSelection ?? []));
    const inflight = useRef(new Map<string, Promise<PickerCollection[]>>());

    const dbList = dbs ?? [];
    const dbNav = useListNav(dbList.length, { isActive: pane === 'db' });
    const currentDb = dbList[dbNav.cursor]?.name;
    const currentCols = currentDb ? cache.get(currentDb) : undefined;
    const colNav = useListNav(currentCols?.length ?? 0, { isActive: pane === 'col' });

    const ensureLoaded = useCallback((db: string): Promise<PickerCollection[]> => {
        const cached = cache.get(db);
        if (cached) return Promise.resolve(cached);
        let p = inflight.current.get(db);
        if (!p) {
            p = loadCollections(db).then(
                cols => {
                    setCache(prev => new Map(prev).set(db, cols));
                    return cols;
                },
                error => {
                    setErrors(prev => new Map(prev).set(db, errorMessage(error)));
                    inflight.current.delete(db);
                    throw error;
                },
            );
            inflight.current.set(db, p);
        }
        return p;
    }, [cache, loadCollections]);

    // Prefetch the collections of the highlighted database
    useEffect(() => {
        if (currentDb) ensureLoaded(currentDb).catch(() => {});
        colNav.setCursor(0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentDb]);

    const setDbSelection = (db: string, cols: Set<string> | null) => {
        setSelection(prev => {
            const next = new Map(prev);
            if (cols && cols.size > 0) next.set(db, cols);
            else next.delete(db);
            return next;
        });
    };

    const toggleDb = async (db: string) => {
        try {
            const cols = await ensureLoaded(db);
            const selected = selection.get(db);
            const all = selected !== undefined && selected.size === cols.length;
            setDbSelection(db, all ? null : new Set(cols.map(c => c.name)));
        } catch {
            ctx.setStatus(`Could not list collections of ${db}`, 'error');
        }
    };

    const toggleCollection = (db: string, col: string) => {
        const next = new Set(selection.get(db) ?? []);
        if (next.has(col)) next.delete(col);
        else next.add(col);
        setDbSelection(db, next);
    };

    const toggleEverything = async () => {
        try {
            const loaded = await Promise.all(dbList.map(d => ensureLoaded(d.name).then(cols => [d.name, cols] as const)));
            const everything = loaded.every(([db, cols]) => cols.length === 0 || selection.get(db)?.size === cols.length);
            const next: Selection = new Map();
            if (!everything) {
                for (const [db, cols] of loaded) if (cols.length > 0) next.set(db, new Set(cols.map(c => c.name)));
            }
            setSelection(next);
        } catch {
            ctx.setStatus('Could not list collections of every database', 'error');
        }
    };

    const stats = useMemo(() => selectionStats(selection, cache), [selection, cache]);

    useInput((input, key) => {
        if (key.escape) {
            onBack();
        } else if (key.tab) {
            if (pane === 'col') setPane('db');
            else if (currentCols && currentCols.length > 0) setPane('col');
        } else if (key.rightArrow || input === 'l') {
            if (currentCols && currentCols.length > 0) setPane('col');
        } else if (key.leftArrow || input === 'h') {
            setPane('db');
        } else if (input === ' ') {
            if (pane === 'db' && currentDb) void toggleDb(currentDb);
            else if (pane === 'col' && currentDb && currentCols?.[colNav.cursor]) toggleCollection(currentDb, currentCols[colNav.cursor].name);
        } else if (input === 'a') {
            if (pane === 'db') void toggleEverything();
            else if (currentDb) void toggleDb(currentDb);
        } else if (key.return) {
            if (stats.collections === 0) ctx.setStatus('Select at least one collection (space)', 'warn');
            else {
                ctx.clearStatus();
                onSubmit(selection, cache);
            }
        }
    });

    const listHeight = Math.max(3, rows - 8);
    const leftWidth = Math.max(24, Math.floor((columns - 2) * 0.38));

    const dbState = (db: string): 'all' | 'some' | 'none' => {
        const sel = selection.get(db);
        if (!sel || sel.size === 0) return 'none';
        const cols = cache.get(db);
        return cols && sel.size === cols.length ? 'all' : 'some';
    };

    const hints: Hint[] = [['↑↓', 'move'], ['tab/←→', 'switch pane'], ['space', 'toggle'], ['a', pane === 'db' ? 'toggle all' : 'toggle db'], ['enter', 'continue'], ['esc', 'back']];

    let right: React.ReactNode;
    if (!currentDb) {
        right = <Text color={theme.dim}>No database selected</Text>;
    } else if (errors.has(currentDb) && !currentCols) {
        right = <Text color={theme.danger} wrap="truncate-end">{errors.get(currentDb)}</Text>;
    } else if (!currentCols) {
        right = <Text><Spinner /> <Text color={theme.dim}>Loading collections...</Text></Text>;
    } else {
        const sel = selection.get(currentDb);
        right = (
            <ListView
                items={currentCols}
                cursor={colNav.cursor}
                height={listHeight}
                showCursor={pane === 'col'}
                emptyText="No collections"
                renderRow={(c, _i, isCursor) => (
                    <Row left={<Text><Checkbox state={sel?.has(c.name) ? 'all' : 'none'} /> {c.name}</Text>} right={c.detail} bold={isCursor} />
                )}
            />
        );
    }

    return (
        <Frame title={title} hints={hints}>
            <Box flexGrow={1}>
                <Pane title="Databases" right={position(dbNav.cursor, dbList.length)} focused={pane === 'db'} width={leftWidth}>
                    {dbs === null ? (
                        dbError ? <Text color={theme.danger} wrap="truncate-end">{dbError}</Text> : <Text><Spinner /> <Text color={theme.dim}>Loading databases...</Text></Text>
                    ) : (
                        <ListView
                            items={dbList}
                            cursor={dbNav.cursor}
                            height={listHeight}
                            showCursor={pane === 'db'}
                            emptyText="No databases"
                            renderRow={(d, _i, isCursor) => (
                                <Row left={<Text><Checkbox state={dbState(d.name)} /> {d.name}</Text>} right={d.detail} bold={isCursor} />
                            )}
                        />
                    )}
                </Pane>
                <Pane
                    title={currentDb ? `Collections · ${currentDb}` : 'Collections'}
                    right={currentCols ? position(colNav.cursor, currentCols.length) : undefined}
                    focused={pane === 'col'}
                    flexGrow={1}
                >
                    {right}
                </Pane>
            </Box>
            <Box paddingX={1}>
                <Text color={stats.collections ? theme.accent : theme.dim}>
                    {stats.collections
                        ? `${formatNumber(stats.collections)} collection(s) in ${stats.databases} database(s) selected · ${weightLabel(stats.weight)}`
                        : 'Nothing selected'}
                </Text>
            </Box>
        </Frame>
    );
}
