type ToastKind = 'info' | 'success' | 'error';

let toastHost: HTMLDivElement | null = null;

const ensureToastHost = (): HTMLDivElement | null => {
  if (toastHost) return toastHost;
  const host = document.createElement('div');
  host.setAttribute('aria-live', 'polite');
  host.setAttribute('aria-atomic', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    zIndex: '9999',
    pointerEvents: 'none',
  });
  document.body.appendChild(host);
  toastHost = host;
  return host;
};

export const showToast = (message: string, kind: ToastKind = 'info', durationMs = 2200): void => {
  const host = ensureToastHost();
  if (!host) return;

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const palette = {
    info: { background: 'rgba(17, 24, 39, 0.92)', color: 'white' },
    success: { background: 'rgba(22, 163, 74, 0.95)', color: 'white' },
    error: { background: 'rgba(220, 38, 38, 0.95)', color: 'white' },
  } as const;
  Object.assign(toast.style, {
    minWidth: '180px',
    maxWidth: '320px',
    padding: '10px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    lineHeight: '1.4',
    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    opacity: '0',
    transform: 'translateY(6px)',
    transition: 'opacity 140ms ease, transform 140ms ease',
    ...palette[kind],
  });

  host.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    window.setTimeout(() => {
      toast.remove();
      if (host.childElementCount === 0) {
        host.remove();
        toastHost = null;
      }
    }, 180);
  }, durationMs);
};
