# Estructura del proyecto

## Árbol

```
mongoBackupApp/
├── AGENTS.md                 Guía para agentes de IA que trabajan en el repo
├── README.md                 Documentación de uso
├── docs/
│   ├── ARCHITECTURE.md       Capas, núcleo, TUI, persistencia, limitaciones
│   └── STRUCTURE.md          Este archivo
├── src/
│   ├── index.ts              Entrada: decide CLI o TUI
│   ├── cli.ts                Flags, ayuda y modo CLI
│   ├── jobs.ts               runBackupJob / runRestoreJob / runCopyJob (compartidos)
│   ├── MongoBackup.ts        Listado de bases/colecciones, backupCollection (stream)
│   ├── MongoRestore.ts       Listado de archivos, restoreCollection (stream, atómico)
│   ├── MongoCopy.ts          copyCollection entre servidores, isSameServer
│   ├── replaceCollection.ts  Reemplazo atómico (temporal + rename), compartido por restore y copia
│   ├── jsonArrayStream.ts    Lectura en stream de arrays JSON
│   ├── archive.ts            zip/tar, extracción temporal, listado de backups
│   ├── config.ts             MBConfig.json, raíz de backups, prueba de conexión
│   ├── mongoConnection.ts    Fábrica de MongoClient, getInteractiveClient (timeout corto)
│   ├── utils.ts              Formatos, maskUri, validación, AbortError
│   └── tui/
│       ├── App.tsx               Raíz: ruta, sesión, Ctrl+C, startTui()
│       ├── context.ts            AppContext
│       ├── routes.ts             Tipos de ruta, Selection, RestoreSource, JobSpec
│       ├── theme.ts              Colores
│       ├── cleanup.ts            Limpiezas al salir (temporales)
│       ├── useListNav.ts         Navegación de listas y ventana visible
│       ├── components.tsx        Frame, Pane, ListView, Row, TextInput, ProgressBar, Spinner...
│       ├── CollectionPicker.tsx  Selector de dos paneles (bases / colecciones)
│       └── screens/
│           ├── ConnectionsScreen.tsx
│           ├── ConnectionFormScreen.tsx
│           ├── HomeScreen.tsx
│           ├── BackupScreens.tsx     Selección y opciones de backup (archivos u otro servidor)
│           ├── CopyScreens.tsx       Servidor destino y confirmación de la copia
│           ├── RestoreScreens.tsx    Elegir, seleccionar y confirmar restore
│           └── RunScreen.tsx         Progreso y cancelación
├── tests/
│   ├── setup.ts                  Preload: HOME y BACKUPDIR temporales
│   ├── helpers.tsx               Contexto falso, teclas, waitFor
│   ├── core.test.ts
│   ├── jsonArrayStream.test.ts
│   ├── ejson.test.ts
│   ├── tui.test.tsx
│   ├── tui.copy.test.tsx
│   └── mongo.integration.test.ts Requiere MongoDB (se omite si no responde)
├── scripts/
│   └── build.ts              Compila el binario (Bun.build + plugin para Ink)
├── bunfig.toml               Preload de tests
├── .env.example              Plantilla de MONGOURI, DBNAME, BACKUPDIR
├── build.sh                  Compila el binario mongoBackupCli en la raíz
├── package.json
├── bun.lock
├── tsconfig.json             strict, esnext, moduleResolution bundler, jsx react-jsx, noEmit, solo src/
└── .gitignore
```

Directorios generados (ignorados por git): `node_modules/`, `build/`, `backup/`, binario `mongoBackupCli`, `.env`.

## Dependencias entre módulos

```
index ──▶ cli ──▶ jobs ──▶ MongoBackup, MongoRestore, MongoCopy ──▶ replaceCollection, jsonArrayStream
  │        │       └─────▶ archive
  │        └─────▶ config, archive
  └─(import dinámico)─▶ tui/App ──▶ screens ──▶ jobs, config, archive, MongoBackup, MongoRestore
```

`src/tui/` depende del núcleo; el núcleo nunca importa nada de `src/tui/` ni de `src/cli.ts`.

## Rutas en tiempo de ejecución

| Ruta | Contenido |
|------|-----------|
| `$HOME/.mongobackupcli/MBConfig.json` | Perfiles de conexión y `config.workingDir` |
| `<raíz>/<proyecto>/<base>/<colección>.json` | Backups |
| `<raíz>/<proyecto>.zip` o `.tar` | Backups comprimidos |
| `<os.tmpdir()>/mongobackup-XXXXXX/` | Extracción temporal durante el restore; se borra al terminar |

`<raíz>` = `BACKUPDIR`, si no `<config.workingDir>/backup`, si no `<cwd>/backup`.

## Scripts

| Comando | Resultado |
|---------|-----------|
| `bun install` | Instala dependencias |
| `bun run dev` | Ejecuta desde el código fuente (TUI sin flags) |
| `bun test` | Ejecuta los tests |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run build` | Typecheck y binario para la plataforma actual en `build/app-current` |
| `bun run build:current` | `build/app-current` |
| `bun run build:linux64` | `build/app-linux-x64` |
| `bun run build:linuxarm` | `build/app-linux-arm64` |
| `bun run build:macos` | `build/app-macos-x64` |
| `bun run build:macosarm` | `build/app-macos-arm64` |
| `./build.sh` | Binario `mongoBackupCli` en la raíz |
