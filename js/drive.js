// ── RECIPE VAULT — GOOGLE DRIVE INTEGRATION ───────────────────────────────────

const GOOGLE_CLIENT_ID = '731440034823-cf8mcfc907rf70mredc0s91dj8a8828n.apps.googleusercontent.com';
const DRIVE_SCOPE      = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

const drive = {
  accessToken: null,
  userProfile: null,
  isSignedIn:  false,
  folderPath:  localStorage.getItem('rv_folder') || 'Recipes',
};

// ── INIT — check for token in URL hash after redirect ─────────────────────────
async function initGoogleAuth() {
  // Check if we just came back from Google sign-in (token is in URL hash)
  const hash = window.location.hash;
  if (hash && hash.includes('access_token')) {
    const params  = new URLSearchParams(hash.slice(1));
    const token   = params.get('access_token');
    const expires = parseInt(params.get('expires_in') || '3600');
    if (token) {
      drive.accessToken = token;
      localStorage.setItem('rv_gtoken', JSON.stringify({
        token,
        expiry: Date.now() + (expires - 60) * 1000,
      }));
      history.replaceState(null, '', window.location.pathname);
      await fetchUserProfile();
      drive.isSignedIn = true;
      onSignInSuccess();
      return;
    }
  }

  // Try restoring saved token
  try {
    const raw = localStorage.getItem('rv_gtoken');
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.token && saved.expiry > Date.now()) {
        drive.accessToken = saved.token;
        // Verify token is actually still valid
        try {
          await fetchUserProfile();
          drive.isSignedIn = true;
          onSignInSuccess();
          return;
        } catch(e) {
          // Token rejected — clear and fall through
          localStorage.removeItem('rv_gtoken');
        }
      } else {
        // Token expired — clear it
        localStorage.removeItem('rv_gtoken');
      }
    }
  } catch(e) {}

  updateSignInUI(false);
}

// ── SIGN IN — redirect to Google ──────────────────────────────────────────────
function signInWithGoogle() {
  const redirectUri = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: 'token',
    scope:         DRIVE_SCOPE,
    // Use 'select_account' instead of 'consent' so returning users
    // just pick their account without re-approving all permissions
    prompt:        'select_account',
  });
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

// ── SIGN OUT ──────────────────────────────────────────────────────────────────
function signOutGoogle() {
  // Revoke the token with Google
  if (drive.accessToken) {
    fetch('https://oauth2.googleapis.com/revoke?token=' + drive.accessToken, { method: 'POST' })
      .catch(() => {});
  }
  drive.accessToken = null;
  drive.isSignedIn  = false;
  drive.userProfile = null;
  localStorage.removeItem('rv_gtoken');
  onSignOut();
}

// ── PROFILE ───────────────────────────────────────────────────────────────────
async function fetchUserProfile() {
  try {
    const res = await gfetch('https://www.googleapis.com/oauth2/v3/userinfo');
    drive.userProfile = res;
  } catch(e) {
    drive.userProfile = { name: 'Google User', email: '' };
  }
}

// ── CALLBACKS ─────────────────────────────────────────────────────────────────
function onSignInSuccess() {
  updateSignInUI(true);
  if (typeof updateCloudBadge === 'function') updateCloudBadge();
  const banner = document.getElementById('connect-banner');
  if (banner) banner.classList.add('hidden');
  showToast('Signed in to Google Drive ✓');
  syncFromDrive();
}

function onSignOut() {
  updateSignInUI(false);
  if (typeof updateCloudBadge === 'function') updateCloudBadge();
  const banner = document.getElementById('connect-banner');
  if (banner) banner.classList.remove('hidden');
  if (typeof state !== 'undefined') {
    state.recipes = DEMO_RECIPES;
    if (typeof buildCuisineChips === 'function') buildCuisineChips();
    if (typeof applyFilters      === 'function') applyFilters();
  }
  showToast('Signed out of Google Drive');
}

// ── UI ────────────────────────────────────────────────────────────────────────
function updateSignInUI(signedIn) {
  const btnIn   = document.getElementById('btn-google-signin');
  const btnOut  = document.getElementById('btn-google-signout');
  const userBox = document.getElementById('google-user-box');
  const name    = document.getElementById('google-user-name');
  const email   = document.getElementById('google-user-email');
  const status  = document.getElementById('cloud-status');
  if (signedIn && drive.userProfile) {
    btnIn?.classList.add('hidden');
    btnOut?.classList.remove('hidden');
    userBox?.classList.remove('hidden');
    if (name)   name.textContent   = drive.userProfile.name  || 'Google User';
    if (email)  email.textContent  = drive.userProfile.email || '';
    if (status) status.textContent = '✓ Connected as ' + (drive.userProfile.email || 'Google User');
  } else {
    btnIn?.classList.remove('hidden');
    btnOut?.classList.add('hidden');
    userBox?.classList.add('hidden');
    if (status) status.textContent = 'Not connected — click Sign in';
  }
}

// ── DRIVE API HELPERS ─────────────────────────────────────────────────────────
async function gfetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + drive.accessToken,
      'Content-Type':  'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error('Drive API ' + res.status + ': ' + err);
  }
  return res.json();
}

async function gfetchText(url) {
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + drive.accessToken },
  });
  if (!res.ok) throw new Error('Drive API ' + res.status);
  return res.text();
}

async function findOrNull(query) {
  try {
    const data = await gfetch(
      'https://www.googleapis.com/drive/v3/files?q=' +
      encodeURIComponent(query) +
      '&fields=files(id,name)&pageSize=1'
    );
    return data.files?.[0] || null;
  } catch(e) { return null; }
}

async function listFiles(query) {
  try {
    const data = await gfetch(
      'https://www.googleapis.com/drive/v3/files?q=' +
      encodeURIComponent(query) +
      '&fields=files(id,name,mimeType,webViewLink)&pageSize=100&orderBy=name'
    );
    return data.files || [];
  } catch(e) { return []; }
}

// ── SYNC FROM DRIVE ───────────────────────────────────────────────────────────
async function syncFromDrive() {
  if (!drive.isSignedIn) return;
  showSyncBar(true);

  try {
    const folderName = (drive.folderPath || 'Recipes').replace(/^\//, '').trim();

    // Try 1: exact match in root
    let rootFolder = await findOrNull(
      `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`
    );

    // Try 2: exact match anywhere
    if (!rootFolder) {
      rootFolder = await findOrNull(
        `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
      );
    }

    // Try 3: list all top-level folders and match case-insensitively
    if (!rootFolder) {
      const data = await gfetch(
        'https://www.googleapis.com/drive/v3/files?q=' +
        encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`) +
        '&fields=files(id,name)&pageSize=100'
      );
      const folders = data.files || [];
      rootFolder = folders.find(f => f.name.toLowerCase() === folderName.toLowerCase()) || null;
      if (!rootFolder) {
        const names = folders.map(f => '"' + f.name + '"').join(', ');
        showToast('Folder "' + folderName + '" not found. Found: ' + (names || 'no folders'));
        showSyncBar(false);
        state.recipes = DEMO_RECIPES;
        buildCuisineChips(); applyFilters();
        return;
      }
    }

    // Find cuisine subfolders
    const subfolders = await listFiles(
      `'${rootFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );

    // Collect all PDF/text files
    const allFiles = [];
    const rootFiles = await listFiles(
      `'${rootFolder.id}' in parents and trashed=false and (mimeType='application/pdf' or mimeType='text/plain')`
    );
    rootFiles.forEach(f => allFiles.push({ ...f, cuisine: 'Other' }));

    for (const sub of subfolders) {
      const files = await listFiles(
        `'${sub.id}' in parents and trashed=false and (mimeType='application/pdf' or mimeType='text/plain')`
      );
      files.forEach(f => allFiles.push({ ...f, cuisine: sub.name }));
    }

    if (allFiles.length === 0) {
      showToast('Found "' + rootFolder.name + '" but no PDF files inside.');
      state.recipes = DEMO_RECIPES;
      buildCuisineChips(); applyFilters();
      showSyncBar(false);
      return;
    }

    // Convert files to recipe objects — process in batches of 5
    const recipes  = [];
    const BATCH    = 5;
    const cached   = getCachedRecipes();

    for (let i = 0; i < allFiles.length; i += BATCH) {
      const batch = allFiles.slice(i, i + BATCH);
      showToast(`Loading recipes ${i + 1}–${Math.min(i + BATCH, allFiles.length)} of ${allFiles.length}…`);
      const results = await Promise.all(batch.map(async file => {
        // Use cached version if file hasn't changed
        const cacheKey = 'drive_' + file.id;
        if (cached[cacheKey]) return cached[cacheKey];
        try {
          const recipe = await fileToRecipe(file);
          if (recipe) { cached[cacheKey] = recipe; }
          return recipe;
        } catch(e) {
          console.warn('Could not parse', file.name, e);
          return null;
        }
      }));
      results.forEach(r => { if (r) recipes.push(r); });
    }

    // Save cache for next time
    saveCachedRecipes(cached);

    state.recipes = recipes.length > 0 ? recipes : DEMO_RECIPES;
    buildCuisineChips();
    applyFilters();
    showToast('Loaded ' + recipes.length + ' recipe' + (recipes.length !== 1 ? 's' : '') + ' from Drive ✓');

  } catch(e) {
    console.error('Sync error:', e);
    showToast('Sync failed: ' + e.message);
    state.recipes = DEMO_RECIPES;
    buildCuisineChips(); applyFilters();
  }

  showSyncBar(false);
}

// ── FILE → RECIPE ─────────────────────────────────────────────────────────────
async function fileToRecipe(file) {
  let text = '';
  try {
    if (file.mimeType === 'application/pdf') {
      text = await extractPDFText(file.id);
    } else {
      text = await gfetchText(
        'https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media'
      );
    }
  } catch(e) { text = ''; }

  const structured = parseStructuredRecipe(text, file);
  if (structured) return structured;
  return await aiParseRecipe(text, file);
}

async function extractPDFText(fileId) {
  // For uploaded PDFs we need to download the raw file and extract text
  // Drive's export endpoint only works for Google Docs, not uploaded PDFs
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media',
      { headers: { 'Authorization': 'Bearer ' + drive.accessToken } }
    );
    if (!res.ok) throw new Error('Download failed: ' + res.status);

    const arrayBuffer = await res.arrayBuffer();
    const text = extractTextFromPDFBuffer(arrayBuffer);
    return text;
  } catch(e) {
    console.warn('PDF download failed:', e);
    return '';
  }
}

// Basic PDF text extractor — reads raw text streams from PDF binary
function extractTextFromPDFBuffer(buffer) {
  try {
    const bytes  = new Uint8Array(buffer);
    const str    = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
    const texts  = [];

    // Extract text from PDF text streams (BT...ET blocks)
    const btMatches = str.matchAll(/BT([\s\S]*?)ET/g);
    for (const match of btMatches) {
      const block = match[1];
      // Extract strings in parentheses: (Hello World)
      const parenMatches = block.matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g);
      for (const m of parenMatches) {
        const decoded = m[1]
          .replace(/\\n/g, ' ')
          .replace(/\\r/g, ' ')
          .replace(/\\t/g, ' ')
          .replace(/\\\\/g, '\\')
          .replace(/\\([()\d])/g, '$1')
          .trim();
        if (decoded.length > 1) texts.push(decoded);
      }
      // Extract hex strings: <48656c6c6f>
      const hexMatches = block.matchAll(/<([0-9a-fA-F]+)>/g);
      for (const m of hexMatches) {
        const hex = m[1];
        if (hex.length >= 2 && hex.length % 2 === 0) {
          let decoded = '';
          for (let i = 0; i < hex.length; i += 2) {
            const code = parseInt(hex.slice(i, i+2), 16);
            if (code > 31 && code < 127) decoded += String.fromCharCode(code);
          }
          if (decoded.trim().length > 1) texts.push(decoded.trim());
        }
      }
    }

    const result = texts.join(' ').replace(/\s+/g, ' ').trim();
    return result;
  } catch(e) {
    console.warn('PDF text extraction error:', e);
    return '';
  }
}

function parseStructuredRecipe(text, file) {
  if (!text || (!text.includes('## Ingredients') && !text.includes('## Steps'))) return null;
  const lines   = text.split('\n').map(l => l.trim()).filter(Boolean);
  const get     = section => {
    const start = lines.findIndex(l => l.toLowerCase().includes(section.toLowerCase()));
    if (start === -1) return [];
    const end = lines.findIndex((l, i) => i > start && l.startsWith('##'));
    return lines.slice(start + 1, end === -1 ? undefined : end);
  };
  const nameLine = lines.find(l => l.startsWith('# ')) || file.name.replace(/\.(pdf|txt)$/i, '');
  const name     = nameLine.replace(/^# /, '').trim();
  const timeLine = lines.find(l => /time:|duration:/i.test(l));
  const ingLines = get('ingredients');
  const stepLines= get('steps').filter(l => !l.startsWith('##'));
  return {
    id: 'drive_' + file.id, name,
    cuisine: file.cuisine || 'Other',
    emoji:   guessEmoji(file.cuisine || ''),
    time:    timeLine ? (timeLine.split(':')[1]?.trim() || '—') : '—',
    servings: 4,
    cloudPath:   file.webViewLink || '',
    driveFileId: file.id,
    tags: ['From Drive'],
    ingredients: ingLines.map(l => {
      const m = l.match(/^[-•*]?\s*([\d.\/]+\s*(?:g|kg|ml|l|tsp|tbsp|cup|oz|lb|cloves?|bunch|pinch|large|medium|small|handful)?)\s+(.*)/i);
      return m ? { amount: m[1].trim(), item: m[2].trim() } : { amount: '', item: l.replace(/^[-•*]\s*/, '') };
    }).filter(i => i.item),
    steps: stepLines.map(l => l.replace(/^\d+[.)]\s*/, '')).filter(Boolean),
    nutrition: null,
  };
}

async function aiParseRecipe(text, file) {
  const name = file.name.replace(/\.(pdf|txt)$/i, '');

  // If no text extracted at all, create a placeholder
  if (!text || text.trim().length < 20) {
    return {
      id: 'drive_' + file.id, name,
      cuisine: file.cuisine || 'Other',
      emoji:   guessEmoji(file.cuisine || ''),
      time: '—', servings: 4,
      cloudPath:   file.webViewLink || '',
      driveFileId: file.id,
      tags: ['From Drive', 'Open PDF to view'],
      ingredients: [],
      steps: ['Open the PDF in Google Drive to view the full recipe.'],
      nutrition: null,
    };
  }

  try {
    const raw = await callClaude([{
      role: 'user',
      content: `You are extracting a recipe from PDF text. The text may be messy or jumbled due to PDF extraction — do your best to find the recipe information.

Recipe name from filename: "${name}"
Cuisine folder: "${file.cuisine || 'Unknown'}"

PDF text content:
${text.slice(0, 4000)}

Extract and return ONLY valid JSON (no markdown, no explanation):
{
  "name": "recipe name",
  "time": "cook time or — if unknown",
  "servings": 4,
  "ingredients": [{"amount": "200g", "item": "pasta"}, ...],
  "steps": ["Step 1...", "Step 2...", ...],
  "nutrition": {"calories": 400, "protein": 20, "carbs": 50, "fat": 10}
}

IMPORTANT: 
- If you cannot find ingredients in the text, use your knowledge of "${name}" to suggest typical ingredients
- If you cannot find steps, use your knowledge of "${name}" to suggest typical steps  
- nutrition can be null if not mentioned
- Always return valid JSON even if you have to guess based on the recipe name`
    }]);
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    return {
      id: 'drive_' + file.id,
      name:     parsed.name     || name,
      cuisine:  file.cuisine    || 'Other',
      emoji:    guessEmoji(file.cuisine || ''),
      time:     parsed.time     || '—',
      servings: parsed.servings || 4,
      cloudPath:   file.webViewLink || '',
      driveFileId: file.id,
      tags: ['From Drive'],
      ingredients: parsed.ingredients || [],
      steps:       parsed.steps       || [],
      nutrition:   parsed.nutrition   || null,
    };
  } catch(e) {
    console.warn('AI parse failed for', name, e);
    // Return placeholder — at least the recipe is listed
    return {
      id: 'drive_' + file.id, name,
      cuisine: file.cuisine || 'Other',
      emoji:   guessEmoji(file.cuisine || ''),
      time: '—', servings: 4,
      cloudPath:   file.webViewLink || '',
      driveFileId: file.id,
      tags: ['From Drive'],
      ingredients: [],
      steps: ['Open the PDF in Google Drive to view the full recipe.'],
      nutrition: null,
    };
  }
}

// ── SAVE TO DRIVE ─────────────────────────────────────────────────────────────
async function saveRecipeToDrive(recipe) {
  if (!drive.isSignedIn || !drive.accessToken) {
    showToast('Sign in to Google Drive first');
    return false;
  }

  // Verify token is still valid
  try {
    await gfetch('https://www.googleapis.com/drive/v3/about?fields=user');
  } catch(e) {
    showToast('Drive session expired — please sign in again in Settings');
    drive.isSignedIn = false;
    updateSignInUI(false);
    updateCloudBadge();
    return false;
  }

  try {
    const rootName = (drive.folderPath || 'Recipes').replace(/^\//, '');

    // Find or create Recipes root folder
    let rootFolder = await findOrNull(
      `name='${rootName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    if (!rootFolder) {
      rootFolder = await createFolder(rootName, 'root');
      if (!rootFolder?.id) throw new Error('Could not create Recipes folder in Drive');
    }

    // Find or create cuisine subfolder
    let cuisineFolder = await findOrNull(
      `name='${recipe.cuisine}' and '${rootFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    if (!cuisineFolder) {
      cuisineFolder = await createFolder(recipe.cuisine, rootFolder.id);
      if (!cuisineFolder?.id) throw new Error('Could not create cuisine folder in Drive');
    }

    const content  = buildRecipeText(recipe);
    const fileName = recipe.name.replace(/[/\\?%*:|"<>]/g, '-') + '.txt';

    // Check if file already exists
    const existing = await findOrNull(
      `name='${fileName}' and '${cuisineFolder.id}' in parents and trashed=false`
    );

    let result;
    if (existing) {
      result = await updateDriveFile(existing.id, content);
      recipe.driveFileId = existing.id;
    } else {
      result = await createDriveFile(fileName, content, cuisineFolder.id);
      if (!result?.id) throw new Error('File created but no ID returned from Drive API');
      recipe.driveFileId = result.id;
      recipe.cloudPath   = 'https://drive.google.com/file/d/' + result.id + '/view';
    }

    showToast('"' + recipe.name + '" saved to Drive ✓');
    return true;

  } catch(e) {
    console.error('Save to Drive failed:', e);
    showToast('Drive save failed: ' + e.message);
    return false;
  }
}

function buildRecipeText(recipe) {
  const lines = [
    '# ' + recipe.name,
    'Cuisine: ' + recipe.cuisine,
    'Time: '    + recipe.time,
    'Servings: '+ recipe.servings, '',
    '## Ingredients',
    ...(recipe.ingredients||[]).map(i => '- ' + (i.amount ? i.amount + ' ' : '') + i.item),
    '', '## Steps',
    ...(recipe.steps||[]).map((s, i) => (i+1) + '. ' + s),
  ];
  if (recipe.nutrition) {
    lines.push('', '## Nutrition (per serving)',
      'Calories: ' + recipe.nutrition.calories + 'kcal',
      'Protein: '  + recipe.nutrition.protein  + 'g',
      'Carbs: '    + recipe.nutrition.carbs    + 'g',
      'Fat: '      + recipe.nutrition.fat      + 'g');
  }
  return lines.join('\n');
}

async function createFolder(name, parentId) {
  return gfetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
}

async function createDriveFile(name, content, parentId) {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({
    name, parents: [parentId], mimeType: 'text/plain'
  })], { type: 'application/json' }));
  form.append('file', new Blob([content], { type: 'text/plain' }));

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + drive.accessToken },
      body:    form,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('Create file failed ' + res.status + ': ' + (err.error?.message || res.statusText));
  }
  return res.json();
}

async function updateDriveFile(fileId, content) {
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media',
    {
      method:  'PATCH',
      headers: {
        'Authorization': 'Bearer ' + drive.accessToken,
        'Content-Type':  'text/plain',
      },
      body: content,
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('Update file failed ' + res.status + ': ' + (err.error?.message || res.statusText));
  }
  return res.json();
}

// ── OPEN IN DRIVE ─────────────────────────────────────────────────────────────
function openFileInDrive(recipe) {
  const url = recipe.cloudPath ||
    (recipe.driveFileId ? 'https://drive.google.com/file/d/' + recipe.driveFileId + '/view' : null);
  if (url) window.open(url, '_blank');
  else showToast('No Drive link available for this recipe');
}

// ── RECIPE CACHE ──────────────────────────────────────────────────────────────
function getCachedRecipes() {
  try {
    return JSON.parse(localStorage.getItem('rv_recipe_cache') || '{}');
  } catch(e) { return {}; }
}

function saveCachedRecipes(cache) {
  try {
    // Keep cache under 4MB — drop oldest entries if needed
    const str = JSON.stringify(cache);
    if (str.length < 4 * 1024 * 1024) {
      localStorage.setItem('rv_recipe_cache', str);
    }
  } catch(e) {}
}

function clearRecipeCache() {
  localStorage.removeItem('rv_recipe_cache');
  showToast('Cache cleared — recipes will reload from Drive');
}

function showSyncBar(visible) {
  const bar = document.getElementById('sync-bar');
  if (bar) bar.classList.toggle('hidden', !visible);
}
