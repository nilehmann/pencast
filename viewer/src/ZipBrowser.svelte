<script lang="ts">
    import FileBrowser from "../../shared/components/FileBrowser.svelte";
    import type { ZipEntry } from "../../shared/pdf-utils";
    import type { DirectoryEntry } from "../../shared/types";

    interface Props {
        entries: ZipEntry[];
        onSelectPdf: (path: string) => void;
        onCancel: () => void;
    }
    let { entries, onSelectPdf, onCancel }: Props = $props();

    const dirEntries = $derived(
        entries
            .filter((e) => e.isPdf || e.path.toLowerCase().endsWith(".json"))
            .map((e): DirectoryEntry => ({
                name: e.name,
                path: e.path,
                type: e.isPdf ? "pdf" : "annotations",
            })),
    );
</script>

<FileBrowser
    entries={dirEntries}
    canGoBack={true}
    onSelect={(e) => { if (e.type === "pdf") onSelectPdf(e.path); }}
    onGoBack={onCancel}
/>
