import { MongoClient, MongoClientOptions } from 'mongodb';

/** Default server selection timeout for interactive connections (the driver default is 30 s). */
export const DEFAULT_SELECTION_TIMEOUT_MS = 8000;

/**
 * Returns a MongoClient instance for the given MongoDB connection URL.
 * @param urlMongo - The MongoDB connection string selected from the menu.
 */
export function getMongoClient(urlMongo: string, options?: MongoClientOptions): MongoClient {
    return new MongoClient(urlMongo, options);
}

/**
 * Client with a short server selection timeout, unless the URL already sets one
 * (options passed to the driver would override the URL).
 */
export function getInteractiveClient(urlMongo: string, timeoutMs = DEFAULT_SELECTION_TIMEOUT_MS): MongoClient {
    const urlSetsTimeout = /[?&]serverSelectionTimeoutMS=/i.test(urlMongo);
    return getMongoClient(urlMongo, urlSetsTimeout ? undefined : { serverSelectionTimeoutMS: timeoutMs });
}
