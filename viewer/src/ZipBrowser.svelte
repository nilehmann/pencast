<script lang="ts">
    import type { ZipEntry } from "../../shared/pdf-utils";

    interface Props {
        entries: ZipEntry[];
        onSelectPdf: (path: string) => void;
        onCancel: () => void;
    }
    let { entries, onSelectPdf, onCancel }: Props = $props();

    const pdfs = $derived(entries.filter((e) => e.isPdf));
    const others = $derived(entries.filter((e) => !e.isPdf));
</script>

<div class="browser">
    <div class="header">
        <button class="back-btn" onclick={onCancel}>Back</button>
        <span class="title">Select a PDF</span>
    </div>
    <ul class="file-list">
        {#each pdfs as entry (entry.path)}
            <li>
                <button class="file-entry pdf" onclick={() => onSelectPdf(entry.path)}>
                    {entry.path}
                </button>
            </li>
        {/each}
        {#each others as entry (entry.path)}
            <li>
                <div class="file-entry other">{entry.path}</div>
            </li>
        {/each}
    </ul>
    {#if pdfs.length === 0}
        <p class="no-pdfs">No PDF files found in this zip.</p>
    {/if}
</div>

<style>
    .browser {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #1a1a1a;
        color: #e0e0e0;
        font-family: system-ui, sans-serif;
    }

    .header {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.75rem 1rem;
        background: #111;
        border-bottom: 1px solid #2a2a2a;
        flex-shrink: 0;
    }

    .title {
        font-size: 0.95rem;
        color: #9ca3af;
    }

    .back-btn {
        background: #374151;
        color: #e0e0e0;
        border: none;
        border-radius: 6px;
        padding: 0.35rem 0.75rem;
        font-size: 0.9rem;
        cursor: pointer;
        transition: background 0.15s;
    }

    .back-btn:hover {
        background: #4b5563;
    }

    .file-list {
        list-style: none;
        margin: 0;
        padding: 0.5rem;
        overflow-y: auto;
        flex: 1;
    }

    .file-list li {
        margin-bottom: 2px;
    }

    .file-entry {
        display: block;
        width: 100%;
        text-align: left;
        padding: 0.5rem 0.75rem;
        border-radius: 6px;
        font-size: 0.9rem;
        font-family: monospace;
        word-break: break-all;
    }

    .file-entry.pdf {
        background: #1e3a5f;
        color: #93c5fd;
        border: none;
        cursor: pointer;
        transition: background 0.15s;
    }

    .file-entry.pdf:hover {
        background: #2563eb;
        color: #fff;
    }

    .file-entry.other {
        color: #4b5563;
        background: transparent;
    }

    .no-pdfs {
        color: #f87171;
        text-align: center;
        margin-top: 2rem;
    }
</style>
