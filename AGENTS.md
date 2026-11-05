# AGENTS.md

Guía para agentes de IA que trabajan en este repositorio.

## Proyecto

CLI en TypeScript (runtime Bun) para backup y restore de MongoDB a archivos JSON. Tiene modo CLI por flags y modo interactivo por menú.

- Arquitectura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Estructura: [docs/STRUCTURE.md](docs/STRUCTURE.md)
- Uso: [README.md](README.md)

## Comandos

```bash
bun install                    # dependencias
bun run dev                    # ejecutar desde src/index.ts
bun run dev -h                 # ayuda del modo CLI
bunx tsc --noEmit -p .         # chequeo de tipos
bun run build:current          # binario local en build/app-current
```

No hay suite de tests. Valida los cambios con `tsc --noEmit` y una prueba manual contra un MongoDB local (`mongodb://localhost:27017`).

## Mapa de código

| Cambio | Archivo |
|--------|---------|
| Flags, ayuda, modo CLI, compresión | `src/index.ts` |
| Menú inicial y perfiles | `src/index.ts` (`startApp`, `profilesMenu`) |
| Backup de una colección, EJSON, backup interactivo | `src/MongoBackup.ts` |
| Restore de una colección, EJSON, restore interactivo | `src/MongoRestore.ts` |
| Prompts y selección (número, nombre, comas, `all`) | `src/selection.ts` |
| Raíz de backups | `src/index.ts` (`getBackupRoot`) |
| Conexión a MongoDB | `src/mongoConnection.ts` |

## Convenciones

- TypeScript `strict`, módulos `commonjs`, indentación de 4 espacios, comillas simples o dobles según el archivo.
- Textos de la interfaz en inglés. Algunos comentarios del código están en español; consérvalos.
- La interfaz `readline` es única y se crea en `src/index.ts`. Pásala como parámetro; no crees otra.
- Abre un `MongoClient` por operación y ciérralo siempre al terminar (`await client.close()`).
- Excluye siempre las bases `admin`, `local` y `config` al listar.
- Formato de backup: `<raíz>/<proyecto>/<base>/<colección>.json`. Cualquier cambio de formato debe seguir leyendo backups existentes.
- Serialización con `BSON.EJSON` del driver en modo canónico (`relaxed: false`). No escribas serializadores propios.
- Backup y restore de una colección viven solo en `MongoBackup.backupCollection` y `MongoRestore.restoreCollection`. El modo CLI y el interactivo los reutilizan; no dupliques esa lógica.
- Para pedir selecciones usa `promptSelection` / `parseSelection` de `src/selection.ts`.

## Reglas de seguridad

- El restore reemplaza cada colección destino (temporal + `rename` con `dropTarget`). No cambies este comportamiento sin confirmación explícita del usuario.
- Las pruebas manuales van contra una base desechable (por ejemplo `mbtest_<n>`) y con `HOME` y `BACKUPDIR` temporales, para no tocar `MBConfig.json` ni backups reales.
- `~/.mongobackupcli/MBConfig.json` contiene URLs con credenciales. No lo leas, copies ni muestres en logs o commits.
- No hagas commit de `.env`, `backup/`, `build/` ni del binario `mongoBackupCli`.
- No ejecutes backup ni restore contra conexiones remotas o de producción para probar cambios.

## Problemas conocidos

Ver la sección "Limitaciones conocidas" de [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Commits

Usa Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`), como en el historial existente.
