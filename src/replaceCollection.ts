import { Collection, Db, Document, IndexDescription } from 'mongodb';
import { throwIfAborted } from './utils';

export const INSERT_BATCH_SIZE = 1000;

export type ReplaceCollectionOptions = {
    /** Indexes to create on the new collection (the `_id_` index is skipped). Resolved after the first batch is ready. */
    indexes: () => Promise<Document[]>;
    /** Options for creating the new collection (validator, collation, capped...). Default: none */
    collectionOptions?: () => Promise<Document | undefined>;
    /** Called after each inserted batch with the total documents inserted so far */
    onBatch?: (docs: number) => void;
    signal?: AbortSignal;
};

/** Index definitions of a collection, ready for createIndexes (empty when it does not exist). */
export async function indexSpecsOf(db: Db, collectionName: string): Promise<Document[]> {
    const exists = (await db.listCollections({ name: collectionName }, { nameOnly: true }).toArray()).length > 0;
    if (!exists) return [];
    return db.collection(collectionName).listIndexes().toArray();
}

function toIndexDescriptions(specs: Document[]): IndexDescription[] {
    return specs
        .filter(idx => idx.name !== '_id_')
        .map(({ v, ns, ...spec }) => spec as IndexDescription);
}

/**
 * Atomically replaces `collectionName` in `db` with `docs`.
 * Documents are inserted in batches into `<name>.__restore_tmp_<ts>` (created with `indexes`);
 * only after `docs` is fully consumed the temp collection is renamed over the target.
 * Any error or cancellation drops the temp collection and leaves the target untouched.
 * Returns the number of documents, or null when `docs` is empty (target untouched).
 */
export async function replaceCollection(db: Db, collectionName: string, docs: AsyncIterable<Document>, options: ReplaceCollectionOptions): Promise<number | null> {
    const { indexes, collectionOptions, onBatch, signal } = options;
    const tmp: Collection = db.collection(`${collectionName}.__restore_tmp_${Date.now()}`);
    let prepared = false;
    let count = 0;
    let batch: Document[] = [];

    const flush = async () => {
        if (batch.length === 0) return;
        throwIfAborted(signal);
        if (!prepared) {
            prepared = true;
            const createOptions = collectionOptions ? await collectionOptions() : undefined;
            if (createOptions && Object.keys(createOptions).length > 0) await db.createCollection(tmp.collectionName, createOptions);
            const specs = toIndexDescriptions(await indexes());
            if (specs.length > 0) await tmp.createIndexes(specs);
        }
        await tmp.insertMany(batch);
        count += batch.length;
        batch = [];
        onBatch?.(count);
    };

    try {
        throwIfAborted(signal);
        for await (const doc of docs) {
            batch.push(doc);
            if (batch.length >= INSERT_BATCH_SIZE) await flush();
        }
        await flush();
        if (count === 0) return null;
        throwIfAborted(signal);
        await tmp.rename(collectionName, { dropTarget: true });
    } catch (error) {
        if (prepared) await tmp.drop().catch(() => {});
        throw error;
    }
    return count;
}
