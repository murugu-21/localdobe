export function LocalBadge() {
  return (
    <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm3 8H9V6a3 3 0 1 1 6 0v3Z" />
      </svg>
      Your file never leaves this device — everything runs in your browser.
    </p>
  );
}
