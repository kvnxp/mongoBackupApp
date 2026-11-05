import { createContext } from 'react';
import { MongoClient } from 'mongodb';
import { DbConnection } from '../config';
import { Tone } from './theme';
import { Route } from './routes';

export type Session = { conn: DbConnection; client: MongoClient };
export type Status = { text: string; tone: Tone } | null;

export type AppContextValue = {
    session: Session | null;
    backupRoot: string;
    status: Status;
    setStatus: (text: string, tone?: Tone) => void;
    clearStatus: () => void;
    navigate: (route: Route) => void;
    /** Connects to `conn` and replaces the current session. Throws on failure. */
    connect: (conn: DbConnection) => Promise<void>;
    disconnect: () => Promise<void>;
    quit: () => void;
    /** While set, Ctrl+C calls this instead of quitting (used by running jobs). */
    setInterruptHandler: (handler: (() => void) | null) => void;
};

export const AppContext = createContext<AppContextValue>(null as unknown as AppContextValue);
