import * as readline from 'readline';
import { MongoBackup } from './MongoBackup';
import { MongoRestore } from './MongoRestore';
import { errorMessage, question } from './selection';

export class MenuManager {
    private rl: readline.Interface;
    mongoUrl: string;
    private debugMode: boolean;
    private backupRoot: string;

    constructor(mongoUrl: string, rl: readline.Interface, debugMode: boolean, backupRoot: string) {
        this.mongoUrl = mongoUrl;
        this.rl = rl;
        this.debugMode = debugMode;
        this.backupRoot = backupRoot;
    }

    async doBackup() {
        const projectName = (await question(this.rl, "Enter project name for backup: ")).trim();
        if (!projectName) {
            console.log("Project name cannot be empty.");
            return;
        }
        try {
            await MongoBackup.backupMongoInteractive(projectName, this.mongoUrl, this.rl, this.debugMode, this.backupRoot);
        } catch (error) {
            console.error('Backup failed:', errorMessage(error));
        }
    }

    async doRestore() {
        try {
            await MongoRestore.restoreMongoInteractive(this.rl, this.mongoUrl, this.debugMode, this.backupRoot);
        } catch (error) {
            console.error('Restore failed:', errorMessage(error));
        }
    }
}
