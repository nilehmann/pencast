<script lang="ts">
interface Props {
  onFilePicked: (file: File) => void;
}

let { onFilePicked }: Props = $props();

let isDragging = $state(false);
let inputEl: HTMLInputElement;

function handleFile(file: File | undefined) {
  if (!file) return;
  if (!file.name.endsWith('.zip')) {
    alert('Only .zip files are supported.');
    return;
  }
  onFilePicked(file);
}

function handleChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  handleFile(file);
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  isDragging = true;
}

function onDragLeave(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (!(e.currentTarget as Element).contains(e.relatedTarget as Node)) {
    isDragging = false;
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  isDragging = false;
  const file = e.dataTransfer?.files?.[0];
  handleFile(file);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    inputEl.click();
  }
}
</script>

<div class="picker">
  <h1>Pencast Viewer</h1>
  <p>Open a <code>.zip</code> file to browse its slides and annotations.</p>
  <div
    class="drop-area"
    class:dragging={isDragging}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    onclick={() => inputEl.click()}
    onkeydown={onKeyDown}
    role="button"
    tabindex="0"
  >
    {#if isDragging}
      <p class="drop-hint">Drop ZIP file here to open</p>
    {:else}
      <p>Drop ZIP file here or click to browse</p>
      <span class="pick-btn">Browse files</span>
    {/if}
    <input bind:this={inputEl} type="file" accept=".zip" onchange={handleChange} style="display: none;" />
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 1rem;
    color: #e0e0e0;
    background: #1a1a1a;
    font-family: system-ui, sans-serif;
  }

  h1 {
    font-size: 1.5rem;
    margin: 0;
  }

  p {
    color: #888;
    margin: 0;
  }

  .drop-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 3rem 4rem;
    min-width: 420px;
    min-height: 180px;
    border: 2px dashed #666;
    border-radius: 12px;
    background: #1a1a1a;
    transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    cursor: pointer;
  }

  .drop-area:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }

  .drop-area.dragging {
    background: #2a2a3a;
    border-color: #3b82f6;
    box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
  }

  .drop-hint {
    color: #3b82f6;
    font-weight: 500;
    margin: 0;
  }

  .pick-btn {
    display: inline-block;
    padding: 0.75rem 2rem;
    min-width: 180px;
    background: #3b82f6;
    color: white;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
    transition: background 0.15s;
    text-align: center;
  }

  .drop-area:hover .pick-btn {
    background: #2563eb;
  }
</style>
