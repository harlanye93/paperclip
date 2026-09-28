import { execFileSync, spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { processMayBeAlive } from "./conversation-continuation.js";

const posix = process.platform !== "win32";
const ownGroupId = () => Number(execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" }).trim());

describe("processMayBeAlive", () => {
  it.skipIf(!posix)("treats a zombie-only process group as stopped", async () => {
    const pgid = ownGroupId();
    const table = `${pgid} ${pgid} Z\n`;
    expect(await processMayBeAlive({ processGroupId: pgid }, { readTable: async () => table })).toBe(false);
  });

  it.skipIf(!posix)("treats a zombie PID as stopped", async () => {
    const table = `${process.pid} 1 Z\n`;
    expect(await processMayBeAlive({ pid: process.pid }, { readTable: async () => table })).toBe(false);
  });

  it.skipIf(!posix)("keeps a group alive while any member is not a zombie", async () => {
    const pgid = ownGroupId();
    const table = `${pgid} ${pgid} Z\n  4242 ${pgid} S+\n`;
    expect(await processMayBeAlive({ processGroupId: pgid }, { readTable: async () => table })).toBe(true);
  });

  it("stays conservative when the process table cannot be read", async () => {
    const readTable = async () => { throw new Error("ps unavailable"); };
    expect(await processMayBeAlive({ pid: process.pid }, { readTable })).toBe(true);
  });

  it("reports an exited process as stopped without reading the table", async () => {
    const child = spawn(process.execPath, ["-e", ""]);
    await new Promise(resolve => child.once("exit", resolve));
    const readTable = async () => { throw new Error("must not be read"); };
    expect(await processMayBeAlive({ pid: child.pid! }, { readTable })).toBe(false);
  });

  it.skipIf(!posix)("detects a live process and group from the real process table", async () => {
    expect(await processMayBeAlive({ pid: process.pid })).toBe(true);
    expect(await processMayBeAlive({ processGroupId: ownGroupId() })).toBe(true);
  });
});
