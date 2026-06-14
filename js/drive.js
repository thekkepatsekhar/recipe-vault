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
  // Check if we just came back from Google sign-in
  // Ignore if it's a Microsoft redirect (state=microsoft)
  const hash = window.location.hash;
  if (hash && hash.includes('access_token')) {
    const params = new URLSearchParams(hash.slice(1));
    if (params.get('state') === 'microsoft') return; // Let OneDrive handle it
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

async function findOrNull(query, spaces = 'drive') {
  try {
    const data = await gfetch(
      'https://www.googleapis.com/drive/v3/files?q=' +
      encodeURIComponent(query) +
      '&fields=files(id,name)&pageSize=1&spaces=' + spaces
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

    // Use known Recipes folder ID directly — avoids finding OneDrive folder by mistake
    const RECIPES_FOLDER_ID = '1txHMRLqVaAL4uJjEokPeo17NDdK8XKGj';
    const rootFolder = { id: RECIPES_FOLDER_ID, name: folderName };

    // Find cuisine subfolders
    const subfolders = await listFiles(
      `'${rootFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );

    // Collect all PDF/text files
    const allFiles = [];
    const rootFiles = await listFiles(
      `'${rootFolder.id}' in parents and trashed=false and (mimeType='application/pdf' or mimeType='text/plain' or mimeType='application/vnd.google-apps.document')`
    );
    rootFiles.forEach(f => allFiles.push({ ...f, cuisine: 'Other' }));

    for (const sub of subfolders) {
      const files = await listFiles(
        `'${sub.id}' in parents and trashed=false and (mimeType='application/pdf' or mimeType='text/plain' or mimeType='application/vnd.google-apps.document')`
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

    // Restore any saved custom thumbnails from localStorage
    state.recipes.forEach(r => {
      const saved = localStorage.getItem('rv_thumb_' + r.id);
      if (saved) r.thumbImage = saved;
    });

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
    if (file.mimeType === 'application/pdf' ||
        file.mimeType === 'text/plain' ||
        file.mimeType === 'application/vnd.google-apps.document') {
      text = await extractPDFText(file.id, file.mimeType);
    }
  } catch(e) { text = ''; }

  const structured = parseStructuredRecipe(text, file);
  if (structured) return structured;
  return await aiParseRecipe(text, file);
}

async function extractPDFText(fileId, mimeType) {
  // Google Docs — export as plain text directly
  if (mimeType === 'application/vnd.google-apps.document') {
    try {
      return await gfetchText(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=text/plain'
      );
    } catch(e) { return ''; }
  }

  // Plain text files — download directly
  if (mimeType === 'text/plain') {
    try {
      return await gfetchText(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media'
      );
    } catch(e) { return ''; }
  }

  // PDFs — download and extract text from binary
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media',
      { headers: { 'Authorization': 'Bearer ' + drive.accessToken } }
    );
    if (!res.ok) throw new Error('Download failed: ' + res.status);
    const arrayBuffer = await res.arrayBuffer();
    return extractTextFromPDFBuffer(arrayBuffer);
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

async function saveRecipeToDrive(recipe) {
  if (!drive.isSignedIn || !drive.accessToken) {
    showToast('Sign in to Google Drive first');
    return false;
  }

  try {
    // Verify token
    const aboutRes = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { 'Authorization': 'Bearer ' + drive.accessToken }
    });
    if (!aboutRes.ok) {
      const err = await aboutRes.json().catch(()=>({}));
      throw new Error('Auth failed ' + aboutRes.status + ': ' + (err.error?.message || aboutRes.statusText));
    }

    // Use the known Recipes folder ID directly — no searching needed
    const rootName   = (drive.folderPath || 'Recipes').replace(/^\//, '').trim();
    const RECIPES_FOLDER_ID = '1txHMRLqVaAL4uJjEokPeo17NDdK8XKGj';
    const rootFolder = { id: RECIPES_FOLDER_ID, name: rootName };

    // Find or create cuisine subfolder
    const subRes = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=' +
      encodeURIComponent(`name='${recipe.cuisine}' and '${rootFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`) +
      '&fields=files(id,name)&pageSize=5',
      { headers: { 'Authorization': 'Bearer ' + drive.accessToken } }
    );
    let cuisineFolder = (await subRes.json()).files?.[0] || null;
    if (!cuisineFolder) {
      const cr = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + drive.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: recipe.cuisine, mimeType: 'application/vnd.google-apps.folder', parents: [rootFolder.id] }),
      });
      if (!cr.ok) { const e=await cr.json().catch(()=>({})); throw new Error('Create cuisine folder failed ' + cr.status + ': ' + (e.error?.message||cr.statusText)); }
      cuisineFolder = await cr.json();
    }

    const fileName = recipe.name.replace(/[/\\?%*:|"<>]/g, '-') + '.pdf';

    // Generate PDF using jsPDF
    const pdfBytes = await generateRecipePDF(recipe);
    if (!pdfBytes) throw new Error('Could not generate PDF');

    // Check if file already exists
    const existsRes = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=' +
      encodeURIComponent(`name='${fileName}' and '${cuisineFolder.id}' in parents and trashed=false`) +
      '&fields=files(id)&pageSize=1',
      { headers: { 'Authorization': 'Bearer ' + drive.accessToken } }
    );
    const existsData = await existsRes.json();
    const existing   = existsData.files?.[0] || null;

    let fileData;
    if (existing) {
      // Update existing PDF
      const ur = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files/' + existing.id + '?uploadType=media&fields=id,name,webViewLink',
        { method: 'PATCH', headers: { 'Authorization': 'Bearer ' + drive.accessToken, 'Content-Type': 'application/pdf' }, body: pdfBytes }
      );
      if (!ur.ok) { const e=await ur.json().catch(()=>({})); throw new Error('Update failed ' + ur.status + ': ' + (e.error?.message||ur.statusText)); }
      fileData = { id: existing.id };
    } else {
      // Create new PDF — use supportsAllDrives=false to ensure it lands in user's My Drive
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({
        name:    fileName,
        parents: [cuisineFolder.id],
        mimeType:'application/pdf',
      })], { type: 'application/json' }));
      form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }));
      const fr = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=false',
        { method: 'POST', headers: { 'Authorization': 'Bearer ' + drive.accessToken }, body: form }
      );
      if (!fr.ok) { const e=await fr.json().catch(()=>({})); throw new Error('Upload failed ' + fr.status + ': ' + (e.error?.message||fr.statusText)); }
      fileData = await fr.json();
    }

    recipe.driveFileId = fileData.id;
    recipe.cloudPath   = fileData.webViewLink || 'https://drive.google.com/file/d/' + fileData.id + '/view';

    showToast('"' + recipe.name + '" saved to Drive ✓');
    return true;

  } catch(e) {
    console.error('Drive save failed:', e);
    showToast('Drive save failed: ' + e.message);
    return false;
  }
}

// ── PDF GENERATION ────────────────────────────────────────────────────────────
async function loadJsPDF() {
  if (window.jspdf) return window.jspdf.jsPDF;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = () => resolve(window.jspdf.jsPDF);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function generateRecipePDF(recipe) {
  try {
    const jsPDF = await loadJsPDF();
    const doc   = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 20;
    const colW   = pageW - margin * 2;
    let   y      = margin;

    const checkY = (needed = 8) => { if (y + needed > pageH - margin) { doc.addPage(); y = margin; } };

    // Header bar
    doc.setFillColor(14, 53, 40);
    doc.rect(0, 0, pageW, 28, 'F');
    doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(255,255,255);
    doc.text(recipe.name, margin, 13);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(200,230,216);
    doc.text([recipe.cuisine, recipe.time, (recipe.servings||2)+' servings'].filter(Boolean).join('  ·  '), margin, 21);
    y = 36;
    doc.setTextColor(20,20,20);

    // Tags
    if (recipe.tags && recipe.tags.length) {
      doc.setFontSize(9); doc.setFont('helvetica','italic'); doc.setTextColor(130,130,130);
      doc.text(recipe.tags.join('  ·  '), margin, y); y += 8;
    }

    // Ingredients
    if (recipe.ingredients && recipe.ingredients.length) {
      checkY(12);
      doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(14,53,40);
      doc.text('Ingredients', margin, y); y += 2;
      doc.setDrawColor(14,53,40); doc.setLineWidth(0.5); doc.line(margin, y, margin+colW, y); y += 6;
      recipe.ingredients.forEach(ing => {
        checkY(7);
        if (ing.amount) {
          doc.setFont('helvetica','bold'); doc.setTextColor(232,98,58); doc.setFontSize(10);
          doc.text(ing.amount, margin, y);
          const aw = doc.getTextWidth(ing.amount) + 3;
          doc.setFont('helvetica','normal'); doc.setTextColor(20,20,20);
          const lines = doc.splitTextToSize(ing.item, colW - aw - 2);
          doc.text(lines, margin + aw, y); y += lines.length * 5.5;
        } else {
          doc.setFont('helvetica','normal'); doc.setTextColor(20,20,20); doc.setFontSize(10);
          const lines = doc.splitTextToSize(ing.item, colW);
          doc.text(lines, margin, y); y += lines.length * 5.5;
        }
      });
      y += 5;
    }

    // Method
    if (recipe.steps && recipe.steps.length) {
      checkY(12);
      doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(14,53,40);
      doc.text('Method', margin, y); y += 2;
      doc.setDrawColor(14,53,40); doc.line(margin, y, margin+colW, y); y += 6;
      recipe.steps.forEach((step, i) => {
        checkY(12);
        doc.setFillColor(232,98,58); doc.circle(margin+3, y-1.5, 3, 'F');
        doc.setTextColor(255,255,255); doc.setFontSize(7);
        doc.text(String(i+1), margin+3, y-0.5, {align:'center'});
        doc.setTextColor(20,20,20); doc.setFontSize(10); doc.setFont('helvetica','normal');
        const lines = doc.splitTextToSize(step, colW-10);
        doc.text(lines, margin+9, y); y += lines.length * 5.5 + 3;
      });
      y += 2;
    }

    // Nutrition
    if (recipe.nutrition) {
      checkY(26);
      doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(14,53,40);
      doc.text('Nutrition per serving', margin, y); y += 2;
      doc.setDrawColor(14,53,40); doc.line(margin, y, margin+colW, y); y += 6;
      const nuts = [{label:'Calories',val:recipe.nutrition.calories+' kcal'},{label:'Protein',val:recipe.nutrition.protein+'g'},{label:'Carbs',val:recipe.nutrition.carbs+'g'},{label:'Fat',val:recipe.nutrition.fat+'g'}];
      const bw = (colW-9)/4;
      nuts.forEach((n,i) => {
        const x=margin+i*(bw+3);
        doc.setFillColor(240,248,244); doc.roundedRect(x,y,bw,14,2,2,'F');
        doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(14,53,40);
        doc.text(n.val, x+bw/2, y+7, {align:'center'});
        doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(90,138,116);
        doc.text(n.label, x+bw/2, y+12, {align:'center'});
      });
      y += 18;
    }

    // Footer on each page
    const total = doc.internal.getNumberOfPages();
    for (let p=1; p<=total; p++) {
      doc.setPage(p); doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(150,150,150);
      doc.text('Recipe Vault', margin, pageH-8);
      doc.text('Page '+p+' of '+total, pageW-margin, pageH-8, {align:'right'});
    }

    return doc.output('arraybuffer');
  } catch(e) {
    console.error('PDF generation failed:', e);
    return null;
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
