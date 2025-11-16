# mongoBackupApp

A Node.js application for backing up and restoring MongoDB databases. This app provides utilities to export and import collections as JSON files, making it easy to manage database snapshots for development, testing, and production environments.

## Features
- Backup MongoDB collections to JSON files
- Restore collections from JSON files
- Interactive menu for selecting and managing MongoDB connections
- Connection profiles management (add, delete, test connections)
- Cross-platform support (Windows, Linux, macOS)
- No environment variables required; connection URLs are managed via the app menu
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
      devices.json
      plans.json
      services.json
      users.json
      transactions.json
src/
  index.ts
  MenuManager.ts
  MongoBackup.ts
  mongoConnection.ts
  MongoRestore.ts
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
3. You do NOT need to create a `.env` file or set any environment variables. The app will prompt you to add a MongoDB connection interactively on first run and save it to `~/.mongobackupcli/MDBackup.json`.

### Usage

#### First Run & Connection Setup
Start the app:
```sh
npm start
# or
bun run src/index.ts
```
On first run, you will see the initial menu with options to select or manage connections.

#### Initial Menu
- **s. Select connection**: Choose from saved connections
- **p. Profiles Operations**: Manage connection profiles

#### Profiles Operations
From the initial menu, select `p` to access:
- **n. Add new connection**: Create and test a new MongoDB connection
- **d. Delete a connection**: Remove an existing connection profile
- **t. Test a connection**: Verify connectivity to a saved connection
- **b. Back to initial menu**: Return to main menu

#### Selecting a Connection
After setting up connections, use `s` from the initial menu to select a connection for backup/restore operations.

#### Main Menu (after selecting connection)
- **b. Backup MongoDB**: Export collections to JSON files
- **r. Restore MongoDB**: Import collections from JSON files
- **x. Exit**: Quit the app

> **Note:** All data in this repository and examples are for demonstration purposes only. Do not use real customer or sensitive data.

## Configuration
Connection profiles are stored in `~/.mongobackupcli/MDBackup.json` on all platforms:
- Windows: `C:\Users\<username>\.mongobackupcli\MDBackup.json`
- Linux/macOS: `/home/<username>/.mongobackupcli/MDBackup.json`

The directory is created automatically if it doesn't exist.

## Contributing
Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License
MIT
