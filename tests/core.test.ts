import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseCliArgs } from '../src/cli';
import { compressFolder, listBackups, openArchive } from '../src/archive';
import { defaultProjectName, formatBytes, formatDuration, isValidProjectName, maskUri } from '../src/utils';

describe('parseCliArgs', () => {
    test('backup with connection, database and compression', () => {
        expect(parseCliArgs(['-c', 'prod', '-d', 'shop', '-b', 'snap', '-zip'])).toEqual({
            action: 'backup', connection: 'prod', database: 'shop', backupName: 'snap', compress: 'zip', debug: false,
        });
    });

    test('a following flag is not taken as a value', () => {
        const args = parseCliArgs(['-b', '-zip']);
        expect(args.backupName).toBeNull();
        expect(args.compress).toBe('zip');
    });

    test('restore, help and debug', () => {
        expect(parseCliArgs(['-r', 'snap.tar']).action).toBe('restore');
        expect(parseCliArgs(['-r', 'snap.tar']).backupName).toBe('snap.tar');
        expect(parseCliArgs(['-h']).action).toBe('help');
        expect(parseCliArgs(['-D']).debug).toBe(true);
        expect(parseCliArgs([]).action).toBeNull();
    });
});

describe('utils', () => {
    test('maskUri hides only the password', () => {
        expect(maskUri('mongodb://user:p@ss:w0rd@host:27017/db')).toBe('mongodb://user:****@host:27017/db');
        expect(maskUri('mongodb+srv://u:x@cluster.example.net')).toBe('mongodb+srv://u:****@cluster.example.net');
        expect(maskUri('mongodb://localhost:27017')).toBe('mongodb://localhost:27017');
    });

    test('isValidProjectName', () => {
        expect(isValidProjectName('backup-1')).toBe(true);
        expect(isValidProjectName('  ')).toBe(false);
        expect(isValidProjectName('a/b')).toBe(false);
        expect(isValidProjectName('a\\b')).toBe(false);
        expect(isValidProjectName('..')).toBe(false);
    });

    test('formatters', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
        expect(formatDuration(5_000)).toBe('5s');
        expect(formatDuration(125_000)).toBe('2m 5s');
        expect(defaultProjectName(new Date(2026, 0, 2, 3, 4))).toBe('backup-20260102-0304');
    });
});

describe('archive', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mbtest-archive-'));
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    function makeProject(name: string) {
        const dir = path.join(root, name, 'shop');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'users.json'), '[{"_id":1}]');
        return path.join(root, name);
    }

    for (const kind of ['zip', 'tar'] as const) {
        test(`${kind}: compress, list and open in a temp dir`, async () => {
            const folder = makeProject(`p-${kind}`);
            const archive = await compressFolder(folder, kind);
            expect(archive).toBe(`${folder}.${kind}`);
            expect(fs.existsSync(folder)).toBe(false);

            const entry = listBackups(root).find(e => e.name === `p-${kind}.${kind}`)!;
            expect(entry.kind).toBe(kind);
            expect(entry.size).toBeGreaterThan(0);

            const { projectDir, cleanup } = await openArchive(archive);
            expect(projectDir.startsWith(os.tmpdir()) || projectDir.startsWith(fs.realpathSync(os.tmpdir()))).toBe(true);
            expect(fs.readFileSync(path.join(projectDir, 'shop', 'users.json'), 'utf8')).toBe('[{"_id":1}]');
            cleanup();
            expect(fs.existsSync(projectDir)).toBe(false);
        });
    }

    test('opening a renamed archive still finds the single project folder', async () => {
        const archive = await compressFolder(makeProject('original'), 'zip');
        const renamed = path.join(root, 'renamed.zip');
        fs.renameSync(archive, renamed);
        const { projectDir, cleanup } = await openArchive(renamed);
        expect(fs.existsSync(path.join(projectDir, 'shop', 'users.json'))).toBe(true);
        cleanup();
    });

    test('listBackups lists folders and archives, ignores other files', () => {
        fs.writeFileSync(path.join(root, 'notes.txt'), 'x');
        const names = listBackups(root).map(e => e.name);
        expect(names).toContain('renamed.zip');
        expect(names).not.toContain('notes.txt');
        expect(listBackups(path.join(root, 'missing'))).toEqual([]);
    });
});
