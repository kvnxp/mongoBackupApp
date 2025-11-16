import * as readline from 'readline';
import { MongoBackup } from './MongoBackup';
import { MongoRestore } from './MongoRestore';

type DbConnection = {
    name: string;
    url: string;
};

export class MenuManager {
    private rl: readline.Interface;
    mongoUrl: string;
    selectedDb: string;
    private conns: DbConnection[];
    private saveConns: (conns: DbConnection[]) => void;

    constructor(mongoUrl: string, selectedDb: string, rl: readline.Interface, conns: DbConnection[], saveConns: (conns: DbConnection[]) => void) {
        this.mongoUrl = mongoUrl;
        this.selectedDb = selectedDb;
        this.rl = rl;
        this.conns = conns;
        this.saveConns = saveConns;
    }
    showMenu() {
        console.log("\n🔧 MongoBackupApp CLI Menu:");
        console.log("b. 💾 Backup MongoDB");
        console.log("r. 🔄 Restore MongoDB");
        console.log("x. 🚪 Exit");
    }
    mainMenu() {
        this.showMenu();
        this.rl.question("Select an option: ", async (answer) => {
            switch (answer.trim().toLowerCase()) {
                case 'b':
                    this.rl.question("Enter project name for backup: ", async (projectName) => {
                        if (!projectName.trim()) {
                            console.log("Project name cannot be empty.");
                            this.mainMenu();
                            return;
                        }
                        await MongoBackup.backupMongoInteractive(projectName.trim(), this.selectedDb, this.rl, this.mongoUrl);
                        this.mainMenu();
                    });
                    break;
                case 'r':
                    await MongoRestore.restoreMongoInteractive(this.rl, this.mongoUrl);
                    this.mainMenu();
                    break;
                case 'x':
                    this.rl.close();
                    return;
                default:
                    console.log("Invalid option. Please try again.");
                    this.mainMenu();
            }
        });
    }

    async doBackup() {
        return new Promise<void>((resolve) => {
            this.rl.question("Enter project name for backup: ", async (projectName) => {
                if (!projectName.trim()) {
                    console.log("Project name cannot be empty.");
                    resolve();
                    return;
                }
                await MongoBackup.backupMongoInteractive(projectName.trim(), this.selectedDb, this.rl, this.mongoUrl);
                resolve();
            });
        });
    }

    async doRestore() {
        await MongoRestore.restoreMongoInteractive(this.rl, this.mongoUrl);
    }
}
