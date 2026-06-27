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
  return ai.provider === 'gemini'
    ? callGemini(messages, ai.key, maxTokens)
    : callAnthropic(messages, ai.key, maxTokens);
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
  const raw = await callClaude([{ role: 'user', content: fullPrompt }]);
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}
