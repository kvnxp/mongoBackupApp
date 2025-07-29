
import * as readline from 'readline';
import { MenuManager } from './MenuManager';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const menu = new MenuManager(rl);
menu.mainMenu();