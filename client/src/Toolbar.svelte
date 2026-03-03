<script lang="ts">
    import {
        activeTool,
        activeColor,
        activeThickness,
        currentSlide,
        activePdfPath,
        activePdfName,
        pageCount,
        annotations,
        authToken,
    } from "./stores.ts";
    import { send } from "./ws-client.ts";
    import { exportPdf } from "./export.ts";
    import type {
        AnnotationTool,
        StrokeColor,
        StrokeThickness,
    } from "../../shared/types.ts";

    const tools: { id: AnnotationTool; label: string }[] = [
        { id: "ink", label: "✏️" },
        { id: "highlighter", label: "🖊" },
        { id: "arrow", label: "➡️" },
        { id: "box", label: "⬜" },
        { id: "eraser", label: "⌫" },
    ];

    const colors: { id: StrokeColor; hex: string }[] = [
        { id: "orange", hex: "#f97316" },
        { id: "red", hex: "#ef4444" },
        { id: "green", hex: "#22c55e" },
        { id: "yellow", hex: "#facc15" },
        { id: "black", hex: "#111111" },
        { id: "gray", hex: "#9ca3af" },
    ];

    const thicknesses: { id: StrokeThickness; size: number }[] = [
        { id: "thin", size: 6 },
        { id: "medium", size: 10 },
        { id: "thick", size: 16 },
    ];

    // When highlighter is selected, force yellow
    $effect(() => {
        if ($activeTool === "highlighter") activeColor.set("yellow");
    });

    let tool = $derived($activeTool);
    let color = $derived($activeColor);
    let thickness = $derived($activeThickness);

    const colorDisabled = $derived(tool === "highlighter" || tool === "eraser");

    function undo() {
        send({ type: "undo", slide: $currentSlide });
    }
    function clearSlide() {
        send({ type: "clear_slide", slide: $currentSlide });
    }
    function clearAll() {
        if (confirm("Clear annotations on ALL slides?"))
            send({ type: "clear_all" });
    }

    let exporting = $state(false);
    async function doExport() {
        if (!$activePdfPath || exporting) return;
        exporting = true;
        try {
            await exportPdf(
                $activePdfPath,
                $authToken,
                $pageCount,
                $annotations,
                $activePdfName ?? "presentation.pdf",
            );
        } catch (e) {
            console.error("Export failed:", e);
            alert("Export failed. See console for details.");
        } finally {
            exporting = false;
        }
    }
</script>

<div class="toolbar">
    <!-- Tools -->
    <div class="group">
        {#each tools as t (t.id)}
            <button
                class="tool-btn"
                class:active={tool === t.id}
                title={t.id}
                onclick={() => activeTool.set(t.id)}>{t.label}</button
            >
        {/each}
    </div>

    <div class="divider"></div>

    <!-- Colors -->
    <div class="group">
        {#each colors as c (c.id)}
            <button
                class="color-btn"
                class:active={color === c.id}
                class:disabled={colorDisabled}
                style="background: {c.hex};"
                disabled={colorDisabled}
                title={c.id}
                onclick={() => activeColor.set(c.id)}
            ></button>
        {/each}
    </div>

    <div class="divider"></div>

    <!-- Thickness -->
    <div class="group">
        {#each thicknesses as t (t.id)}
            <button
                class="thick-btn"
                class:active={thickness === t.id}
                title={t.id}
                onclick={() => activeThickness.set(t.id)}
            >
                <span class="dot" style="width:{t.size}px; height:{t.size}px;"
                ></span>
            </button>
        {/each}
    </div>

    <div class="divider"></div>

    <!-- Actions -->
    <div class="group">
        <button class="tool-btn" title="Undo" onclick={undo}>↩</button>
        <button class="tool-btn" title="Clear slide" onclick={clearSlide}
            >🗑</button
        >
        <button class="tool-btn" title="Clear all" onclick={clearAll}>⚠️</button
        >
        <button
            class="tool-btn"
            title="Export PDF"
            disabled={exporting}
            onclick={doExport}
        >
            {exporting ? "⏳" : "⬇️"}
        </button>
    </div>
</div>

<style>
    .toolbar {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        background: rgba(30, 30, 30, 0.92);
        border-radius: 14px;
        padding: 10px 8px;
        z-index: 10;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(6px);
    }
    .group {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
    }
    .divider {
        width: 28px;
        height: 1px;
        background: rgba(255, 255, 255, 0.15);
        margin: 2px 0;
    }
    .tool-btn {
        width: 38px;
        height: 38px;
        border-radius: 8px;
        border: 2px solid transparent;
        background: transparent;
        font-size: 1.2rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ddd;
        transition: background 0.1s;
    }
    .tool-btn:hover {
        background: rgba(255, 255, 255, 0.1);
    }
    .tool-btn.active {
        background: rgba(255, 255, 255, 0.18);
        border-color: rgba(255, 255, 255, 0.5);
    }
    .color-btn {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        transition: transform 0.1s;
    }
    .color-btn:hover {
        transform: scale(1.15);
    }
    .color-btn.active {
        border-color: white;
        transform: scale(1.15);
    }
    .color-btn.disabled {
        opacity: 0.25;
        cursor: not-allowed;
    }
    .thick-btn {
        width: 38px;
        height: 30px;
        border-radius: 6px;
        border: 2px solid transparent;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .thick-btn:hover {
        background: rgba(255, 255, 255, 0.1);
    }
    .thick-btn.active {
        background: rgba(255, 255, 255, 0.18);
        border-color: rgba(255, 255, 255, 0.5);
    }
    .dot {
        border-radius: 50%;
        background: white;
        display: block;
    }
</style>
