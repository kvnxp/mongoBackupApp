import { MongoClient } from 'mongodb';

/**
 * Returns a MongoClient instance for the given MongoDB connection URL.
 * @param urlMongo - The MongoDB connection string selected from the menu.
 */
export function getMongoClient(urlMongo: string): MongoClient {
    return new MongoClient(urlMongo);
}
