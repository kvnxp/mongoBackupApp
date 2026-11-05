import * as fs from 'fs';
import * as path from 'path';
import { BSON, Db, MongoClient } from 'mongodb';
import { throwIfAborted } from './utils';
const { EJSON } = BSON;

export const SYSTEM_DATABASES = ['admin', 'local', 'config'];

export type DatabaseInfo = { name: string; sizeOnDisk: number };
export type CollectionInfo = { name: string; count: number };

export type BackupCollectionOptions = {
    /** Called with the number of documents written so far (every 200 documents and at the end) */
    onProgress?: (docs: number) => void;
    signal?: AbortSignal;
};

export class MongoBackup {
    // Serialize MongoDB types to canonical Extended JSON (keeps Int32/Double/Long/Binary/etc.)
    static serializeMongoTypes(obj: any): any {
        return EJSON.serialize(obj, { relaxed: false });
    }

    /** User databases (admin, local and config excluded), sorted by name. */
    static async listDatabases(client: MongoClient): Promise<DatabaseInfo[]> {
        const { databases } = await client.db().admin().listDatabases();
        return databases
            .filter(db => !SYSTEM_DATABASES.includes(db.name))
            .map(db => ({ name: db.name, sizeOnDisk: Number(db.sizeOnDisk ?? 0) }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    /** Lists real collections (no views, no system collections). */
    static async listCollectionNames(db: Db): Promise<string[]> {
        const cols = await db.listCollections({ type: 'collection' }, { nameOnly: true }).toArray();
        return cols.map(c => c.name).filter(name => !name.startsWith('system.')).sort();
    }

    /** Collections with their estimated document count (metadata only, no scan). */
    static async listCollections(db: Db): Promise<CollectionInfo[]> {
        const names = await MongoBackup.listCollectionNames(db);
        return Promise.all(names.map(async name => ({
            name,
            count: await db.collection(name).estimatedDocumentCount().catch(() => 0),
        })));
    }

    /**
     * Streams one collection to `<dir>/<collection>.json` as a JSON array.
     * Writes to a temporary file first so an interrupted or cancelled backup never leaves a truncated .json.
     * Returns the number of documents written.
     */
    static async backupCollection(db: Db, collectionName: string, dir: string, options: BackupCollectionOptions = {}): Promise<number> {
        const { onProgress, signal } = options;
        const filePath = path.join(dir, `${collectionName}.json`);
        const tmpPath = `${filePath}.tmp`;
        const fd = fs.openSync(tmpPath, 'w');
        let count = 0;
        try {
            throwIfAborted(signal);
            fs.writeSync(fd, '[');
            // promoteValues: false keeps Int32/Double/Long wrappers so their type survives the round trip
            const cursor = db.collection(collectionName).find({}, { promoteValues: false, promoteLongs: false });
            try {
                for await (const doc of cursor) {
                    fs.writeSync(fd, (count === 0 ? '\n' : ',\n') + EJSON.stringify(doc, undefined, 2, { relaxed: false }));
                    count++;
                    if (count % 200 === 0) {
                        onProgress?.(count);
                        throwIfAborted(signal);
                    }
                }
            } finally {
                await cursor.close();
            }
            fs.writeSync(fd, count === 0 ? ']\n' : '\n]\n');
            fs.closeSync(fd);
        } catch (error) {
            fs.closeSync(fd);
            fs.rmSync(tmpPath, { force: true });
            throw error;
        }
        fs.renameSync(tmpPath, filePath);
        onProgress?.(count);
        return count;
    }
}
