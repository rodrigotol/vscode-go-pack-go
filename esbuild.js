const esbuild = require("esbuild");
const { copyFileSync } = require("node:fs");
const { dirname } = require("node:path");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");
const outfile = production ? "dist/extension.js" : "out/extension.js";
const copyAssetsArgument = process.argv.find((argument) => argument.startsWith("--copy-runtime-assets="));

/** @type {import('esbuild').BuildOptions} */
const options = {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile,
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: true,
    logLevel: "info",
};

async function main() {
    if (copyAssetsArgument) {
        copyRuntimeAssets(copyAssetsArgument.split("=", 2)[1]);
        return;
    }

    if (watch) {
        const ctx = await esbuild.context(options);
        await ctx.rebuild();
        copyRuntimeAssets(dirname(outfile));
        await ctx.watch();
        console.log("[esbuild] watching...");
    } else {
        await esbuild.build(options);
        copyRuntimeAssets(dirname(outfile));
    }
}

function copyRuntimeAssets(outputDirectory) {
    copyFileSync("node_modules/web-tree-sitter/tree-sitter.wasm", `${outputDirectory}/tree-sitter.wasm`);
    copyFileSync("node_modules/tree-sitter-wasms/out/tree-sitter-go.wasm", `${outputDirectory}/tree-sitter-go.wasm`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
