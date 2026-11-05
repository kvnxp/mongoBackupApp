# mongoBackupApp

A Node.js application for backing up and restoring MongoDB databases. This app provides utilities to export and import collections as JSON files, making it easy to manage database snapshots for development, testing, and production environments.

## Features
- Backup MongoDB collections to JSON files
- Restore collections from JSON files
- Full screen TUI (Ink) to manage connections, back up and restore with live progress
- Copy selected collections directly to another server (saved or new connection)
- Connection profiles management (add, delete, test connections)
- CLI mode for quick backup/restore operations
- Compress backups as `.zip` or `.tar`
- Auto-detect archive format on restore
- Two connection modes: profiles from MBConfig.json or `.env` variables
- Cross-platform support (Windows, Linux, macOS)
- Organized backup structure by project, database, and collection

## Project Structure
```
backup/
  ExampleOrg/
    Production/
      products.json
      users.json
    Staging/
      products.json
      orders.json
      invoices.json
src/
  index.ts          entry: CLI flags or TUI
  cli.ts            CLI mode
  jobs.ts           backup/restore jobs shared by CLI and TUI
  MongoBackup.ts    MongoRestore.ts  jsonArrayStream.ts  archive.ts  config.ts
  tui/              Ink screens and components
tests/
docs/               architecture and structure
.env.example
```

## Getting Started

### Prerequisites
- [Bun](https://bun.sh) 1.2+
- MongoDB instance

### Installation
1. Clone the repository:
   ```sh
   git clone https://github.com/yourusername/mongoBackupApp.git
   cd mongoBackupApp
   ```
2. Install dependencies:
   ```sh
   bun install
   ```
3. (Optional) Create a `.env` file for CLI mode:
   ```sh
   cp .env.example .env
   ```
   Edit `.env` with your MongoDB URI and default database name.

## Usage

### Interactive Mode (TUI)
Start the app without arguments in a terminal to open the full screen TUI:
```sh
bun run dev
# or the compiled binary
./build/app-current
```

```
 MongoBackupApp  ›  Backup · select collections                 ● production
╭ Databases ──────────── 2/3 ╮╭ Collections · shop ─────────────────── 1/3 ╮
│   [ ] blog         1.2 MB  ││ ❯ [x] orders                   12,300 docs │
│ ❯ [-] shop          48 MB  ││   [ ] products                    800 docs │
│   [ ] stats        320 KB  ││   [x] users                     5,000 docs │
╰────────────────────────────╯╰────────────────────────────────────────────╯
 2 collection(s) in 1 database(s) selected · ~17,300 docs
 ↑↓ move  tab/←→ switch pane  space toggle  a toggle all  enter continue  esc back
```

Screens:
- **Connections**: pick a saved connection (`enter`), add (`n`), test (`t`) or delete (`d`) one. Passwords are shown masked.
- **Home**: server version and size, backup root, and the actions Backup (`b`), Restore (`r`), Change connection (`c`), Quit (`q`).
- **Backup**: select databases and collections in two panes (document counts are shown), then choose the destination:
  - **Files**: a name and a format (folder, `.zip` or `.tar`).
  - **Another server**: pick a saved connection or create a new one, review which collections already exist there (they will be replaced) and confirm. Collections are copied directly between servers with their types, indexes and collection options; each one is swapped in only after it was fully copied.
- **Restore**: pick a backup folder or archive (newest first), select databases and collections, and confirm. Each collection is replaced only after its whole file was imported.
- **Progress**: live progress per collection, documents per second, and a summary at the end. `esc` or `Ctrl+C` asks to cancel; finished collections are kept and the current one is discarded.

Keys: `↑↓`/`j k` move, `PgUp/PgDn`, `g/G` first/last, `space` toggle, `a` toggle all, `tab` switch pane or field, `enter` confirm, `esc` back, `Ctrl+C` cancel a running job or quit.

The TUI needs an interactive terminal. When stdin/stdout are not a TTY, use the CLI flags.

### CLI Mode
Run backup/restore operations directly from the command line.

#### Help
```sh
mongobackupcli -h
```

#### Backup
Using a connection from MBConfig.json:
```sh
mongobackupcli -c <connection> -d <database> -b <backup-name>
```

Compress the backup:
```sh
mongobackupcli -c <connection> -d <database> -b <backup-name> -zip
mongobackupcli -c <connection> -d <database> -b <backup-name> -tar
```

Using `.env` variables:
```sh
mongobackupcli -b <backup-name> -zip
```

#### Restore
Auto-detects `.zip` or `.tar` from the filename:
```sh
mongobackupcli -c <connection> -d <database> -r <backup-name>.zip
mongobackupcli -c <connection> -d <database> -r <backup-name>.tar
```

Using `.env` variables:
```sh
mongobackupcli -r <backup-name>.zip
```

#### CLI Options
| Flag | Description | Required |
|------|-------------|----------|
| `-c` | Connection name from MBConfig.json | Yes, unless `MONGOURI` is set in `.env` |
| `-d` | Database name | Yes, unless `DBNAME` is set in `.env` |
| `-b` | Backup mode with project name | One of `-b` or `-r` required |
| `-r` | Restore mode (auto-detects archive format) | One of `-b` or `-r` required |
| `-zip` | Compress backup as `.zip` | Optional (backup only) |
| `-tar` | Compress backup as `.tar` | Optional (backup only) |
| `-h` | Show help message | No |

#### Examples
```sh
# Backup using MBConfig.json connection
mongobackupcli -c personal -d mydb -b backup-lunes

# Backup with zip compression
mongobackupcli -c personal -d mydb -b backup-lunes -zip

# Backup with tar compression
mongobackupcli -c personal -d mydb -b backup-lunes -tar

# Backup using .env
mongobackupcli -b backup-lunes -zip

# Restore from zip (auto-detected)
mongobackupcli -c personal -d mydb -r backup-lunes.zip

# Restore from tar (auto-detected)
mongobackupcli -c personal -d mydb -r backup-lunes.tar
```

## Configuration

### Environment Variables
Create a `.env` file (see `.env.example`) with:
```env
MONGOURI=mongodb://localhost:27017
DBNAME=mydb
BACKUPDIR=./backup
```

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGOURI` | MongoDB connection URI | - |
| `DBNAME` | Default database name | - |
| `BACKUPDIR` | Directory for backups | `./backup` |

### Connection Profiles
Connections are stored in `~/.mongobackupcli/MBConfig.json` on all platforms:
- Windows: `C:\Users\<username>\.mongobackupcli\MBConfig.json`
- Linux/macOS: `/home/<username>/.mongobackupcli/MBConfig.json`

The directory is created automatically if it doesn't exist.

### Backup Structure
Backups are organized as:
```
BACKUPDIR/
  <backup-name>/
    <database>/
      <collection>.json
```

Compressed archives:
```
BACKUPDIR/
  <backup-name>.zip
  <backup-name>.tar
```

> **Note:** All data in this repository and examples are for demonstration purposes only. Do not use real customer or sensitive data.

## Contributing
Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License
MIT
