<script lang="ts">
    import { onMount } from "svelte";
    import html2canvas from "html2canvas";
    import { htmlMode, htmlPath, authToken } from "./stores";
    import { send } from "./ws-client";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";

    let container = $state<HTMLDivElement>(undefined!);
    let iframeEl = $state<HTMLIFrameElement | undefined>(undefined);

    let snapshotInterval: ReturnType<typeof setInterval> | null = null;

    $effect(() => {
        if (!$htmlMode || !iframeEl) {
            if (snapshotInterval !== null) {
                clearInterval(snapshotInterval);
                snapshotInterval = null;
            }
            return;
        }

        snapshotInterval = setInterval(() => {
            if (!$htmlMode || !iframeEl?.contentDocument?.body) return;
            html2canvas(iframeEl.contentDocument.body, {
                    logging: false,
                    width: iframeEl.clientWidth,
                    height: iframeEl.clientHeight,
                    windowWidth: iframeEl.clientWidth,
                    windowHeight: iframeEl.clientHeight,
                })
                .then((c) => {
                    const dataUrl = c.toDataURL("image/jpeg", 0.7);
                    send({ type: "html_snapshot", dataUrl });
                })
                .catch(() => {
                    // Ignore errors (e.g., cross-origin content)
                });
        }, 300);

        return () => {
            if (snapshotInterval !== null) {
                clearInterval(snapshotInterval);
                snapshotInterval = null;
            }
        };
    });

    $effect(() => {
        if (!container) return;
        const observer = new ResizeObserver(() => {
            // trigger AnnotationCanvas syncSize
        });
        observer.observe(container);
        return () => observer.disconnect();
    });
</script>

<div class="html-container" bind:this={container}>
    {#if $htmlPath}
        <iframe
            bind:this={iframeEl}
            src={`/api/html?path=${encodeURIComponent($htmlPath)}&token=${encodeURIComponent($authToken)}`}
            class="html-iframe"
            sandbox="allow-scripts allow-forms allow-same-origin"
            title="HTML content"
        ></iframe>
    {/if}
    <AnnotationCanvas sourceCanvas={iframeEl ?? container} readonly={true} />
</div>

<style>
    .html-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1a1a1a;
        overflow: hidden;
        position: relative;
        min-height: 0;
    }

    .html-iframe {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: none;
    }
</style>
