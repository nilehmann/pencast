<script lang="ts">
    interface Props {
        slide: number;
        pages: number;
        onPrev: () => void;
        onNext: () => void;
        nextAlwaysEnabled?: boolean;
    }
    let {
        slide,
        pages,
        onPrev,
        onNext,
        nextAlwaysEnabled = false,
    }: Props = $props();
</script>

<div class="nav-bar">
    <button onclick={onPrev} disabled={slide <= 0}>← Prev</button>
    <span>{pages > 0 ? `${slide + 1} / ${pages}` : "—"}</span>
    <button onclick={onNext} disabled={!nextAlwaysEnabled && slide >= pages - 1}
        >Next →</button
    >
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
</style>
