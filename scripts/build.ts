/**
 * Compiles the app into a single executable with `bun build --compile`.
 *
 *   bun scripts/build.ts [target] [outfile]
 *   bun scripts/build.ts                                   # current platform -> build/app-current
 *   bun scripts/build.ts bun-linux-x64 build/app-linux-x64
 *
 * Ink loads `react-devtools-core` only when DEV=true; the bundler still tries to resolve it,
 * so it is replaced by an empty module here.
 */
import type { BunPlugin } from 'bun';

const currentTarget = `bun-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
const requested = process.argv[2];
const target = (!requested || requested === 'bun' ? currentTarget : requested) as Bun.Build.CompileTarget;
const outfile = process.argv[3] ?? 'build/app-current';

const stubDevtools: BunPlugin = {
    name: 'stub-react-devtools-core',
    setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: 'react-devtools-core', namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {};', loader: 'js' }));
    },
};

const result = await Bun.build({
    entrypoints: ['src/index.ts'],
    compile: { target, outfile },
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.DEV': '"false"' },
    plugins: [stubDevtools],
});

if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
}
console.log(`Built ${outfile} (${target})`);
