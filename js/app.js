// ── RECIPE VAULT — APP LOGIC ──────────────────────────────────────────────────

const state = {
  folderPath:      localStorage.getItem('rv_folder') || 'Recipes',
  recipes:         [],
  currentFilter:   'all',
  currentSearch:   '',
  currentRecipe:   null,
  currentServings: 2,
  baseServings:    2,
  shoppingItems:   safeJSON('rv_shopping',   []),
  shoppingRecipes: safeJSON('rv_shopping_recipes', []),
  plannerData:     safeJSON('rv_planner',    {}),
  weekOffset:      0,
  cookSteps:       [],
  cookStepIndex:   0,
  voiceActive:     false,
  speechSynth:     window.speechSynthesis || null,
  speechRecog:     null,
  exportTarget:    localStorage.getItem('rv_export') || 'share',
  isDesktop:       () => window.innerWidth > 768,
  isMobile:        () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
};

function safeJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch(e) { return fallback; }
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const splash = document.getElementById('splash');
    if (splash) splash.classList.add('fade-out');
    setTimeout(bootApp, 500);
  }, 1200);
});

function bootApp() {
  state.recipes = DEMO_RECIPES;
  const app = document.getElementById('app');
  if (app) app.classList.remove('hidden');
  updateCloudBadge();
  buildCuisineChips();
  renderRecipes(state.recipes);
  updateShoppingBadge();
  renderPlannerWeek();
  const fp = document.getElementById('folder-path');
  if (fp) { fp.value = state.folderPath; fp.addEventListener('change', () => { state.folderPath = fp.value.trim().replace(/^\//,''); localStorage.setItem('rv_folder', state.folderPath); }); }
  const exp = document.getElementById('export-target');
  if (exp) { exp.value = state.exportTarget; exp.addEventListener('change', () => { state.exportTarget = exp.value; localStorage.setItem('rv_export', exp.value); }); }
  const keyField = document.getElementById('anthropic-key');
  if (keyField) keyField.value = localStorage.getItem('rv_anthropic_key') || '';
  const gemField = document.getElementById('gemini-key');
  if (gemField) gemField.value = localStorage.getItem('rv_gemini_key') || '';
  initGoogleAuth();
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
function navigate(screen) {
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
  const target = document.getElementById('screen-' + screen);
  if (target) { target.classList.remove('hidden'); target.classList.add('active'); }
  document.querySelectorAll('.sn-item').forEach(b => b.classList.toggle('active', b.dataset.screen === screen));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.screen === screen));
  if (screen === 'shopping') renderShopping();
  if (screen === 'planner')  renderPlannerWeek();
  if (screen === 'settings') renderSettings();
  if (screen !== 'recipes' && !state.isDesktop()) closeDetail();
}

function renderSettings() {
  const status = document.getElementById('cloud-status');
  const sd = (typeof drive !== 'undefined') && drive.isSignedIn;
  if (status) status.textContent = sd ? '✓ Connected as ' + (drive.userProfile?.email||'Google User') : 'Not connected — click Sign in';
  if (typeof updateSignInUI === 'function') updateSignInUI(sd);
  const rc = document.getElementById('sett-recipe-count');
  const mc = document.getElementById('sett-meal-count');
  if (rc) rc.textContent = state.recipes.length + ' recipes';
  if (mc) { const t=Object.values(state.plannerData).reduce((s,a)=>s+a.length,0); mc.textContent=t+' meal'+(t!==1?'s':'')+' planned'; }
  const keyField = document.getElementById('anthropic-key');
  if (keyField) keyField.value = localStorage.getItem('rv_anthropic_key') || '';
  const gemField = document.getElementById('gemini-key');
  if (gemField) {
    gemField.value = localStorage.getItem('rv_gemini_key') || '';
    const gemStatus = document.getElementById('gemini-key-status');
    if (gemStatus) {
      gemStatus.textContent = gemField.value ? '✓ Gemini key active — free AI enabled' : '';
      gemStatus.style.color = 'var(--clr-coral)';
    }
  }
}

// ── CLOUD BADGE ───────────────────────────────────────────────────────────────
function updateCloudBadge() {
  const icon  = document.getElementById('cloud-icon');
  const label = document.getElementById('cloud-label');
  const sd    = (typeof drive !== 'undefined') && drive.isSignedIn;
  if (icon)  icon.textContent  = sd ? '🟢' : '☁️';
  if (label) label.textContent = sd ? (drive.userProfile?.email || 'Google Drive') : 'Sign in to connect';
}

// ── CUISINE CHIPS ─────────────────────────────────────────────────────────────
function buildCuisineChips() {
  const container = document.getElementById('cuisine-chips');
  if (!container) return;
  [...container.querySelectorAll('[data-filter]:not([data-filter="all"])')].forEach(el => el.remove());
  getCuisines().forEach(c => {
    const btn = document.createElement('button');
    btn.className='chip'; btn.dataset.filter=c; btn.textContent=c;
    btn.onclick=()=>setFilter(btn,c);
    container.appendChild(btn);
  });
}

function setFilter(el, filter) {
  document.querySelectorAll('#cuisine-chips .chip').forEach(c=>c.classList.remove('chip-active'));
  if (el) el.classList.add('chip-active');
  state.currentFilter=filter; applyFilters();
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const inp=document.getElementById('search-input');
  if (!inp) return;
  inp.addEventListener('input', e=>{
    state.currentSearch=e.target.value.trim().toLowerCase();
    document.getElementById('search-clear')?.classList.toggle('hidden',!state.currentSearch);
    applyFilters();
  });
});

function clearSearch() {
  const inp=document.getElementById('search-input');
  if (inp) inp.value='';
  state.currentSearch='';
  document.getElementById('search-clear')?.classList.add('hidden');
  applyFilters();
}

function applyFilters() {
  let list=state.recipes;
  if (state.currentFilter&&state.currentFilter!=='all') list=list.filter(r=>r.cuisine===state.currentFilter);
  if (state.currentSearch) {
    const q=state.currentSearch;
    list=list.filter(r=>
      r.name.toLowerCase().includes(q)||
      r.cuisine.toLowerCase().includes(q)||
      (r.ingredients||[]).some(i=>i.item.toLowerCase().includes(q))||
      (r.tags||[]).some(t=>t.toLowerCase().includes(q))
    );
  }
  renderRecipes(list);
}

// ── RECIPE LIST ───────────────────────────────────────────────────────────────
function renderRecipes(list) {
  const grid=document.getElementById('recipe-grid');
  const stEmpty=document.getElementById('recipes-state-empty');
  const stNoRes=document.getElementById('recipes-state-no-results');
  const countLbl=document.getElementById('recipe-count-label');
  if (!grid) return;
  grid.innerHTML=''; stEmpty?.classList.add('hidden'); stNoRes?.classList.add('hidden');
  if (!state.recipes.length){stEmpty?.classList.remove('hidden');return;}
  if (!list.length){stNoRes?.classList.remove('hidden');return;}
  if (countLbl) countLbl.textContent=list.length+' recipe'+(list.length!==1?'s':'');
  list.forEach(recipe=>{
    const card=document.createElement('div');
    card.className='recipe-card'; card.setAttribute('role','listitem'); card.setAttribute('tabindex','0');
    const thumb = recipe.thumbImage
      ? `<img src="${recipe.thumbImage}" style="width:100%;height:100%;object-fit:cover;border-radius:calc(var(--radius-sm) - 2px)" />`
      : (recipe.emoji || '🍽️');
    const madeIt  = getMadeItHistory()[recipe.id];
    const madeBadge = madeIt ? `<span class="made-it-badge">✅ Made ${madeIt.count}×</span>` : '';
    card.innerHTML = `
      <div class="recipe-thumb" style="${recipe.thumbImage ? 'padding:0;overflow:hidden' : ''}">${thumb}</div>
      <div class="recipe-info">
        <div class="recipe-name">${recipe.name}</div>
        <div class="recipe-sub">${recipe.cuisine} · ${recipe.time}${madeBadge}</div>
      </div>
      <span class="recipe-arrow">›</span>`;
    card.onclick=()=>openRecipe(recipe);
    card.onkeydown=e=>{if(e.key==='Enter')openRecipe(recipe);};
    grid.appendChild(card);
  });
}

// ── RECIPE DETAIL ─────────────────────────────────────────────────────────────
function openRecipe(recipe) {
  state.currentRecipe   = recipe;
  state.currentServings = recipe.servings||2;
  state.baseServings    = recipe.servings||2;

  const emojiEl = document.getElementById('detail-emoji');
  if (emojiEl) {
    if (recipe.thumbImage) {
      emojiEl.innerHTML = `<img src="${recipe.thumbImage}" style="width:80px;height:80px;object-fit:cover;border-radius:16px;margin-bottom:4px" />`;
      emojiEl.style.fontSize = '0';
    } else {
      emojiEl.textContent = recipe.emoji || '🍽️';
      emojiEl.style.fontSize = '';
    }
  }
  document.getElementById('detail-name').textContent  = recipe.name;
  document.getElementById('detail-meta-row').textContent = recipe.cuisine+' · '+recipe.time+' · '+(recipe.servings||2)+' servings';

  const tagsEl=document.getElementById('detail-tags');
  if (tagsEl) tagsEl.innerHTML=
    `<span class="tag tag-cuisine">${recipe.cuisine}</span>`+
    `<span class="tag tag-time">⏱ ${recipe.time}</span>`+
    (recipe.tags||[]).map(t=>`<span class="tag tag-other">${t}</span>`).join('');

  renderIngredients();
  renderNutrition(recipe.nutrition);
  renderSteps(recipe.steps);
  updateMadeItButton();

  // Show/hide save to drive button
  const btnSave = document.getElementById('btn-save-drive');
  const btnOpen = document.getElementById('btn-open-drive');
  const isImported = (recipe.tags||[]).includes('Imported') && !recipe.driveFileId;
  if (btnSave) btnSave.classList.toggle('hidden', !isImported);
  if (btnOpen) btnOpen.classList.toggle('hidden', isImported);

  const panel=document.getElementById('detail-panel');
  if (!panel) return;

  if (state.isDesktop()) {
    panel.classList.remove('hidden');
    panel.style.cssText='';
  } else {
    // FIX: Use viewport units so it works in portrait on all phones
    panel.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:150;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:80px;';
    panel.classList.remove('hidden');
    panel.scrollTop=0;
  }
}

function closeDetail() {
  const panel=document.getElementById('detail-panel');
  if (!panel) return;
  panel.classList.add('hidden');
  panel.style.cssText='';
  state.currentRecipe=null;
}

function renderIngredients() {
  const list=document.getElementById('ingredient-list');
  if (!list||!state.currentRecipe) return;
  const ratio=state.currentServings/state.baseServings;
  const ings=state.currentRecipe.ingredients||[];
  if (ings.length===0) {
    list.innerHTML=`<li style="padding:12px 0;text-align:center;color:var(--clr-muted);font-size:14px;list-style:none">
      No ingredients extracted yet.${state.currentRecipe.driveFileId
        ?'<br><button onclick="reExtractCurrentRecipe()" class="btn-primary" style="margin-top:10px;font-size:13px;padding:8px 16px">✨ Extract with AI</button>'
        :''}</li>`;
  } else {
    list.innerHTML=ings.map(i=>
      `<li class="ingredient-item"><span class="ingredient-amount">${scaleAmount(i.amount||'',ratio)}</span><span>${i.item}</span></li>`
    ).join('');
  }
  const sn=document.getElementById('serving-num');
  if (sn) sn.textContent=state.currentServings;
}

function scaleAmount(amount,ratio) {
  if (ratio===1||!amount) return amount;
  const match=amount.match(/^([\d.\/]+)\s*(.*)/);
  if (!match) return amount;
  let num=match[1].includes('/')?eval(match[1]):parseFloat(match[1]);
  const unit=match[2];
  const scaled=num*ratio;
  const display=scaled%1===0?scaled.toFixed(0):scaled.toFixed(1).replace(/\.0$/,'');
  return display+(unit?' '+unit:'');
}

function changeServings(delta) {
  const next=state.currentServings+delta;
  if (next<1||next>20) return;
  state.currentServings=next;
  renderIngredients();
  renderNutrition(state.currentRecipe?.nutrition);
}

function renderNutrition(nut) {
  const sec=document.getElementById('nutrition-section');
  if (!nut){sec?.classList.add('hidden');return;}
  sec?.classList.remove('hidden');
  const ratio=state.currentServings/state.baseServings;
  const n=v=>Math.round(v*ratio);
  const grid=document.getElementById('nutrition-grid');
  if (grid) grid.innerHTML=[
    {val:n(nut.calories),label:'kcal'},{val:n(nut.protein)+'g',label:'protein'},
    {val:n(nut.carbs)+'g',label:'carbs'},{val:n(nut.fat)+'g',label:'fat'},
  ].map(item=>`<div class="nut-card"><div class="nut-val">${item.val}</div><div class="nut-label">${item.label}</div></div>`).join('');
}

function renderSteps(steps) {
  const list=document.getElementById('steps-list');
  if (!list) return;
  list.innerHTML=(steps&&steps.length)
    ?steps.map(s=>`<li class="step-item">${s}</li>`).join('')
    :'<li style="color:var(--clr-muted);font-size:14px;list-style:none;padding:8px 0">No steps extracted yet.</li>';
}

// ── IN-APP VIEWER ─────────────────────────────────────────────────────────────
function printCurrentRecipe() {
  if (!state.currentRecipe) return;
  const r     = state.currentRecipe;
  const ratio = state.currentServings / state.baseServings;

  const scaleAmt = (amount) => {
    if (ratio === 1 || !amount) return amount;
    const match = amount.match(/^([\d.\/]+)\s*(.*)/);
    if (!match) return amount;
    let num = match[1].includes('/') ? eval(match[1]) : parseFloat(match[1]);
    const scaled = num * ratio;
    const display = scaled % 1 === 0 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '');
    return display + (match[2] ? ' ' + match[2] : '');
  };

  const ings = (r.ingredients || []).map(i =>
    `<tr><td class="amt">${scaleAmt(i.amount || '')}</td><td>${i.item}</td></tr>`
  ).join('');

  const steps = (r.steps || []).map((s, i) =>
    `<div class="step"><div class="step-num">${i + 1}</div><div class="step-text">${s}</div></div>`
  ).join('');

  const nutrition = r.nutrition ? `
    <div class="section-title">Nutrition per serving</div>
    <div class="nut-grid">
      <div class="nut-box"><div class="nut-val">${Math.round(r.nutrition.calories * ratio)}</div><div class="nut-lbl">kcal</div></div>
      <div class="nut-box"><div class="nut-val">${Math.round(r.nutrition.protein * ratio)}g</div><div class="nut-lbl">protein</div></div>
      <div class="nut-box"><div class="nut-val">${Math.round(r.nutrition.carbs * ratio)}g</div><div class="nut-lbl">carbs</div></div>
      <div class="nut-box"><div class="nut-val">${Math.round(r.nutrition.fat * ratio)}g</div><div class="nut-lbl">fat</div></div>
    </div>` : '';

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${r.name} — Recipe Vault</title>
  <link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;font-size:14px;color:#1a1a1a;max-width:680px;margin:0 auto;padding:20px}
    .header{background:#0e3528;color:white;padding:20px 24px;border-radius:12px;margin-bottom:20px}
    .emoji{font-size:40px;margin-bottom:8px}
    h1{font-family:'Lora',serif;font-size:26px;font-weight:600;margin-bottom:6px}
    .meta{font-size:13px;color:rgba(255,255,255,0.65)}
    .tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
    .tag{background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.85);font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:.04em}
    .section-title{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#5a8a74;margin:20px 0 10px;padding-bottom:6px;border-bottom:1.5px solid #c8e6d8}
    table{width:100%;border-collapse:collapse}
    td{padding:6px 4px;border-bottom:1px solid #e8f4ee;vertical-align:top;font-size:14px}
    td.amt{font-weight:600;color:#e8623a;width:90px;white-space:nowrap}
    .step{display:flex;gap:12px;margin-bottom:12px;align-items:flex-start}
    .step-num{min-width:26px;height:26px;border-radius:50%;background:#e8623a;color:white;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
    .step-text{line-height:1.65;font-size:14px}
    .nut-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
    .nut-box{background:#f2faf7;border-radius:8px;padding:10px 8px;text-align:center}
    .nut-val{font-size:16px;font-weight:600;color:#0e3528}
    .nut-lbl{font-size:11px;color:#5a8a74;margin-top:2px}
    .footer{margin-top:24px;padding-top:12px;border-top:1px solid #e0f2ea;font-size:11px;color:#aaa;text-align:center}
    @media print{
      body{padding:0;max-width:100%}
      .no-print{display:none}
      @page{margin:1.5cm}
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="emoji">${r.emoji || '🍽️'}</div>
    <h1>${r.name}</h1>
    <div class="meta">${[r.cuisine, r.time, state.currentServings + ' servings'].filter(Boolean).join('  ·  ')}</div>
    ${(r.tags || []).length ? `<div class="tags">${r.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
  </div>

  <button class="no-print" onclick="window.print()" style="background:#e8623a;color:white;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:16px;width:100%">
    🖨️ Print / Save as PDF
  </button>

  ${ings ? `<div class="section-title">Ingredients</div><table>${ings}</table>` : ''}
  ${steps ? `<div class="section-title">Method</div>${steps}` : ''}
  ${nutrition}

  <div class="footer">Recipe Vault · ${r.name}</div>

  <script>
    // Auto-trigger print dialog after fonts load
    window.onload = () => setTimeout(() => window.print(), 500);
  </script>
</body>
</html>`);
  win.document.close();
}

function openInCloud() {
  if (!state.currentRecipe) return;
  const recipe=state.currentRecipe;
  const hasContent=(recipe.steps&&recipe.steps.length>0&&recipe.steps[0]!=='Open the PDF in Google Drive to view the full recipe.')||(recipe.ingredients&&recipe.ingredients.length>0);
  if (hasContent) {
    document.getElementById('steps-section')?.scrollIntoView({behavior:'smooth',block:'start'});
    showToast('Recipe content shown above ↑');
  } else if (recipe.cloudPath||recipe.driveFileId) {
    const url=recipe.cloudPath||(recipe.driveFileId?'https://drive.google.com/file/d/'+recipe.driveFileId+'/view':null);
    if (url) window.open(url,'_blank');
  }
}

function addToPlannerFromDetail() {
  if (!state.currentRecipe) return;
  const el=document.getElementById('modal-recipe-name');
  if (el) el.textContent=state.currentRecipe.name;
  state.pendingRecipeForPlan=state.currentRecipe.id;
  buildDayPicker(state.currentRecipe.id);
  document.getElementById('add-to-day-modal')?.classList.remove('hidden');
}

// ── RE-EXTRACT ────────────────────────────────────────────────────────────────
async function reExtractCurrentRecipe() {
  if (!state.currentRecipe||!state.currentRecipe.driveFileId) return;
  showToast('Extracting recipe with AI…');
  try {
    const text=await extractPDFText(state.currentRecipe.driveFileId);
    const raw=await callClaude([{
      role:'user',
      content:`Extract this recipe and return ONLY valid JSON (no markdown):
{"name":"","time":"","servings":4,"ingredients":[{"amount":"","item":""}],"steps":[""],"nutrition":null}
Recipe name: "${state.currentRecipe.name}"
Cuisine: "${state.currentRecipe.cuisine}"
PDF text: ${text||'(no text — use your knowledge of this recipe name)'}
IMPORTANT: If PDF text is missing, use culinary knowledge to fill in typical ingredients and steps for "${state.currentRecipe.name}".`
    }]);
    const parsed=JSON.parse(raw.replace(/```json|```/g,'').trim());
    state.currentRecipe.ingredients=parsed.ingredients||[];
    state.currentRecipe.steps=parsed.steps||[];
    state.currentRecipe.nutrition=parsed.nutrition||null;
    if (parsed.time&&parsed.time!=='—') state.currentRecipe.time=parsed.time;
    if (parsed.servings){state.currentRecipe.servings=parsed.servings;state.baseServings=parsed.servings;state.currentServings=parsed.servings;}
    const idx=state.recipes.findIndex(r=>r.id===state.currentRecipe.id);
    if (idx!==-1) state.recipes[idx]={...state.recipes[idx],...state.currentRecipe};
    const cache=getCachedRecipes();
    cache['drive_'+state.currentRecipe.driveFileId]=state.currentRecipe;
    saveCachedRecipes(cache);
    renderIngredients();renderSteps(state.currentRecipe.steps);renderNutrition(state.currentRecipe.nutrition);
    showToast('Recipe extracted ✓');
  } catch(e) {
    console.error('Re-extract failed:',e);
    showToast('Extraction failed: '+e.message);
  }
}

// ── COOK MODE ─────────────────────────────────────────────────────────────────
// ── WAKE LOCK — keeps screen on during cooking mode ───────────────────────────
let _wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) {
    console.log('Wake Lock API not supported on this browser');
    return;
  }
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    console.log('Screen wake lock active ✓');
    _wakeLock.addEventListener('release', () => {
      console.log('Wake lock was released');
    });
  } catch(e) {
    console.warn('Wake lock request failed:', e.message);
  }
}

function releaseWakeLock() {
  if (_wakeLock) {
    _wakeLock.release().catch(()=>{});
    _wakeLock = null;
  }
}

// Re-acquire wake lock if the tab becomes visible again while cooking
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' &&
      !document.getElementById('screen-cook')?.classList.contains('hidden')) {
    requestWakeLock();
  }
});

function startCookMode() {
  if (!state.currentRecipe) return;
  state.cookSteps=state.currentRecipe.steps||[];
  state.cookStepIndex=0;
  const cn=document.getElementById('cook-recipe-name');
  if (cn) cn.textContent=state.currentRecipe.name;
  document.getElementById('screen-cook')?.classList.remove('hidden');
  renderCookStep();
  requestWakeLock();
}
function renderCookStep() {
  const steps=state.cookSteps,idx=state.cookStepIndex,total=steps.length;
  const txt=document.getElementById('cook-step-text');
  const lbl=document.getElementById('progress-label');
  const bar=document.getElementById('progress-fill');
  const prev=document.getElementById('btn-prev-step');
  const next=document.getElementById('btn-next-step');
  if (txt) txt.textContent=steps[idx]||'';
  if (lbl) lbl.textContent=`Step ${idx+1} of ${total}`;
  if (bar) bar.style.width=((idx+1)/total*100)+'%';
  if (prev) prev.disabled=idx===0;
  if (next) next.textContent=idx===total-1?'✓ Done':'Next →';
  if (state.voiceActive&&document.getElementById('voice-read')?.checked) speakStep(steps[idx]);
}
function changeStep(delta) {
  const next=state.cookStepIndex+delta;
  if (next<0) return;
  if (next>=state.cookSteps.length){stopCookMode();return;}
  state.cookStepIndex=next;renderCookStep();
}
function stopCookMode() {
  if (state.voiceActive) stopVoice();
  state.speechSynth?.cancel();
  releaseWakeLock();
  document.getElementById('screen-cook')?.classList.add('hidden');
}

// ── VOICE ─────────────────────────────────────────────────────────────────────
function toggleVoice(){state.voiceActive?stopVoice():startVoice();}
function startVoice(){
  state.voiceActive=true;
  const btn=document.getElementById('voice-toggle');if(btn)btn.textContent='🎙️ Voice on';
  const hint=document.getElementById('voice-hint');if(hint)hint.style.display='block';
  if(document.getElementById('voice-read')?.checked)speakStep(state.cookSteps[state.cookStepIndex]);
  if(document.getElementById('voice-listen')?.checked)startRecognition();
}
function stopVoice(){
  state.voiceActive=false;
  const btn=document.getElementById('voice-toggle');if(btn)btn.textContent='🔇 Voice off';
  const hint=document.getElementById('voice-hint');if(hint)hint.style.display='none';
  state.speechSynth?.cancel();
  try{state.speechRecog?.stop();}catch(e){}
}
function speakStep(text){
  if(!state.speechSynth||!text)return;
  state.speechSynth.cancel();
  const utt=new SpeechSynthesisUtterance(text);utt.rate=0.9;utt.pitch=1;
  state.speechSynth.speak(utt);
}
function startRecognition(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return;
  const r=new SR();r.continuous=true;r.interimResults=false;r.lang='en-US';
  state.speechRecog=r;
  r.onresult=e=>{
    const t=e.results[e.results.length-1][0].transcript.toLowerCase().trim();
    if(t.includes('next')||t.includes('continue'))changeStep(1);
    else if(t.includes('back')||t.includes('previous'))changeStep(-1);
    else if(t.includes('repeat')||t.includes('again'))speakStep(state.cookSteps[state.cookStepIndex]);
    else if(t.includes('stop')||t.includes('exit'))stopCookMode();
  };
  r.onerror=e=>{if(e.error!=='no-speech')console.warn(e.error);};
  r.onend=()=>{if(state.voiceActive)try{r.start();}catch(e){}};
  try{r.start();}catch(e){}
}

// ── SHOPPING LIST ─────────────────────────────────────────────────────────────
function addToShoppingList() {
  if (!state.currentRecipe){showToast('Please open a recipe first');return;}
  const recipe=state.currentRecipe;
  const ratio=state.currentServings/state.baseServings;
  if (!recipe.ingredients||recipe.ingredients.length===0){showToast('No ingredients found for this recipe');return;}
  state.shoppingItems=state.shoppingItems.filter(i=>i.recipeId!==recipe.id);
  state.shoppingRecipes=state.shoppingRecipes.filter(n=>n!==recipe.name);
  recipe.ingredients.forEach(ing=>{
    state.shoppingItems.push({id:Math.random().toString(36).slice(2),recipeId:recipe.id,recipeName:recipe.name,text:scaleAmount(ing.amount||'',ratio)+' '+ing.item,checked:false});
  });
  if(!state.shoppingRecipes.includes(recipe.name))state.shoppingRecipes.push(recipe.name);
  saveShoppingList();updateShoppingBadge();
  showToast('Added '+recipe.ingredients.length+' items to shopping list ✓');
}
function saveShoppingList(){
  localStorage.setItem('rv_shopping',JSON.stringify(state.shoppingItems));
  localStorage.setItem('rv_shopping_recipes',JSON.stringify(state.shoppingRecipes));
}
function updateShoppingBadge(){
  const n=state.shoppingItems.filter(i=>!i.checked).length;
  ['list-badge','list-badge-mobile'].forEach(id=>{const el=document.getElementById(id);if(!el)return;el.textContent=n;el.classList.toggle('hidden',n===0);});
}
function renderShopping(){
  const emptyEl=document.getElementById('shopping-empty');
  const contentEl=document.getElementById('shopping-content');
  const sourceEl=document.getElementById('shopping-source-row');
  const listEl=document.getElementById('shopping-list');
  if(!listEl)return;
  if(!state.shoppingItems.length){emptyEl?.classList.remove('hidden');contentEl?.classList.add('hidden');return;}
  emptyEl?.classList.add('hidden');contentEl?.classList.remove('hidden');
  if(sourceEl)sourceEl.textContent='From: '+(state.shoppingRecipes.join(', ')||'—');
  listEl.innerHTML=state.shoppingItems.map(item=>`
    <li class="shopping-item${item.checked?' checked':''}" onclick="toggleShoppingItem('${item.id}')">
      <div class="shopping-check"></div>
      <div><div class="shopping-item-text">${item.text}</div><div class="shopping-item-recipe">${item.recipeName}</div></div>
    </li>`).join('');
}
function toggleShoppingItem(id){
  const item=state.shoppingItems.find(i=>i.id===id);
  if(item)item.checked=!item.checked;
  saveShoppingList();updateShoppingBadge();renderShopping();
}
function clearChecked(){
  state.shoppingItems=state.shoppingItems.filter(i=>!i.checked);
  const rem=new Set(state.shoppingItems.map(i=>i.recipeName));
  state.shoppingRecipes=state.shoppingRecipes.filter(n=>rem.has(n));
  saveShoppingList();updateShoppingBadge();renderShopping();
}
function exportShoppingList(){
  if(!state.shoppingItems.length){showToast('Nothing to export yet');return;}
  const lines=['🛒 Shopping List — Recipe Vault','Recipes: '+state.shoppingRecipes.join(', '),''];
  state.shoppingItems.filter(i=>!i.checked).forEach(i=>lines.push('☐ '+i.text));
  const checked=state.shoppingItems.filter(i=>i.checked);
  if(checked.length){lines.push('','Already have:');checked.forEach(i=>lines.push('✓ '+i.text));}
  const text=lines.join('\n');
  if(state.exportTarget==='share'){
    if(state.isMobile()&&navigator.share){
      navigator.share({title:'🛒 Shopping List',text}).catch(err=>{if(err.name!=='AbortError')copyToClipboard(text);});
    } else {
      copyToClipboard(text);
    }
  } else if(state.exportTarget==='keep'){
    copyToClipboard(text,false);showExportModal();
  } else {
    copyToClipboard(text);
  }
}
function copyToClipboard(text,showMsg=true){
  if(navigator.clipboard){
    navigator.clipboard.writeText(text).then(()=>{if(showMsg)showToast('Shopping list copied ✓');}).catch(()=>fallbackCopy(text,showMsg));
  } else {fallbackCopy(text,showMsg);}
}
function fallbackCopy(text,showMsg=true){
  const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;top:-999px;left:-999px;opacity:0';
  document.body.appendChild(ta);ta.focus();ta.select();
  try{document.execCommand('copy');if(showMsg)showToast('Copied ✓');}catch(e){}
  document.body.removeChild(ta);
}
function showExportModal(){
  let modal=document.getElementById('export-modal');
  if(!modal){
    modal=document.createElement('div');modal.id='export-modal';modal.className='modal-overlay';
    modal.innerHTML=`<div class="modal-card" style="text-align:center">
      <div style="font-size:40px;margin-bottom:12px">📋</div>
      <h3 class="modal-title">List copied!</h3>
      <p class="modal-sub">Your shopping list is on your clipboard. Open Google Keep, create a new note, and tap <strong>Paste</strong>.</p>
      <button class="btn-primary full-width" onclick="window.open('https://keep.google.com','_blank');closeModal('export-modal')">Open Google Keep</button>
      <button class="btn-ghost full-width" style="margin-top:8px" onclick="closeModal('export-modal')">Done</button>
    </div>`;
    modal.onclick=e=>{if(e.target===modal)modal.classList.add('hidden');};
    document.body.appendChild(modal);
  }
  modal.classList.remove('hidden');
}

// ── MEAL PLANNER ─────────────────────────────────────────────────────────────
function getWeekDates(offset){const now=new Date(),start=new Date(now);start.setDate(now.getDate()-now.getDay()+1+offset*7);return Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return d;});}
function shiftWeek(delta){state.weekOffset+=delta;renderPlannerWeek();}
function renderPlannerWeek(){
  const days=getWeekDates(state.weekOffset);
  const labelEl=document.getElementById('week-label');
  const container=document.getElementById('day-list');
  if(!container)return;
  if(labelEl){if(state.weekOffset===0)labelEl.textContent='This week';else if(state.weekOffset===1)labelEl.textContent='Next week';else if(state.weekOffset===-1)labelEl.textContent='Last week';else labelEl.textContent='Week of '+days[0].toLocaleDateString('en-US',{month:'short',day:'numeric'});}
  const dayNames=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  container.innerHTML=days.map((d,i)=>{
    const key=d.toISOString().slice(0,10);const meals=state.plannerData[key]||[];const today=d.toDateString()===new Date().toDateString();
    return `<div class="day-card${today?' day-today':''}">
      <div class="day-header"><div class="day-name">${dayNames[i]}${today?' · Today':''}</div><div class="day-date">${d.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div></div>
      <div class="day-meals">${meals.length===0?'<div class="day-empty">No meals planned</div>':meals.map((m,mi)=>`<div class="day-meal-item"><span class="day-meal-emoji">${m.emoji||'🍽️'}</span><span class="day-meal-name">${m.name}</span><button class="day-meal-remove" onclick="removeMealFromDay('${key}',${mi})">✕</button></div>`).join('')}</div>
      <button class="day-add-btn" onclick="openAddToDayModal('${key}')">+ Add recipe</button>
    </div>`;
  }).join('');
}
function openAddToDayModal(dateKey){
  state.pendingDayKey=dateKey;state.pendingRecipeForPlan=null;
  const el=document.getElementById('modal-recipe-name');if(el)el.textContent='this day';
  buildDayPicker(null);document.getElementById('add-to-day-modal')?.classList.remove('hidden');
}
function buildDayPicker(recipeId){
  const picker=document.getElementById('day-picker');if(!picker)return;
  const days=getWeekDates(state.weekOffset);
  const dayNames=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const rId=recipeId||state.pendingRecipeForPlan;
  if(rId){
    picker.innerHTML=days.map((d,i)=>{const key=d.toISOString().slice(0,10);const count=(state.plannerData[key]||[]).length;return `<button class="day-pick-btn" onclick="addMealToDay('${key}','${rId}')"><span>${dayNames[i]} <span style="color:var(--clr-muted);font-size:12px">${d.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span></span><span class="day-pick-count">${count} meal${count!==1?'s':''}</span></button>`;}).join('');
  } else {
    picker.innerHTML=state.recipes.map(r=>`<button class="day-pick-btn" onclick="addMealToDay('${state.pendingDayKey}','${r.id}')"><span>${r.emoji||'🍽️'} ${r.name}</span><span class="day-pick-count">${r.cuisine}</span></button>`).join('');
  }
}
function addMealToDay(dateKey,recipeId){
  const recipe=state.recipes.find(r=>r.id===recipeId);if(!recipe)return;
  if(!state.plannerData[dateKey])state.plannerData[dateKey]=[];
  state.plannerData[dateKey].push({id:recipe.id,name:recipe.name,emoji:recipe.emoji||'🍽️'});
  localStorage.setItem('rv_planner',JSON.stringify(state.plannerData));
  closeModal('add-to-day-modal');renderPlannerWeek();showToast(recipe.name+' added ✓');
}
function removeMealFromDay(dateKey,index){
  if(!state.plannerData[dateKey])return;
  state.plannerData[dateKey].splice(index,1);
  localStorage.setItem('rv_planner',JSON.stringify(state.plannerData));renderPlannerWeek();
}
function buildPlannerList(){document.getElementById('planner-list-modal')?.classList.remove('hidden');}
function generatePlannerList(mode){
  closeModal('planner-list-modal');
  const days=getWeekDates(state.weekOffset);const dayNames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  state.shoppingItems=[];state.shoppingRecipes=[];
  if(mode==='combined'){
    const ids=new Set();days.forEach(d=>(state.plannerData[d.toISOString().slice(0,10)]||[]).forEach(m=>ids.add(m.id)));
    if(!ids.size){showToast('No meals planned this week');return;}
    ids.forEach(id=>{const r=state.recipes.find(r=>r.id===id);if(!r)return;(r.ingredients||[]).forEach(ing=>state.shoppingItems.push({id:Math.random().toString(36).slice(2),recipeId:r.id,recipeName:r.name,text:(ing.amount||'')+' '+ing.item,checked:false}));state.shoppingRecipes.push(r.name);});
  } else {
    days.forEach((d,i)=>{(state.plannerData[d.toISOString().slice(0,10)]||[]).forEach(m=>{const r=state.recipes.find(r=>r.id===m.id);if(!r)return;(r.ingredients||[]).forEach(ing=>state.shoppingItems.push({id:Math.random().toString(36).slice(2),recipeId:r.id,recipeName:dayNames[i]+': '+r.name,text:(ing.amount||'')+' '+ing.item,checked:false}));if(!state.shoppingRecipes.includes(r.name))state.shoppingRecipes.push(r.name);});});
  }
  saveShoppingList();updateShoppingBadge();navigate('shopping');showToast('Shopping list ready ✓');
}

// ── IMPORT ────────────────────────────────────────────────────────────────────
async function extractRecipe() {
  const urlInput = document.getElementById('import-url');
  const url = urlInput?.value.trim();
  if (!url) { urlInput?.focus(); showToast('Please enter a URL'); return; }

  document.getElementById('import-loading')?.classList.remove('hidden');
  document.getElementById('import-error')?.classList.add('hidden');
  document.getElementById('import-preview')?.classList.add('hidden');
  const btn = document.getElementById('btn-extract');
  if (btn) btn.disabled = true;

  try {
    let prompt;

    // Check if it's a YouTube URL — fetch content differently
    const isYouTube = /youtube\.com|youtu\.be/i.test(url);

    if (isYouTube) {
      // Extract video ID from URL
      const videoId = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/)?.[1] || '';
      prompt = `A user wants to import a recipe from this YouTube video: ${url}
${videoId ? `Video ID: ${videoId}` : ''}

YouTube videos cannot be accessed directly, so use your knowledge to identify this recipe.
Look at the URL for clues about the video title or channel.

Return ONLY valid JSON (no markdown, no explanation):
{"name":"","cuisine":"","time":"","servings":4,"ingredients":[{"amount":"","item":""}],"steps":[""]}

If you cannot identify the specific recipe, make your best guess based on any clues in the URL, or create a template with placeholder values the user can edit.`;
    } else {
      // For regular websites, try to fetch the page content
      let pageContent = '';
      try { pageContent = await fetchPageContent(url); } catch(e) {}
      prompt = pageContent
        ? `Extract the recipe from this webpage. Return ONLY valid JSON (no markdown):
{"name":"","cuisine":"","time":"","servings":4,"ingredients":[{"amount":"","item":""}],"steps":[""]}
URL: ${url}
Page content: ${pageContent}`
        : `Extract or guess the recipe from this URL. Return ONLY valid JSON (no markdown):
{"name":"","cuisine":"","time":"","servings":4,"ingredients":[{"amount":"","item":""}],"steps":[""]}
URL: ${url}`;
    }

    const recipe = await importRecipeFromURL(prompt);

    document.getElementById('imp-name')        && (document.getElementById('imp-name').value        = recipe.name     || '');
    document.getElementById('imp-cuisine')     && (document.getElementById('imp-cuisine').value     = recipe.cuisine  || '');
    document.getElementById('imp-time')        && (document.getElementById('imp-time').value        = recipe.time     || '');
    document.getElementById('imp-servings')    && (document.getElementById('imp-servings').value    = recipe.servings || 4);
    document.getElementById('imp-ingredients') && (document.getElementById('imp-ingredients').value = (recipe.ingredients||[]).map(i => (i.amount ? i.amount + ' ' : '') + i.item).join('\n'));
    document.getElementById('imp-steps')       && (document.getElementById('imp-steps').value       = (recipe.steps||[]).join('\n'));
    document.getElementById('import-preview')?.classList.remove('hidden');

    if (isYouTube) {
      showToast('Recipe guessed from YouTube URL — please review and edit ✓');
    } else {
      showToast('Recipe extracted ✓ — review and save');
    }

  } catch(err) {
    console.error('Import error:', err);
    const el = document.getElementById('import-error');
    if (el) {
      el.textContent = 'Could not extract automatically. Fill in the details below and save manually.';
      el.classList.remove('hidden');
    }
    document.getElementById('import-preview')?.classList.remove('hidden');
  } finally {
    document.getElementById('import-loading')?.classList.add('hidden');
    if (btn) btn.disabled = false;
  }
}

async function saveImportedRecipe() {
  const name    =(document.getElementById('imp-name')?.value||'').trim();
  const cuisine =(document.getElementById('imp-cuisine')?.value||'').trim()||'Other';
  const time    =(document.getElementById('imp-time')?.value||'').trim();
  const servings=parseInt(document.getElementById('imp-servings')?.value||'4')||4;
  const ings    =(document.getElementById('imp-ingredients')?.value||'').trim().split('\n').filter(Boolean);
  const steps   =(document.getElementById('imp-steps')?.value||'').trim().split('\n').filter(Boolean);
  if(!name){document.getElementById('imp-name')?.focus();showToast('Please enter a recipe name');return;}
  const newRecipe={
    id:'imported_'+Date.now(),name,cuisine,emoji:guessEmoji(cuisine),
    time:time||'Unknown',servings,cloudPath:'',tags:['Imported'],
    ingredients:ings.map(line=>{const m=line.match(/^([\d.\/]+\s*(?:g|kg|ml|l|tsp|tbsp|cup|oz|lb|cloves?|bunch|pinch|large|medium|small|handful)?)\s+(.*)/i);return m?{amount:m[1].trim(),item:m[2].trim()}:{amount:'',item:line};}),
    steps,nutrition:null,
  };
  state.recipes.unshift(newRecipe);
  buildCuisineChips();applyFilters();
  resetImport();navigate('recipes');

  // Save to Google Drive
  if (typeof saveRecipeToDrive === 'function' && drive?.isSignedIn) {
    showToast('Saving "' + name + '" to Google Drive…');
    try { await saveRecipeToDrive(newRecipe); } catch(e) { showToast('Drive save failed: ' + e.message); }
  } else {
    showToast('"' + name + '" saved locally. Sign in to Drive to sync.');
  }
}

function guessEmoji(cuisine){
  const map={italian:'🍝',mexican:'🌮',japanese:'🍣',chinese:'🥢',indian:'🍛',french:'🥐',thai:'🍜',vietnamese:'🍜',american:'🍔',greek:'🫒',spanish:'🥘',korean:'🍱',bread:'🍞',dessert:'🍰',soup:'🍲',salad:'🥗',seafood:'🐟'};
  return map[(cuisine||'').toLowerCase()]||'🍽️';
}
function resetImport(){
  const url=document.getElementById('import-url');if(url)url.value='';
  document.getElementById('import-preview')?.classList.add('hidden');
  document.getElementById('import-error')?.classList.add('hidden');
}

// ── SAVE CURRENT RECIPE TO DRIVE ──────────────────────────────────────────────
async function saveCurrentRecipeToDrive() {
  if(!state.currentRecipe)return;
  if(!drive?.isSignedIn){showToast('Sign in to Google Drive first');navigate('settings');return;}
  const btn=document.getElementById('btn-save-drive');
  if(btn)btn.textContent='⏳ Saving…';
  try {
    const ok=await saveRecipeToDrive(state.currentRecipe);
    if(ok){
      state.currentRecipe.tags=(state.currentRecipe.tags||[]).filter(t=>t!=='Imported');
      state.currentRecipe.tags.push('From Drive');
      const idx=state.recipes.findIndex(r=>r.id===state.currentRecipe.id);
      if(idx!==-1)state.recipes[idx]={...state.currentRecipe};
      if(btn)btn.classList.add('hidden');
      document.getElementById('btn-open-drive')?.classList.remove('hidden');
    }
  } catch(e){
    showToast('Save failed: '+e.message);
    if(btn)btn.textContent='☁️ Save to Google Drive';
  }
}

// ── EDIT RECIPE ───────────────────────────────────────────────────────────────
const FOOD_EMOJIS = ['🍝','🍛','🌮','🍣','🍕','🥘','🍜','🥗','🍲','🥩','🍗','🐟','🦐','🥚','🥞','🍞','🥐','🥨','🧀','🥦','🫕','🍱','🥟','🦪','🍤','🌯','🫔','🥙','🧆','🥜','🍖','🍔','🌭','🫙','🧂','🫚','🥫','🍿','🧁','🎂','🍰','🍮','🍭','🍫','🍩','🍪','🍨','🍧','🧇','🫓'];

let editThumbValue = null; // stores emoji string or base64 image data

function openEditRecipeModal() {
  if (!state.currentRecipe) return;
  const r = state.currentRecipe;

  // Set current thumbnail
  editThumbValue = r.thumbImage || r.emoji || '🍽️';
  updateThumbPreview();

  // Build emoji picker
  const picker = document.getElementById('emoji-picker');
  if (picker) {
    picker.innerHTML = FOOD_EMOJIS.map(e =>
      `<button onclick="selectThumbEmoji('${e}')" style="font-size:22px;padding:4px;border-radius:6px;background:transparent;border:1.5px solid transparent;cursor:pointer;transition:all .12s" 
       title="${e}">${e}</button>`
    ).join('');
  }

  document.getElementById('edit-name').value        = r.name        || '';
  document.getElementById('edit-cuisine').value     = r.cuisine     || '';
  document.getElementById('edit-time').value        = r.time        || '';
  document.getElementById('edit-servings').value    = r.servings    || 4;
  document.getElementById('edit-tags').value        = (r.tags||[]).join(', ');
  document.getElementById('edit-ingredients').value = (r.ingredients||[]).map(i => (i.amount ? i.amount + ' ' : '') + i.item).join('\n');
  document.getElementById('edit-steps').value       = (r.steps||[]).join('\n');

  document.getElementById('edit-recipe-modal').classList.remove('hidden');
}

function updateThumbPreview() {
  const preview = document.getElementById('edit-thumb-preview');
  if (!preview) return;
  if (editThumbValue && editThumbValue.startsWith('data:')) {
    // Photo
    preview.innerHTML = `<img src="${editThumbValue}" style="width:100%;height:100%;object-fit:cover;border-radius:10px" />`;
  } else {
    // Emoji
    preview.textContent = editThumbValue || '🍽️';
  }
}

function selectThumbEmoji(emoji) {
  editThumbValue = emoji;
  updateThumbPreview();
  // Highlight selected
  document.querySelectorAll('#emoji-picker button').forEach(btn => {
    btn.style.borderColor = btn.textContent === emoji ? 'var(--clr-coral)' : 'transparent';
    btn.style.background  = btn.textContent === emoji ? 'var(--clr-coral-lt)' : 'transparent';
  });
}

function handleThumbUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please select an image file'); return; }
  if (file.size > 2 * 1024 * 1024) { showToast('Image must be under 2MB'); return; }

  const reader = new FileReader();
  reader.onload = e => {
    // Resize image to max 200x200 to keep storage small
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size   = Math.min(img.width, img.height, 200);
      canvas.width  = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      // Centre-crop
      const sx = (img.width  - size) / 2;
      const sy = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
      editThumbValue = canvas.toDataURL('image/jpeg', 0.8);
      updateThumbPreview();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function saveEditedRecipe() {
  if(!state.currentRecipe)return;
  const name    =document.getElementById('edit-name').value.trim();
  const cuisine =document.getElementById('edit-cuisine').value.trim()||'Other';
  const time    =document.getElementById('edit-time').value.trim();
  const servings=parseInt(document.getElementById('edit-servings').value)||4;
  const tagsRaw =document.getElementById('edit-tags').value.trim();
  const tags    =tagsRaw?tagsRaw.split(',').map(t=>t.trim()).filter(Boolean):[];
  const ingsRaw =document.getElementById('edit-ingredients').value.trim().split('\n').filter(Boolean);
  const stepsRaw=document.getElementById('edit-steps').value.trim().split('\n').filter(Boolean);
  if(!name){document.getElementById('edit-name')?.focus();showToast('Name is required');return;}
  const ingredients=ingsRaw.map(line=>{const m=line.match(/^([\d.\/]+\s*(?:g|kg|ml|l|tsp|tbsp|cup|oz|lb|cloves?|bunch|pinch|large|medium|small|handful)?)\s+(.*)/i);return m?{amount:m[1].trim(),item:m[2].trim()}:{amount:'',item:line};});
  const updated = {
    ...state.currentRecipe,
    name, cuisine, time, servings, tags, ingredients,
    steps:      stepsRaw,
    emoji:      (editThumbValue && !editThumbValue.startsWith('data:')) ? editThumbValue : (state.currentRecipe.emoji || guessEmoji(cuisine)),
    thumbImage: (editThumbValue && editThumbValue.startsWith('data:'))  ? editThumbValue : null,
  };
  state.currentRecipe = updated;
  const idx = state.recipes.findIndex(r => r.id === updated.id);
  if (idx !== -1) state.recipes[idx] = updated;

  // Save thumbnail to localStorage (keyed by recipe ID)
  if (updated.thumbImage) {
    try { localStorage.setItem('rv_thumb_' + updated.id, updated.thumbImage); } catch(e) {}
  } else {
    localStorage.removeItem('rv_thumb_' + updated.id);
  }

  if (updated.driveFileId) {const cache=getCachedRecipes();cache['drive_'+updated.driveFileId]=updated;saveCachedRecipes(cache);}
  document.getElementById('detail-name').textContent     =updated.name;
  document.getElementById('detail-emoji').textContent    =updated.emoji;
  document.getElementById('detail-meta-row').textContent =updated.cuisine+' · '+updated.time+' · '+updated.servings+' servings';
  const tagsEl=document.getElementById('detail-tags');
  if(tagsEl)tagsEl.innerHTML=`<span class="tag tag-cuisine">${updated.cuisine}</span><span class="tag tag-time">⏱ ${updated.time}</span>`+tags.map(t=>`<span class="tag tag-other">${t}</span>`).join('');
  renderIngredients();renderSteps(updated.steps);buildCuisineChips();applyFilters();
  closeModal('edit-recipe-modal');
  if(typeof saveRecipeToDrive==='function'&&drive?.isSignedIn){showToast('Saving changes to Drive…');try{await saveRecipeToDrive(updated);}catch(e){showToast('Saved locally — Drive sync failed');}}
  else{showToast('Recipe updated ✓');}
}

// ── DELETE RECIPE ─────────────────────────────────────────────────────────────
function confirmDeleteRecipe() {
  if(!state.currentRecipe)return;
  const r=state.currentRecipe;
  document.getElementById('delete-recipe-name').textContent=r.name;
  const driveOpt=document.getElementById('delete-drive-option');
  const hasFile=!!(r.driveFileId||r.cloudPath);
  if(driveOpt)driveOpt.style.display=hasFile?'block':'none';
  const cb=document.getElementById('delete-from-drive');if(cb)cb.checked=false;
  document.getElementById('delete-recipe-modal').classList.remove('hidden');
}

async function executeDeleteRecipe() {
  if(!state.currentRecipe)return;
  const r=state.currentRecipe;
  const deleteFromDrive=document.getElementById('delete-from-drive')?.checked;
  closeModal('delete-recipe-modal');
  state.recipes=state.recipes.filter(recipe=>recipe.id!==r.id);
  if(r.driveFileId){const cache=getCachedRecipes();delete cache['drive_'+r.driveFileId];saveCachedRecipes(cache);}
  state.shoppingItems=state.shoppingItems.filter(i=>i.recipeId!==r.id);
  state.shoppingRecipes=state.shoppingRecipes.filter(n=>n!==r.name);
  saveShoppingList();updateShoppingBadge();
  Object.keys(state.plannerData).forEach(day=>{state.plannerData[day]=state.plannerData[day].filter(m=>m.id!==r.id);});
  localStorage.setItem('rv_planner',JSON.stringify(state.plannerData));
  if(deleteFromDrive&&r.driveFileId&&drive?.isSignedIn){
    try{await gfetch('https://www.googleapis.com/drive/v3/files/'+r.driveFileId,{method:'DELETE'});showToast('"'+r.name+'" deleted from Drive ✓');}
    catch(e){showToast('Removed from app — Drive delete failed');}
  } else {showToast('"'+r.name+'" removed ✓');}
  closeDetail();buildCuisineChips();applyFilters();
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function saveGeminiKey() {
  const field = document.getElementById('gemini-key');
  if (!field) return;
  const key = field.value.trim();
  if (!key) {
    localStorage.removeItem('rv_gemini_key');
    showToast('Gemini key cleared');
    return;
  }
  if (!key.startsWith('AIza')) { showToast('Gemini key should start with AIza'); return; }
  localStorage.setItem('rv_gemini_key', key);
  const status = document.getElementById('gemini-key-status');
  if (status) { status.textContent = '✓ Gemini key active — free AI enabled'; status.style.color = 'var(--clr-coral)'; }
  showToast('Gemini key saved ✓ — free AI active!');
}

function saveAnthropicKey(){
  const field=document.getElementById('anthropic-key');if(!field)return;
  const key=field.value.trim();
  if(!key){showToast('Please enter your API key');return;}
  if(!key.startsWith('sk-ant-')){showToast('Key should start with sk-ant-');return;}
  localStorage.setItem('rv_anthropic_key',key);
  showToast('API key saved ✓ — AI features now active');
}
function resync() {
  if (typeof syncFromDrive === 'function' && drive?.isSignedIn) {
    syncFromDrive();
  } else {
    showToast('Sign in to Google Drive first');
    navigate('settings');
  }
}
function connectCloud(){}
function switchCloud(){}
function updateSettingsCloud(){renderSettings();}
function updateSettingsStats(){renderSettings();}

// ── MADE IT ───────────────────────────────────────────────────────────────────
function getMadeItHistory() {
  try { return JSON.parse(localStorage.getItem('rv_made_it') || '{}'); } catch(e) { return {}; }
}

function saveMadeItHistory(history) {
  try { localStorage.setItem('rv_made_it', JSON.stringify(history)); } catch(e) {}
}

function markAsMade() {
  if (!state.currentRecipe) return;
  const id      = state.currentRecipe.id;
  const history = getMadeItHistory();
  if (!history[id]) history[id] = { count: 0, dates: [] };
  history[id].count++;
  history[id].last = new Date().toISOString();
  history[id].dates.unshift(new Date().toISOString());
  history[id].dates = history[id].dates.slice(0, 10); // keep last 10
  saveMadeItHistory(history);
  updateMadeItButton();
  applyFilters(); // refresh cards to show updated badge
  showToast('Cooked ' + history[id].count + ' time' + (history[id].count !== 1 ? 's' : '') + '! ✅');
}

function updateMadeItButton() {
  if (!state.currentRecipe) return;
  const history = getMadeItHistory();
  const record  = history[state.currentRecipe.id];
  const btn     = document.getElementById('btn-made-it');
  const info    = document.getElementById('made-it-info');
  if (!btn) return;
  if (record && record.last) {
    const date  = new Date(record.last);
    const label = date.toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' });
    btn.innerHTML = '✅ Made it again!';
    btn.style.cssText = 'background:var(--clr-paper-mid);color:var(--clr-ink);border-color:var(--clr-border-mid)';
    if (info) info.textContent = 'Last made: ' + label + ' · ' + record.count + ' time' + (record.count !== 1 ? 's' : '');
  } else {
    btn.innerHTML = '✅ Mark as made';
    btn.style.cssText = '';
    if (info) info.textContent = '';
  }
}

// ── MODALS ────────────────────────────────────────────────────────────────────
function closeModal(id){document.getElementById(id)?.classList.add('hidden');}
document.addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))e.target.classList.add('hidden');});

// ── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(msg){
  let t=document.getElementById('rv-toast');
  if(!t){
    t=document.createElement('div');t.id='rv-toast';
    Object.assign(t.style,{position:'fixed',bottom:'80px',left:'50%',transform:'translateX(-50%)',background:'var(--clr-ink)',color:'var(--clr-paper)',padding:'10px 22px',borderRadius:'24px',fontSize:'14px',fontWeight:'500',zIndex:'9999',whiteSpace:'nowrap',transition:'opacity .3s',fontFamily:'var(--font-ui)',boxShadow:'0 4px 20px rgba(0,0,0,.3)',pointerEvents:'none',maxWidth:'90vw',textAlign:'center'});
    document.body.appendChild(t);
  }
  t.textContent=msg;t.style.opacity='1';
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>{t.style.opacity='0';},2800);
}
