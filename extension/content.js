document.addEventListener(
  'click',
  (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    const anchor = target.closest('a[href]');
    if (!anchor) return;
    const href = (anchor.href || '').trim();
    if (!/^magnet:\?xt=urn:btih:/i.test(href)) return;

    event.preventDefault();
    event.stopPropagation();

    try {
      chrome.runtime.sendMessage(
        {
          type: 'MYLOAD_INTERCEPT_LINK',
          url: href,
          referrer: window.location.href,
        },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.ok) {
            window.location.href = href;
          }
        }
      );
    } catch {
      window.location.href = href;
    }
  },
  true
);

