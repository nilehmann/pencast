<script lang="ts">
  interface Props {
    x: number;           // CSS px (container-relative); bottom-centre anchor
    y: number;
    showCut?: boolean;
    showCopy?: boolean;
    showDelete?: boolean;
    showPaste?: boolean;
    oncut?: () => void;
    oncopy?: () => void;
    ondelete?: () => void;
    onpaste?: () => void;
    onclose?: () => void;
  }
  let {
    x, y,
    showCut = false, showCopy = false, showDelete = false, showPaste = false,
    oncut, oncopy, ondelete, onpaste, onclose,
  }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onpointerdown={(e) => { e.stopPropagation(); onclose?.(); }}></div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="menu" style="left: {x}px; top: {y}px;" onpointerdown={(e) => e.stopPropagation()}>
  {#if showCut}
    <button class="menu-btn" onclick={() => { oncut?.(); onclose?.(); }}>Cut</button>
  {/if}
  {#if showCopy}
    <button class="menu-btn" onclick={() => { oncopy?.(); onclose?.(); }}>Copy</button>
  {/if}
  {#if showDelete}
    <button class="menu-btn menu-btn--danger" onclick={() => { ondelete?.(); onclose?.(); }}>Delete</button>
  {/if}
  {#if showPaste}
    <button class="menu-btn" onclick={() => { onpaste?.(); onclose?.(); }}>Paste</button>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
  }
  .menu {
    position: absolute;
    z-index: 201;
    transform: translate(-50%, calc(-100% - 8px));
    display: flex;
    flex-direction: row;
    gap: 4px;
    background: rgba(30, 30, 30, 0.92);
    border-radius: 14px;
    padding: 8px 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(6px);
    white-space: nowrap;
  }
  .menu-btn {
    height: 36px;
    padding: 0 14px;
    border-radius: 8px;
    border: 2px solid transparent;
    background: transparent;
    color: #ddd;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s;
    flex-shrink: 0;
    touch-action: manipulation;
  }
  .menu-btn:hover { background: rgba(255, 255, 255, 0.1); }
  .menu-btn--danger { color: #f87171; }
  .menu-btn--danger:hover { background: rgba(239, 68, 68, 0.18); }
</style>
