import * as readline from 'readline';

export function question(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise((resolve) => rl.question(prompt, resolve));
}

/**
 * Parses a selection typed by the user: a number (1-based), a name,
 * a comma separated list of both, or 'all'.
 * Returns null when nothing valid was selected.
 */
export function parseSelection(input: string, options: string[]): { selected: string[]; all: boolean } | null {
    const val = input.trim();
    if (val.toLowerCase() === 'all') {
        return { selected: [...options], all: true };
    }
    const selected: string[] = [];
    for (const part of val.split(',').map(s => s.trim()).filter(Boolean)) {
        if (/^\d+$/.test(part)) {
            const item = options[parseInt(part, 10) - 1];
            if (item) selected.push(item);
        } else if (options.includes(part)) {
            selected.push(part);
        }
    }
    return selected.length > 0 ? { selected: Array.from(new Set(selected)), all: false } : null;
}

/** Prints the numbered options and asks until the user enters a valid selection. */
export async function promptSelection(
    rl: readline.Interface,
    prompt: string,
    options: string[],
): Promise<{ selected: string[]; all: boolean }> {
    options.forEach((opt, idx) => console.log(`${idx + 1}. ${opt}`));
    while (true) {
        const result = parseSelection(await question(rl, prompt), options);
        if (result) return result;
        console.log('Invalid selection. Please try again.');
    }
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
