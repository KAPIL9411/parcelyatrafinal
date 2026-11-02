/**
 * Parcel Yatra iPhone PWA — the browser chrome around the app.
 *
 * Plain DOM, deliberately outside React: the app itself is the Expo export and must stay identical to
 * Android, while these three things are only ever true in a browser. Config arrives from
 * `window.__PY_PWA__`, which `ios/scripts/build.mjs` writes into index.html from `ios/app.json`, so
 * the copy below has no hard-coded strings.
 *
 *   1. service worker registration, with the version hand-off done politely;
 *   2. an update banner, shown only when a new worker is genuinely waiting;
 *   3. an "Add to Home Screen" guide, on iOS Safari only, never in standalone mode, once only.
 *
 * Nothing here reads or writes anything personal. The single stored value is the flag saying the owner
 * of this phone already saw the install guide.
 */

'use strict';

(function () {
  const cfg = window.__PY_PWA__ || {};
  const guide = cfg.installGuide || {};
  const bannerCopy = cfg.updateBanner || {};
  const theme = cfg.themeColor || '#005DFD';
  const dismissKey = guide.storageKey || 'py.install-guide-dismissed';

  function dismissed() {
    try {
      return window.localStorage.getItem(dismissKey) === '1';
    } catch {
      return false;
    }
  }

  function rememberDismissal() {
    // Safari in private mode throws on every localStorage write; the guide simply comes back.
    try {
      window.localStorage.setItem(dismissKey, '1');
    } catch {
      /* ignore */
    }
  }

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.startsWith('app-settings:')
    );
  }

  function isIOS() {
    const ua = window.navigator.userAgent || '';
    const iPadOS = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(ua) || iPadOS;
  }

  function isSafari() {
    const ua = window.navigator.userAgent || '';
    return ua.includes('Safari') && !/CriOS|FxiOS|EdgA|OPiOS|MicroMessenger/.test(ua);
  }

  // -------------------------------------------------------------------------
  // Shared styling for the two surfaces
  // -------------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = [
    '.py-chrome{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(20px + env(safe-area-inset-bottom,0px));',
    'z-index:2147483000;width:min(420px,calc(100vw - 32px));box-sizing:border-box;',
    'background:#fff;border:1px solid #e4e7ec;border-radius:18px;',
    'box-shadow:0 10px 44px rgba(10,23,48,.18);padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    'animation:py-chrome-in .28s ease-out}',
    '@keyframes py-chrome-in{from{opacity:0;transform:translate(-50%,12px)}to{opacity:1;transform:translate(-50%,0)}}',
    '.py-chrome h2{margin:0 0 6px;font-size:16px;line-height:20px;color:#101828;font-weight:600}',
    '.py-chrome p{margin:0;font-size:13px;line-height:18px;color:#667085}',
    '.py-chrome ol{margin:12px 0 0;padding:0;list-style:none;counter-reset:step}',
    '.py-chrome ol li{counter-increment:step;position:relative;padding:0 0 10px 28px;font-size:13px;line-height:18px;color:#344054}',
    '.py-chrome ol li:last-child{padding-bottom:0}',
    '.py-chrome ol li::before{content:counter(step);position:absolute;left:0;top:0;width:20px;height:20px;border-radius:10px;',
    'background:#eaf1ff;color:' + theme + ';font-size:11px;font-weight:700;text-align:center;line-height:20px}',
    '.py-chrome-actions{display:flex;gap:10px;margin-top:14px}',
    '.py-chrome button{flex:1;min-height:44px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;',
    'font-family:inherit;border:1px solid transparent;padding:0 12px}',
    '.py-chrome .primary{background:' + theme + ';color:#fff}',
    '.py-chrome .ghost{background:#fff;color:#344054;border-color:#e4e7ec}',
    '.py-chrome .close{position:absolute;top:8px;right:8px;width:32px;height:32px;min-height:0;flex:0 0 auto;',
    'border-radius:16px;font-size:16px;line-height:1;color:#98a2b3;background:transparent}',
  ].join('\n');
  document.head.appendChild(style);

  function card(role) {
    const el = document.createElement('div');
    el.className = 'py-chrome';
    el.setAttribute('role', role === 'update' ? 'alert' : 'dialog');
    if (role !== 'update') el.setAttribute('aria-label', guide.title || 'Install Parcel Yatra');
    return el;
  }

  // -------------------------------------------------------------------------
  // 1 + 2. Service worker, and the update banner it can produce
  // -------------------------------------------------------------------------
  let reloaded = false;

  function promptReload(worker, registration) {
    if (reloaded || document.querySelector('.py-chrome[data-role="update"]')) return;

    const el = card('update');
    el.dataset.role = 'update';
    el.innerHTML =
      '<h2></h2><p></p><div class="py-chrome-actions"><button class="primary" type="button"></button></div>';
    el.querySelector('h2').textContent = bannerCopy.title || 'A new version is ready';
    el.querySelector('p').textContent = 'Reloading takes a second and keeps you signed in.';
    const action = el.querySelector('button');
    action.textContent = bannerCopy.actionLabel || 'Reload now';

    action.addEventListener('click', () => {
      reloaded = true;
      el.remove();
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
      (worker || registration.waiting).postMessage({ type: 'PY_SKIP_WAITING' });
      // If the worker is already the active one there is no hand-off to wait for.
      setTimeout(() => window.location.reload(), 1500);
    });
    document.body.appendChild(el);
  }

  function attach(registration) {
    if (registration.waiting) promptReload(registration.waiting, registration);

    registration.addEventListener('updatefound', () => {
      const next = registration.installing;
      if (!next) return;
      next.addEventListener('statechange', () => {
        if (next.state !== 'installed') return;
        // A controller means this page was served by the previous build, so the new one is an update.
        // Without one, this is simply the first install and there is nothing to reload for.
        if (navigator.serviceWorker.controller) promptReload(next, registration);
      });
    });
  }

  const secure = window.isSecureContext || /^(localhost|127\.|\[::1\])$/.test(window.location.hostname);
  if ('serviceWorker' in navigator && secure) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: cfg.scope || '/' })
        .then(attach)
        .catch((error) => console.warn('[Parcel Yatra] offline support unavailable:', error && error.message));
    });
  }

  // -------------------------------------------------------------------------
  // 3. The install guide
  // -------------------------------------------------------------------------
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
  });

  function showInstallGuide() {
    if (isStandalone() || dismissed()) return;
    // iOS Safari has no install event, so the only way in is the Share sheet — say so.
    if (!isIOS() && !deferredPrompt) return;

    const el = card('install');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.setAttribute('aria-label', guide.dismissLabel || 'Dismiss');
    close.textContent = '×';

    const steps = (guide.steps || []).map((text) => `<li></li>`).join('');
    const isIOSSafari = isIOS() && !deferredPrompt;
    
    // For iOS: initially hide steps, show button to expand
    el.innerHTML = [
      '<h2></h2><p></p>',
      steps ? `<ol style="${isIOSSafari ? 'display:none;' : ''}">${steps}</ol>` : '',
      '<div class="py-chrome-actions">',
      deferredPrompt 
        ? '<button class="ghost" type="button" data-act="later"></button><button class="primary" type="button" data-act="install"></button>' 
        : isIOSSafari
          ? '<button class="ghost" type="button" data-act="later"></button><button class="primary" type="button" data-act="show-steps"></button>'
          : '<button class="ghost" type="button" data-act="later" style="flex:1"></button>',
      '</div>',
    ].join('');

    el.querySelector('h2').textContent = guide.title || 'Add Parcel Yatra to your Home Screen';
    el.querySelector('p').textContent = guide.body || '';
    el.querySelectorAll('ol li').forEach((li, index) => {
      li.textContent = guide.steps[index];
    });
    el.prepend(close);

    const later = el.querySelector('[data-act="later"]');
    if (later) {
      later.textContent = guide.dismissLabel || 'Not now';
      later.addEventListener('click', () => {
        rememberDismissal();
        el.remove();
      });
    }

    // iOS: Show steps button
    const showSteps = el.querySelector('[data-act="show-steps"]');
    if (showSteps) {
      showSteps.textContent = 'Show me how to install';
      showSteps.addEventListener('click', () => {
        const stepsList = el.querySelector('ol');
        if (stepsList) {
          stepsList.style.display = 'block';
          stepsList.style.animation = 'py-chrome-in .28s ease-out';
        }
        showSteps.style.display = 'none';
      });
    }

    // Android/Chrome: Direct install button
    const install = el.querySelector('[data-act="install"]');
    if (install) {
      install.textContent = 'Install';
      install.addEventListener('click', () => {
        deferredPrompt.prompt();
        void deferredPrompt.userChoice.then(() => {
          deferredPrompt = null;
          rememberDismissal();
          el.remove();
        });
      });
    }

    close.addEventListener('click', () => {
      rememberDismissal();
      el.remove();
    });

    document.body.appendChild(el);
  }

  // Wait out the splash and the first paint; a guide over a loading screen helps nobody.
  window.addEventListener('load', () => setTimeout(showInstallGuide, 1600));
})();
