<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        dismissible?: boolean;
        wide?: boolean;
        ondismiss?: () => void;
        children: Snippet;
    }

    let { dismissible = false, wide = false, ondismiss, children }: Props =
        $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="modal-backdrop"
    onpointerdown={dismissible && ondismiss ? ondismiss : undefined}
>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="modal-panel"
        class:modal-panel--wide={wide}
        onpointerdown={(e) => e.stopPropagation()}
    >
        {#if dismissible && ondismiss}
            <button class="cancel" onclick={ondismiss}>✕</button>
        {/if}
        {@render children()}
    </div>
</div>

<style>
    .modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 500;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: all;
    }

    .modal-panel {
        position: relative;
        background: #1e1e1e;
        color: #f0f0f0;
        border: 1px solid #444;
        border-radius: 12px;
        padding: 2rem 2.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
        min-width: 260px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    }

    /* Target headings passed in as snippet content */
    .modal-panel :global(h1),
    .modal-panel :global(h2) {
        margin: 0;
    }

    .modal-panel--wide {
        width: min(640px, 90vw);
        max-height: 80vh;
        overflow-y: auto;
        align-items: stretch;
    }

    .cancel {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        font-size: 0.9rem;
        padding: 0.25rem 0.5rem;
        opacity: 0.7;
        cursor: pointer;
    }
</style>
