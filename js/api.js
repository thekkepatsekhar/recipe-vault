// ── RECIPE VAULT — API HELPER ─────────────────────────────────────────────────
// Calls Anthropic API directly from the browser.
// This is safe for a personal private app since only you have the URL and key.

async function callClaude(messages, maxTokens = 1500) {
  // Get API key from localStorage (set in Settings)
  const apiKey = localStorage.getItem('rv_anthropic_key');
  if (!apiKey) {
    throw new Error('No API key set — please add your Anthropic API key in Settings');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':         'application/json',
      'x-api-key':            apiKey,
      'anthropic-version':    '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-5',
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('API error ' + res.status + (err.error?.message ? ': ' + err.error.message : ''));
  }

  const data = await res.json();
  return data.content.map(c => c.text || '').join('');
}

async function fetchPageContent(url) {
  // Use a CORS proxy to fetch page content for recipe import
  try {
    const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error('Fetch failed');
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
      .replace(/\s{2,}/g, ' ').trim().slice(0, 6000);
  } catch(e) {
    return ''; // Return empty — Claude will use URL knowledge instead
  }
}
