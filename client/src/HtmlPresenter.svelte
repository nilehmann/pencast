<script lang="ts">
    import { latestHtmlDom } from "./stores";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";

    let container = $state<HTMLDivElement>(undefined!);
    let iframeWrapper = $state<HTMLDivElement | undefined>(undefined);
    let containerW = $state(0);
    let containerH = $state(0);

    const scale = $derived(
        $latestHtmlDom &&
        $latestHtmlDom.viewerWidth > 0 && $latestHtmlDom.viewerHeight > 0 &&
        containerW > 0 && containerH > 0
            ? Math.min(containerW / $latestHtmlDom.viewerWidth, containerH / $latestHtmlDom.viewerHeight)
            : 1
    );
</script>

<div class="html-container" bind:this={container}
     bind:clientWidth={containerW} bind:clientHeight={containerH}>
    {#if $latestHtmlDom}
        {@const { html, viewerWidth, viewerHeight } = $latestHtmlDom}
        <div class="iframe-wrapper"
             style="width:{viewerWidth * scale}px; height:{viewerHeight * scale}px"
             bind:this={iframeWrapper}>
            <iframe
                srcdoc={html}
                style="width:{viewerWidth}px; height:{viewerHeight}px; transform:scale({scale}); transform-origin:0 0"
                class="html-iframe"
                sandbox="allow-same-origin"
                title="HTML content"
            ></iframe>
            <AnnotationCanvas sourceCanvas={iframeWrapper ?? container} />
        </div>
    {:else}
        <div class="html-waiting">Waiting for viewer…</div>
        <AnnotationCanvas sourceCanvas={container} />
    {/if}
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

    .iframe-wrapper {
        position: relative;
        flex-shrink: 0;
        overflow: hidden;
    }

    .html-iframe {
        position: absolute;
        top: 0;
        left: 0;
        border: none;
        pointer-events: none;
    }

    .html-waiting {
        color: #888;
        font-size: 1rem;
        font-family: sans-serif;
    }
</style>
