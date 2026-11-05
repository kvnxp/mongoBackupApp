import * as fs from 'fs';
import * as path from 'path';
import { MongoClient } from 'mongodb';
import { MongoBackup } from './MongoBackup';
import { MongoRestore } from './MongoRestore';
import { MongoCopy } from './MongoCopy';
import { compressFolder, CompressionKind } from './archive';
import { AbortError, errorMessage } from './utils';

/** One collection to back up, restore or copy. `total` is the estimated document count (backup, copy) or file size in bytes (restore). */
export type Task = { db: string; collection: string; total: number };

export type TaskResult =
    | { status: 'done'; docs: number }
    | { status: 'skipped'; reason: string }
    | { status: 'error'; error: string }
    | { status: 'cancelled' };

export type JobPhase = 'running' | 'compressing' | 'finished';

export type JobEvents = {
    onPhase?: (phase: JobPhase) => void;
    onTaskStart?: (index: number) => void;
    /** `done` is documents (backup) or bytes read (restore), comparable with `task.total` */
    onTaskProgress?: (index: number, done: number, docs: number) => void;
    onTaskEnd?: (index: number, result: TaskResult) => void;
};

export type JobSummary = {
    results: TaskResult[];
    docs: number;
    cancelled: boolean;
    elapsedMs: number;
    /** Backup only: folder or archive written */
    output?: string;
    /** Backup only: error while compressing (the uncompressed folder is kept) */
    compressError?: string;
};

export type BackupJobOptions = {
    client: MongoClient;
    backupRoot: string;
    project: string;
    tasks: Task[];
    compress: CompressionKind | null;
    signal?: AbortSignal;
    events?: JobEvents;
};

export type RestoreJobOptions = {
    client: MongoClient;
    /** Folder containing one sub folder per database */
    projectDir: string;
    tasks: Task[];
    signal?: AbortSignal;
    events?: JobEvents;
};

async function runTasks(
    tasks: Task[],
    signal: AbortSignal | undefined,
    events: JobEvents,
    runOne: (task: Task, index: number) => Promise<TaskResult>,
): Promise<{ results: TaskResult[]; cancelled: boolean; docs: number }> {
    const results: TaskResult[] = tasks.map(() => ({ status: 'cancelled' }));
    let cancelled = false;
    let docs = 0;
    events.onPhase?.('running');
    for (let i = 0; i < tasks.length; i++) {
        if (signal?.aborted) {
            cancelled = true;
            break;
        }
        events.onTaskStart?.(i);
        let result: TaskResult;
        try {
            result = await runOne(tasks[i], i);
        } catch (error) {
            if (error instanceof AbortError || signal?.aborted) {
                cancelled = true;
                result = { status: 'cancelled' };
            } else {
                result = { status: 'error', error: errorMessage(error) };
            }
        }
        if (result.status === 'done') docs += result.docs;
        results[i] = result;
        events.onTaskEnd?.(i, result);
        if (cancelled) break;
    }
    return { results, cancelled, docs };
}

/**
 * Backs up `tasks` into `<backupRoot>/<project>/<db>/<collection>.json`,
 * then optionally packs the project folder into `<project>.zip|.tar`.
 * Collections finished before a cancellation are kept (each file is complete).
 */
export async function runBackupJob(options: BackupJobOptions): Promise<JobSummary> {
    const { client, backupRoot, project, tasks, compress, signal, events = {} } = options;
    const started = Date.now();
    const projectDir = path.join(backupRoot, project);

    const { results, cancelled, docs } = await runTasks(tasks, signal, events, async (task, i) => {
        const dir = path.join(projectDir, task.db);
        fs.mkdirSync(dir, { recursive: true });
        const count = await MongoBackup.backupCollection(client.db(task.db), task.collection, dir, {
            signal,
            onProgress: d => events.onTaskProgress?.(i, d, d),
        });
        return { status: 'done', docs: count };
    });

    const summary: JobSummary = { results, docs, cancelled, elapsedMs: 0, output: projectDir };
    if (compress && !cancelled && results.some(r => r.status === 'done')) {
        events.onPhase?.('compressing');
        try {
            summary.output = await compressFolder(projectDir, compress);
        } catch (error) {
            summary.compressError = errorMessage(error);
        }
    }
    events.onPhase?.('finished');
    summary.elapsedMs = Date.now() - started;
    return summary;
}

/** Restores `tasks` from `<projectDir>/<db>/<collection>.json`, replacing each target collection. */
export async function runRestoreJob(options: RestoreJobOptions): Promise<JobSummary> {
    const { client, projectDir, tasks, signal, events = {} } = options;
    const started = Date.now();

    const { results, cancelled, docs } = await runTasks(tasks, signal, events, async (task, i) => {
        const file = path.join(projectDir, task.db, `${task.collection}.json`);
        const count = await MongoRestore.restoreCollection(client.db(task.db), task.collection, file, {
            signal,
            onProgress: p => events.onTaskProgress?.(i, p.bytes, p.docs),
        });
        return count === null ? { status: 'skipped', reason: 'empty backup' } : { status: 'done', docs: count };
    });

    events.onPhase?.('finished');
    return { results, docs, cancelled, elapsedMs: Date.now() - started };
}

export type CopyJobOptions = {
    /** Server the collections are read from */
    source: MongoClient;
    /** Server the collections are written to */
    target: MongoClient;
    tasks: Task[];
    /** Database name on the target for each source database (default: same name) */
    targetDbName?: (sourceDb: string) => string;
    signal?: AbortSignal;
    events?: JobEvents;
};

/** Copies `tasks` from `source` to `target`, replacing each collection on the target. */
export async function runCopyJob(options: CopyJobOptions): Promise<JobSummary> {
    const { source, target, tasks, targetDbName = (db: string) => db, signal, events = {} } = options;
    const started = Date.now();

    const { results, cancelled, docs } = await runTasks(tasks, signal, events, async (task, i) => {
        const count = await MongoCopy.copyCollection(source.db(task.db), target.db(targetDbName(task.db)), task.collection, {
            signal,
            onProgress: d => events.onTaskProgress?.(i, d, d),
        });
        return count === null ? { status: 'skipped', reason: 'empty collection' } : { status: 'done', docs: count };
    });

    events.onPhase?.('finished');
    return { results, docs, cancelled, elapsedMs: Date.now() - started };
}
