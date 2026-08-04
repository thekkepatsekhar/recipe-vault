// ── RECIPE VAULT CONFIG ───────────────────────────────────────────────────────
// Store your API keys here. This file is loaded automatically on startup.
// Keep this file out of public GitHub repos — add it to .gitignore if needed.
// Keys are saved to localStorage so you only need to enter them here once.

(function() {
  const defaults = {
    rv_anthropic_key: '',   // Your Anthropic API key: sk-ant-...
    rv_youtube_key:   '',   // Your YouTube Data API key: AIza...
  };

  // Only set if not already saved by the user in Settings
  Object.entries(defaults).forEach(([key, value]) => {
    if (value && !localStorage.getItem(key)) {
      localStorage.setItem(key, value);
    }
  });
})();
