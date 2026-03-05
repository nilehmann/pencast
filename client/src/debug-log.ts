import { writable } from "svelte/store";

export type LogLevel = "log" | "info" | "warn" | "error";

export interface LogEntry {
    id: number;
    ts: number;
    level: LogLevel;
    text: string;
}

const MAX_ENTRIES = 200;
let _idCounter = 0;
let _intercepting = false;

export const logEntries = writable<LogEntry[]>([]);

function safeStringify(arg: unknown): string {
    if (typeof arg === "string") return arg;
    if (arg instanceof Error) return arg.stack ?? arg.message;
    try { return JSON.stringify(arg); } catch { return "[Circular]"; }
}

function push(level: LogLevel, args: unknown[]): void {
    if (_intercepting) return;
    _intercepting = true;
    try {
        const entry: LogEntry = {
            id: _idCounter++,
            ts: Date.now(),
            level,
            text: args.map(safeStringify).join(" "),
        };
        logEntries.update((es) => {
            const next = [...es, entry];
            return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
        });
    } finally {
        _intercepting = false;
    }
}

export function installConsoleInterceptor(): void {
    for (const level of ["log", "info", "warn", "error"] as LogLevel[]) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            original(...args);
            push(level, args);
        };
    }
}

export function clearLog(): void {
    logEntries.set([]);
}
