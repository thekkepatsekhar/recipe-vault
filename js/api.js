// ── RECIPE VAULT — AI API HELPER ─────────────────────────────────────────────
// Supports both Google Gemini (free) and Anthropic Claude (paid)
// Gemini free tier: https://aistudio.google.com/apikey
// Anthropic paid:   https://console.anthropic.com

function getActiveAI() {
  const geminiKey    = localStorage.getItem('rv_gemini_key');
  const anthropicKey = localStorage.getItem('rv_anthropic_key');
  if (geminiKey)    return { provider: 'gemini',    key: geminiKey    };
  if (anthropicKey) return { provider: 'anthropic', key: anthropicKey };
  return null;
}

async function callClaude(messages, maxTokens = 1500) {
  const ai = getActiveAI();
  if (!ai) throw new Error('No API key set — add a Gemini or Anthropic key in Settings');

  if (ai.provider === 'gemini') {
    try {
      return await callGemini(messages, ai.key, maxTokens);
    } catch(e) {
      // If Gemini hits quota (429) or model error, fall back to Anthropic
      if (e.message.includes('429') || e.message.includes('quota') || e.message.includes('not found')) {
        const anthropicKey = localStorage.getItem('rv_anthropic_key');
        if (anthropicKey) {
          console.log('Gemini failed, falling back to Anthropic:', e.message);
          showToast('Gemini limit reached — using Anthropic backup');
          return await callAnthropic(messages, anthropicKey, maxTokens);
        }
      }
      throw e;
    }
  }

  return callAnthropic(messages, ai.key, maxTokens);
}

// ── GOOGLE GEMINI (free) ──────────────────────────────────────────────────────
async function callGemini(messages, apiKey, maxTokens) {
  // Model name stored in settings so it can be updated without code changes
  const model    = localStorage.getItem('rv_gemini_model') || 'gemini-2.0-flash';
  const contents = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey,
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

// ── METRIC CONVERSION PROMPT ──────────────────────────────────────────────────
// Used by drive.js and app.js when extracting recipes
const METRIC_INSTRUCTION = `IMPORTANT - Convert measurements to metric where appropriate:
- cups/tablespoons/teaspoons of dry ingredients (flour, sugar, oats, butter etc) → grams (g)
- cups of liquids (milk, water, cream etc) → millilitres (ml)
- tablespoons/teaspoons of liquids → millilitres (ml)
- oz/lbs of food → grams (g) or kilograms (kg)
- inches (pan sizes etc) → centimetres (cm)
- Keep temperatures in Fahrenheit (°F) — do NOT convert to Celsius
- Keep metric measurements as-is (already g, ml, kg)
- Keep "pinch", "handful", "to taste", "a few" as-is — no conversion needed
- Common conversions: 1 cup flour ≈ 120g, 1 cup sugar ≈ 200g, 1 cup butter ≈ 225g, 1 cup milk ≈ 240ml, 1 tbsp ≈ 15ml, 1 tsp ≈ 5ml, 1 oz ≈ 28g, 1 lb ≈ 450g`;

// ── PAGE FETCH (for recipe import from websites) ──────────────────────────────
async function fetchPageContent(url) {
  // allorigins.win works best for sites that block other proxies
  try {
    const res = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url));
    if (res.ok) {
      const json = await res.json();
      const html = json.contents || '';
      if (html.length > 200) {
        return extractRecipeText(html);
      }
    }
  } catch(e) { console.warn('allorigins failed:', e.message); }

  // Fall back to corsproxy.io
  try {
    const res = await fetch('https://corsproxy.io/?' + encodeURIComponent(url));
    if (res.ok) {
      const html = await res.text();
      if (html.length > 200) {
        return extractRecipeText(html);
      }
    }
  } catch(e) { console.warn('corsproxy failed:', e.message); }

  return '';
}

function extractRecipeText(html) {
  // Try JSON-LD structured data first (most reliable)
  const jsonLdMatches = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of jsonLdMatches) {
    const content = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
    try {
      const data = JSON.parse(content);
      const items = Array.isArray(data) ? data : [data];
      const recipe = items.find(d => d['@type'] === 'Recipe' ||
        (Array.isArray(d['@type']) && d['@type'].includes('Recipe')));
      if (recipe) {
        const ingredients = (recipe.recipeIngredient || []).join('\n');
        const instructions = (recipe.recipeInstructions || [])
          .map(i => typeof i === 'string' ? i : (i.text || i.name || ''))
          .filter(Boolean).join('\n');
        if (ingredients || instructions) {
          return `STRUCTURED RECIPE:\nName: ${recipe.name || ''}\nTime: ${recipe.totalTime || recipe.cookTime || ''}\nServings: ${recipe.recipeYield || ''}\n\nINGREDIENTS:\n${ingredients}\n\nSTEPS:\n${instructions}`;
        }
      }
    } catch(e) {}
  }

  // Fall back to plain text
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
    .replace(/\s{2,}/g, ' ').trim().slice(0, 5000);
}

// ── METRIC EXTRACTION HELPER ──────────────────────────────────────────────────
// Call this instead of callClaude for recipe extraction — adds metric conversion
async function extractRecipeWithAI(recipeNameHint, cuisineHint, pdfText) {
  const prompt = `Extract this recipe and return ONLY valid JSON (no markdown, no explanation):
{
  "name": "",
  "time": "",
  "servings": 4,
  "ingredients": [{"amount": "", "item": ""}],
  "steps": [""],
  "nutrition": null
}

Recipe name: "${recipeNameHint}"
Cuisine: "${cuisineHint || 'Unknown'}"
PDF text: ${pdfText ? pdfText.slice(0, 3000) : '(no text — use your culinary knowledge of this recipe)'}

${METRIC_INSTRUCTION}

If PDF text is missing or unclear, use your culinary knowledge to provide typical ingredients and steps for "${recipeNameHint}".
Always return valid JSON.`;

  const raw = await callClaude([{ role: 'user', content: prompt }]);
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

async function importRecipeFromURL(prompt) {
  const fullPrompt = prompt + '\n\n' + METRIC_INSTRUCTION;
  const raw = await callClaude([{ role: 'user', content: fullPrompt }], 2500);
  // Clean and fix potentially truncated JSON
  let cleaned = raw.replace(/```json|```/g, '').trim();
  // If JSON is truncated, try to close it gracefully
  if (!cleaned.endsWith('}')) {
    // Find the last complete field and close the JSON
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > 0) {
      cleaned = cleaned.slice(0, lastBrace + 1);
      // Make sure arrays are closed
      while ((cleaned.match(/\[/g)||[]).length > (cleaned.match(/\]/g)||[]).length) {
        cleaned += ']';
      }
      // Make sure object is closed
      while ((cleaned.match(/\{/g)||[]).length > (cleaned.match(/\}/g)||[]).length) {
        cleaned += '}';
      }
    }
  }
  return JSON.parse(cleaned);
}

// ── YOUTUBE DATA API ──────────────────────────────────────────────────────────
// Key is stored in localStorage (set in Settings) — never hardcoded in source

async function fetchYouTubeDetails(url) {
  const apiKey = localStorage.getItem('rv_youtube_key');
  if (!apiKey) {
    console.warn('No YouTube API key set — falling back to URL-only extraction');
    return null;
  }

  const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([^&?/\s]{11})/);
  if (!match) return null;
  const videoId = match[1];

  try {
    const res = await fetch(
      'https://www.googleapis.com/youtube/v3/videos?part=snippet&id=' +
      videoId + '&key=' + apiKey
    );
    if (!res.ok) throw new Error('YouTube API ' + res.status);
    const data = await res.json();
    const item = data.items?.[0]?.snippet;
    if (!item) return null;
    return {
      title:       item.title        || '',
      description: item.description  || '',
      channel:     item.channelTitle || '',
      videoId,
    };
  } catch(e) {
    console.warn('YouTube API failed:', e.message);
    return null;
  }
}
