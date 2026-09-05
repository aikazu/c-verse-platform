import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(__dirname, "../../../../../sync-docs.mjs");
const directories: string[] = [];

function fixture(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "cverse-mirror-test-"));
  directories.push(directory);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content);
  return directory;
}

function sync(source: string, target: string, ...args: string[]) {
  return spawnSync(process.execPath, [script, "--source", source, "--target", target, ...args], { encoding: "utf8" });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("documentation mirror CLI", () => {
  it.each([
    [{ "00_readme.md": "same" }, 0],
    [{ "00_readme.md": "drift" }, 2],
    [{}, 2],
    [{ "00_readme.md": "same", "extra.md": "keep" }, 2],
  ])("checks content and missing files without writing: %j", (targetFiles, expectedStatus) => {
    const source = fixture({ "00_readme.md": "same" });
    const target = fixture(targetFiles);
    const result = sync(source, target, "--check");
    expect(result.status, result.stderr).toBe(expectedStatus);
    expect(readdirSync(target).sort()).toEqual(Object.keys(targetFiles).sort());
    for (const [name, content] of Object.entries(targetFiles)) expect(readFileSync(join(target, name), "utf8")).toBe(content);
  });

  it("copies bytes in either direction and leaves extra target files intact", () => {
    const source = fixture({ "00_readme.md": "updated\r\n", "01_scope.md": "new\n" });
    const target = fixture({ "00_readme.md": "old", "extra.md": "keep" });
    expect(sync(source, target).status).toBe(2);
    expect(readFileSync(join(target, "00_readme.md"), "utf8")).toBe("updated\r\n");
    expect(readFileSync(join(target, "01_scope.md"), "utf8")).toBe("new\n");
    expect(readFileSync(join(target, "extra.md"), "utf8")).toBe("keep");
    expect(sync(source, target, "--reverse").status).toBe(0);
    expect(readFileSync(join(source, "extra.md"), "utf8")).toBe("keep");
    expect(sync(source, target, "--check").status).toBe(0);
  });
});
