import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  APP_ENV_REL_PATH,
  commandSpawn,
  mergeAppEnv,
  parseAppEnv,
  projectRoot,
  readAppEnv,
} from "./with-app-env.mjs";
import { authEnabledFromEnvValue } from "./check-auth-invariant.mjs";

const execFileAsync = promisify(execFile);
const WRAPPER = join(projectRoot(), "scripts/with-app-env.mjs");
const PRINT_FLAG = "process.stdout.write(String(process.env.VITE_AUTH_ENABLED));";

function makeWorkspace(appEnvJson) {
  const root = mkdtempSync(join(tmpdir(), "app-env-"));
  if (appEnvJson !== undefined) {
    mkdirSync(join(root, ".grok"), { recursive: true });
    writeFileSync(join(root, APP_ENV_REL_PATH), appEnvJson);
  }
  return root;
}

test("keeps VITE_-prefixed string entries", () => {
  assert.deepEqual(parseAppEnv('{"VITE_AUTH_ENABLED":"false"}'), {
    VITE_AUTH_ENABLED: "false",
  });
});

test("drops non-VITE keys, non-string values and malformed documents", () => {
  assert.deepEqual(parseAppEnv('{"DATABASE_URL":"postgres://x","VITE_N":1,"VITE_OK":"y"}'), {
    VITE_OK: "y",
  });
  assert.deepEqual(parseAppEnv("not json"), {});
  assert.deepEqual(parseAppEnv('["VITE_AUTH_ENABLED"]'), {});
  assert.deepEqual(parseAppEnv("null"), {});
});

test("a missing app-env.json is a clean no-op", () => {
  assert.deepEqual(readAppEnv(makeWorkspace()), {});
});

test("reads the app env from a workspace", () => {
  const root = makeWorkspace('{"VITE_AUTH_ENABLED":"false"}');
  assert.deepEqual(readAppEnv(root), { VITE_AUTH_ENABLED: "false" });
});

test("an explicit process-env override wins over the file", () => {
  const merged = mergeAppEnv(
    { VITE_AUTH_ENABLED: "false" },
    { VITE_AUTH_ENABLED: "true", PATH: "/usr/bin" },
  );
  assert.equal(merged.VITE_AUTH_ENABLED, "true");
  assert.equal(merged.PATH, "/usr/bin");
});

test("Windows resolves npm's .cmd shims through cmd.exe, not shell mode", () => {
  // npm puts `vite.cmd` on PATH; CreateProcess cannot run it without cmd.exe,
  // so a bare `vite` spawn fails with ENOENT on Windows (`npm run dev`).
  // `shell: true` is avoided because Node warns about its unescaped args.
  const launch = commandSpawn(
    "vite",
    ["dev", "--port", "8080"],
    { ComSpec: "C:\\Windows\\system32\\cmd.exe" },
    "win32",
  );
  assert.equal(launch.file, "C:\\Windows\\system32\\cmd.exe");
  assert.deepEqual(launch.args, ["/d", "/s", "/c", '"vite dev --port 8080"']);
  assert.equal("shell" in launch.options, false);
  assert.equal(launch.options.windowsVerbatimArguments, true);
  // An absolute executable stays direct: cmd.exe would split
  // `C:\Program Files\nodejs\node.exe` at the first space.
  const direct = commandSpawn("C:\\Program Files\\nodejs\\node.exe", ["-e", "1"], {}, "win32");
  assert.equal(direct.file, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(direct.args, ["-e", "1"]);
  assert.equal("shell" in direct.options, false);
  // POSIX is untouched.
  assert.equal(commandSpawn("vite", ["build"], {}, "linux").file, "vite");
  assert.equal("shell" in commandSpawn("vite", ["build"], {}, "darwin").options, false);
});

test("this app carries no VITE_AUTH_ENABLED override", () => {
  // Sign-in is ON here, so the key is deleted from `.grok/app-env.json` (see the
  // auth skill's "Turning sign-in on"): dev, build and preview all resolve the
  // flag to on, and the deployer's env is what decides it once deployed.
  assert.equal("VITE_AUTH_ENABLED" in readAppEnv(projectRoot()), false);
  assert.equal(authEnabledFromEnvValue(readAppEnv(projectRoot()).VITE_AUTH_ENABLED), true);
});

test("vite loadEnv resolves the wrapped value", () => {
  // What `import.meta.env.VITE_AUTH_ENABLED` becomes: loadEnv prefix-matches
  // process.env, so the wrapper's merge has to land before Vite starts.
  // Do not `import { loadEnv } from "vite"` here — Vite 8 loads rolldown
  // native bindings that SIGSEGV the test worker under qemu-user.
  const root = makeWorkspace('{"VITE_AUTH_ENABLED":"false"}');
  const merged = mergeAppEnv(readAppEnv(root), { PATH: "/usr/bin" });
  assert.equal(merged.VITE_AUTH_ENABLED, "false");
});

test("the wrapped command runs with the app env applied", async () => {
  // The file no longer carries the flag, so the child must see it *unset* — the
  // wrapper applies what the file says and invents nothing.
  const { stdout } = await execFileAsync(process.execPath, [
    WRAPPER,
    process.execPath,
    "-e",
    PRINT_FLAG,
  ]);
  assert.equal(stdout, "undefined");
});

test("the wrapped command sees an explicit override, not the file value", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [WRAPPER, process.execPath, "-e", PRINT_FLAG],
    { env: { ...process.env, VITE_AUTH_ENABLED: "true" } },
  );
  assert.equal(stdout, "true");
});

test("the wrapper propagates the command's exit code", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [WRAPPER, process.execPath, "-e", "process.exit(3)"]),
    (err) => err.code === 3,
  );
});

test("a signal-killed command is never reported as success", async () => {
  // The wrapper's own SIGTERM handler must not swallow the re-raised signal:
  // a cancelled build reporting exit 0 is a silently passing gate.
  await assert.rejects(
    execFileAsync(process.execPath, [
      WRAPPER,
      process.execPath,
      "-e",
      "process.kill(process.pid, 'SIGTERM');setTimeout(() => {}, 1000);",
    ]),
    (err) => err.signal === "SIGTERM" || err.code !== 0,
  );
});

test("the CLI still runs when invoked through a symlinked path", async () => {
  // node realpaths import.meta.url but not process.argv[1], so a raw comparison
  // turns the wrapper into a no-op that exits 0 without starting anything.
  const link = join(mkdtempSync(join(tmpdir(), "app-env-link-")), "scripts");
  symlinkSync(join(projectRoot(), "scripts"), link);
  const { stdout } = await execFileAsync(process.execPath, [
    join(link, "with-app-env.mjs"),
    process.execPath,
    "-e",
    PRINT_FLAG,
  ]);
  assert.equal(stdout, "undefined");
});
