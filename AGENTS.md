# AGENTS.md

Guía para agentes de IA que trabajan en este repositorio.

## Proyecto

App en TypeScript (runtime Bun) para backup y restore de MongoDB a archivos JSON. Tiene modo CLI por flags y una TUI a pantalla completa hecha con Ink (React).

- Arquitectura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Estructura: [docs/STRUCTURE.md](docs/STRUCTURE.md)
- Uso: [README.md](README.md)

## Comandos

```bash
bun install                    # dependencias
bun run dev                    # TUI desde el código fuente (necesita una terminal)
bun run dev -h                 # ayuda del modo CLI
bun test                       # tests (integración requiere MongoDB local)
bun run typecheck              # tsc --noEmit
bun run build:current          # binario local en build/app-current (scripts/build.ts)
```

Valida los cambios con `bun test` y `bun run typecheck`. Para cambios visuales de la TUI, prueba también en una terminal real (ancho 80 y 120). Los tests de integración usan `MONGO_TEST_URI` (por defecto `mongodb://localhost:27017`) y una base desechable `mbtest_*`; si MongoDB no responde se omiten, así que revisa que no aparezca el aviso `tests skipped`. Agrega o actualiza tests en `tests/` con cada cambio de comportamiento.

## Mapa de código

| Cambio | Archivo |
|--------|---------|
| Elegir CLI o TUI | `src/index.ts` |
| Flags, ayuda, modo CLI | `src/cli.ts` |
| Ejecución de backups/restores (tareas, progreso, cancelación) | `src/jobs.ts` |
| Backup de una colección, listados, EJSON | `src/MongoBackup.ts` |
| Restore de una colección, EJSON | `src/MongoRestore.ts` |
| Copia de una colección entre servidores, detección de mismo servidor | `src/MongoCopy.ts` |
| Reemplazo atómico de una colección (temporal + rename) | `src/replaceCollection.ts` |
| Lectura en stream de los `.json` | `src/jsonArrayStream.ts` |
| zip/tar, extracción, listado de backups | `src/archive.ts` |
| `MBConfig.json`, raíz de backups, prueba de conexión | `src/config.ts` |
| Pantallas de la TUI | `src/tui/screens/` |
| Componentes de la TUI | `src/tui/components.tsx`, `src/tui/CollectionPicker.tsx` |
| Navegación, sesión, Ctrl+C | `src/tui/App.tsx` |
| Build del binario | `scripts/build.ts` |
| Tests | `tests/` |

## Convenciones

- TypeScript `strict`, ESM (`moduleResolution: bundler`), JSX `react-jsx`, indentación de 4 espacios, comillas simples o dobles según el archivo.
- Textos de la interfaz en inglés. Algunos comentarios del código están en español; consérvalos.
- Capas: el núcleo (`jobs`, `MongoBackup`, `MongoRestore`, `archive`, `config`, `utils`) no imprime ni importa nada de `src/tui/` o `src/cli.ts`. Informa por callbacks y lanza errores. La CLI y la TUI son solo presentación sobre `src/jobs.ts`.
- `MongoClient`: en la CLI uno por operación; en la TUI uno por sesión (`AppContext.session`). Ciérralo siempre (`await client.close()`).
- TUI: las listas usan `ListView` (virtualizada); nunca renderices todas las filas. El progreso de los jobs se guarda en refs y se re-renderiza con throttling (`RunScreen`, 100 ms); no llames `setState` en cada documento.
- TUI: cada pantalla usa `Frame` con sus atajos (`hints`) y la línea de estado (`ctx.setStatus`). Esc vuelve atrás; las acciones destructivas piden confirmación.
- TUI: la cancelación usa `AbortSignal`; las operaciones nuevas del núcleo deben aceptar `signal` y revisar `throwIfAborted` en cada lote.
- Excluye siempre las bases `admin`, `local` y `config` al listar.
- Formato de backup: `<raíz>/<proyecto>/<base>/<colección>.json`. Cualquier cambio de formato debe seguir leyendo backups existentes.
- Serialización con `BSON.EJSON` del driver en modo canónico (`relaxed: false`). No escribas serializadores propios.
- Backup, restore y copia de una colección viven solo en `MongoBackup.backupCollection`, `MongoRestore.restoreCollection` y `MongoCopy.copyCollection`, y se ejecutan a través de `runBackupJob` / `runRestoreJob` / `runCopyJob`. No dupliques esa lógica en la CLI ni en la TUI.
- Todo lo que reemplace una colección en un servidor debe pasar por `replaceCollection` (temporal + rename). Nunca `deleteMany` + `insertMany` sobre el destino.
- Backup y restore deben usar memoria acotada: nunca `toArray()` sobre una colección ni `readFileSync` + `JSON.parse` sobre un backup completo.

## Reglas de seguridad

- El restore y la copia reemplazan cada colección destino (temporal + `rename` con `dropTarget`). No cambies este comportamiento sin confirmación explícita del usuario. Ambos flujos muestran una confirmación antes de escribir.
- La copia no debe permitir que el destino sea el mismo servidor que el origen (`copyTargets` y `isSameServer`).
- Para probar la copia hace falta un segundo servidor desechable (por ejemplo un `mongod` temporal en otro puerto con `--dbpath` en una carpeta temporal). No uses servidores reales como destino.
- Las pruebas manuales van contra una base desechable (por ejemplo `mbtest_<n>`) y con `HOME` y `BACKUPDIR` temporales, para no tocar `MBConfig.json` ni backups reales.
- Los tests corren con `tests/setup.ts`, que apunta `HOME` y `BACKUPDIR` a carpetas temporales. No lo quites. Lee `HOME` desde `process.env` (Bun cachea `os.homedir()`).
- `~/.mongobackupcli/MBConfig.json` contiene URLs con credenciales. No lo leas, copies ni muestres en logs o commits.
- No hagas commit de `.env`, `backup/`, `build/` ni del binario `mongoBackupCli`.
- No ejecutes backup ni restore contra conexiones remotas o de producción para probar cambios.

## Problemas conocidos

Ver la sección "Limitaciones conocidas" de [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Commits

Usa Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`), como en el historial existente.
