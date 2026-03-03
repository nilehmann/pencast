<script lang="ts">
  import { authToken, deviceRole } from './stores.ts';
  import { connect } from './ws-client.ts';

  let pin = $state('');
  let error = $state('');
  let connecting = $state(false);

  // Derive reactive values from stores
  let token = $derived($authToken);
  let role = $derived($deviceRole);

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

{:else}
  <p>Connected as <strong>{role}</strong>. Main app goes here.</p>
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
  }
  .role-buttons {
    display: flex;
    gap: 1rem;
  }
  .error {
    color: red;
  }
</style>
