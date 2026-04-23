<script lang="ts">
    import { stores } from "./stores.svelte";
    import { send } from "./ws-client";

    import {
        Pencil,
        Highlighter,
        MoveUpRight,
        RectangleHorizontal,
        CircleDot,
        Eraser,
        Undo2,
        Trash2,
        MousePointer2,
        PresentationIcon,
        Wand,
    } from "lucide-svelte";
    import EllipseIcon from "./EllipseIcon.svelte";
    import LineIcon from "./LineIcon.svelte";
    import Modal from "./Modal.svelte";
    import type {
        AnnotationSource,
        AnnotationTool,
        StrokeColor,
        StrokeThickness,
    } from "../../shared/types";

    // ── Data ────────────────────────────────────────────────────────────────

    const shapeTools: {
        id: AnnotationTool;
        label: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        icon: any;
    }[] = [
        { id: "box", label: "Box", icon: RectangleHorizontal },
        { id: "arrow", label: "Arrow", icon: MoveUpRight },
        { id: "line", label: "Line", icon: LineIcon },
        { id: "ellipse", label: "Ellipse", icon: EllipseIcon },
        { id: "perfect-circle", label: "Circle", icon: CircleDot },
    ];

    const colors: { id: StrokeColor; hex: string }[] = [
        { id: "blue", hex: "#3b82f6" },
        { id: "orange", hex: "#f97316" },
        { id: "red", hex: "#ef4444" },
        { id: "green", hex: "#22c55e" },
        { id: "yellow", hex: "#eab308" },
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

    let showClearAllModal = $state(false);
    let clearAllSource = $state<AnnotationSource>("pdf");

    let tool = $derived(stores.activeTool);
    let color = $derived(stores.activeColor);
    let thickness = $derived(stores.activeThickness);

    const colorDisabled = $derived(
        tool === "highlighter" || tool === "eraser" || tool === "select",
    );

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
    const lastShapeTool = $derived(
        shapeTools.find((t) => t.id === tool) ?? shapeTools[0],
    );

    const isShapeActive = $derived(shapeTools.some((t) => t.id === tool));

    const activeThicknessStrokeWidth = $derived(
        thicknesses.find((t) => t.id === thickness)?.strokeWidth ?? 4,
    );

    // ── Actions ──────────────────────────────────────────────────────────────

    function undo() {
        const source: AnnotationSource = stores.activeSource();
        const slide = stores.activeSlide();
        send({ type: "undo", source, slide });
    }

    function clearSlide() {
        const ctx = stores.activeContext();
        send({ type: "clear_slide", source: ctx.source, slide: ctx.slide, page: ctx.page });
        openGroup = null;
    }

    function clearAll() {
        clearAllSource = stores.activeMode.whiteboard
            ? "whiteboard"
            : stores.activeMode.base;
        showClearAllModal = true;
        openGroup = null;
    }

    function confirmClearAll() {
        send({ type: "clear_all", source: clearAllSource });
        showClearAllModal = false;
    }

    function toggleWhiteboardMode() {
        if (stores.activeMode.base === "screen") {
            send({
                type: "set_white_background",
                enabled: !stores.activeMode.whiteBackground,
            });
        } else {
            send({
                type: "set_whiteboard_mode",
                enabled: !stores.activeMode.whiteboard,
            });
        }
    }

    const isWhiteboardActive = $derived(
        stores.activeMode.base === "screen"
            ? (stores.activeMode.whiteBackground ?? false)
            : stores.activeMode.whiteboard,
    );

    const whiteboardTitle = $derived(
        stores.activeMode.base === "screen"
            ? (stores.activeMode.whiteBackground ? "Exit White Background" : "White Background")
            : (stores.activeMode.whiteboard ? "Exit Whiteboard" : "Whiteboard Mode"),
    );

    // ── DOM ref for outside-click detection ──────────────────────────────────
    let toolbarEl = $state<HTMLDivElement | null>(null);
</script>

<svelte:document onclick={onDocumentClick} />

<div class="toolbar" bind:this={toolbarEl}>
    <!-- ── Select ────────────────────────────────────────────────────────── -->
    <button
        class="tool-btn"
        class:active={tool === "select"}
        title="Select"
        onclick={() => {
            stores.activeTool = "select";
            openGroup = null;
        }}><MousePointer2 size={20} /></button
    >

    <!-- ── Laser Pointer ────────────────────────────────────────────────── -->
    <button
        class="tool-btn"
        class:active={tool === "pointer"}
        title="Laser Pointer"
        onclick={() => {
            stores.activeTool = "pointer";
            openGroup = null;
        }}><Wand size={20} /></button
    >

    <!-- ── Ink ──────────────────────────────────────────────────────────── -->
    <button
        class="tool-btn"
        class:active={tool === "ink"}
        title="Ink"
        onclick={() => {
            stores.activeTool = "ink";
            openGroup = null;
        }}><Pencil size={20} /></button
    >

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
                            stores.activeTool = t.id;
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
                    stores.activeTool = lastShapeTool.id;
                    openGroup = null;
                } else {
                    toggleGroup("shapes");
                }
            }}
        >
            <lastShapeTool.icon size={20}></lastShapeTool.icon>
        </button>
    </div>

    <!-- ── Highlighter ───────────────────────────────────────────────────── -->
    <button
        class="tool-btn"
        class:active={tool === "highlighter"}
        title="Highlighter"
        onclick={() => {
            stores.activeTool = "highlighter";
            openGroup = null;
        }}><Highlighter size={20} /></button
    >

    <!-- ── Eraser ────────────────────────────────────────────────────────── -->
    <button
        class="tool-btn"
        class:active={tool === "eraser"}
        title="Eraser"
        onclick={() => {
            if (stores.activeTool !== "eraser")
                stores.previousTool = stores.activeTool;
            stores.activeTool = "eraser";
            openGroup = null;
        }}><Eraser size={20} /></button
    >

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
                            stores.activeColor = c.id;
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
                            stores.activeThickness = t.id;
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

    <!-- ── Whiteboard/White Background mode toggle ───────────────────────── -->
    <button
        class="tool-btn"
        class:active={isWhiteboardActive}
        title={whiteboardTitle}
        onclick={toggleWhiteboardMode}
    >
        <PresentationIcon size={20} />
    </button>
</div>

{#if showClearAllModal}
    <Modal>
        <p style="margin: 0; text-align: center; font-size: 0.95rem;">
            {clearAllSource === "whiteboard"
                ? "Clear annotations on ALL whiteboard pages?"
                : "Clear annotations on ALL slides?"}
        </p>
        <div style="display: flex; gap: 0.75rem; margin-top: 0.5rem;">
            <button
                class="modal-btn modal-btn--cancel"
                onclick={() => (showClearAllModal = false)}
            >
                Cancel
            </button>
            <button
                class="modal-btn modal-btn--confirm"
                onclick={confirmClearAll}
            >
                Clear all
            </button>
        </div>
    </Modal>
{/if}

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

    /* ── Clear-all confirmation modal buttons ───────────────────────────── */
    .modal-btn {
        flex: 1;
        padding: 0.5rem 1rem;
        border-radius: 8px;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid transparent;
    }

    .modal-btn--cancel {
        background: rgba(255, 255, 255, 0.08);
        color: #d1d5db;
        border-color: #444;
    }

    .modal-btn--cancel:hover {
        background: rgba(255, 255, 255, 0.14);
    }

    .modal-btn--confirm {
        background: rgba(239, 68, 68, 0.2);
        color: #f87171;
        border-color: rgba(239, 68, 68, 0.45);
    }

    .modal-btn--confirm:hover {
        background: rgba(239, 68, 68, 0.32);
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
