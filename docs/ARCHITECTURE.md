# Arquitectura

## Resumen

`mongoBackupApp` es una herramienta de línea de comandos escrita en TypeScript y ejecutada con Bun. Exporta colecciones de MongoDB a archivos JSON (Extended JSON propio) y las vuelve a importar. Se distribuye como binario único compilado con `bun build --compile`.

La aplicación tiene dos modos de operación que comparten el mismo punto de entrada (`src/index.ts`):

| Modo | Disparador | Entrada | Directorio de backups |
|------|------------|---------|-----------------------|
| CLI | Flags `-b` o `-r` con nombre | Flags + `.env` | `getBackupRoot()` |
| Interactivo | Sin flags | `readline` (stdin) | `getBackupRoot()` |

`getBackupRoot()` resuelve la raíz de backups igual para ambos modos: `BACKUPDIR`, si no `<config.workingDir>/backup`, si no `<cwd>/backup`.

## Componentes

```
                    ┌─────────────────────────┐
                    │       src/index.ts      │
                    │  parseCliArgs()         │
                    │  startApp()             │
                    └───────────┬─────────────┘
                 flags -b/-r    │    sin flags
          ┌─────────────────────┴──────────────────────┐
          ▼                                            ▼
┌──────────────────────┐                  ┌──────────────────────────┐
│ Modo CLI (index.ts)  │                  │ Menú inicial (index.ts)  │
│ handleCliBackup()    │                  │ profilesMenu()           │
│ handleCliRestore()   │                  │ selección de conexión    │
│ compressZip/Tar()    │                  └────────────┬─────────────┘
│ extractArchive()     │                               ▼
└─────────┬────────────┘                  ┌──────────────────────────┐
          │                               │ MenuManager              │
          │                               │ doBackup() / doRestore() │
          │                               └────────────┬─────────────┘
          │                                            ▼
          │                  ┌──────────────────────────────────────────┐
          │                  │ MongoBackup.backupMongoInteractive()     │
          │                  │ MongoRestore.restoreMongoInteractive()   │
          │                  └────────────────────┬─────────────────────┘
          │                                       │
          └──────────────┬────────────────────────┘
                         ▼
   ┌───────────────────────────────────────────────────────────┐
   │ Operaciones por colección (compartidas por ambos modos)   │
   │ MongoBackup.backupCollection()   cursor → .json (EJSON)   │
   │ MongoRestore.restoreCollection() .json → tmp → rename     │
   └───────────────────────────┬───────────────────────────────┘
                               ▼
   ┌───────────────────────────────────────────────────────────┐
   │ mongoConnection.getMongoClient(url) → MongoClient         │
   └───────────────────────────────────────────────────────────┘
```

### `src/index.ts`

Punto de entrada y orquestador. Responsabilidades:

- Carga `.env` con `dotenv`.
- Crea la única interfaz `readline` compartida por toda la app.
- Parsea flags (`parseCliArgs`) y muestra la ayuda (`showCliHelp`).
- Lee y escribe el archivo de configuración `~/.mongobackupcli/MBConfig.json`.
- Implementa el modo CLI completo: backup, restore, compresión y extracción.
- Implementa el menú inicial interactivo y el submenú de perfiles (alta, baja y prueba de conexiones).
- Resuelve la raíz de backups (`getBackupRoot`).
- Captura cualquier error no manejado en `startApp().catch(...)` y sale con código 1.

### `src/MenuManager.ts`

Adaptador entre el menú interactivo y las clases de backup y restore. `index.ts` crea una instancia por operación y llama `doBackup()` o `doRestore()`. Captura los errores de la operación para que el menú siga vivo.

### `src/selection.ts`

Utilidades de entrada compartidas:

- `question(rl, prompt)`: versión con promesa de `rl.question`.
- `parseSelection(input, options)`: interpreta número, nombre, lista separada por comas o `all`.
- `promptSelection(rl, prompt, options)`: muestra la lista numerada y pregunta hasta recibir una selección válida.
- `errorMessage(error)`: mensaje legible de un error.

### `src/MongoBackup.ts`

- `serializeMongoTypes(obj)`: `EJSON.serialize` canónico (`relaxed: false`).
- `listCollectionNames(db)`: colecciones reales; excluye views y `system.*`.
- `backupCollection(db, name, dir)`: recorre la colección con un cursor (`promoteValues: false` para conservar Int32, Double y Long) y escribe cada documento en `<name>.json.tmp`. Al terminar renombra a `<name>.json`, así un backup interrumpido nunca deja un `.json` truncado.
- `backupMongoInteractive(...)`: lista bases (excluye `admin`, `local`, `config`), pide selección y llama `backupCollection` por cada colección.

### `src/MongoRestore.ts`

- `deserializeMongoTypes(obj)`: `EJSON.deserialize` canónico. Lee también backups del formato anterior (`$oid`, `$date` ISO, `$numberDecimal`, `$numberLong`, `$timestamp`).
- `listBackupCollections(dir)`: nombres de colección a partir de los `.json` de una carpeta.
- `restoreCollection(db, name, file)`: restore atómico:
  1. Crea `<name>.__restore_tmp_<timestamp>` con los índices de la colección destino (si existe).
  2. Inserta los documentos en lotes de 1000.
  3. Renombra la temporal sobre el destino (`dropTarget: true`).
  4. Si algo falla, borra la temporal y el destino queda intacto.
  5. Un backup vacío (`[]`) no toca el destino.
- `restoreMongoInteractive(...)`: lista proyectos, bases y colecciones, y llama `restoreCollection`.

### `src/mongoConnection.ts`

Fábrica mínima: `getMongoClient(url)` devuelve `new MongoClient(url)`.

## Flujos

### Backup (CLI)

1. Resolver URI: `-c <perfil>` desde `MBConfig.json`, o `MONGOURI`.
2. Resolver base: `-d <db>` o `DBNAME`.
3. Crear `<BACKUPDIR>/<nombre>/<db>/`.
4. Por cada colección: `backupCollection` (stream con cursor a `<colección>.json`).
5. Si hay `-zip` o `-tar`: empaquetar `<BACKUPDIR>/<nombre>/` en `<BACKUPDIR>/<nombre>.zip|.tar` y borrar la carpeta.

### Restore (CLI)

1. Resolver URI y base igual que en backup.
2. Si el nombre termina en `.zip` o `.tar`: extraer en un directorio temporal privado (`fs.mkdtempSync(os.tmpdir())`). El archivo contiene la carpeta del proyecto: la ruta es `<tmp>/<nombre>/<db>/`. Si el archivo fue renombrado y solo hay una carpeta, se usa esa.
3. Por cada `.json`: `restoreCollection` (temporal + rename).
4. Si hubo extracción: borrar el directorio temporal, también si hubo error.

### Interactivo

1. Menú inicial: elegir conexión por número, o `p` para gestionar perfiles.
2. Menú de acciones: `b` backup, `r` restore, `c` cambiar conexión, `x` salir.
3. Backup y restore piden bases y colecciones. Aceptan número, nombre, lista separada por comas o `all`. Si se elige `all` en bases, se toman todas las colecciones sin preguntar.

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

- `dbList`: perfiles de conexión. Las URLs se guardan en texto plano; el archivo se escribe con permisos `0600` y la carpeta con `0700`.
- `config.workingDir`: raíz de backups del modo interactivo. Vacío significa `process.cwd()`.

### Variables de entorno (`.env`)

| Variable | Uso |
|----------|-----|
| `MONGOURI` | URI cuando no se pasa `-c` |
| `DBNAME` | Base cuando no se pasa `-d` |
| `BACKUPDIR` | Raíz de backups de ambos modos (tiene prioridad sobre `config.workingDir`) |

### Formato de backup

```
<backupRoot>/<proyecto>/<base>/<colección>.json
```

Cada archivo es un array JSON de documentos en Extended JSON canónico (`$numberInt`, `$numberDouble`, `$numberLong`, `$binary`, `$uuid`, etc.), uno por elemento e indentado con 2 espacios.

## Dependencias

| Paquete | Uso |
|---------|-----|
| `mongodb` | Driver oficial; también se usa su `BSON.EJSON` |
| `dotenv` | Carga de `.env` |
| `archiver` | Creación de `.zip` |
| `tar` | Creación y extracción de `.tar` |
| `extract-zip` | Extracción de `.zip` (protege contra path traversal) |

## Build

- `bun run dev`: ejecuta `src/index.ts` directo.
- `bun run build:current | build:linux64 | build:linuxarm | build:macos | build:macosarm`: binarios en `build/`.
- `build.sh`: compila con `--bytecode` y renombra el binario a `mongoBackupCli`.
- `bun run build` (`tsc`): emite JS en `build/`.

## Limitaciones conocidas

- No se respaldan los índices ni las opciones de colección (validadores, capped, collation). En el restore se conservan los índices que ya tenga la colección destino; las opciones de colección se pierden al reemplazarla.
- Las views no se respaldan.
- El restore lee cada `.json` completo en memoria. El backup sí es en stream.
- El rename de la colección temporal no funciona en colecciones fragmentadas (sharded) y requiere permiso `renameCollection`.
- `-tar` empaqueta sin comprimir.
- La compresión solo existe en modo CLI.
- Los nombres de colección con `/` no se pueden guardar como archivo.
