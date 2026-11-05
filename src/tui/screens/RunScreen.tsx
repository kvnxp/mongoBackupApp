import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { JobEvents, JobPhase, JobSummary } from '../../jobs';
import { errorMessage, formatBytes, formatDuration, formatNumber } from '../../utils';
import { AppContext } from '../context';
import { Frame, Hint, ListView, Pane, ProgressBar, Row, Spinner, position } from '../components';
import { useListNav } from '../useListNav';
import { JobSpec } from '../routes';
import { theme } from '../theme';

type TaskState = {
    status: 'pending' | 'running' | 'done' | 'skipped' | 'error' | 'cancelled';
    /** documents (backup) or bytes (restore) processed */
    done: number;
    docs: number;
    note?: string;
};

/** UI refresh rate while a job runs: progress events are buffered in refs and flushed at this interval. */
const FLUSH_MS = 100;

export function RunScreen({ job }: { job: JobSpec }) {
    const ctx = useContext(AppContext);
    const { columns, rows } = useWindowSize();
    const states = useRef<TaskState[]>(job.tasks.map(() => ({ status: 'pending', done: 0, docs: 0 })));
    const current = useRef(-1);
    const dirty = useRef(true);
    const startedAt = useRef(Date.now());
    const [, setTick] = useState(0);
    const [phase, setPhase] = useState<JobPhase | 'starting'>('starting');
    const [summary, setSummary] = useState<JobSummary | null>(null);
    const [fatal, setFatal] = useState<string | null>(null);
    const [confirmCancel, setConfirmCancel] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const controller = useMemo(() => new AbortController(), []);
    const finished = summary !== null || fatal !== null;
    const nav = useListNav(job.tasks.length, { isActive: finished && !confirmCancel });

    // Throttled re-render: at most every FLUSH_MS when something changed, and once a second for the clock
    useEffect(() => {
        let ticks = 0;
        const id = setInterval(() => {
            ticks++;
            if (dirty.current || ticks % (1000 / FLUSH_MS) === 0) {
                dirty.current = false;
                setTick(t => t + 1);
            }
        }, FLUSH_MS);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        const events: JobEvents = {
            onPhase: p => setPhase(p),
            onTaskStart: i => {
                states.current[i].status = 'running';
                current.current = i;
                dirty.current = true;
            },
            onTaskProgress: (i, done, docs) => {
                states.current[i].done = done;
                states.current[i].docs = docs;
                dirty.current = true;
            },
            onTaskEnd: (i, result) => {
                const s = states.current[i];
                s.status = result.status;
                if (result.status === 'done') {
                    s.docs = result.docs;
                    s.done = job.tasks[i].total || result.docs;
                } else if (result.status === 'error') {
                    s.note = result.error;
                } else if (result.status === 'skipped') {
                    s.note = result.reason;
                }
                dirty.current = true;
            },
        };
        job.start(controller.signal, events).then(
            s => {
                setSummary(s);
                const firstError = s.results.findIndex(r => r.status === 'error');
                nav.setCursor(firstError >= 0 ? firstError : Math.max(0, current.current));
            },
            e => setFatal(errorMessage(e)),
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Ctrl+C while running asks to cancel instead of quitting
    useEffect(() => {
        if (finished) return;
        ctx.setInterruptHandler(() => setConfirmCancel(true));
        return () => ctx.setInterruptHandler(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [finished]);

    useInput((input, key) => {
        if (confirmCancel) {
            if (input === 'y') {
                controller.abort();
                setCancelling(true);
                setConfirmCancel(false);
            } else if (input === 'n' || key.escape) {
                setConfirmCancel(false);
            }
            return;
        }
        if (finished) {
            if (key.return || key.escape || input === 'q') job.onExit();
        } else if (key.escape || input === 'q') {
            if (!cancelling) setConfirmCancel(true);
        }
    });

    const list = states.current;
    const isRestore = job.kind === 'restore';
    const completed = list.filter(s => s.status === 'done' || s.status === 'skipped' || s.status === 'error').length;
    const failed = list.filter(s => s.status === 'error').length;
    const skipped = list.filter(s => s.status === 'skipped').length;
    const ok = list.filter(s => s.status === 'done').length;
    const docs = summary ? summary.docs : list.reduce((sum, s) => sum + (s.status === 'done' || s.status === 'running' ? s.docs : 0), 0);
    const elapsed = summary ? summary.elapsedMs : Date.now() - startedAt.current;
    const rate = elapsed > 0 ? Math.round(docs / (elapsed / 1000)) : 0;
    const barWidth = Math.max(10, Math.min(60, columns - 46));

    const idx = current.current;
    const task = idx >= 0 ? job.tasks[idx] : null;
    const state = idx >= 0 ? list[idx] : null;

    let phaseLabel: React.ReactNode;
    if (fatal) phaseLabel = <Text color={theme.danger}>✗ Failed</Text>;
    else if (summary) phaseLabel = summary.cancelled
        ? <Text color={theme.warn}>⊘ Cancelled</Text>
        : failed || summary.compressError ? <Text color={theme.warn}>✓ Finished with errors</Text> : <Text color={theme.ok}>✓ Completed</Text>;
    else if (cancelling) phaseLabel = <Text color={theme.warn}><Spinner color={theme.warn} /> Cancelling after the current batch...</Text>;
    else if (phase === 'compressing') phaseLabel = <Text><Spinner /> Compressing...</Text>;
    else phaseLabel = <Text><Spinner /> {job.kind === 'restore' ? 'Restoring' : job.kind === 'copy' ? 'Copying' : 'Backing up'}...</Text>;

    const icon = (s: TaskState) => {
        switch (s.status) {
            case 'done': return <Text color={theme.ok}>✓</Text>;
            case 'error': return <Text color={theme.danger}>✗</Text>;
            case 'skipped': return <Text color={theme.warn}>↷</Text>;
            case 'cancelled': return <Text color={theme.dim}>⊘</Text>;
            case 'running': return <Spinner />;
            default: return <Text color={theme.dim}>·</Text>;
        }
    };
    const detail = (s: TaskState, i: number) => {
        if (s.status === 'error' || s.status === 'skipped') return s.note ?? '';
        if (s.status === 'done') return `${formatNumber(s.docs)} docs`;
        if (s.status === 'running') return isRestore
            ? `${formatBytes(s.done)} / ${formatBytes(job.tasks[i].total)}`
            : `${formatNumber(s.done)} / ~${formatNumber(job.tasks[i].total)}`;
        return isRestore ? formatBytes(job.tasks[i].total) : `~${formatNumber(job.tasks[i].total)}`;
    };

    const hints: Hint[] = confirmCancel
        ? [['y', 'cancel job'], ['n', 'keep running']]
        : finished
            ? [['↑↓', 'scroll'], ['enter', 'done']]
            : [['esc', 'cancel']];

    return (
        <Frame title={job.title} hints={hints}>
            <Pane title="Progress" focused={!finished} borderColor={confirmCancel ? theme.warn : undefined}>
                <Row left={phaseLabel} right={`${formatDuration(elapsed)} · ${formatNumber(rate)} docs/s`} />
                <Box>
                    <Text color={theme.dim}>{'Collections '.padEnd(12)}</Text>
                    <ProgressBar ratio={job.tasks.length ? completed / job.tasks.length : 1} width={barWidth} color={failed ? theme.warn : theme.ok} />
                    <Text> {completed}/{job.tasks.length}</Text>
                    <Text color={theme.dim}>  {formatNumber(docs)} docs</Text>
                </Box>
                {task && state && !finished ? (
                    <Box>
                        <Text color={theme.dim}>{'Current '.padEnd(12)}</Text>
                        <ProgressBar ratio={task.total ? state.done / task.total : 0} width={barWidth} />
                        <Text wrap="truncate-end"> {task.db}.{task.collection}</Text>
                    </Box>
                ) : null}
                {confirmCancel ? (
                    <Text color={theme.warn}>Cancel? Finished collections are kept; the current one is discarded (y/n)</Text>
                ) : null}
                {fatal ? <Text color={theme.danger} wrap="truncate-end">{fatal}</Text> : null}
                {summary ? (
                    <Text>
                        <Text color={theme.ok}>{ok} ok</Text>
                        {failed ? <Text color={theme.danger}>  {failed} failed</Text> : null}
                        {skipped ? <Text color={theme.warn}>  {skipped} skipped</Text> : null}
                        {summary.output ? <Text color={theme.dim}>  → {summary.output}</Text> : null}
                    </Text>
                ) : null}
                {summary?.compressError ? <Text color={theme.danger} wrap="truncate-end">Compression failed: {summary.compressError} (folder kept)</Text> : null}
            </Pane>
            <Pane title="Collections" right={position(finished ? nav.cursor : Math.max(0, idx), job.tasks.length)} flexGrow={1}>
                <ListView
                    items={job.tasks}
                    cursor={finished ? nav.cursor : Math.max(0, idx)}
                    showCursor={finished}
                    height={Math.max(3, rows - 14)}
                    renderRow={(t, i, isCursor) => (
                        <Row
                            left={<Text>{icon(list[i])} {t.db}.{t.collection}</Text>}
                            right={<Text color={list[i].status === 'error' ? theme.danger : theme.dim}>{detail(list[i], i)}</Text>}
                            bold={isCursor}
                        />
                    )}
                />
            </Pane>
        </Frame>
    );
}
