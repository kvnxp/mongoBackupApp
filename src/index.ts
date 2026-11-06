import * as dotenv from 'dotenv';
import { parseCliArgs, printUsage, runCli, showCliHelp } from './cli';
import { errorMessage } from './utils';

dotenv.config({ quiet: true });

async function main(): Promise<void> {
    const args = parseCliArgs(process.argv.slice(2));

    if (args.action === 'help') {
        showCliHelp();
        return;
    }

    // CLI mode: -b/-r <name> with connection from -c or MONGOURI env
    if (args.action && args.backupName) {
        await runCli(args);
        return;
    }

    // Incomplete CLI flags — show usage
    if (args.action || args.connection || args.database || args.backupName) {
        printUsage();
        return;
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error('The interactive TUI needs a terminal. Use the CLI flags instead (see -h).');
        process.exitCode = 1;
        return;
    }

    // Loaded lazily so CLI mode does not pay for React/Ink startup
    const { startTui } = await import('./tui/App');
    await startTui({ debug: args.debug });
}

main().catch((error) => {
    console.error('Error:', errorMessage(error));
    process.exit(1);
});
