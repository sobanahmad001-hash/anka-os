import { useState } from 'react';

export default function BrowserApp() {
  const [url, setUrl] = useState('https://ankastudio.com');
  const [inputUrl, setInputUrl] = useState(url);

  function navigate(e) {
    e.preventDefault();
    let target = inputUrl.trim();
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = `https://${target}`;
    }
    setUrl(target);
    setInputUrl(target);
  }

  return (
    <div className="h-full flex flex-col">
      {/* URL bar */}
      <form
        onSubmit={navigate}
        className="flex items-center gap-2 px-3 py-2 bg-[var(--anka-bg-secondary)] border-b border-[var(--anka-border)]"
      >
        <button
          type="button"
          onClick={() => { setUrl('https://ankastudio.com'); setInputUrl('https://ankastudio.com'); }}
          className="text-xs px-2 py-1 rounded hover:bg-[var(--anka-bg-tertiary)] text-[var(--anka-text-secondary)] transition cursor-pointer"
        >
          🏠
        </button>
        <input
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          className="flex-1 px-3 py-1.5 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-xs text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
          placeholder="Enter URL..."
        />
        <button
          type="submit"
          className="text-xs px-3 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white rounded-lg transition cursor-pointer"
        >
          Go
        </button>
      </form>

      {/* Iframe */}
      <iframe
        src={url}
        className="flex-1 w-full border-none bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="Browser"
      />
    </div>
  );
}
