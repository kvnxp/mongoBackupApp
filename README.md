# mongoBackupApp

A Node.js application for backing up and restoring MongoDB databases. This app provides utilities to export and import collections as JSON files, making it easy to manage database snapshots for development, testing, and production environments.

## Features
- Backup MongoDB collections to JSON files
- Restore collections from JSON files
- Interactive menu for selecting and saving MongoDB connections
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
3. You do NOT need to create a `.env` file or set any environment variables. The app will prompt you to add a MongoDB connection interactively on first run and save it to `db.json`.

### Usage

#### First Run & Connection Setup
Start the app:
```sh
npm start
# or
bun run src/index.ts
```
On first run, you will be prompted to create a MongoDB connection:
- Enter a name for the connection
- Enter the MongoDB connection URL
- The app will test the connection and ask if you want to save it
- Saved connections are stored in `db.json`

#### Selecting a Connection
On subsequent runs, the app will show a list of saved connections. Select one to use for backup/restore operations. The selected connection URL will be used for all database actions.

#### Using the Menu
After selecting a connection, the main menu will appear:
- **1. Backup MongoDB**: Export collections to JSON files
- **2. Restore MongoDB**: Import collections from JSON files
- **0. Exit**: Quit the app

> **Note:** All data in this repository and examples are for demonstration purposes only. Do not use real customer or sensitive data.

## Contributing
Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License
MIT
