<script lang="ts">
    interface Props {
        slide: number;
        pages: number;
        onPrev: () => void;
        onNext: () => void;
        nextAlwaysEnabled?: boolean;
        onChangePdf?: () => void;
        onLoadHtml?: () => void;
        onChangeRole?: () => void;
    }
    let {
        slide,
        pages,
        onPrev,
        onNext,
        nextAlwaysEnabled = false,
        onChangePdf,
        onLoadHtml,
        onChangeRole,
    }: Props = $props();

    let menuOpen = $state(false);

    function closeOnOutside(e: PointerEvent) {
        if (!menuOpen) return;
        const target = e.target as Element;
        if (!target.closest(".menu-anchor")) {
            menuOpen = false;
        }
    }
</script>

<svelte:window onpointerdown={closeOnOutside} />

<div class="nav-bar">
    <div class="menu-anchor">
        <button class="hamburger" onclick={() => (menuOpen = !menuOpen)}
            >☰</button
        >
        {#if menuOpen}
            <div class="popup">
                {#if onChangePdf}
                    <button
                        onclick={() => {
                            onChangePdf!();
                            menuOpen = false;
                        }}>Change PDF</button
                    >
                {/if}
                {#if onLoadHtml}
                    <button
                        onclick={() => {
                            onLoadHtml!();
                            menuOpen = false;
                        }}>Load HTML</button
                    >
                {/if}
                {#if onChangeRole}
                    <button
                        onclick={() => {
                            onChangeRole!();
                            menuOpen = false;
                        }}>Change Role</button
                    >
                {/if}
                <button onclick={() => location.reload()}>Refresh</button>
            </div>
        {/if}
    </div>
    <div class="nav-buttons">
        <button onclick={onPrev} disabled={slide <= 0}>← Prev</button>
        <span>{pages > 0 ? `${slide + 1} / ${pages}` : "—"}</span>
        <button
            onclick={onNext}
            disabled={!nextAlwaysEnabled && slide >= pages - 1}>Next →</button
        >
    </div>
</div>

<style>
    .nav-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1.5rem;
        padding: 0.5rem;
        background: #222;
        color: #ddd;
        font-size: 0.95rem;
    }
    .nav-bar button {
        padding: 0.4rem 1.2rem;
        font-size: 0.95rem;
        cursor: pointer;
    }
    .nav-bar button:disabled {
        opacity: 0.3;
        cursor: default;
    }
    .menu-anchor {
        position: absolute;
        left: 48px;
        /*margin-left: auto;*/
    }
    .hamburger {
        padding: 0.4rem 0.8rem;
    }
    .popup {
        position: absolute;
        bottom: 100%;
        left: 0;
        background: #333;
        border: 1px solid #555;
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        min-width: 10rem;
        z-index: 100;
    }
    .popup button {
        padding: 0.6rem 1rem;
        text-align: left;
        border: none;
        background: none;
        color: #ddd;
        font-size: 0.95rem;
        cursor: pointer;
        white-space: nowrap;
    }
    .popup button:hover {
        background: #444;
    }
</style>
