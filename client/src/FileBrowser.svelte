<script lang="ts">
    import type { DirectoryEntry } from "../../shared/types.ts";
    import { authToken } from "./stores.ts";
    import { send } from "./ws-client.ts";

    let currentPath = $state("");
    let entries = $state<DirectoryEntry[]>([]);
    let loading = $state(true);
    let error = $state("");
    let pathHistory = $state<string[]>([]);

    $effect(() => {
        loadDir(currentPath);
    });

    async function loadDir(dirPath: string) {
        loading = true;
        error = "";
        const params = new URLSearchParams({ token: $authToken });
        if (dirPath) params.set("path", dirPath);
        const res = await fetch(`/api/browse?${params}`);
        if (res.ok) {
            entries = (await res.json()) as DirectoryEntry[];
        } else {
            error = "Failed to load directory";
        }
        loading = false;
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

    function loadPdf(entry: DirectoryEntry) {
        send({ type: "load_pdf", path: entry.path });
    }
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
    {:else if entries.length === 0}
        <p class="status">No PDFs or folders found.</p>
    {:else}
        <ul>
            {#each entries as entry (entry.path)}
                <li>
                    {#if entry.type === "folder"}
                        <button
                            class="entry folder"
                            onclick={() => navigate(entry)}
                        >
                            📁 {entry.name}
                        </button>
                    {:else}
                        <button
                            class="entry pdf"
                            onclick={() => loadPdf(entry)}
                        >
                            📄 {entry.name}
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
    .pdf {
        color: #0055cc;
    }
    .status {
        color: #666;
        padding: 1rem 0;
    }
    .error {
        color: red;
    }
</style>
