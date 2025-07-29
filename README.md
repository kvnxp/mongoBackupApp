# mongoBackupApp

A Node.js application for backing up and restoring MongoDB databases. This app provides utilities to export and import collections as JSON files, making it easy to manage database snapshots for development, testing, and production environments.

## Features
- Backup MongoDB collections to JSON files
- Restore collections from JSON files
- Environment variable support for MongoDB connection
- Organized backup structure by environment and collection

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
3. Create a `.env` file in the root directory and set your MongoDB connection string (example, do not use real credentials):
   ```env
   MONGO_URL=mongodb://exampleUser:examplePass@localhost:27017/exampledb
   ```

### Usage

#### Backup Collections
Run the backup script to export collections:
```sh
npm run backup
```

#### Restore Collections
Run the restore script to import collections:
```sh
npm run restore
```

> **Note:** All data in this repository and examples are for demonstration purposes only. Do not use real customer or sensitive data.

## Contributing
Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License
MIT
