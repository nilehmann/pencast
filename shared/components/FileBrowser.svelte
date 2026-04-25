<script lang="ts">
    import type { DirectoryEntry } from "../types";

    interface Props {
        entries: DirectoryEntry[];
        currentPath?: string;
        canGoBack?: boolean;
        loading?: boolean;
        error?: string;
        activeFilePath?: string;
        mode?: "pdf" | "html";
        onSelect: (entry: DirectoryEntry) => void;
        onNavigate?: (entry: DirectoryEntry) => void;
        onGoBack?: () => void;
    }

    let {
        entries,
        currentPath = "",
        canGoBack = false,
        loading = false,
        error = "",
        activeFilePath,
        mode = "pdf",
        onSelect,
        onNavigate,
        onGoBack,
    }: Props = $props();

    const visibleEntries = $derived(
        entries.filter((e) => {
            if (e.type === "folder") return true;
            if (mode === "html") return e.type === "html";
            return e.type === "pdf" || e.type === "annotations";
        }),
    );
</script>

<div class="browser">
    <div class="toolbar">
        <button onclick={onGoBack} disabled={!canGoBack}>← Back</button>
        <span class="path">{currentPath || "Root"}</span>
    </div>

    {#if loading}
        <p class="status">Loading…</p>
    {:else if error}
        <p class="status error">{error}</p>
    {:else if visibleEntries.length === 0}
        <p class="status">
            {mode === "html" ? "No HTML files found." : "No PDFs or folders found."}
        </p>
    {:else}
        <ul>
            {#each visibleEntries as entry (entry.path)}
                <li>
                    {#if entry.type === "folder"}
                        <button class="entry folder" onclick={() => onNavigate?.(entry)}>
                            📁 {entry.name}
                        </button>
                    {:else if entry.type === "annotations"}
                        <span class="entry annotations">📝 {entry.name}</span>
                    {:else if entry.path === activeFilePath}
                        <span class="entry file file--active">
                            {mode === "html" ? "🌐" : "📄"} {entry.name}
                        </span>
                    {:else}
                        <button class="entry file" onclick={() => onSelect(entry)}>
                            {mode === "html" ? "🌐" : "📄"} {entry.name}
                        </button>
                    {/if}
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style>
    .browser {
        max-width: var(--browser-max-width, 600px);
        margin: var(--browser-margin, 2rem auto);
        font-family: var(--browser-font, sans-serif);
        color: var(--browser-text, inherit);
        background: var(--browser-bg, transparent);
        height: var(--browser-height, auto);
        display: var(--browser-display, block);
        flex-direction: var(--browser-flex-direction, row);
        overflow: var(--browser-overflow, visible);
    }

    .toolbar {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: var(--browser-toolbar-margin-bottom, 1rem);
        padding: var(--browser-toolbar-padding, 0);
        background: var(--browser-toolbar-bg, transparent);
        border-bottom: var(--browser-toolbar-border, none);
        flex-shrink: 0;
    }

    .path {
        color: var(--browser-path-color, #666);
        font-size: 0.9rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    ul {
        list-style: none;
        padding: var(--browser-list-padding, 0);
        margin: 0;
        overflow-y: var(--browser-list-overflow, visible);
        flex: var(--browser-list-flex, none);
    }

    li {
        border-bottom: 1px solid var(--browser-border-color, #eee);
    }

    .entry {
        display: block;
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        padding: 0.75rem 0.5rem;
        font-size: 1rem;
        cursor: pointer;
        color: var(--browser-text, inherit);
    }

    .entry:hover {
        background: var(--browser-hover, #f5f5f5);
    }

    .file {
        color: var(--browser-file-color, #0055cc);
    }

    .file--active {
        cursor: default;
        opacity: 0.45;
    }

    .annotations {
        color: var(--browser-annotations-color, #888);
        cursor: default;
        font-style: italic;
    }

    .status {
        color: var(--browser-path-color, #666);
        padding: 1rem 0;
    }

    .error {
        color: var(--browser-error-color, red);
    }
</style>
