# Estructura del proyecto

## Árbol

```
mongoBackupApp/
├── AGENTS.md              Guía para agentes de IA que trabajan en el repo
├── README.md              Documentación de uso
├── docs/
│   ├── ARCHITECTURE.md    Componentes, flujos, persistencia, limitaciones
│   └── STRUCTURE.md       Este archivo
├── src/
│   ├── index.ts           Entrada: flags, modo CLI, menú inicial, perfiles, compresión
│   ├── MenuManager.ts     Puente entre el menú interactivo y backup/restore
│   ├── selection.ts       Prompts y parseo de selección (número, nombre, comas, all)
│   ├── MongoBackup.ts     EJSON, backupCollection (stream) y backup interactivo
│   ├── MongoRestore.ts    EJSON, restoreCollection (atómico) y restore interactivo
│   └── mongoConnection.ts Fábrica de MongoClient
├── .env.example           Plantilla de MONGOURI, DBNAME, BACKUPDIR
├── build.sh               Compila binario con bytecode y lo renombra a mongoBackupCli
├── package.json           Dependencias y scripts de build
├── bun.lock               Lockfile de Bun
├── tsconfig.json          Configuración de TypeScript (strict, commonjs, es2016)
└── .gitignore
```

Directorios generados (ignorados por git): `node_modules/`, `build/`, `backup/`, binario `mongoBackupCli`, `.env`.

## Archivos fuente

| Archivo | Líneas | Exporta | Depende de |
|---------|--------|---------|------------|
| `src/index.ts` | ~540 | nada (ejecuta `startApp()`) | `MenuManager`, `MongoBackup`, `MongoRestore`, `selection`, `mongoConnection`, `dotenv`, `archiver`, `tar`, `extract-zip` |
| `src/MenuManager.ts` | ~40 | `MenuManager` | `MongoBackup`, `MongoRestore`, `selection` |
| `src/selection.ts` | ~45 | `question`, `parseSelection`, `promptSelection`, `errorMessage` | `readline` |
| `src/MongoBackup.ts` | ~130 | `MongoBackup`, `SYSTEM_DATABASES` | `mongoConnection`, `selection`, `mongodb` |
| `src/MongoRestore.ts` | ~160 | `MongoRestore` | `mongoConnection`, `selection`, `mongodb` |
| `src/mongoConnection.ts` | ~10 | `getMongoClient` | `mongodb` |

## Funciones principales de `src/index.ts`

| Función | Propósito |
|---------|-----------|
| `parseCliArgs()` | Lee `-h -c -d -b -r -zip -tar` (`-D` se lee aparte) |
| `showCliHelp()` | Imprime la ayuda |
| `readConfigFile()` | Lee `MBConfig.json` (objeto vacío si no existe o es inválido) |
| `readDbConnections()` | Devuelve `dbList` |
| `saveDbConnections()` | Escribe `dbList` preservando `config`, con permisos `0600` |
| `getWorkingDirectory()` | `config.workingDir` o `cwd` |
| `getBackupRoot()` | Raíz de backups de ambos modos |
| `testMongoConnection()` | Conecta, hace ping y cierra para validar una URL |
| `handleCliBackup()` / `handleCliRestore()` | Flujos del modo CLI |
| `compressZip()` / `compressTar()` / `extractArchive()` | Empaquetado |
| `findExtractedDbPath()` | Ubica la carpeta de la base dentro de un archivo extraído |
| `profilesMenu()` | Alta, baja y prueba de perfiles |
| `startApp()` | Decide modo y ejecuta el menú principal |

## Rutas en tiempo de ejecución

| Ruta | Contenido |
|------|-----------|
| `~/.mongobackupcli/MBConfig.json` | Perfiles de conexión y `config.workingDir` |
| `<raíz>/<proyecto>/<base>/<colección>.json` | Backups (ambos modos) |
| `<raíz>/<proyecto>.zip` o `.tar` | Backups comprimidos (modo CLI) |
| `<os.tmpdir()>/mongobackup-XXXXXX/` | Extracción temporal durante el restore; se borra al terminar |

`<raíz>` = `BACKUPDIR`, si no `<config.workingDir>/backup`, si no `<cwd>/backup`.

## Scripts

| Comando | Resultado |
|---------|-----------|
| `bun install` | Instala dependencias |
| `bun run dev` | Ejecuta desde el código fuente |
| `bun run build` | `tsc` a `build/` |
| `bun run build:current` | Binario para la plataforma actual en `build/app-current` |
| `bun run build:linux64` | `build/app-linux-x64` |
| `bun run build:linuxarm` | `build/app-linux-arm64` |
| `bun run build:macos` | `build/app-macos-x64` |
| `bun run build:macosarm` | `build/app-macos-arm64` |
| `./build.sh` | Binario `mongoBackupCli` en la raíz |
