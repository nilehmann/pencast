<script lang="ts">
    import type { DirectoryEntry } from "../../shared/types";
    import { stores } from "./stores.svelte";
    import { send } from "./ws-client";

    interface Props {
        mode?: "pdf" | "html";
    }
    let { mode = "pdf" }: Props = $props();

    let currentPath = $state("");
    let entries = $state<DirectoryEntry[]>([]);
    let loading = $state(true);
    let error = $state("");
    let pathHistory = $state<string[]>([]);

    // Generation counter: incremented on every loadDir call so that a response
    // arriving from a stale (superseded) fetch is silently discarded.
    let loadGen = 0;

    $effect(() => {
        // Reference currentPath so Svelte tracks it as a reactive dependency.
        const path = currentPath;
        void loadDir(path, ++loadGen);
    });

    async function loadDir(dirPath: string, gen: number) {
        loading = true;
        error = "";
        try {
            const params = new URLSearchParams({ token: stores.authToken });
            if (dirPath) params.set("path", dirPath);
            const res = await fetch(`/api/browse?${params}`);
            if (gen !== loadGen) return; // superseded by a newer navigation
            if (res.status === 401) {
                stores.logout(true); // token is invalid — full logout to PIN screen
                return;
            }
            if (!res.ok) {
                error = `Failed to load directory (${res.status})`;
                return;
            }
            entries = (await res.json()) as DirectoryEntry[];
        } catch {
            if (gen !== loadGen) return;
            error = "Network error — check your connection";
        } finally {
            // Only update loading for the winning generation so a rapid series
            // of navigations doesn't flicker loading=false while an old fetch
            // is still in-flight.
            if (gen === loadGen) loading = false;
        }
    }

    function navigate(entry: DirectoryEntry) {
        pathHistory = [...pathHistory, currentPath];
        currentPath = entry.path;
    }

    function goBack() {
        const prev = pathHistory[pathHistory.length - 1];
        pathHistory = pathHistory.slice(0, -1);
        currentPath = prev ?? "";
    }

    function loadFile(entry: DirectoryEntry) {
        if (mode === "html") {
            send({ type: "load_html", path: entry.path });
        } else {
            send({ type: "load_pdf", path: entry.path });
        }
    }

    let visibleEntries = $derived(
        entries.filter((e) => {
            if (e.type === "folder") return true;
            if (mode === "html") return e.type === "html";
            return e.type === "pdf" || e.type === "annotations";
        }),
    );

    let activeFilePath = $derived(mode === "html" ? stores.htmlPath : stores.activePdfPath);
</script>

<div class="browser">
    <div class="toolbar">
        <button onclick={goBack} disabled={pathHistory.length === 0}
            >← Back</button
        >
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
                        <button
                            class="entry folder"
                            onclick={() => navigate(entry)}
                        >
                            📁 {entry.name}
                        </button>
                    {:else if entry.type === "annotations"}
                        <span class="entry annotations">
                            📝 {entry.name}
                        </span>
                    {:else if entry.path === activeFilePath}
                        <span class="entry file file--active">
                            {mode === "html" ? "🌐" : "📄"} {entry.name}
                        </span>
                    {:else}
                        <button
                            class="entry file"
                            onclick={() => loadFile(entry)}
                        >
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
        max-width: 600px;
        margin: 2rem auto;
        font-family: sans-serif;
    }
    .toolbar {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
    }
    .path {
        color: #666;
        font-size: 0.9rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    ul {
        list-style: none;
        padding: 0;
        margin: 0;
    }
    li {
        border-bottom: 1px solid #eee;
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
    }
    .entry:hover {
        background: #f5f5f5;
    }
    .file {
        color: #0055cc;
    }
    .file--active {
        cursor: default;
        opacity: 0.45;
    }
    .annotations {
        color: #888;
        cursor: default;
        font-style: italic;
    }
    .status {
        color: #666;
        padding: 1rem 0;
    }
    .error {
        color: red;
    }
</style>
