<script lang="ts">
    import { logEntries, clearLog } from "./debug-log";

    interface Props { onclose: () => void; }
    let { onclose }: Props = $props();

    let listEl = $state<HTMLDivElement | null>(null);
    let height = $state(50); // dvh units
    let searchText = $state("");
    const ALL_LEVELS = ["log", "info", "warn", "error"] as const;
    let enabledLevels = $state(new Set<string>(ALL_LEVELS));

    $effect(() => {
        void $logEntries;
        if (listEl) listEl.scrollTop = listEl.scrollHeight;
    });

    const LEVEL_COLORS: Record<string, string> = {
        log:   "#888",
        info:  "#4a9eff",
        warn:  "#f0a500",
        error: "#e05555",
    };

    function formatTs(ts: number): string {
        const d = new Date(ts);
        return d.toTimeString().slice(0, 8);
    }

    function toggleLevel(level: string): void {
        const next = new Set(enabledLevels);
        if (next.has(level)) {
            // Keep at least one level active
            if (next.size > 1) next.delete(level);
        } else {
            next.add(level);
        }
        enabledLevels = next;
    }

    const filteredEntries = $derived(
        $logEntries.filter((entry) => {
            if (!enabledLevels.has(entry.level)) return false;
            if (searchText && !entry.text.toLowerCase().includes(searchText.toLowerCase())) return false;
            return true;
        })
    );

    // ── Drag-to-resize ────────────────────────────────────────────────────────
    let dragging = false;

    function onResizePointerDown(e: PointerEvent): void {
        e.stopPropagation();
        e.preventDefault();
        dragging = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }

    function onResizePointerMove(e: PointerEvent): void {
        if (!dragging) return;
        // Distance from bottom of viewport to pointer = new height
        const newHeightPx = window.innerHeight - e.clientY;
        const newHeightDvh = (newHeightPx / window.innerHeight) * 100;
        height = Math.max(15, Math.min(90, newHeightDvh));
    }

    function onResizePointerUp(e: PointerEvent): void {
        dragging = false;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="debug-overlay"
    style="height: {height}dvh"
    onpointerdown={(e) => e.stopPropagation()}
>
    <div class="debug-header">
        <span class="debug-title">Debug Console</span>
        <div class="debug-filters">
            {#each ALL_LEVELS as level}
                <button
                    class="debug-level-toggle"
                    class:active={enabledLevels.has(level)}
                    style="--level-color: {LEVEL_COLORS[level]}"
                    onclick={() => toggleLevel(level)}
                >{level.toUpperCase()}</button>
            {/each}
            <input
                class="debug-search"
                type="search"
                placeholder="filter…"
                bind:value={searchText}
            />
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="debug-resize-handle"
            onpointerdown={onResizePointerDown}
            onpointermove={onResizePointerMove}
            onpointerup={onResizePointerUp}
            onpointercancel={onResizePointerUp}
        ></div>
        <div class="debug-actions">
            <button onclick={clearLog}>Clear</button>
            <button onclick={onclose}>Close</button>
        </div>
    </div>
    <div class="debug-list" bind:this={listEl}>
        {#each filteredEntries as entry (entry.id)}
            <div class="debug-entry debug-entry--{entry.level}">
                <span class="debug-ts">{formatTs(entry.ts)}</span>
                <span
                    class="debug-badge"
                    style="color: {LEVEL_COLORS[entry.level]}"
                >{entry.level.toUpperCase()}</span>
                <span class="debug-text">{entry.text}</span>
            </div>
        {/each}
    </div>
</div>

<style>
    .debug-overlay {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 2000;
        background: rgba(10, 10, 10, 0.93);
        color: #e0e0e0;
        display: flex;
        flex-direction: column;
        font-family: ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace;
        font-size: 12px;
    }

    .debug-header {
        display: flex;
        align-items: center;
        padding: 0 0.75rem;
        gap: 0.5rem;
        background: #1a1a1a;
        border-bottom: 1px solid #333;
        border-top: 2px solid #444;
        flex-shrink: 0;
        min-height: 44px;
    }

    .debug-filters {
        display: flex;
        align-items: center;
        gap: 0.3rem;
    }

    .debug-level-toggle {
        font-size: 10px;
        font-weight: 700;
        padding: 0.2rem 0.45rem;
        background: #2a2a2a;
        color: #555;
        border: 1px solid #444;
        border-radius: 3px;
        cursor: pointer;
        font-family: inherit;
        transition: color 0.1s, border-color 0.1s;
    }

    .debug-level-toggle.active {
        color: var(--level-color);
        border-color: var(--level-color);
    }

    .debug-level-toggle:active {
        background: #3a3a3a;
    }

    .debug-search {
        font-size: 12px;
        font-family: inherit;
        padding: 0.2rem 0.5rem;
        background: #2a2a2a;
        color: #ccc;
        border: 1px solid #444;
        border-radius: 3px;
        width: 10rem;
        outline: none;
    }

    .debug-search:focus {
        border-color: #666;
    }

    .debug-search::placeholder {
        color: #555;
    }

    .debug-resize-handle {
        flex: 1;
        align-self: stretch;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: ns-resize;
        touch-action: none;
    }

    .debug-resize-handle::after {
        content: "";
        display: block;
        width: 48px;
        height: 4px;
        background: #555;
        border-radius: 2px;
    }

    .debug-title {
        font-weight: 600;
        color: #f97316;
        font-size: 13px;
        flex-shrink: 0;
    }

    .debug-actions {
        display: flex;
        gap: 0.5rem;
        flex-shrink: 0;
    }

    .debug-actions button {
        font-size: 13px;
        padding: 0.35rem 1rem;
        background: #2a2a2a;
        color: #ccc;
        border: 1px solid #444;
        border-radius: 4px;
        cursor: pointer;
        font-family: inherit;
    }

    .debug-actions button:active {
        background: #3a3a3a;
    }

    .debug-list {
        flex: 1;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding: 0.25rem 0;
    }

    .debug-entry {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
        padding: 0.15rem 0.75rem;
        border-bottom: 1px solid #1a1a1a;
        line-height: 1.5;
    }

    .debug-entry--warn {
        background: rgba(240, 165, 0, 0.06);
    }

    .debug-entry--error {
        background: rgba(224, 85, 85, 0.08);
    }

    .debug-ts {
        color: #555;
        flex-shrink: 0;
        font-size: 11px;
    }

    .debug-badge {
        font-weight: 700;
        font-size: 10px;
        flex-shrink: 0;
        width: 3.2em;
        text-align: right;
    }

    .debug-text {
        color: #d0d0d0;
        word-break: break-all;
        white-space: pre-wrap;
    }
</style>
