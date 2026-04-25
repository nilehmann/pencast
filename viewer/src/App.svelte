<script lang="ts">
    import type { PDFDocumentProxy } from "pdfjs-dist";
    import PdfViewer from "./PdfViewer.svelte";
    import StaticAnnotationCanvas from "./StaticAnnotationCanvas.svelte";
    import ZipPicker from "./ZipPicker.svelte";
    import ZipBrowser from "./ZipBrowser.svelte";
    import Modal from "../../shared/components/Modal.svelte";
    import { listZip } from "../../shared/pdf-utils";
    import { stores } from "./stores.svelte";

    async function onFilePicked(file: File) {
        stores.loading = true;
        stores.error = null;
        try {
            const result = await listZip(file);
            stores.zipEntries = result.entries;
            stores.zipLoadPdf = result.loadPdf;
            stores.showBrowser = true;
        } catch (err) {
            stores.error = err instanceof Error ? err.message : String(err);
        } finally {
            stores.loading = false;
        }
    }

    async function onPdfSelected(path: string) {
        stores.loading = true;
        stores.error = null;
        try {
            const contents = await stores.zipLoadPdf!(path);
            stores.setPdfState(
                path,
                path,
                contents.pdfBytes,
                contents.annotationMap,
                contents.subPageCounts,
            );
            stores.showBrowser = false;
        } catch (err) {
            stores.error = err instanceof Error ? err.message : String(err);
        } finally {
            stores.loading = false;
        }
    }

    function onPdfLoaded(doc: PDFDocumentProxy | null) {
        stores.updatePageCount(doc?.numPages ?? 0);
    }

    function reset() {
        stores.reset();
    }
</script>

{#if stores.loading}
    <div class="loading-screen">
        <span>Loading…</span>
    </div>
{:else if stores.error}
    <div class="error-screen">
        <p class="error-msg">{stores.error}</p>
        <button onclick={reset}>Try again</button>
    </div>
{:else if stores.activePdf && stores.pdfBytes}
    <div class="viewer">
        <PdfViewer pdfBytes={stores.pdfBytes} {onPdfLoaded} readonly={true}>
            {#snippet children(sourceCanvas)}
                <StaticAnnotationCanvas {sourceCanvas} strokes={stores.strokes} />
            {/snippet}
        </PdfViewer>

        <nav class="nav-bar">
            <button
                onclick={() => (stores.showBrowser = true)}
                class="reset-btn"
                title="Open another PDF">☰</button
            >
            <div class="nav-controls">
                <button
                    onclick={() => stores.prevSlide()}
                    disabled={stores.activePdf?.position.slide === 0}>‹</button
                >
                <span class="slide-label"
                    >{(stores.activePdf?.position.slide ?? 0) + 1} / {stores.activePdf?.pageCount}</span
                >
                <button
                    onclick={() => stores.nextSlide()}
                    disabled={stores.activePdf && stores.activePdf.position.slide >= stores.activePdf.pageCount - 1}>›</button
                >
            </div>
            {#if stores.currentSubPageCount > 1}
                <div class="subpage-controls">
                    <button
                        onclick={() => stores.prevSubPage()}
                        disabled={stores.activePdf?.position.page === 0}>↑</button
                    >
                    <span class="subpage-label"
                        >{(stores.activePdf?.position.page ?? 0) + 1} / {stores.currentSubPageCount}</span
                    >
                    <button
                        onclick={() => stores.nextSubPage()}
                        disabled={stores.activePdf && stores.activePdf.position.page >= stores.currentSubPageCount - 1}>↓</button
                    >
                </div>
            {/if}
        </nav>
    </div>
{:else}
    <ZipPicker {onFilePicked} />
{/if}

{#if stores.zipEntries && stores.showBrowser}
    <Modal wide dismissible={!!stores.activePdf} ondismiss={() => (stores.showBrowser = false)}>
        <h2>Select a PDF</h2>
        <ZipBrowser entries={stores.zipEntries} onSelectPdf={onPdfSelected} onCancel={reset} />
    </Modal>
{/if}

<style>
    .loading-screen {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        background: #1a1a1a;
        color: #9ca3af;
        font-family: system-ui, sans-serif;
        font-size: 1rem;
    }

    .viewer {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #1a1a1a;
    }

    .nav-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.5rem 1rem;
        background: #111;
        gap: 1.5rem;
        position: relative;
        flex-shrink: 0;
    }

    .nav-controls,
    .subpage-controls {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .subpage-controls {
        border-left: 1px solid #2a2a2a;
        padding-left: 1.5rem;
    }

    .nav-bar button {
        background: #374151;
        color: #e0e0e0;
        border: none;
        border-radius: 6px;
        padding: 0.4rem 0.9rem;
        font-size: 1.2rem;
        cursor: pointer;
        transition: background 0.15s;
    }

    .nav-bar button:hover:not(:disabled) {
        background: #4b5563;
    }

    .nav-bar button:disabled {
        opacity: 0.35;
        cursor: default;
    }

    .reset-btn {
        position: absolute;
        left: 1rem;
        font-size: 0.9rem !important;
        padding: 0.35rem 0.65rem !important;
    }

    .slide-label,
    .subpage-label {
        color: #9ca3af;
        font-family: system-ui, sans-serif;
        font-size: 0.9rem;
        min-width: 4rem;
        text-align: center;
    }

    .error-screen {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 1rem;
        background: #1a1a1a;
        font-family: system-ui, sans-serif;
    }

    .error-msg {
        color: #f87171;
    }

    .error-screen button {
        background: #374151;
        color: #e0e0e0;
        border: none;
        border-radius: 6px;
        padding: 0.5rem 1.5rem;
        cursor: pointer;
    }
</style>
