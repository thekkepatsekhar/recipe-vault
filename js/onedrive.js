// ── RECIPE VAULT — ONEDRIVE INTEGRATION ──────────────────────────────────────

const MICROSOFT_CLIENT_ID = '905544c2-61cd-4199-83fb-b5e3657d7b3e';
const GRAPH_BASE          = 'https://graph.microsoft.com/v1.0';

// Use the /consumers endpoint which only works with personal Microsoft accounts
// This bypasses the "unauthorized_client" error for personal accounts
const MS_AUTH_BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const MS_SCOPE     = 'https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/User.Read offline_access';

const onedrive = {
  accessToken: null,
  userProfile: null,
  isSignedIn:  false,
};

async function initOneDriveAuth() {
  const hash = window.location.hash;
  if (hash && hash.includes('access_token')) {
    const params = new URLSearchParams(hash.slice(1));
    if (params.get('state') !== 'microsoft') return; // Not a Microsoft token
    const token   = params.get('access_token');
    const expires = parseInt(params.get('expires_in') || '3600');
    if (token) {
      onedrive.accessToken = token;
      localStorage.setItem('rv_mstoken', JSON.stringify({
        token,
        expiry: Date.now() + (expires - 60) * 1000,
      }));
      history.replaceState(null, '', window.location.pathname);
      await fetchOneDriveProfile();
      onedrive.isSignedIn = true;
      onOneDriveSignInSuccess();
      return;
    }
  }

  // Try restoring saved token
  try {
    const raw = localStorage.getItem('rv_mstoken');
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.token && saved.expiry > Date.now()) {
        onedrive.accessToken = saved.token;
        try {
          await fetchOneDriveProfile();
          onedrive.isSignedIn = true;
          onOneDriveSignInSuccess();
          return;
        } catch(e) {
          localStorage.removeItem('rv_mstoken');
        }
      } else {
        localStorage.removeItem('rv_mstoken');
      }
    }
  } catch(e) {}

  updateOneDriveUI(false);
}

function signInWithMicrosoft() {
  // Hardcoded redirect URI must match EXACTLY what's in Azure app registration
  const redirectUri = 'https://recipe-vault-88p.pages.dev/app.html';
  const params = new URLSearchParams({
    client_id:     MICROSOFT_CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: 'token',
    scope:         MS_SCOPE,
    prompt:        'select_account',
    state:         'microsoft',
  });
  window.location.href = MS_AUTH_BASE + '/authorize?' + params.toString();
}

// ── SIGN OUT ──────────────────────────────────────────────────────────────────
function signOutMicrosoft() {
  onedrive.accessToken = null;
  onedrive.isSignedIn  = false;
  onedrive.userProfile = null;
  localStorage.removeItem('rv_mstoken');
  updateOneDriveUI(false);
  updateCloudBadge();
  showToast('Signed out of OneDrive');
}

// ── PROFILE ───────────────────────────────────────────────────────────────────
async function fetchOneDriveProfile() {
  const res = await msfetch(GRAPH_BASE + '/me?$select=displayName,mail,userPrincipalName');
  onedrive.userProfile = {
    name:  res.displayName || 'Microsoft User',
    email: res.mail || res.userPrincipalName || '',
  };
}

// ── CALLBACKS ─────────────────────────────────────────────────────────────────
function onOneDriveSignInSuccess() {
  updateOneDriveUI(true);
  updateCloudBadge();
  const banner = document.getElementById('connect-banner');
  if (banner) banner.classList.add('hidden');
  showToast('Signed in to OneDrive ✓');
  // If OneDrive is the selected cloud, sync
  if (localStorage.getItem('rv_active_cloud') === 'onedrive') {
    syncFromOneDrive();
  }
}

// ── UI ────────────────────────────────────────────────────────────────────────
function updateOneDriveUI(signedIn) {
  const btnIn   = document.getElementById('btn-ms-signin');
  const btnOut  = document.getElementById('btn-ms-signout');
  const userBox = document.getElementById('ms-user-box');
  const name    = document.getElementById('ms-user-name');
  const email   = document.getElementById('ms-user-email');

  if (signedIn && onedrive.userProfile) {
    btnIn?.classList.add('hidden');
    btnOut?.classList.remove('hidden');
    userBox?.classList.remove('hidden');
    if (name)  name.textContent  = onedrive.userProfile.name;
    if (email) email.textContent = onedrive.userProfile.email;
  } else {
    btnIn?.classList.remove('hidden');
    btnOut?.classList.add('hidden');
    userBox?.classList.add('hidden');
  }
}

// ── GRAPH API HELPER ──────────────────────────────────────────────────────────
async function msfetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + onedrive.accessToken,
      'Content-Type':  'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('Graph API ' + res.status + ': ' + (err.error?.message || res.statusText));
  }
  if (res.status === 204) return {};
  return res.json();
}

// ── SYNC FROM ONEDRIVE ────────────────────────────────────────────────────────
async function syncFromOneDrive() {
  if (!onedrive.isSignedIn) return;
  showSyncBar(true);

  try {
    const folderName = (localStorage.getItem('rv_folder') || 'Recipes').replace(/^\//, '').trim();

    // Find Recipes folder in OneDrive root
    let recipesFolder;
    try {
      recipesFolder = await msfetch(
        `${GRAPH_BASE}/me/drive/root:/${encodeURIComponent(folderName)}?$select=id,name,webUrl`
      );
    } catch(e) {
      showToast(`No "${folderName}" folder found in OneDrive`);
      showSyncBar(false);
      state.recipes = DEMO_RECIPES;
      buildCuisineChips(); applyFilters();
      return;
    }

    // Get all subfolders (cuisines)
    const subRes  = await msfetch(
      `${GRAPH_BASE}/me/drive/items/${recipesFolder.id}/children?$select=id,name,folder&$filter=folder ne null`
    );
    const subfolders = (subRes.value || []).filter(i => i.folder);

    // Collect all PDF/docx files
    const allFiles = [];

    // Files directly in /Recipes
    const rootFiles = await msfetch(
      `${GRAPH_BASE}/me/drive/items/${recipesFolder.id}/children?$select=id,name,file,webUrl,@microsoft.graph.downloadUrl`
    );
    (rootFiles.value || []).filter(f => f.file).forEach(f => allFiles.push({ ...f, cuisine: 'Other' }));

    // Files in each cuisine subfolder
    for (const sub of subfolders) {
      const files = await msfetch(
        `${GRAPH_BASE}/me/drive/items/${sub.id}/children?$select=id,name,file,webUrl,@microsoft.graph.downloadUrl`
      );
      (files.value || []).filter(f => f.file).forEach(f => allFiles.push({ ...f, cuisine: sub.name }));
    }

    if (allFiles.length === 0) {
      showToast('No recipe files found in OneDrive Recipes folder');
      state.recipes = DEMO_RECIPES;
      buildCuisineChips(); applyFilters();
      showSyncBar(false);
      return;
    }

    // Convert files to recipes using cache + AI
    const recipes = [];
    const cached  = getCachedRecipes();
    const BATCH   = 5;

    for (let i = 0; i < allFiles.length; i += BATCH) {
      const batch = allFiles.slice(i, i + BATCH);
      showToast(`Loading recipes ${i+1}–${Math.min(i+BATCH, allFiles.length)} of ${allFiles.length}…`);
      const results = await Promise.all(batch.map(async file => {
        const cacheKey = 'od_' + file.id;
        if (cached[cacheKey]) return cached[cacheKey];
        try {
          const recipe = await oneDriveFileToRecipe(file);
          if (recipe) cached[cacheKey] = recipe;
          return recipe;
        } catch(e) { return null; }
      }));
      results.forEach(r => { if (r) recipes.push(r); });
    }

    saveCachedRecipes(cached);
    state.recipes = recipes.length > 0 ? recipes : DEMO_RECIPES;

    // Restore custom thumbnails
    state.recipes.forEach(r => {
      const saved = localStorage.getItem('rv_thumb_' + r.id);
      if (saved) r.thumbImage = saved;
    });

    buildCuisineChips();
    applyFilters();
    showToast(`Loaded ${recipes.length} recipe${recipes.length !== 1 ? 's' : ''} from OneDrive ✓`);

  } catch(e) {
    console.error('OneDrive sync error:', e);
    showToast('OneDrive sync failed: ' + e.message);
    state.recipes = DEMO_RECIPES;
    buildCuisineChips(); applyFilters();
  }

  showSyncBar(false);
}

// ── FILE → RECIPE ─────────────────────────────────────────────────────────────
async function oneDriveFileToRecipe(file) {
  const name = file.name.replace(/\.(pdf|txt|docx)$/i, '');
  let text = '';

  try {
    // Download file content
    const downloadUrl = file['@microsoft.graph.downloadUrl'] ||
      `${GRAPH_BASE}/me/drive/items/${file.id}/content`;

    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error('Download failed');

    const mimeType = file.file?.mimeType || '';
    if (mimeType === 'application/pdf') {
      const buffer = await res.arrayBuffer();
      text = extractTextFromPDFBuffer(buffer);
    } else {
      text = await res.text();
    }
  } catch(e) { text = ''; }

  // Try structured parse first
  const structured = parseStructuredRecipe(text, { ...file, name, webViewLink: file.webUrl });
  if (structured) return { ...structured, id: 'od_' + file.id, driveFileId: null, oneDriveId: file.id };

  // AI parse
  try {
    const apiKey = localStorage.getItem('rv_anthropic_key');
    if (!apiKey) {
      // No API key — return placeholder with note
      return {
        id: 'od_' + file.id, name,
        cuisine: file.cuisine || 'Other',
        emoji:   guessEmoji(file.cuisine || ''),
        time: '—', servings: 4,
        cloudPath:  file.webUrl || '',
        oneDriveId: file.id,
        tags: ['From OneDrive', 'Add API key to extract'],
        ingredients: [],
        steps: ['Add your Anthropic API key in Settings to extract ingredients and steps.'],
        nutrition: null,
      };
    }

    const raw = await callClaude([{
      role: 'user',
      content: `Extract this recipe and return ONLY valid JSON (no markdown):
{"name":"","time":"","servings":4,"ingredients":[{"amount":"","item":""}],"steps":[""],"nutrition":null}
Recipe name: "${name}", Cuisine: "${file.cuisine || 'Unknown'}"
PDF text: ${text ? text.slice(0, 3000) : '(use your knowledge of this recipe name)'}`
    }]);
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return {
      id:          'od_' + file.id,
      name:        parsed.name    || name,
      cuisine:     file.cuisine   || 'Other',
      emoji:       guessEmoji(file.cuisine || ''),
      time:        parsed.time    || '—',
      servings:    parsed.servings || 4,
      cloudPath:   file.webUrl    || '',
      oneDriveId:  file.id,
      tags:        ['From OneDrive'],
      ingredients: parsed.ingredients || [],
      steps:       parsed.steps       || [],
      nutrition:   parsed.nutrition   || null,
    };
  } catch(e) {
    return {
      id: 'od_' + file.id, name,
      cuisine: file.cuisine || 'Other',
      emoji:   guessEmoji(file.cuisine || ''),
      time: '—', servings: 4,
      cloudPath:  file.webUrl || '',
      oneDriveId: file.id,
      tags: ['From OneDrive'],
      ingredients: [], steps: ['Open in OneDrive to view the full recipe.'],
      nutrition: null,
    };
  }
}

// ── SAVE RECIPE TO ONEDRIVE ───────────────────────────────────────────────────
async function saveRecipeToOneDrive(recipe) {
  if (!onedrive.isSignedIn || !onedrive.accessToken) {
    showToast('Sign in to OneDrive first');
    return false;
  }

  try {
    const folderName = (localStorage.getItem('rv_folder') || 'Recipes').replace(/^\//, '').trim();
    const fileName   = recipe.name.replace(/[/\\?%*:|"<>]/g, '-') + '.txt';
    const content    = buildRecipeText(recipe);
    const path       = `${folderName}/${recipe.cuisine}/${fileName}`;

    // Upload via simple put — Graph API creates folders automatically
    const res = await fetch(
      `${GRAPH_BASE}/me/drive/root:/${encodeURIComponent(path)}:/content`,
      {
        method:  'PUT',
        headers: {
          'Authorization': 'Bearer ' + onedrive.accessToken,
          'Content-Type':  'text/plain',
        },
        body: content,
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error('Save failed ' + res.status + ': ' + (err.error?.message || res.statusText));
    }

    const data = await res.json();
    recipe.oneDriveId = data.id;
    recipe.cloudPath  = data.webUrl;

    showToast('"' + recipe.name + '" saved to OneDrive ✓');
    return true;
  } catch(e) {
    console.error('OneDrive save failed:', e);
    showToast('OneDrive save failed: ' + e.message);
    return false;
  }
}
