import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8"),
);
const temporaryRoot = mkdtempSync(join(tmpdir(), "parallm-package-smoke-"));
const packDirectory = join(temporaryRoot, "pack");
const installDirectory = join(temporaryRoot, "install");
const npmCache = join(temporaryRoot, "npm-cache");

try {
  mkdirSync(packDirectory);
  mkdirSync(installDirectory);
  writeFileSync(
    join(installDirectory, "package.json"),
    `${JSON.stringify({ name: "parallm-package-smoke", private: true, type: "module" }, null, 2)}\n`,
  );

  const npmEnvironment = {
    npm_config_cache: npmCache,
    npm_config_update_notifier: "false",
  };
  run(
    "npm",
    ["pack", "--silent", "--pack-destination", packDirectory],
    projectRoot,
    npmEnvironment,
  );

  const archives = readdirSync(packDirectory).filter((file) =>
    file.endsWith(".tgz"),
  );
  assert.deepEqual(archives.length, 1, "npm pack should create one archive");
  const archive = join(packDirectory, archives[0]);

  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      archive,
    ],
    installDirectory,
    npmEnvironment,
  );

  const executable = join(
    installDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "parallm.cmd" : "parallm",
  );
  const version = run(executable, ["--version"], installDirectory).trim();
  assert.equal(version, packageJson.version);

  const exportedNames = run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "const api = await import('parallm'); process.stdout.write(Object.keys(api).sort().join(','));",
    ],
    installDirectory,
  );
  assert.match(exportedNames, /CodexAdapter/);
  assert.match(exportedNames, /ComparisonEngine/);

  const installedPackageRoot = join(
    installDirectory,
    "node_modules",
    packageJson.name,
  );
  const installedPackageJson = JSON.parse(
    readFileSync(join(installedPackageRoot, "package.json"), "utf8"),
  );
  const exportedTypes = installedPackageJson.exports?.["."]?.types;
  assert.equal(exportedTypes, "./dist/index.d.ts");
  assert.equal(
    existsSync(join(installedPackageRoot, exportedTypes)),
    true,
    "the public type declaration should be included in the package",
  );
  assert.equal(
    existsSync(join(installedPackageRoot, "SECURITY.md")),
    true,
    "the security policy should be included in the package",
  );

  process.stdout.write(
    `Packed package smoke test passed (${packageJson.name}@${packageJson.version}).\n`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function run(command, args, cwd, additionalEnvironment = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...additionalEnvironment },
    shell: process.platform === "win32",
    windowsHide: true,
  });

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} exited with code ${result.status ?? "unknown"}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout;
}
