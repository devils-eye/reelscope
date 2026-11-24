// Minimal ambient declarations so `tsc --noEmit` passes without extra deps.
// Bun provides the real implementations at runtime.

declare module 'bun:sqlite' {
  export interface Statement<T = unknown> {
    get(...params: unknown[]): T | null;
    all(...params: unknown[]): T[];
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number };
  }
  export class Database {
    constructor(path?: string, options?: { create?: boolean; readwrite?: boolean });
    query<T = Record<string, unknown>>(sql: string): Statement<T>;
    run(sql: string, ...params: unknown[]): void;
    exec(sql: string): void;
    transaction<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
    close(): void;
  }
}

declare module 'node:fs' {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function existsSync(path: string): boolean;
}

declare module '*.sql' {
  const content: string;
  export default content;
}

declare module 'bun:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function describe(name: string, fn: () => void): void;
  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toMatch(pattern: RegExp | string): void;
    toBeTruthy(): void;
    toContain(item: unknown): void;
    toBeNull(): void;
    toThrow(): void;
    toHaveLength(n: number): void;
    toContainEqual(item: unknown): void;
    toMatchObject(subset: unknown): void;
    toBeGreaterThan(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toBeCloseTo(n: number, digits?: number): void;
    toBeUndefined(): void;
    not: Matchers;
  }
  export function expect(actual: unknown): Matchers;
}

declare namespace Bun {
  const env: Record<string, string | undefined>;
  interface Server {
    port: number;
  }
  function serve(options: {
    port?: number;
    fetch(req: Request): Response | Promise<Response>;
  }): Server;
  function file(path: string): Blob;
  function write(
    path: string | Blob,
    data: Blob | ArrayBuffer | Uint8Array | string,
  ): Promise<number>;
  interface Subprocess {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
    kill(signal?: number): void;
  }
  function spawn(cmd: string[], options?: { stdout?: 'pipe'; stderr?: 'pipe'; stdin?: unknown; cwd?: string }): Subprocess;
}
