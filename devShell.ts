// Must be imported before App (imports are hoisted): App reads window.ReactNativeWebView
// and window.__NETWORQ_SHELL__ when its module first evaluates.
// Dev preview only: ?shell=android makes the web app behave as it does inside the
// Android WebView shell (app layout, native Google button, Radar bridge stub).
// __DEV__ is false in production bundles, so this block is stripped there.
export {};

if (__DEV__ && typeof window !== 'undefined' && /[?&]shell=android\b/.test(window.location.search)) {
  const w = window as any;
  const params = new URLSearchParams(window.location.search);
  // Simulated Bluetooth: this window "broadcasts" at the chosen signal strength via the dev API
  const rssi = Number(params.get('bleRssi') || -75);
  const deviceId = sessionStorage.getItem('nq-dev-device') || Math.random().toString(36).slice(2);
  sessionStorage.setItem('nq-dev-device', deviceId);
  let token: string | null = null;
  let scanning: ReturnType<typeof setInterval> | null = null;
  const reply = (detail: unknown) => setTimeout(() => window.dispatchEvent(new CustomEvent('networq-native', { detail })), 30);
  const tick = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/dev/ble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, token, rssi }),
      });
      const { heard } = await res.json();
      if (heard?.length) reply({ type: 'radar:sightings', items: heard });
    } catch {
      /* dev API not running */
    }
  };
  // Mirrors the current APK (native Google sign-in); framed previews fall back to a new tab
  w.__NETWORQ_SHELL__ = { googleAuth: true };
  w.ReactNativeWebView = {
    postMessage(raw: string) {
      const msg = JSON.parse(raw);
      console.info('[shell ←]', msg);
      if (msg.type === 'radar:capabilities') reply({ type: 'radar:capabilities', state: 'on', permission: 'granted' });
      if (msg.type === 'radar:start') {
        token = msg.token;
        reply({ type: 'radar:state', state: 'on' });
        if (!scanning) scanning = setInterval(tick, 1500);
        tick();
      }
      if (msg.type === 'radar:token') token = msg.token;
      if (msg.type === 'radar:stop') {
        token = null;
        if (scanning) clearInterval(scanning);
        scanning = null;
        tick();
      }
      if (msg.type === 'auth:google') reply({ type: 'auth:error', message: 'Google sign-in runs in the real app (system browser).' });
    },
  };
}


// Dev preview only: ?devLogin=<account> signs into a preview test account automatically.
// Only the two preview accounts are accepted, and only in development builds.
if (__DEV__ && typeof window !== 'undefined') {
  const who = new URLSearchParams(window.location.search).get('devLogin');
  const accounts: Record<string, string> = { a: 'preview.a@networq.co.in', b: 'preview.b@networq.co.in' };
  if (who && accounts[who]) {
    import('./supabase').then(async ({ supabase }) => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user?.email === accounts[who]) return; // already signed in as this account
      if (data.session) await supabase.auth.signOut({ scope: 'local' });
      const { error } = await supabase.auth.signInWithPassword({ email: accounts[who], password: 'Preview#2026' });
      if (error) console.warn('[preview] auto sign-in failed:', error.message);
    });
  }
}
