# Arquitectura

## Resumen

`mongoBackupApp` es una herramienta de línea de comandos escrita en TypeScript y ejecutada con Bun. Exporta colecciones de MongoDB a archivos JSON (Extended JSON canónico), las vuelve a importar y las copia directamente entre servidores. Se distribuye como binario único compilado con `bun build --compile` (`scripts/build.ts`).

Tiene dos modos que comparten el mismo núcleo:

| Modo | Disparador | Interfaz | Raíz de backups |
|------|------------|----------|-----------------|
| CLI | Flags `-b` o `-r` con nombre | `console.log` | `getBackupRoot()` |
| TUI | Sin flags, en una terminal (TTY) | Ink (React) a pantalla completa | `getBackupRoot()` |

`getBackupRoot()` resuelve la raíz igual para ambos modos: `BACKUPDIR`, si no `<config.workingDir>/backup`, si no `<cwd>/backup`.

Sin flags y sin TTY (por ejemplo con stdin redirigido) la app termina con un mensaje y código 1.

## Capas

```
                           src/index.ts
                  parseCliArgs → CLI  |  TUI (import dinámico)
              ┌────────────────────┴───────────────────────┐
              ▼                                            ▼
     ┌─────────────────┐                     ┌────────────────────────────┐
     │ src/cli.ts      │                     │ src/tui/  (Ink + React)    │
     │ flags, ayuda,   │                     │ App, pantallas, componentes│
     │ salida por      │                     │ progreso con throttling    │
     │ consola         │                     └─────────────┬──────────────┘
     └────────┬────────┘                                   │
              └──────────────────┬─────────────────────────┘
                                 ▼
             ┌──────────────────────────────────────────────┐
             │ src/jobs.ts                                   │
             │ runBackupJob / runRestoreJob / runCopyJob     │
             │ tareas, eventos de progreso, cancelación      │
             └───────┬──────────────────────────┬───────────┘
                     ▼                          ▼
     ┌──────────────────────────┐  ┌──────────────────────────────┐  ┌───────────────────────┐
     │ MongoBackup               │  │ MongoRestore                  │  │ MongoCopy              │
     │ listDatabases/Collections │  │ listBackupFiles               │  │ copyCollection         │
     │ backupCollection (stream) │  │ restoreCollection (stream)    │  │ isSameServer           │
     └──────────────────────────┘  └───────┬──────────────────────┘  └──────────┬────────────┘
                                           │ jsonArrayStream                     │
                                           └──────────────┬─────────────────────┘
                                                          ▼
                                    src/replaceCollection.ts (temporal + rename atómico)
     src/archive.ts   (zip/tar, extracción temporal, listado de backups)
     src/config.ts    (MBConfig.json, raíz de backups, prueba de conexión)
     src/utils.ts     (formato, maskUri, AbortError)
```

Solo `src/tui/` conoce Ink/React y solo `src/cli.ts` escribe en consola. El núcleo (`jobs`, `MongoBackup`, `MongoRestore`, `archive`, `config`) no imprime nada: informa por callbacks y lanza errores.

## Núcleo

### `src/jobs.ts`

Un job recibe una lista de `Task` (`{ db, collection, total }`) y las ejecuta en orden.

- `total` es el número estimado de documentos (backup) o el tamaño del archivo en bytes (restore). La UI lo usa para las barras de progreso.
- Eventos: `onPhase('running' | 'compressing' | 'finished')`, `onTaskStart(i)`, `onTaskProgress(i, done, docs)`, `onTaskEnd(i, result)`.
- Resultado por tarea: `done` (con documentos), `skipped` (backup vacío), `error` (mensaje) o `cancelled`.
- Un error en una colección no detiene el job; se informa y sigue con la siguiente.
- Cancelación con `AbortSignal`. La tarea en curso termina con `cancelled` y las siguientes no se ejecutan.
- `runBackupJob`: escribe `<raíz>/<proyecto>/<db>/<colección>.json`. Si se pidió compresión y no hubo cancelación, empaqueta la carpeta del proyecto en `<proyecto>.zip|.tar` y la borra. Si la compresión falla, la carpeta se conserva y se informa `compressError`.
- `runRestoreJob`: restaura desde `<projectDir>/<db>/<colección>.json`.
- `runCopyJob`: copia cada tarea del cliente `source` al cliente `target`, en una base con el mismo nombre (`targetDbName` permite cambiarlo). Una colección vacía en el origen se marca `skipped` y no toca el destino.

### `src/MongoBackup.ts`

- `serializeMongoTypes(obj)`: `EJSON.serialize` canónico (`relaxed: false`).
- `listDatabases(client)`: bases de usuario con `sizeOnDisk` (excluye `admin`, `local`, `config`).
- `listCollectionNames(db)`: colecciones reales; excluye views y `system.*`.
- `listCollections(db)`: lo anterior con `estimatedDocumentCount` (solo metadatos, no recorre la colección).
- `backupCollection(db, name, dir, { onProgress, signal })`: recorre la colección con un cursor (`promoteValues: false` para conservar Int32, Double y Long), escribe en `<name>.json.tmp` y al terminar renombra a `<name>.json`. Informa progreso cada 200 documentos y revisa la cancelación en el mismo punto. Un backup cancelado o fallido borra el `.tmp`.

### `src/MongoRestore.ts`

- `deserializeMongoTypes(obj)`: `EJSON.deserialize` canónico. Lee también backups del formato anterior.
- `listBackupFiles(dir)` / `listBackupCollections(dir)`: `.json` de una carpeta, con tamaño.
- `restoreCollection(db, name, file, { onProgress, signal })`: lee el archivo con `readJsonArray` y lo pasa a `replaceCollection`, conservando los índices que ya tenga la colección destino (los backups no incluyen índices). Informa bytes leídos y documentos.

### `src/MongoCopy.ts`

- `copyCollection(source, target, name, { onProgress, signal })`: recorre la colección de origen con un cursor (`promoteValues: false`, sin archivos ni EJSON) y la pasa a `replaceCollection` en el destino. La colección nueva se crea con las **opciones** (validador, collation, capped...) y los **índices** del origen.
- `isSameServer(a, b)`: compara una huella de cada servidor (`serverStatus` host:pid, o el miembro del replica set de `hello`). Es best-effort: si no hay permisos para obtener la huella devuelve `false`. La TUI la usa para impedir copiar un servidor sobre sí mismo cuando dos conexiones con URLs distintas apuntan al mismo servidor.

### `src/replaceCollection.ts`

`replaceCollection(db, name, docs, { indexes, collectionOptions, onBatch, signal })` reemplaza una colección de forma atómica. Lo usan el restore y la copia:

1. Con el primer lote crea `<name>.__restore_tmp_<timestamp>` (con `collectionOptions` si se dan) y sus índices.
2. Inserta en lotes de 1000; llama `onBatch` después de cada lote y revisa la cancelación.
3. Cuando consumió todos los documentos, renombra la temporal sobre el destino (`dropTarget: true`).
4. Cualquier error o cancelación borra la temporal; el destino queda intacto.
5. Sin documentos no toca el destino y devuelve `null`.

`indexSpecsOf(db, name)` devuelve los índices de una colección (vacío si no existe).

### `src/jsonArrayStream.ts`

`readJsonArray(file, { onBytes })`: generador asíncrono que lee un array JSON en chunks de 1 MB y entrega cada documento parseado. Acepta cualquier formato (indentado, compacto, BOM) y falla con un mensaje claro si el archivo no es un array, está truncado, tiene un elemento que no es documento o contenido después del `]`. La memoria no depende del tamaño del archivo.

### `src/archive.ts`

- `compressFolder(folder, 'zip' | 'tar')`: crea `<folder>.zip|.tar` y borra la carpeta.
- `openArchive(path)`: extrae en un directorio temporal privado (`os.tmpdir()`), nunca dentro de la raíz de backups, y devuelve `{ projectDir, cleanup }`. Si el archivo fue renombrado y contiene una sola carpeta, usa esa.
- `listBackups(root)`: carpetas y archivos `.zip`/`.tar` de la raíz, del más nuevo al más viejo.

### `src/config.ts`

- `MBConfig.json` en `$HOME/.mongobackupcli/`: `readDbConnections`, `saveDbConnections` (permisos `0600`, carpeta `0700`), `findConnectionByName`.
- `getBackupRoot()`.
- `checkMongoConnection(url)` (lanza el error del driver) y `testMongoConnection(url)` (booleano).
- Las conexiones interactivas usan `getInteractiveClient` (`src/mongoConnection.ts`): `serverSelectionTimeoutMS` de 8 s, salvo que la URL ya defina uno.
- `HOME` se lee en cada llamada porque Bun cachea `os.homedir()`.

## TUI (`src/tui/`)

### Navegación

`App.tsx` mantiene una ruta (`routes.ts`) y la sesión. No hay router externo: un `switch` sobre `route.name`.

```
connections ──n──▶ connectionForm
     │ enter
     ▼
   home ──b──▶ backupSelect ──enter──▶ backupOptions ──(archivos) enter──▶ run ──▶ home
     │                                          │
     │                                          └──(otro servidor)──▶ copyTarget ──enter──▶ copyConfirm ──y──▶ run ──▶ home
     │                                                                   │ n
     │                                                                   └──▶ connectionForm (returnTo: copyTarget)
     │
     └──r──▶ restorePick ──enter──▶ restoreSelect ──enter──▶ restoreConfirm ──y──▶ run ──▶ home
```

- Esc vuelve a la pantalla anterior conservando la selección (`selection` viaja en la ruta).
- Las pantallas que necesitan conexión muestran la lista de conexiones si no hay sesión.

### Contexto (`context.ts`)

`AppContext` da a cada pantalla: `session` (`{ conn, client }`), `backupRoot`, `status` y `setStatus`/`clearStatus` (línea de estado del pie), `navigate`, `connect`, `disconnect`, `quit` y `setInterruptHandler`.

- La TUI mantiene **un `MongoClient` por sesión**: se crea al conectar y se cierra al cambiar de conexión o salir.
- La copia abre un segundo cliente para el servidor destino. Viaja en la ruta `copyConfirm` junto con `closeTarget`, se cierra al volver atrás o al terminar el job, y queda registrado en `cleanup.ts` por si se sale de la app.
- `Ctrl+C`: Ink se crea con `exitOnCtrlC: false`. Si hay un job corriendo, `RunScreen` registra un handler que pide confirmación de cancelación; si no, `Ctrl+C` sale.

### Pantallas (`screens/`)

| Pantalla | Archivo | Función |
|----------|---------|---------|
| Conexiones | `ConnectionsScreen.tsx` | Lista, conectar, probar, borrar (con confirmación) |
| Nueva conexión | `ConnectionFormScreen.tsx` | Nombre y URL; prueba la conexión antes de guardar (`Ctrl+S` guarda aunque falle) |
| Inicio | `HomeScreen.tsx` | Acciones, versión del servidor, tamaño, rutas |
| Backup | `BackupScreens.tsx` | Selección de colecciones y opciones: destino archivos (nombre, formato) u otro servidor |
| Copia a servidor | `CopyScreens.tsx` | Elegir servidor destino (guardado o nuevo), confirmar con lista de colecciones nuevas / reemplazadas |
| Restore | `RestoreScreens.tsx` | Elegir backup, seleccionar colecciones, confirmar |
| Progreso | `RunScreen.tsx` | Ejecuta el job y muestra el progreso |

`CollectionPicker.tsx` es el selector de dos paneles (bases y colecciones) que usan backup y restore. Las colecciones de cada base se cargan al resaltarla y se guardan en caché.

### Componentes (`components.tsx`)

`Frame` (layout de pantalla completa: cabecera, cuerpo, estado y atajos), `Pane`, `ListView`, `Row`, `TextInput`, `ProgressBar`, `Spinner`, `Checkbox`, `KeyHints`. `useListNav.ts` implementa la navegación de listas.

### Rendimiento

- **Listas virtualizadas**: `ListView` solo renderiza las filas visibles (`visibleWindow`), así que miles de colecciones no afectan la velocidad.
- **Progreso con throttling**: `RunScreen` guarda los eventos del job en `useRef` y re-renderiza como máximo cada 100 ms (y una vez por segundo para el reloj). Los jobs emiten eventos cada 200 documentos o 1000 inserciones.
- **Render**: Ink se inicia con `alternateScreen`, `incrementalRendering` (solo reescribe líneas que cambian) y `maxFps: 30`.
- **Carga diferida**: `index.ts` importa la TUI con `import()` dinámico, así que el modo CLI no carga React (arranca en unos 70 ms).
- **Animaciones**: `Spinner` usa `useAnimation` de Ink, que comparte un único timer entre todos los spinners.

### Limpieza

`cleanup.ts` registra limpiezas que deben ejecutarse aunque el usuario salga de golpe (carpetas temporales de archivos extraídos). Se ejecutan al salir con `quit`, al desmontar la app y en `process.on('exit')`.

## Persistencia

### Configuración: `~/.mongobackupcli/MBConfig.json`

```json
{
  "dbList": [
    { "name": "personal", "url": "mongodb://user:pass@host:27017" }
  ],
  "config": { "workingDir": "" }
}
```

Las URLs se guardan en texto plano; el archivo se escribe con permisos `0600`. La TUI muestra las contraseñas enmascaradas (`maskUri`).

### Variables de entorno (`.env`)

| Variable | Uso |
|----------|-----|
| `MONGOURI` | URI cuando no se pasa `-c` (CLI) |
| `DBNAME` | Base cuando no se pasa `-d` (CLI) |
| `BACKUPDIR` | Raíz de backups de ambos modos (tiene prioridad sobre `config.workingDir`) |

### Formato de backup

```
<raíz>/<proyecto>/<base>/<colección>.json
<raíz>/<proyecto>.zip | .tar
```

Cada archivo es un array JSON de documentos en Extended JSON canónico (`$numberInt`, `$numberDouble`, `$numberLong`, `$binary`, `$uuid`, etc.).

## Build

`scripts/build.ts` usa `Bun.build` con `compile`:

- Ink importa `react-devtools-core` solo cuando `DEV=true`, pero el bundler intenta resolverlo igual. Un plugin lo reemplaza por un módulo vacío.
- `minify: true`, `NODE_ENV=production`.
- No usa `bytecode`: Ink y yoga-layout usan `await` de nivel superior, que el modo bytecode no admite.

## Tests

`bun test` ejecuta `tests/`. `tests/setup.ts` (precargado por `bunfig.toml`) apunta `HOME` y `BACKUPDIR` a carpetas temporales, así ningún test toca la configuración ni los backups reales.

| Archivo | Cubre |
|---------|-------|
| `tests/core.test.ts` | `parseCliArgs`, utilidades, zip/tar, `openArchive`, `listBackups` |
| `tests/jsonArrayStream.test.ts` | Parser en stream: formatos, chunks pequeños, multibyte, errores |
| `tests/ejson.test.ts` | Ida y vuelta de todos los tipos BSON y lectura del formato anterior |
| `tests/tui.test.tsx` | Listas virtualizadas, `TextInput`, `CollectionPicker`, `RunScreen` (progreso, cancelación, Ctrl+C), `ConnectionsScreen` |
| `tests/tui.copy.test.tsx` | Destino "otro servidor", lista de servidores destino, confirmación, `returnTo` del formulario |
| `tests/mongo.integration.test.ts` | Backup, restore y copia contra MongoDB real: tipos, índices, opciones, atomicidad, cancelación, jobs |

Los tests de la TUI usan `ink-testing-library` (terminal simulada de 100x24). Los de integración usan `MONGO_TEST_URI` (por defecto `mongodb://localhost:27017`) y una base desechable `mbtest_*`; si el servidor no responde, se omiten.

## Limitaciones conocidas

- No se respaldan los índices ni las opciones de colección (validadores, capped, collation). En el restore se conservan los índices que ya tenga la colección destino; las opciones de colección se pierden al reemplazarla.
- Las views no se respaldan.
- El restore siempre escribe en una base con el mismo nombre que la carpeta del backup, y la copia en una base con el mismo nombre que la de origen.
- La copia no se ofrece en el modo CLI.
- La detección de "mismo servidor" es best-effort: sin permisos para `serverStatus` en un standalone no puede detectarlo.
- El rename de la colección temporal no funciona en colecciones fragmentadas (sharded) y requiere permiso `renameCollection`.
- `-tar` empaqueta sin comprimir.
- Los nombres de colección con `/` no se pueden guardar como archivo.
- La TUI necesita una terminal interactiva.
