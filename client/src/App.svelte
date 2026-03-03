<script lang="ts">
  let pin = $state('');
  let error = $state('');
  let token = $state(sessionStorage.getItem('authToken') ?? '');

  async function submitPin() {
    error = '';
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (res.ok) {
      const data = await res.json() as { token: string };
      token = data.token;
      sessionStorage.setItem('authToken', token);
    } else {
      error = 'Invalid PIN';
      pin = '';
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') submitPin();
  }
</script>

{#if !token}
  <div class="pin-gate">
    <h1>Presenter</h1>
    <input
      type="password"
      placeholder="Enter PIN"
      bind:value={pin}
      onkeydown={handleKeydown}
      autofocus
    />
    <button onclick={submitPin}>Unlock</button>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  </div>
{:else}
  <p>Authenticated. Main app goes here.</p>
{/if}

<style>
  .pin-gate {
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
  .error {
    color: red;
  }
</style>
