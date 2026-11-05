import React, { useContext, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { checkMongoConnection, readDbConnections, saveDbConnections } from '../../config';
import { errorMessage, maskUri } from '../../utils';
import { AppContext } from '../context';
import { Frame, Pane, Spinner, TextInput } from '../components';
import { theme } from '../theme';
import { Route } from '../routes';

type Field = 'name' | 'url';

export function ConnectionFormScreen({ returnTo }: { returnTo?: Route }) {
    const ctx = useContext(AppContext);
    const [name, setName] = useState('');
    const [url, setUrl] = useState('mongodb://');
    const [focus, setFocus] = useState<Field>('name');
    const [testing, setTesting] = useState(false);
    const [lastFailed, setLastFailed] = useState(false);

    const save = () => {
        const conns = readDbConnections();
        saveDbConnections([...conns, { name: name.trim(), url: url.trim() }]);
        ctx.setStatus(`Saved connection ${name.trim()}`, 'ok');
        // Coming from the copy target list: highlight the new connection there
        ctx.navigate(returnTo?.name === 'copyTarget' ? { ...returnTo, preselect: name.trim() } : returnTo ?? { name: 'connections' });
    };

    const submit = async () => {
        const n = name.trim();
        const u = url.trim();
        if (!n) {
            setFocus('name');
            ctx.setStatus('Name is required', 'error');
            return;
        }
        if (readDbConnections().some(c => c.name.toLowerCase() === n.toLowerCase())) {
            setFocus('name');
            ctx.setStatus(`A connection named '${n}' already exists`, 'error');
            return;
        }
        if (!/^mongodb(\+srv)?:\/\/.+/.test(u)) {
            setFocus('url');
            ctx.setStatus('URL must start with mongodb:// or mongodb+srv://', 'error');
            return;
        }
        setTesting(true);
        ctx.setStatus('Testing connection...', 'info');
        try {
            await checkMongoConnection(u);
            save();
        } catch (error) {
            setTesting(false);
            setLastFailed(true);
            ctx.setStatus(`Connection failed: ${errorMessage(error)}  (Ctrl+S saves anyway)`, 'error');
        }
    };

    useInput((input, key) => {
        if (testing) return;
        if (key.escape) {
            ctx.clearStatus();
            ctx.navigate(returnTo ?? { name: 'connections' });
        } else if (key.tab || key.downArrow || key.upArrow) {
            setFocus(f => (f === 'name' ? 'url' : 'name'));
        } else if (key.ctrl && input === 's' && lastFailed) {
            save();
        }
    });

    const onNameSubmit = () => setFocus('url');
    const onUrlSubmit = () => void submit();

    const label = (field: Field, text: string) => (
        <Text color={focus === field ? theme.accent : theme.dim} bold={focus === field}>{text.padEnd(6)}</Text>
    );

    return (
        <Frame
            title="New connection"
            hints={[['tab', 'next field'], ['enter', focus === 'name' ? 'next' : 'test & save'], ['ctrl+u', 'clear'], ['esc', 'cancel']]}
        >
            <Pane title="Connection" focused>
                <Box>
                    {label('name', 'Name')}
                    <Box flexGrow={1}>
                        <TextInput value={name} onChange={setName} onSubmit={onNameSubmit} isActive={focus === 'name' && !testing} placeholder="e.g. production" />
                    </Box>
                </Box>
                <Box>
                    {label('url', 'URL')}
                    <Box flexGrow={1}>
                        {focus === 'url'
                            ? <TextInput value={url} onChange={setUrl} onSubmit={onUrlSubmit} isActive={!testing} placeholder="mongodb://user:pass@host:27017" />
                            : <Text wrap="truncate-start">{maskUri(url)}</Text>}
                    </Box>
                </Box>
            </Pane>
            <Box paddingX={1} flexDirection="column">
                {testing ? <Text><Spinner /> <Text color={theme.dim}>Testing connection...</Text></Text> : null}
                <Text color={theme.dim}>The URL is saved in ~/.mongobackupcli/MBConfig.json (permissions 0600).</Text>
            </Box>
        </Frame>
    );
}
