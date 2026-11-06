import * as fs from 'fs';
import * as path from 'path';
import { BSON, Db, Document } from 'mongodb';
import { readJsonArray } from './jsonArrayStream';
import { indexSpecsOf, replaceCollection } from './replaceCollection';
const { EJSON } = BSON;

export type BackupFileInfo = { name: string; size: number };

export type RestoreProgress = { docs: number; bytes: number; totalBytes: number };

export type RestoreCollectionOptions = {
    /** Called after each inserted batch and at the end */
    onProgress?: (progress: RestoreProgress) => void;
    signal?: AbortSignal;
};

export class MongoRestore {
    // Deserialize Extended JSON to MongoDB types.
    // Also reads backups made by older versions ($oid, $date ISO string, $numberDecimal, $numberLong, $timestamp).
    static deserializeMongoTypes(obj: any): any {
        return EJSON.deserialize(obj, { relaxed: false });
    }

    /** Lists `<collection>.json` files in a backup folder and returns collection names. */
    static listBackupCollections(dir: string): string[] {
        return MongoRestore.listBackupFiles(dir).map(f => f.name);
    }

    /** Lists `<collection>.json` files in a backup folder with their size. */
    static listBackupFiles(dir: string): BackupFileInfo[] {
        return fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => ({ name: path.basename(f, '.json'), size: fs.statSync(path.join(dir, f)).size }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Replaces `collectionName` with the documents in `filePath`.
     * The file is streamed (see readJsonArray) and inserted in batches, so memory use
     * does not depend on the collection size.
     * Documents go into a temporary collection first (with the target's indexes);
     * the target is only replaced, via rename, once the whole file was read and inserted.
     * Any error (invalid JSON, duplicate key, connection loss, cancellation) drops the temporary
     * collection and leaves the target intact.
     * Returns the number of restored documents, or null when the file is empty (target untouched).
     */
    static async restoreCollection(db: Db, collectionName: string, filePath: string, options: RestoreCollectionOptions = {}): Promise<number | null> {
        const { onProgress, signal } = options;
        const totalBytes = fs.statSync(filePath).size;
        let bytes = 0;

        async function* documents(): AsyncGenerator<Document> {
            for await (const raw of readJsonArray(filePath, { onBytes: b => { bytes = b; } })) {
                yield MongoRestore.deserializeMongoTypes(raw);
            }
        }

        const count = await replaceCollection(db, collectionName, documents(), {
            // Keep the indexes the target already has (backups do not include indexes)
            indexes: () => indexSpecsOf(db, collectionName),
            onBatch: docs => onProgress?.({ docs, bytes, totalBytes }),
            signal,
        });
        if (count !== null) onProgress?.({ docs: count, bytes: totalBytes, totalBytes });
        return count;
    }
}
