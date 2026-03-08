<script lang="ts">
    import { deviceRole, whiteboardSlide, whiteboardPageCount } from "./stores";
    import { prevWbSlide, nextWbSlide } from "./navigation";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";
    import NavBar from "./NavBar.svelte";

    interface Props {
        onChangePdf?: () => void;
        onLoadHtml?: () => void;
        onChangeRole?: () => void;
    }
    let { onChangePdf, onLoadHtml, onChangeRole }: Props = $props();

    let whiteboardCanvas = $state<HTMLCanvasElement>(undefined!);
    let container = $state<HTMLDivElement>(undefined!);

    let wbSlide = $derived($whiteboardSlide);
    let wbPages = $derived($whiteboardPageCount);

    $effect(() => {
        if (!container) return;
        const observer = new ResizeObserver(() => syncSize());
        observer.observe(container);
        syncSize();
        return () => observer.disconnect();
    });

    function syncSize() {
        if (!whiteboardCanvas || !container) return;
        const dpr = window.devicePixelRatio || 1;
        const cw = container.clientWidth;
        const ch = container.clientHeight;

        // Fixed 4:3 aspect ratio, fitted within the container.
        const aspect = 4 / 3;
        let w = cw;
        let h = w / aspect;
        if (h > ch) {
            h = ch;
            w = h * aspect;
        }

        whiteboardCanvas.width = Math.round(w * dpr);
        whiteboardCanvas.height = Math.round(h * dpr);
        whiteboardCanvas.style.width = `${Math.round(w)}px`;
        whiteboardCanvas.style.height = `${Math.round(h)}px`;

        const ctx = whiteboardCanvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
    }
</script>

<div class="whiteboard-container" bind:this={container}>
    <canvas bind:this={whiteboardCanvas} class="whiteboard-canvas"></canvas>
    <AnnotationCanvas sourceCanvas={whiteboardCanvas} />
</div>

{#if $deviceRole !== "viewer"}
    <NavBar
        slide={wbSlide}
        pages={wbPages}
        onPrev={prevWbSlide}
        onNext={nextWbSlide}
        nextAlwaysEnabled={true}
        {onChangePdf}
        {onLoadHtml}
        {onChangeRole}
    />
{/if}

<style>
    .whiteboard-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1a1a1a;
        overflow: hidden;
        position: relative;
        min-height: 0;
    }

    .whiteboard-canvas {
        display: block;
        background: #ffffff;
        box-shadow: 0 2px 16px rgba(0, 0, 0, 0.5);
    }
</style>
