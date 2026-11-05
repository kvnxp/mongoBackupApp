import React, { useCallback, useMemo, useRef, useState } from 'react';
import { render, useApp, useInput } from 'ink';
import { getInteractiveClient } from '../mongoConnection';
import { DbConnection, getBackupRoot } from '../config';
import { AppContext, AppContextValue, Session, Status } from './context';
import { Route } from './routes';
import { Tone } from './theme';
import { runCleanups } from './cleanup';
import { ConnectionsScreen } from './screens/ConnectionsScreen';
import { ConnectionFormScreen } from './screens/ConnectionFormScreen';
import { HomeScreen } from './screens/HomeScreen';
import { BackupOptionsScreen, BackupSelectScreen } from './screens/BackupScreens';
import { RestoreConfirmScreen, RestorePickScreen, RestoreSelectScreen } from './screens/RestoreScreens';
import { RunScreen } from './screens/RunScreen';
import { CopyConfirmScreen, CopyTargetScreen } from './screens/CopyScreens';

export function App({ initialRoute = { name: 'connections' } }: { initialRoute?: Route }) {
    const { exit } = useApp();
    const [route, setRoute] = useState<Route>(initialRoute);
    const [session, setSession] = useState<Session | null>(null);
    const [status, setStatusState] = useState<Status>(null);
    const sessionRef = useRef<Session | null>(null);
    const interruptRef = useRef<(() => void) | null>(null);
    const backupRoot = useMemo(() => getBackupRoot(), []);

    const closeSession = useCallback(async () => {
        const s = sessionRef.current;
        sessionRef.current = null;
        setSession(null);
        if (s) await s.client.close().catch(() => {});
    }, []);

    const ctx: AppContextValue = useMemo(() => ({
        session,
        backupRoot,
        status,
        setStatus: (text: string, tone: Tone = 'info') => setStatusState({ text, tone }),
        clearStatus: () => setStatusState(null),
        navigate: (r: Route) => setRoute(r),
        connect: async (conn: DbConnection) => {
            const client = getInteractiveClient(conn.url);
            try {
                await client.connect();
                await client.db().admin().ping();
            } catch (error) {
                await client.close().catch(() => {});
                throw error;
            }
            await closeSession();
            const s = { conn, client };
            sessionRef.current = s;
            setSession(s);
        },
        disconnect: closeSession,
        quit: () => {
            runCleanups();
            void closeSession().finally(() => exit());
        },
        setInterruptHandler: (handler) => { interruptRef.current = handler; },
    }), [session, backupRoot, status, closeSession, exit]);

    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            if (interruptRef.current) interruptRef.current();
            else ctx.quit();
        }
    });

    let screen: React.ReactNode;
    switch (route.name) {
        case 'connections': screen = <ConnectionsScreen />; break;
        case 'connectionForm': screen = <ConnectionFormScreen returnTo={route.returnTo} />; break;
        case 'home': screen = <HomeScreen />; break;
        case 'backupSelect': screen = <BackupSelectScreen selection={route.selection} />; break;
        case 'backupOptions': screen = <BackupOptionsScreen selection={route.selection} tasks={route.tasks} destination={route.destination} />; break;
        case 'copyTarget': screen = <CopyTargetScreen selection={route.selection} tasks={route.tasks} preselect={route.preselect} />; break;
        case 'copyConfirm': screen = <CopyConfirmScreen selection={route.selection} tasks={route.tasks} target={route.target} existing={route.existing} closeTarget={route.closeTarget} />; break;
        case 'restorePick': screen = <RestorePickScreen />; break;
        case 'restoreSelect': screen = <RestoreSelectScreen source={route.source} selection={route.selection} />; break;
        case 'restoreConfirm': screen = <RestoreConfirmScreen source={route.source} selection={route.selection} tasks={route.tasks} />; break;
        case 'run': screen = <RunScreen job={route.job} />; break;
    }

    // Screens that need a connection fall back to the connection list
    const needsSession = route.name !== 'connections' && route.name !== 'connectionForm';
    if (needsSession && !session) screen = <ConnectionsScreen />;

    return <AppContext.Provider value={ctx}>{screen}</AppContext.Provider>;
}

export async function startTui(_options: { debug?: boolean } = {}): Promise<void> {
    const instance = render(<App />, {
        alternateScreen: true,
        exitOnCtrlC: false,
        incrementalRendering: true,
        maxFps: 30,
    });
    try {
        await instance.waitUntilExit();
    } finally {
        runCleanups();
    }
}
