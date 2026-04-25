<script lang="ts">
    import { drawStroke } from "../../shared/draw";
    import type { AnnotationStroke } from "../../shared/types";

    interface Props {
        sourceCanvas: HTMLCanvasElement | undefined;
        strokes: AnnotationStroke[];
    }
    let { sourceCanvas, strokes }: Props = $props();

    let canvas = $state<HTMLCanvasElement>(undefined!);
    let dirty = false;

    $effect(() => {
        if (!sourceCanvas) return;
        const observer = new ResizeObserver(() => syncSize());
        observer.observe(sourceCanvas);
        syncSize();
        return () => observer.disconnect();
    });

    $effect(() => {
        void strokes;
        dirty = true;
        redraw();
    });

    function syncSize() {
        if (!sourceCanvas || !canvas) return;
        canvas.width = sourceCanvas.width;
        canvas.height = sourceCanvas.height;
        canvas.style.width = sourceCanvas.style.width;
        canvas.style.height = sourceCanvas.style.height;
        dirty = true;
        redraw();
    }

    function redraw() {
        if (!canvas || canvas.width === 0) return;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const stroke of strokes) {
            drawStroke(ctx, stroke, canvas.width, canvas.height);
        }
        dirty = false;
    }
</script>

<canvas bind:this={canvas} style="position: absolute; pointer-events: none;"></canvas>
