<script lang="ts">
    import { loadZip, type ZipContents } from "../../shared/pdf-utils";

    interface Props {
        onFilePicked: (contents: ZipContents) => void;
        onError: (msg: string) => void;
    }
    let { onFilePicked, onError }: Props = $props();

    let loading = $state(false);

    async function handleChange(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        loading = true;
        try {
            const contents = await loadZip(file);
            onFilePicked(contents);
        } catch (err) {
            onError(err instanceof Error ? err.message : String(err));
        } finally {
            loading = false;
        }
    }
</script>

<div class="picker">
    <h1>Pencast Viewer</h1>
    <p>Open a <code>.zip</code> file exported from Pencast to view its slides and annotations.</p>
    <label class="pick-btn" class:loading>
        {#if loading}
            Loading…
        {:else}
            Open ZIP file
        {/if}
        <input
            type="file"
            accept=".zip"
            onchange={handleChange}
            disabled={loading}
            style="display: none;"
        />
    </label>
</div>

<style>
    .picker {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 1rem;
        color: #e0e0e0;
        background: #1a1a1a;
        font-family: system-ui, sans-serif;
    }

    h1 {
        font-size: 1.5rem;
        margin: 0;
    }

    p {
        color: #888;
        margin: 0;
    }

    .pick-btn {
        padding: 0.75rem 2rem;
        background: #3b82f6;
        color: white;
        border-radius: 8px;
        cursor: pointer;
        font-size: 1rem;
        transition: background 0.15s;
    }

    .pick-btn:hover:not(.loading) {
        background: #2563eb;
    }

    .pick-btn.loading {
        background: #374151;
        cursor: default;
    }
</style>
