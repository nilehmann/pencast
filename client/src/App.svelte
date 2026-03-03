<script lang="ts">
  import { authToken, deviceRole, activePdfPath, activePdfName } from './stores.ts';
  import { connect } from './ws-client.ts';
  import FileBrowser from './FileBrowser.svelte';
  import PdfViewer from './PdfViewer.svelte';
  import Toolbar from './Toolbar.svelte';

  let pin = $state('');
  let error = $state('');
  let connecting = $state(false);
  let showBrowser = $state(false);

  let token = $derived($authToken);
  let role = $derived($deviceRole);
  let pdfPath = $derived($activePdfPath);
  let pdfName = $derived($activePdfName);

  // Auto-close browser once a PDF is loaded
  $effect(() => {
    if (pdfPath) showBrowser = false;
  });

  async function submitPin() {
    error = '';
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (res.ok) {
      const data = await res.json() as { token: string };
      authToken.set(data.token);
      sessionStorage.setItem('authToken', data.token);
    } else {
      error = 'Invalid PIN';
      pin = '';
    }
  }

  async function selectRole(selected: 'presenter' | 'annotator') {
    connecting = true;
    error = '';
    try {
      await connect(token, selected);
      deviceRole.set(selected);
    } catch (e) {
      error = 'Failed to connect';
      console.error(e);
    } finally {
      connecting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') submitPin();
  }
</script>

{#if !token}
  <div class="center">
    <h1>Presenter</h1>
    <input
      type="password"
      placeholder="Enter PIN"
      bind:value={pin}
      onkeydown={handleKeydown}
    />
    <button onclick={submitPin}>Unlock</button>
    {#if error}<p class="error">{error}</p>{/if}
  </div>

{:else if !role}
  <div class="center">
    <h1>Select Role</h1>
    {#if connecting}
      <p>Connecting…</p>
    {:else}
      <div class="role-buttons">
        <button onclick={() => selectRole('presenter')}>Presenter</button>
        <button onclick={() => selectRole('annotator')}>Annotator</button>
      </div>
      {#if error}<p class="error">{error}</p>{/if}
    {/if}
  </div>

{:else if !pdfPath || showBrowser}
  <div class="browser-wrap">
    <div class="browser-header">
      <h2>Select a PDF</h2>
      {#if pdfPath}
        <button onclick={() => { showBrowser = false; }}>✕ Cancel</button>
      {/if}
    </div>
    <FileBrowser />
  </div>

{:else}
  <div class="main">
    <div class="top-bar">
      <span>{pdfName}</span>
      <button onclick={() => { showBrowser = true; }}>Change PDF</button>
    </div>
    <div class="viewer-wrap">
      <PdfViewer />
      {#if role === 'annotator'}
        <Toolbar />
      {/if}
    </div>
  </div>
{/if}

<style>
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 1rem;
  }
  input {
    font-size: 1.5rem;
    padding: 0.5rem 1rem;
    text-align: center;
    width: 12rem;
  }
  button {
    font-size: 1rem;
    padding: 0.5rem 2rem;
    cursor: pointer;
  }
  .role-buttons {
    display: flex;
    gap: 1rem;
  }
  .error {
    color: red;
  }
  .browser-wrap {
    max-width: 700px;
    margin: 0 auto;
    padding: 1rem;
  }
  .browser-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  .viewer-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    min-height: 0;
  }
  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    background: #f0f0f0;
    border-bottom: 1px solid #ccc;
  }
</style>
