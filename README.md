# mongoBackupApp

A Node.js application for backing up and restoring MongoDB databases. This app provides utilities to export and import collections as JSON files, making it easy to manage database snapshots for development, testing, and production environments.

## Features
- Backup MongoDB collections to JSON files
- Restore collections from JSON files
- Interactive menu for selecting and managing MongoDB connections
- Connection profiles management (add, delete, test connections)
- CLI mode for quick backup/restore operations
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
  index.ts
  MenuManager.ts
  MongoBackup.ts
  mongoConnection.ts
  MongoRestore.ts
.env.example
```

## Getting Started

### Prerequisites
- Node.js (v18+ recommended)
- npm or bun
- MongoDB instance

### Installation
1. Clone the repository:
   ```sh
   git clone https://github.com/yourusername/mongoBackupApp.git
   cd mongoBackupApp
   ```
2. Install dependencies:
   ```sh
   npm install
   # or
   bun install
   ```
3. (Optional) Create a `.env` file for CLI mode:
   ```sh
   cp .env.example .env
   ```
   Edit `.env` with your MongoDB URI and default database name.

## Usage

### Interactive Mode
Start the app without arguments to enter the interactive menu:
```sh
bun run src/index.ts
```

#### Initial Menu
- **Connection list**: Choose from saved connections by number
- **p. Profiles Operations**: Manage connection profiles

#### Profiles Operations
From the initial menu, select `p` to access:
- **n. Add new connection**: Create and test a new MongoDB connection
- **d. Delete a connection**: Remove an existing connection profile
- **t. Test a connection**: Verify connectivity to a saved connection
- **b. Back to initial menu**: Return to main menu

#### Main Menu (after selecting connection)
- **b. Backup MongoDB**: Export collections to JSON files
- **r. Restore MongoDB**: Import collections from JSON files
- **c. Back to select connection**: Return to connection list
- **x. Exit**: Quit the app

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

Using `.env` variables:
```sh
mongobackupcli -b <backup-name>
```

#### Restore
Using a connection from MBConfig.json:
```sh
mongobackupcli -c <connection> -d <database> -r <backup-name>
```

Using `.env` variables:
```sh
mongobackupcli -r <backup-name>
```

#### CLI Options
| Flag | Description | Required |
|------|-------------|----------|
| `-c` | Connection name from MBConfig.json | Yes, unless `MONGOURI` is set in `.env` |
| `-d` | Database name | Yes, unless `DBNAME` is set in `.env` |
| `-b` | Backup mode with project name | One of `-b` or `-r` required |
| `-r` | Restore mode with project name | One of `-b` or `-r` required |
| `-h` | Show help message | No |

#### Examples
```sh
# Backup using MBConfig.json connection
mongobackupcli -c personal -d mydb -b backup-lunes

# Backup using .env
mongobackupcli -b backup-lunes

# Restore using MBConfig.json connection
mongobackupcli -c personal -d mydb -r backup-lunes

# Restore using .env
mongobackupcli -r backup-lunes
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

> **Note:** All data in this repository and examples are for demonstration purposes only. Do not use real customer or sensitive data.

## Contributing
Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License
MIT
