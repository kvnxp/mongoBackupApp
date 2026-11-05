import { JobEvents, JobSummary, Task } from '../jobs';
import { Session } from './context';

/** Selected collections per database. */
export type Selection = Map<string, Set<string>>;

/** A backup opened for restore: a folder in the backup root or an extracted archive. */
export type RestoreSource = {
    label: string;
    projectDir: string;
    /** Removes the extracted temp dir (archives only) */
    cleanup?: () => void;
};

export type JobSpec = {
    kind: 'backup' | 'restore' | 'copy';
    title: string;
    tasks: Task[];
    start: (signal: AbortSignal, events: JobEvents) => Promise<JobSummary>;
    onExit: () => void;
};

export type Route =
    | { name: 'connections' }
    /** `returnTo`: where to go after saving or cancelling (default: connection list) */
    | { name: 'connectionForm'; returnTo?: Route }
    | { name: 'home' }
    | { name: 'backupSelect'; selection?: Selection }
    | { name: 'backupOptions'; selection: Selection; tasks: Task[]; destination?: 'file' | 'server' }
    /** Pick the server to copy the selected collections to; `preselect` highlights a connection by name */
    | { name: 'copyTarget'; selection: Selection; tasks: Task[]; preselect?: string }
    /**
     * `existing`: "db.collection" keys that already exist on the target and will be replaced.
     * `closeTarget`: closes the target connection (idempotent).
     */
    | { name: 'copyConfirm'; selection: Selection; tasks: Task[]; target: Session; existing: Set<string>; closeTarget: () => void }
    | { name: 'restorePick' }
    | { name: 'restoreSelect'; source: RestoreSource; selection?: Selection }
    | { name: 'restoreConfirm'; source: RestoreSource; selection: Selection; tasks: Task[] }
    | { name: 'run'; job: JobSpec };
