<script lang="ts">
    import FileBrowser from "@pencast/shared/components/FileBrowser.svelte";
    import type { ZipEntry } from "@pencast/shared/pdf-utils";
    import type { DirectoryEntry } from "@pencast/shared/types";

    interface Props {
        entries: ZipEntry[];
        onSelectPdf: (path: string) => void;
        onCancel: () => void;
    }
    let { entries, onSelectPdf, onCancel }: Props = $props();

    function entriesAt(path: string): DirectoryEntry[] {
        const prefix = path ? path + "/" : "";
        const seen = new Set<string>();
        const result: DirectoryEntry[] = [];

        for (const entry of entries) {
            if (!entry.isPdf && !entry.path.toLowerCase().endsWith(".annotations.json")) continue;
            if (!entry.path.startsWith(prefix)) continue;

            const remaining = entry.path.slice(prefix.length);
            const slashIndex = remaining.indexOf("/");

            if (slashIndex === -1) {
                result.push({
                    name: entry.name,
                    path: entry.path,
                    type: entry.isPdf ? "pdf" : "annotations",
                });
            } else {
                const folderName = remaining.slice(0, slashIndex);
                const folderPath = prefix + folderName;
                if (!seen.has(folderPath)) {
                    seen.add(folderPath);
                    result.push({ name: folderName, path: folderPath, type: "folder" });
                }
            }
        }

        return result.sort((a, b) => {
            if (a.type === "folder" && b.type !== "folder") return -1;
            if (a.type !== "folder" && b.type === "folder") return 1;
            return a.name.localeCompare(b.name);
        });
    }

    function computeInitialPath(): string {
        const root = entriesAt("");
        if (root.length === 1 && root[0].type === "folder") return root[0].path;
        return "";
    }

    let currentPath = $state(computeInitialPath());
    let pathHistory = $state<string[]>([]);

    const dirEntries = $derived.by(() => entriesAt(currentPath));

    function navigate(entry: DirectoryEntry) {
        pathHistory = [...pathHistory, currentPath];
        currentPath = entry.path;
    }

    function goBack() {
        if (pathHistory.length > 0) {
            currentPath = pathHistory[pathHistory.length - 1];
            pathHistory = pathHistory.slice(0, -1);
        } else {
            onCancel();
        }
    }
</script>

<FileBrowser
    entries={dirEntries}
    currentPath={currentPath}
    canGoBack={true}
    onNavigate={navigate}
    onSelect={(e) => { if (e.type === "pdf") onSelectPdf(e.path); }}
    onGoBack={goBack}
/>
