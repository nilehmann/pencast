<script lang="ts">
    import {
        ChevronLeft,
        ChevronRight,
        ChevronUp,
        ChevronDown,
        EllipsisVertical,
        FileText,
        Globe,
        Monitor,
        UserCog,
        RefreshCw,
        Download,
        Loader,
        Eye,
        EyeOff,
    } from "lucide-svelte";
    import { stores } from "./stores.svelte";
    import { send } from "./ws-client";
    import {
        prevSlide,
        nextSlide,
        prevSubPage,
        nextSubPage,
        prevWbSlide,
        nextWbSlide,
        prevHtmlSlide,
        nextHtmlSlide,
        prevScreenSlide,
        nextScreenSlide,
    } from "./navigation";

    let isScreenMode = $derived(stores.activeMode.base === "screen");

    interface Props {
        role: "presenter" | "viewer";
        onChangePdf: () => void;
        onLoadHtml: () => void;
        onChangeRole: () => void;
        showPreview?: boolean;
        onTogglePreview?: () => void;
    }
    let {
        role,
        onChangePdf,
        onLoadHtml,
        onChangeRole,
        showPreview = false,
        onTogglePreview,
    }: Props = $props();

    let fabMenuOpen = $state(false);
    let fabHovered = $state(false);

    let isHtml = $derived(
        stores.activeMode.base === "html" && !stores.activeMode.whiteboard,
    );
    let isScreen = $derived(
        stores.activeMode.base === "screen" && !stores.activeMode.whiteboard,
    );
    let isPdf = $derived(
        !stores.activeMode.whiteboard && stores.activeMode.base === "pdf",
    );
    let slide = $derived(
        stores.activeMode.whiteboard
            ? stores.whiteboard.slide
            : isHtml
              ? (stores.activeHtml?.slide ?? 0)
              : isScreen
                ? (stores.activeScreen?.slide ?? 0)
                : (stores.activePdf?.position.slide ?? 0),
    );
    let subPage = $derived(stores.activePdf?.position.page ?? 0);
    let subPageCount = $derived(
        stores.activePdf
            ? (stores.activePdf.subPageCounts[stores.activePdf.position.slide] ?? 1)
            : 1,
    );
    let pages = $derived(
        stores.activeMode.whiteboard
            ? stores.whiteboard.pageCount
            : isHtml
              ? (stores.activeHtml?.pageCount ?? 0)
              : isScreen
                ? (stores.activeScreen?.pageCount ?? 0)
                : (stores.activePdf?.pageCount ?? 0),
    );
    let nextAlwaysEnabled = $derived(stores.activeMode.whiteboard || isHtml || isScreen);

    function handlePrev() {
        if (stores.activeMode.whiteboard) prevWbSlide();
        else if (isHtml) prevHtmlSlide();
        else if (isScreen) prevScreenSlide();
        else prevSlide();
    }

    function handleNext() {
        if (stores.activeMode.whiteboard) nextWbSlide();
        else if (isHtml) nextHtmlSlide();
        else if (isScreen) nextScreenSlide();
        else nextSlide();
    }

    let exporting = $state(false);
    async function doExport() {
        const activePdf = stores.activePdf;
        if (!activePdf || exporting) return;
        exporting = true;
        try {
            const { exportPdf } = await import("./export");
            await exportPdf(
                activePdf.path,
                activePdf.pageCount,
                activePdf.annotations,
                activePdf.subPageCounts,
                activePdf.name ?? "presentation.pdf",
            );
        } catch (e) {
            console.error("Export failed:", e);
            alert("Export failed. See console for details.");
        } finally {
            exporting = false;
        }
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
                <ChevronLeft size={28} />
            </button>
            {#if isPdf}
                <button class="fab-btn fab-sub-btn" onclick={prevSubPage} disabled={subPage <= 0}>
                    <ChevronUp size={28} />
                </button>
            {/if}
            <span class="fab-slide"
                >{pages > 0 ? `${slide + 1} / ${pages}` : "—"}</span
            >
            {#if isPdf && subPageCount > 1}
                <span class="fab-sub-label">{subPage + 1}/{subPageCount}</span>
            {/if}
            {#if isPdf}
                <button class="fab-btn fab-sub-btn" onclick={nextSubPage}>
                    <ChevronDown size={28} />
                </button>
            {/if}
            <button
                class="fab-btn"
                onclick={handleNext}
                disabled={!nextAlwaysEnabled && slide >= pages - 1}
            >
                <ChevronRight size={28} />
            </button>
            {#if role === "presenter" && !stores.activeMode.whiteboard && stores.activeMode.base === "pdf" && onTogglePreview}
                <button
                    class="fab-btn"
                    onclick={onTogglePreview}
                    title={showPreview ? "Hide next slide" : "Show next slide"}
                >
                    {#if showPreview}<Eye size={22} />{:else}<EyeOff
                            size={22}
                        />{/if}
                </button>
            {/if}
            <button
                class="fab-btn fab-menu-btn"
                onclick={() => (fabMenuOpen = !fabMenuOpen)}
                title="Menu"
            >
                <EllipsisVertical size={28} />
            </button>
        </div>
    {/if}
    {#if fabMenuOpen}
        <div class="fab-popup">
            <button
                onclick={() => {
                    onChangePdf();
                    fabMenuOpen = false;
                }}><FileText size={16} /> Change PDF</button
            >
            <button
                onclick={() => {
                    onLoadHtml();
                    fabMenuOpen = false;
                }}><Globe size={16} /> Load HTML</button
            >
            {#if role === "viewer" && !isScreenMode}
                <button
                    onclick={() => {
                        send({ type: "set_mode", mode: "screen" });
                        fabMenuOpen = false;
                    }}><Monitor size={16} /> Screen Share</button
                >
            {/if}
            <button
                onclick={() => {
                    onChangeRole();
                    fabMenuOpen = false;
                }}><UserCog size={16} /> Change Role</button
            >
            <button
                disabled={exporting ||
                    stores.activeMode.whiteboard ||
                    !stores.activePdf}
                onclick={() => {
                    void doExport();
                    fabMenuOpen = false;
                }}
                >{#if exporting}<Loader
                        size={16}
                        class="spin"
                    />{:else}<Download size={16} />{/if} Export PDF</button
            >
            <button onclick={() => location.reload()}
                ><RefreshCw size={16} /> Refresh</button
            >
        </div>
    {/if}
</div>

<style>
    .nav-fab-wrap {
        position: fixed;
        bottom: 0;
        left: 0;
        width: 200px;
        height: 64px;
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
        padding: 6px 6px;
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
        padding: 8px 10px;
        border-radius: 18px;
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
    .fab-sub-btn {
        padding: 4px 4px;
    }
    .fab-sub-label {
        color: #999;
        font-size: 0.8rem;
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
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .fab-popup button:hover:not(:disabled) {
        background: #444;
    }
    .fab-popup button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    :global(.fab-popup .spin) {
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
