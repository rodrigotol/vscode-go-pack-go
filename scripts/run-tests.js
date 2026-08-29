const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

function findTestFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return findTestFiles(path);
        }
        return entry.name.endsWith(".test.js") ? [path] : [];
    });
}

const testFiles = findTestFiles("out-test");
if (testFiles.length === 0) {
    console.error("No compiled test files found in out-test.");
    process.exit(1);
}

console.log(`Running ${testFiles.length} compiled test file(s).`);
const result = spawnSync(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit",
});
process.exit(result.status ?? 1);
