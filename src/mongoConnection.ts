import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
dotenv.config();

const urlMongo = process.env.MONGO_URL;
export const mongoClient = new MongoClient(urlMongo as string);
