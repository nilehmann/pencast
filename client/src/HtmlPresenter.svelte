<script lang="ts">
    import { latestHtmlSnapshot } from "./stores";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";

    let container = $state<HTMLDivElement>(undefined!);
    let imgEl = $state<HTMLImageElement | undefined>(undefined);
    let imgWrapper = $state<HTMLDivElement | undefined>(undefined);
    let fittedW = $state(0);
    let fittedH = $state(0);

    function computeFitted() {
        if (!container || !imgEl || !imgEl.naturalWidth) return;
        const cW = container.clientWidth;
        const cH = container.clientHeight;
        const scale = Math.min(cW / imgEl.naturalWidth, cH / imgEl.naturalHeight);
        fittedW = imgEl.naturalWidth * scale;
        fittedH = imgEl.naturalHeight * scale;
    }

    $effect(() => {
        if (!container) return;
        const ro = new ResizeObserver(computeFitted);
        ro.observe(container);
        return () => ro.disconnect();
    });

</script>

<div class="html-container" bind:this={container}>
    {#if $latestHtmlSnapshot}
        <div
            bind:this={imgWrapper}
            class="img-wrapper"
            style={fittedW ? `width:${fittedW}px;height:${fittedH}px` : ""}
        >
            <img
                bind:this={imgEl}
                src={$latestHtmlSnapshot}
                class="html-snapshot"
                alt=""
                onload={computeFitted}
            />
            <AnnotationCanvas sourceCanvas={imgWrapper ?? container} />
        </div>
    {:else}
        <div class="html-waiting">Waiting for viewer snapshot…</div>
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

    .img-wrapper {
        position: relative;
        flex-shrink: 0;
    }

    .html-snapshot {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
    }

    .html-waiting {
        color: #888;
        font-size: 1rem;
        font-family: sans-serif;
        z-index: 1;
    }
</style>
