<script lang="ts">
    import FileBrowserUI from "@pencast/shared/components/FileBrowser.svelte";
    import type { DirectoryEntry } from "@pencast/shared/types";
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

    let loadGen = 0;

    $effect(() => {
        const path = currentPath;
        void loadDir(path, ++loadGen);
    });

    async function loadDir(dirPath: string, gen: number) {
        loading = true;
        error = "";
        try {
            const params = new URLSearchParams();
            if (dirPath) params.set("path", dirPath);
            const query = params.toString() ? `?${params}` : "";
            const res = await fetch(`/api/browse${query}`);
            if (gen !== loadGen) return;
            if (!res.ok) {
                error = `Failed to load directory (${res.status})`;
                return;
            }
            entries = (await res.json()) as DirectoryEntry[];
        } catch {
            if (gen !== loadGen) return;
            error = "Network error — check your connection";
        } finally {
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

    const activeFilePath = $derived(
        mode === "html" ? stores.activeHtml?.path : stores.activePdf?.path,
    );
</script>

<FileBrowserUI
    {entries}
    {currentPath}
    canGoBack={pathHistory.length > 0}
    {loading}
    {error}
    {activeFilePath}
    {mode}
    onSelect={loadFile}
    onNavigate={navigate}
    onGoBack={goBack}
/>
