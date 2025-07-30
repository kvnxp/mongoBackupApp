import * as readline from 'readline';
import { MongoBackup } from './MongoBackup';
import { MongoRestore } from './MongoRestore';

export class MenuManager {
    private rl: readline.Interface;
    mongoUrl: string;
    constructor(mongoUrl: string, rl: readline.Interface) {
        this.mongoUrl = mongoUrl;
        this.rl = rl;
    }
    showMenu() {
        console.log("\nMongoBackupApp CLI Menu:");
        console.log("1. Backup MongoDB");
        console.log("2. Restore MongoDB");
        console.log("0. Exit");
    }
    mainMenu() {
        this.showMenu();
        this.rl.question("Select an option: ", async (answer) => {
            switch (answer.trim()) {
                case '1':
                    this.rl.question("Enter project name for backup: ", async (projectName) => {
                        if (!projectName.trim()) {
                            console.log("Project name cannot be empty.");
                            this.mainMenu();
                            return;
                        }
                        await MongoBackup.backupMongoInteractive(projectName.trim(), this.rl, this.mongoUrl);
                        this.mainMenu();
                    });
                    break;
                case '2':
                    await MongoRestore.restoreMongoInteractive(this.rl, this.mongoUrl);
                    this.mainMenu();
                    break;
                case '0':
                    this.rl.close();
                    return;
                default:
                    console.log("Invalid option. Please try again.");
                    this.mainMenu();
            }
        });
    }
}
