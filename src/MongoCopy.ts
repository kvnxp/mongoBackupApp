import { Db, Document, MongoClient } from 'mongodb';
import { indexSpecsOf, replaceCollection } from './replaceCollection';

export type CopyCollectionOptions = {
    /** Called after each inserted batch with the documents copied so far */
    onProgress?: (docs: number) => void;
    signal?: AbortSignal;
};

/**
 * Best-effort identity of the server behind a client: `host:pid` from serverStatus,
 * or the replica set member from `hello`. Null when neither is available (missing privileges).
 */
export async function serverFingerprint(client: MongoClient): Promise<string | null> {
    const admin = client.db().admin();
    try {
        const status = await admin.command({ serverStatus: 1, repl: 0, metrics: 0, locks: 0, wiredTiger: 0 });
        if (status.host && status.pid !== undefined) return `${status.host}:${status.pid}`;
    } catch {
        // not authorized: fall back to hello
    }
    try {
        const hello = await admin.command({ hello: 1 });
        if (hello.setName && hello.me) return `${hello.setName}/${hello.me}`;
    } catch {
        // ignore
    }
    return null;
}

/** True when both clients are known to point at the same server (copying would overwrite the source). */
export async function isSameServer(a: MongoClient, b: MongoClient): Promise<boolean> {
    const [fa, fb] = await Promise.all([serverFingerprint(a), serverFingerprint(b)]);
    return fa !== null && fa === fb;
}

export class MongoCopy {
    /**
     * Copies `collectionName` from `source` to `target` (usually another server), replacing it there.
     * Documents stream from a cursor straight into the target (no files, no EJSON), keeping every BSON type.
     * The target collection is created with the source's options and indexes and only swapped in
     * (temp collection + rename) after every document was copied; on error or cancellation it is untouched.
     * Returns the number of copied documents, or null when the source is empty (target untouched).
     */
    static async copyCollection(source: Db, target: Db, collectionName: string, options: CopyCollectionOptions = {}): Promise<number | null> {
        const { onProgress, signal } = options;
        const cursor = source.collection(collectionName).find({}, { promoteValues: false, promoteLongs: false, batchSize: 1000 });

        async function* documents(): AsyncGenerator<Document> {
            try {
                for await (const doc of cursor) yield doc;
            } finally {
                await cursor.close();
            }
        }

        return replaceCollection(target, collectionName, documents(), {
            indexes: () => indexSpecsOf(source, collectionName),
            collectionOptions: async () => {
                const [info] = await source.listCollections({ name: collectionName }).toArray();
                return (info as Document | undefined)?.options;
            },
            onBatch: onProgress,
            signal,
        });
    }
}
