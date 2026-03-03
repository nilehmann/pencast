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
    } from "./stores";
    import { send } from "./ws-client";
    import { exportPdf } from "./export";
    import {
        Pencil,
        Highlighter,
        ArrowUpRight,
        Square,
        Eraser,
        Undo2,
        Trash2,
        Download,
        Loader,
    } from "lucide-svelte";
    import type {
        AnnotationTool,
        StrokeColor,
        StrokeThickness,
    } from "../../shared/types";

    // ── Data ────────────────────────────────────────────────────────────────

    const shapeTools: { id: AnnotationTool; label: string; icon: any }[] = [
        { id: "arrow", label: "Arrow", icon: ArrowUpRight },
        { id: "box", label: "Box", icon: Square },
    ];

    const colors: { id: StrokeColor; hex: string }[] = [
        { id: "orange", hex: "#f97316" },
        { id: "red", hex: "#ef4444" },
        { id: "green", hex: "#22c55e" },
        { id: "yellow", hex: "#facc15" },
        { id: "black", hex: "#111111" },
        { id: "gray", hex: "#9ca3af" },
    ];

    const thicknesses: { id: StrokeThickness; strokeWidth: number }[] = [
        { id: "thin", strokeWidth: 2 },
        { id: "medium", strokeWidth: 4 },
        { id: "thick", strokeWidth: 7 },
    ];

    // ── State ───────────────────────────────────────────────────────────────

    type GroupId = "colors" | "shapes" | "thickness" | "clear" | null;
    let openGroup = $state<GroupId>(null);

    let tool = $derived($activeTool);
    let color = $derived($activeColor);
    let thickness = $derived($activeThickness);

    const colorDisabled = $derived(tool === "highlighter" || tool === "eraser");

    // When highlighter is selected, force yellow
    $effect(() => {
        if ($activeTool === "highlighter") activeColor.set("yellow");
    });

    // Close flyout when clicking outside the toolbar
    function onDocumentClick(e: MouseEvent) {
        if (!toolbarEl) return;
        if (!toolbarEl.contains(e.target as Node)) {
            openGroup = null;
        }
    }

    function toggleGroup(id: GroupId) {
        openGroup = openGroup === id ? null : id;
    }

    // ── Derived helpers for group trigger labels ─────────────────────────────

    const activeColorHex = $derived(
        colors.find((c) => c.id === color)?.hex ?? "#f97316",
    );

    // Persist the last picked shape icon so the trigger always shows it
    let LastShapeIcon = $state<any>(ArrowUpRight);
    let lastShapeToolId = $state<AnnotationTool>("arrow");
    $effect(() => {
        const match = shapeTools.find((t) => t.id === tool);
        if (match) {
            LastShapeIcon = match.icon;
            lastShapeToolId = match.id;
        }
    });

    const isShapeActive = $derived(shapeTools.some((t) => t.id === tool));

    const activeThicknessStrokeWidth = $derived(
        thicknesses.find((t) => t.id === thickness)?.strokeWidth ?? 4,
    );

    // ── Actions ──────────────────────────────────────────────────────────────

    function undo() {
        send({ type: "undo", slide: $currentSlide });
    }

    function clearSlide() {
        send({ type: "clear_slide", slide: $currentSlide });
        openGroup = null;
    }

    function clearAll() {
        if (confirm("Clear annotations on ALL slides?")) {
            send({ type: "clear_all" });
        }
        openGroup = null;
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

    // ── DOM ref for outside-click detection ──────────────────────────────────
    let toolbarEl = $state<HTMLDivElement | null>(null);
</script>

<svelte:document onclick={onDocumentClick} />

<div class="toolbar" bind:this={toolbarEl}>
    <!-- ── Ink ──────────────────────────────────────────────────────────── -->
    <button
        class="tool-btn"
        class:active={tool === "ink"}
        title="Ink"
        onclick={() => {
            activeTool.set("ink");
            openGroup = null;
        }}><Pencil size={20} /></button
    >

    <!-- ── Highlighter ───────────────────────────────────────────────────── -->
    <button
        class="tool-btn"
        class:active={tool === "highlighter"}
        title="Highlighter"
        onclick={() => {
            activeTool.set("highlighter");
            openGroup = null;
        }}><Highlighter size={20} /></button
    >

    <div class="divider"></div>

    <!-- ── Shapes group ──────────────────────────────────────────────────── -->
    <div class="group-wrap">
        {#if openGroup === "shapes"}
            <div class="flyout">
                {#each shapeTools as t (t.id)}
                    <button
                        class="tool-btn"
                        class:active={tool === t.id}
                        title={t.label}
                        onclick={() => {
                            activeTool.set(t.id);
                            openGroup = null;
                        }}><t.icon size={20} /></button
                    >
                {/each}
            </div>
        {/if}
        <button
            class="tool-btn group-trigger"
            class:active={openGroup === "shapes" || isShapeActive}
            title="Shapes"
            onclick={(e) => {
                e.stopPropagation();
                if (!isShapeActive) {
                    activeTool.set(lastShapeToolId);
                    openGroup = null;
                } else {
                    toggleGroup("shapes");
                }
            }}
        >
            <LastShapeIcon size={20}></LastShapeIcon>
        </button>
    </div>

    <div class="divider"></div>

    <!-- ── Colors group ──────────────────────────────────────────────────── -->
    <div class="group-wrap">
        {#if openGroup === "colors"}
            <div class="flyout">
                {#each colors as c (c.id)}
                    <button
                        class="color-btn"
                        class:active={color === c.id}
                        class:disabled={colorDisabled}
                        style="background: {c.hex};"
                        disabled={colorDisabled}
                        title={c.id}
                        onclick={() => {
                            activeColor.set(c.id);
                            openGroup = null;
                        }}
                    ></button>
                {/each}
            </div>
        {/if}
        <button
            class="tool-btn group-trigger"
            class:active={openGroup === "colors"}
            class:disabled={colorDisabled}
            disabled={colorDisabled}
            title="Colors"
            onclick={(e) => {
                e.stopPropagation();
                toggleGroup("colors");
            }}
        >
            <span
                class="color-swatch"
                style="background: {colorDisabled
                    ? '#9ca3af'
                    : activeColorHex};"
            ></span>
        </button>
    </div>

    <div class="divider"></div>

    <!-- ── Thickness group ───────────────────────────────────────────────── -->
    <div class="group-wrap">
        {#if openGroup === "thickness"}
            <div class="flyout">
                {#each thicknesses as t (t.id)}
                    <button
                        class="thick-btn"
                        class:active={thickness === t.id}
                        title={t.id}
                        onclick={() => {
                            activeThickness.set(t.id);
                            openGroup = null;
                        }}
                    >
                        <svg
                            viewBox="0 0 28 18"
                            width="28"
                            height="18"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path
                                d="M3 13 C6 5, 10 15, 14 9 S20 4, 25 9"
                                stroke="white"
                                stroke-width={t.strokeWidth}
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />
                        </svg>
                    </button>
                {/each}
            </div>
        {/if}
        <button
            class="tool-btn group-trigger"
            class:active={openGroup === "thickness"}
            title="Thickness"
            onclick={(e) => {
                e.stopPropagation();
                toggleGroup("thickness");
            }}
        >
            <svg
                viewBox="0 0 28 18"
                width="28"
                height="18"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path
                    d="M3 13 C6 5, 10 15, 14 9 S20 4, 25 9"
                    stroke="white"
                    stroke-width={activeThicknessStrokeWidth}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        </button>
    </div>

    <div class="divider"></div>

    <!-- ── Eraser ────────────────────────────────────────────────────────── -->
    <button
        class="tool-btn"
        class:active={tool === "eraser"}
        title="Eraser"
        onclick={() => {
            activeTool.set("eraser");
            openGroup = null;
        }}><Eraser size={20} /></button
    >

    <!-- ── Undo ──────────────────────────────────────────────────────────── -->
    <button class="tool-btn" title="Undo" onclick={undo}
        ><Undo2 size={20} /></button
    >

    <div class="divider"></div>

    <!-- ── Clear group ───────────────────────────────────────────────────── -->
    <div class="group-wrap">
        {#if openGroup === "clear"}
            <div class="flyout flyout--clear">
                <button
                    class="tool-btn clear-btn"
                    title="Clear current slide"
                    onclick={clearSlide}
                >
                    <span class="clear-label">Slide</span>
                </button>
                <button
                    class="tool-btn clear-btn clear-btn--all"
                    title="Clear all slides"
                    onclick={clearAll}
                >
                    <span class="clear-label">All</span>
                </button>
            </div>
        {/if}
        <button
            class="tool-btn group-trigger"
            class:active={openGroup === "clear"}
            title="Clear"
            onclick={(e) => {
                e.stopPropagation();
                toggleGroup("clear");
            }}><Trash2 size={20} /></button
        >
    </div>

    <div class="divider"></div>

    <!-- ── Export ────────────────────────────────────────────────────────── -->
    <button
        class="tool-btn"
        title="Export PDF"
        disabled={exporting}
        onclick={doExport}
        >{#if exporting}<Loader size={20} class="spin" />{:else}<Download
                size={20}
            />{/if}</button
    >
</div>

<style>
    /* ── Toolbar shell ──────────────────────────────────────────────────── */
    .toolbar {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        background: rgba(30, 30, 30, 0.92);
        border-radius: 14px;
        padding: 10px 8px;
        z-index: 10;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(6px);
    }

    /* ── Group wrapper (trigger + flyout positioned relative to it) ──────── */
    .group-wrap {
        position: relative;
        display: flex;
        align-items: center;
    }

    /* ── Flyout panel ────────────────────────────────────────────────────── */
    .flyout {
        position: absolute;
        right: calc(100% + 10px);
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 6px;
        background: rgba(30, 30, 30, 0.95);
        border-radius: 12px;
        padding: 8px 10px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(6px);
        /* Prevent the flyout from triggering the outside-click dismissal
           by stopping propagation via pointer events — handled in JS above */
        white-space: nowrap;
    }

    /* ── Divider ─────────────────────────────────────────────────────────── */
    .divider {
        width: 28px;
        height: 1px;
        background: rgba(255, 255, 255, 0.15);
        margin: 2px 0;
    }

    /* ── Generic tool button ─────────────────────────────────────────────── */
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
        transition:
            background 0.12s,
            border-color 0.12s;
        flex-shrink: 0;
    }
    .tool-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
    }
    .tool-btn.active {
        background: rgba(255, 255, 255, 0.18);
        border-color: rgba(255, 255, 255, 0.5);
    }
    .tool-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
    }

    /* ── Color swatch inside trigger ─────────────────────────────────────── */
    .color-swatch {
        display: block;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.6);
        flex-shrink: 0;
    }

    /* ── Lucide icons: ensure they inherit colour and don't flex-grow ─────── */
    :global(.tool-btn svg),
    :global(.thick-btn svg),
    :global(.clear-btn svg) {
        flex-shrink: 0;
        stroke: currentColor;
    }

    /* ── Spinning loader for export ──────────────────────────────────────── */
    :global(.spin) {
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* ── Color buttons inside flyout ─────────────────────────────────────── */
    .color-btn {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        flex-shrink: 0;
        transition:
            transform 0.1s,
            border-color 0.1s;
    }
    .color-btn:hover:not(:disabled) {
        transform: scale(1.18);
    }
    .color-btn.active {
        border-color: white;
        transform: scale(1.18);
    }
    .color-btn.disabled {
        opacity: 0.25;
        cursor: not-allowed;
    }

    /* ── Thickness buttons inside flyout ─────────────────────────────────── */
    .thick-btn {
        width: 38px;
        height: 34px;
        border-radius: 6px;
        border: 2px solid transparent;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition:
            background 0.12s,
            border-color 0.12s;
    }
    .thick-btn:hover {
        background: rgba(255, 255, 255, 0.1);
    }
    .thick-btn.active {
        background: rgba(255, 255, 255, 0.18);
        border-color: rgba(255, 255, 255, 0.5);
    }

    /* ── Scribble SVG (thickness indicator) ─────────────────────────────── */
    :global(.thick-btn svg),
    :global(.tool-btn.group-trigger svg:not([data-lucide])) {
        flex-shrink: 0;
        overflow: visible;
    }

    /* ── Clear flyout buttons ────────────────────────────────────────────── */
    .clear-btn {
        width: auto;
        padding: 0 12px;
        gap: 4px;
        font-size: 0.78rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: #f87171;
    }
    .clear-btn:hover {
        background: rgba(239, 68, 68, 0.18) !important;
    }
    .clear-btn--all {
        color: #fca5a5;
        border-color: rgba(239, 68, 68, 0.35);
    }
    .clear-label {
        font-size: 0.78rem;
        font-weight: 600;
    }
</style>
