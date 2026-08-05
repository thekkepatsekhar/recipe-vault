// ── RECIPE VAULT — AI API ─────────────────────────────────────────────────────
// Uses Anthropic Claude — add your key in Settings
// Get a key at https://console.anthropic.com

async function callClaude(messages, maxTokens = 2500) {
  const apiKey = localStorage.getItem('rv_anthropic_key');
  if (!apiKey) throw new Error('No Anthropic API key set — add it in Settings');
  return callAnthropic(messages, apiKey, maxTokens);
}

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
      model:      'claude-haiku-4-5-20251001',
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

// ── METRIC CONVERSION INSTRUCTION ────────────────────────────────────────────
const METRIC_INSTRUCTION = `Convert measurements to metric:
- Dry ingredients (flour, sugar, butter etc) → grams (g)
- Liquids (milk, water, cream etc) → millilitres (ml)
- oz/lbs → grams (g) or kg
- inches → centimetres (cm)
- Keep temperatures in Fahrenheit (°F) — do NOT convert to Celsius
- Keep "pinch", "handful", "to taste" as-is
- Common: 1 cup flour≈120g, 1 cup sugar≈200g, 1 cup butter≈225g, 1 cup milk≈240ml, 1 tbsp≈15ml, 1 tsp≈5ml, 1 oz≈28g, 1 lb≈450g`;

// ── RECIPE EXTRACTION ────────────────────────────────────────────────────────
async function extractRecipeWithAI(recipeNameHint, cuisineHint, pdfText) {
  const prompt = `Extract this recipe and return ONLY valid JSON (no markdown):
{"name":"","time":"","servings":4,"ingredients":[{"amount":"","item":""}],"steps":[""],"nutrition":null}

Recipe name: "${recipeNameHint}"
Cuisine: "${cuisineHint || 'Unknown'}"
PDF text: ${pdfText ? pdfText.slice(0, 2000) : '(no text — use your culinary knowledge of this recipe)'}

${METRIC_INSTRUCTION}

If PDF text is missing, use culinary knowledge for "${recipeNameHint}".`;

  const raw     = await callClaude([{ role: 'user', content: prompt }]);
  let   cleaned = raw.replace(/```json|```/g, '').trim();
  if (!cleaned.endsWith('}')) {
    const last = cleaned.lastIndexOf('}');
    if (last > 0) {
      cleaned = cleaned.slice(0, last + 1);
      while ((cleaned.match(/\[/g)||[]).length > (cleaned.match(/\]/g)||[]).length) cleaned += ']';
      while ((cleaned.match(/\{/g)||[]).length > (cleaned.match(/\}/g)||[]).length) cleaned += '}';
    }
  }
  return JSON.parse(cleaned);
}

async function importRecipeFromURL(prompt) {
  const fullPrompt = prompt + '\n\n' + METRIC_INSTRUCTION;
  const raw     = await callClaude([{ role: 'user', content: fullPrompt }]);
  let   cleaned = raw.replace(/```json|```/g, '').trim();
  if (!cleaned.endsWith('}')) {
    const last = cleaned.lastIndexOf('}');
    if (last > 0) {
      cleaned = cleaned.slice(0, last + 1);
      while ((cleaned.match(/\[/g)||[]).length > (cleaned.match(/\]/g)||[]).length) cleaned += ']';
      while ((cleaned.match(/\{/g)||[]).length > (cleaned.match(/\}/g)||[]).length) cleaned += '}';
    }
  }
  return JSON.parse(cleaned);
}

// ── YOUTUBE DATA API ──────────────────────────────────────────────────────────
async function fetchYouTubeDetails(url) {
  const apiKey  = localStorage.getItem('rv_youtube_key');
  if (!apiKey) return null;
  const match   = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([^&?/\s]{11})/);
  if (!match) return null;
  const videoId = match[1];
  try {
    const res  = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet&id=' + videoId + '&key=' + apiKey);
    if (!res.ok) throw new Error('YouTube API ' + res.status);
    const data = await res.json();
    const item = data.items?.[0]?.snippet;
    if (!item) return null;
    return { title: item.title || '', description: item.description || '', channel: item.channelTitle || '', videoId };
  } catch(e) { console.warn('YouTube API failed:', e.message); return null; }
}

// ── PAGE FETCH ────────────────────────────────────────────────────────────────
async function fetchPageContent(url) {
  try {
    const res  = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url));
    if (res.ok) {
      const json = await res.json();
      const html = json.contents || '';
      if (html.length > 200) return extractRecipeText(html);
    }
  } catch(e) {}
  try {
    const res = await fetch('https://corsproxy.io/?' + encodeURIComponent(url));
    if (res.ok) {
      const html = await res.text();
      if (html.length > 200) return extractRecipeText(html);
    }
  } catch(e) {}
  return '';
}

function extractRecipeText(html) {
  const jsonLdMatches = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of jsonLdMatches) {
    const content = block.replace(/<script[^>]*>/i,'').replace(/<\/script>/i,'').trim();
    try {
      const data  = JSON.parse(content);
      const items = Array.isArray(data) ? data : [data];
      const recipe = items.find(d => d['@type']==='Recipe' || (Array.isArray(d['@type']) && d['@type'].includes('Recipe')));
      if (recipe) {
        const ings   = (recipe.recipeIngredient||[]).join('\n');
        const steps  = (recipe.recipeInstructions||[]).map(i=>typeof i==='string'?i:(i.text||i.name||'')).filter(Boolean).join('\n');
        if (ings||steps) return `STRUCTURED RECIPE:\nName: ${recipe.name||''}\nTime: ${recipe.totalTime||recipe.cookTime||''}\nServings: ${recipe.recipeYield||''}\n\nINGREDIENTS:\n${ings}\n\nSTEPS:\n${steps}`;
      }
    } catch(e) {}
  }
  return html
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&nbsp;/g,' ').replace(/&#\d+;/g,' ')
    .replace(/\s{2,}/g,' ').trim().slice(0,5000);
}
