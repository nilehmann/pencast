<script lang="ts">
    import { ChevronLeft, ChevronRight, EllipsisVertical } from "lucide-svelte";
    import { stores } from "./stores.svelte";
    import {
        prevSlide,
        nextSlide,
        prevWbSlide,
        nextWbSlide,
        prevHtmlSlide,
        nextHtmlSlide,
    } from "./navigation";

    interface Props {
        role: "presenter" | "viewer";
        onChangePdf: () => void;
        onLoadHtml: () => void;
        onChangeRole: () => void;
    }
    let { role, onChangePdf, onLoadHtml, onChangeRole }: Props = $props();

    let fabMenuOpen = $state(false);
    let fabHovered = $state(false);

    let isHtml = $derived(
        stores.activeMode.base === "html" && !stores.activeMode.whiteboard,
    );
    let slide = $derived(
        stores.activeMode.whiteboard
            ? stores.whiteboard.slide
            : isHtml
              ? (stores.activeHtml?.slide ?? 0)
              : (stores.activePdf?.currentSlide ?? 0),
    );
    let pages = $derived(
        stores.activeMode.whiteboard
            ? stores.whiteboard.pageCount
            : isHtml
              ? (stores.activeHtml?.pageCount ?? 0)
              : (stores.activePdf?.pageCount ?? 0),
    );
    let nextAlwaysEnabled = $derived(stores.activeMode.whiteboard || isHtml);

    function handlePrev() {
        if (stores.activeMode.whiteboard) prevWbSlide();
        else if (isHtml) prevHtmlSlide();
        else prevSlide();
    }

    function handleNext() {
        if (stores.activeMode.whiteboard) nextWbSlide();
        else if (isHtml) nextHtmlSlide();
        else nextSlide();
    }

    function closeOnOutside(e: PointerEvent) {
        if (!fabMenuOpen) return;
        if (!(e.target as Element).closest(".nav-fab-wrap"))
            fabMenuOpen = false;
    }
</script>

<svelte:window onpointerdown={closeOnOutside} />
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="nav-fab-wrap"
    onpointerenter={() => (fabHovered = true)}
    onpointerleave={() => {
        if (!fabMenuOpen) fabHovered = false;
    }}
>
    {#if role === "presenter" || fabHovered}
        <div class="nav-fab-row">
            <button class="fab-btn" onclick={handlePrev} disabled={slide <= 0}>
                <ChevronLeft size={25} />
            </button>
            <span class="fab-slide"
                >{pages > 0 ? `${slide + 1} / ${pages}` : "—"}</span
            >
            <button
                class="fab-btn"
                onclick={handleNext}
                disabled={!nextAlwaysEnabled && slide >= pages - 1}
            >
                <ChevronRight size={25} />
            </button>
            <button
                class="fab-btn fab-menu-btn"
                onclick={() => (fabMenuOpen = !fabMenuOpen)}
                title="Menu"
            >
                <EllipsisVertical size={25} />
            </button>
        </div>
    {/if}
    {#if fabMenuOpen}
        <div class="fab-popup">
            <button
                onclick={() => {
                    onChangePdf();
                    fabMenuOpen = false;
                }}>Change PDF</button
            >
            <button
                onclick={() => {
                    onLoadHtml();
                    fabMenuOpen = false;
                }}>Load HTML</button
            >
            <button
                onclick={() => {
                    onChangeRole();
                    fabMenuOpen = false;
                }}>Change Role</button
            >
            <button onclick={() => location.reload()}>Refresh</button>
        </div>
    {/if}
</div>

<style>
    .nav-fab-wrap {
        position: fixed;
        bottom: 0;
        left: 0;
        width: 200px;
        height: 56px;
        z-index: 50;
        display: flex;
        align-items: flex-end;
        padding: 0 0 12px 12px;
        box-sizing: border-box;
    }
    .nav-fab-row {
        display: flex;
        align-items: center;
        gap: 0;
        background: rgba(20, 20, 20, 0.82);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 20px;
        padding: 4px 4px;
        backdrop-filter: blur(4px);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    }
    .fab-btn {
        background: none;
        border: none;
        color: #ddd;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px 6px;
        border-radius: 14px;
        line-height: 1;
    }
    .fab-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
    }
    .fab-btn:disabled {
        opacity: 0.3;
        cursor: default;
    }
    .fab-slide {
        color: #ccc;
        font-size: 1rem;
        min-width: 3.2rem;
        text-align: center;
        white-space: nowrap;
        user-select: none;
    }
    .fab-menu-btn {
        padding-left: 8px;
        margin-left: 4px;
    }
    .fab-popup {
        position: absolute;
        bottom: calc(100% + 4px);
        left: 12px;
        background: #333;
        border: 1px solid #555;
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        min-width: 10rem;
        z-index: 100;
    }
    .fab-popup button {
        padding: 0.6rem 1rem;
        text-align: left;
        border: none;
        background: none;
        color: #ddd;
        font-size: 0.95rem;
        cursor: pointer;
        white-space: nowrap;
    }
    .fab-popup button:hover {
        background: #444;
    }
</style>
