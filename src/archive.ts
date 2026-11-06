import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ZipArchive } from 'archiver';
import * as tar from 'tar';

export type CompressionKind = 'zip' | 'tar';

export type BackupEntry = {
    /** Folder name or archive file name */
    name: string;
    path: string;
    kind: 'folder' | CompressionKind;
    /** Archive size in bytes; folders report null */
    size: number | null;
    modified: Date;
};

export const ARCHIVE_RE = /\.(zip|tar)$/;

export async function compressZip(sourceDir: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = new ZipArchive({ zlib: { level: 9 } });

        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);

        archive.pipe(output);
        archive.directory(sourceDir, path.basename(sourceDir));
        archive.finalize();
    });
}

export async function compressTar(sourceDir: string, outputPath: string): Promise<void> {
    await tar.create(
        { file: outputPath, cwd: path.dirname(sourceDir), gzip: false },
        [path.basename(sourceDir)]
    );
}

/**
 * Packs `<folder>` into `<folder>.<kind>` next to it and removes the folder.
 * Returns the archive path.
 */
export async function compressFolder(folder: string, kind: CompressionKind): Promise<string> {
    const archivePath = `${folder}.${kind}`;
    if (kind === 'zip') {
        await compressZip(folder, archivePath);
    } else {
        await compressTar(folder, archivePath);
    }
    fs.rmSync(folder, { recursive: true, force: true });
    return archivePath;
}

export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
    if (archivePath.endsWith('.zip')) {
        const { default: extractZip } = await import('extract-zip');
        await extractZip(archivePath, { dir: destDir });
    } else if (archivePath.endsWith('.tar')) {
        await tar.extract({ file: archivePath, cwd: destDir });
    } else {
        throw new Error('Unsupported archive format. Use .zip or .tar');
    }
}

/**
 * Extracts an archive into a private temp dir (never inside the backup root,
 * so cleanup can never delete an existing uncompressed backup).
 * Returns the project folder inside it and a cleanup function.
 */
export async function openArchive(archivePath: string): Promise<{ projectDir: string; cleanup: () => void }> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mongobackup-'));
    const cleanup = () => fs.rmSync(tempDir, { recursive: true, force: true });
    try {
        await extractArchive(archivePath, tempDir);
    } catch (error) {
        cleanup();
        throw error;
    }
    // Archives contain the project folder; tolerate renamed archives with a single folder inside
    const expected = path.join(tempDir, path.basename(archivePath).replace(ARCHIVE_RE, ''));
    let projectDir = tempDir;
    if (fs.existsSync(expected)) {
        projectDir = expected;
    } else {
        const dirs = listSubdirs(tempDir);
        if (dirs.length === 1) projectDir = path.join(tempDir, dirs[0]);
    }
    return { projectDir, cleanup };
}

export function listSubdirs(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
}

/** Backup projects (folders) and archives in the backup root, newest first. */
export function listBackups(root: string): BackupEntry[] {
    if (!fs.existsSync(root)) return [];
    const entries: BackupEntry[] = [];
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, e.name);
        if (e.isDirectory()) {
            entries.push({ name: e.name, path: full, kind: 'folder', size: null, modified: fs.statSync(full).mtime });
        } else if (e.isFile() && ARCHIVE_RE.test(e.name)) {
            const stat = fs.statSync(full);
            entries.push({ name: e.name, path: full, kind: e.name.endsWith('.zip') ? 'zip' : 'tar', size: stat.size, modified: stat.mtime });
        }
    }
    return entries.sort((a, b) => b.modified.getTime() - a.modified.getTime() || a.name.localeCompare(b.name));
}
