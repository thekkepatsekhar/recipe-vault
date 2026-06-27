// ── RECIPE VAULT — AI API HELPER ─────────────────────────────────────────────
// Supports both Google Gemini (free) and Anthropic Claude (paid)
// Gemini free tier: https://aistudio.google.com/apikey
// Anthropic paid:   https://console.anthropic.com

function getActiveAI() {
  const geminiKey    = localStorage.getItem('rv_gemini_key');
  const anthropicKey = localStorage.getItem('rv_anthropic_key');
  // Prefer Gemini if set (it's free), fall back to Anthropic
  if (geminiKey)    return { provider: 'gemini',    key: geminiKey    };
  if (anthropicKey) return { provider: 'anthropic', key: anthropicKey };
  return null;
}

async function callClaude(messages, maxTokens = 1500) {
  const ai = getActiveAI();
  if (!ai) {
    throw new Error('No API key set — add a Gemini or Anthropic key in Settings');
  }
  if (ai.provider === 'gemini') {
    return callGemini(messages, ai.key, maxTokens);
  } else {
    return callAnthropic(messages, ai.key, maxTokens);
  }
}

// ── GOOGLE GEMINI (free) ──────────────────────────────────────────────────────
async function callGemini(messages, apiKey, maxTokens) {
  const contents = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('Gemini error ' + res.status + ': ' + (err.error?.message || res.statusText));
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── ANTHROPIC CLAUDE (paid fallback) ─────────────────────────────────────────
async function callAnthropic(messages, apiKey, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
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
    throw new Error('Anthropic error ' + res.status + ': ' + (err.error?.message || res.statusText));
  }

  const data = await res.json();
  return data.content.map(c => c.text || '').join('');
}

// ── PAGE FETCH (for recipe import from websites) ──────────────────────────────
async function fetchPageContent(url) {
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
    return '';
  }
}
