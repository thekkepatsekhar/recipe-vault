// ── RECIPE VAULT — THEME ENGINE ───────────────────────────────────────────────

const THEME_PRESETS = [
  { name:'Parchment', sidebar:'#1a1208', bg:'#f7f3eb', bgMid:'#ede7d9', bgDeep:'#ddd4c0', accent:'#c98b2a', accentLt:'#f5e4c0', accentDk:'#9b6a18', muted:'#7a6a52', thumb:'#f5e4c0' },
  { name:'Mint',      sidebar:'#0e3528', bg:'#f2faf7', bgMid:'#e0f2ea', bgDeep:'#c8e6d8', accent:'#e8623a', accentLt:'#fde8e1', accentDk:'#b8431e', muted:'#5a8a74', thumb:'#fde8e1' },
  { name:'Ocean',     sidebar:'#0a2540', bg:'#eef4fb', bgMid:'#d8eaf6', bgDeep:'#bdd8f0', accent:'#2563eb', accentLt:'#dbeafe', accentDk:'#1d4ed8', muted:'#4a7fa5', thumb:'#dbeafe' },
  { name:'Slate',     sidebar:'#1e293b', bg:'#f8fafc', bgMid:'#e9eef5', bgDeep:'#d4dde8', accent:'#7c3aed', accentLt:'#ede9fe', accentDk:'#5b21b6', muted:'#64748b', thumb:'#ede9fe' },
  { name:'Forest',    sidebar:'#14532d', bg:'#f0fdf4', bgMid:'#dcfce7', bgDeep:'#bbf7d0', accent:'#16a34a', accentLt:'#dcfce7', accentDk:'#15803d', muted:'#4d8560', thumb:'#dcfce7' },
];

function deriveShades(hex) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  const lighten=(v,a)=>Math.min(255,Math.round(v+(255-v)*a));
  const darken =(v,a)=>Math.max(0,  Math.round(v*(1-a)));
  const toHex  =(r,g,b)=>'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
  return { lt:toHex(lighten(r,.7),lighten(g,.7),lighten(b,.7)), mid:toHex(lighten(r,.5),lighten(g,.5),lighten(b,.5)), dk:toHex(darken(r,.25),darken(g,.25),darken(b,.25)), muted:toHex(lighten(r,.3),lighten(g,.3),lighten(b,.3)) };
}

function applyTheme(theme) {
  const s=document.documentElement.style;
  s.setProperty('--clr-paper',      theme.bg);
  s.setProperty('--clr-paper-mid',  theme.bgMid   || deriveShades(theme.bg).mid);
  s.setProperty('--clr-paper-deep', theme.bgDeep  || deriveShades(theme.bg).dk);
  s.setProperty('--clr-ink',        theme.sidebar);
  s.setProperty('--clr-muted',      theme.muted   || deriveShades(theme.sidebar).muted);
  s.setProperty('--clr-coral',      theme.accent);
  s.setProperty('--clr-coral-lt',   theme.accentLt|| deriveShades(theme.accent).lt);
  s.setProperty('--clr-coral-dk',   theme.accentDk|| deriveShades(theme.accent).dk);
  s.setProperty('--clr-saffron',    theme.accent);
  s.setProperty('--clr-saffron-lt', theme.accentLt|| deriveShades(theme.accent).lt);
  s.setProperty('--clr-saffron-dk', theme.accentDk|| deriveShades(theme.accent).dk);
}

function loadSavedTheme() {
  try {
    const raw=localStorage.getItem('rv_theme');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return THEME_PRESETS[1];
}

function saveTheme(theme) {
  try { localStorage.setItem('rv_theme', JSON.stringify(theme)); } catch(e) {}
}

// Apply on load immediately (no DOM needed — only sets CSS vars)
applyTheme(loadSavedTheme());

// ── THEME EDITOR UI (called when Settings screen opens) ───────────────────────
function buildThemeEditor() {
  const container = document.getElementById('theme-editor');
  if (!container) return;

  let working = Object.assign({}, loadSavedTheme());
  const matchedPreset = THEME_PRESETS.find(p =>
    p.accent===working.accent && p.sidebar===working.sidebar && p.bg===working.bg
  );
  working.name = matchedPreset ? matchedPreset.name : 'Custom';

  function render() {
    container.innerHTML = `
      <div class="te-section">
        <div class="te-label">Presets</div>
        <div class="te-presets">
          ${THEME_PRESETS.map(p=>`
            <button class="te-preset${working.name===p.name?' te-preset-active':''}"
              onclick="themeSelectPreset('${p.name}')" aria-label="${p.name} theme">
              <div class="te-preset-swatch">
                <div class="te-ps-sb" style="background:${p.sidebar}"></div>
                <div class="te-ps-bg" style="background:${p.bg}">
                  <div class="te-ps-dot" style="background:${p.accent}"></div>
                </div>
              </div>
              <div class="te-preset-name">${p.name}</div>
            </button>`).join('')}
        </div>
      </div>

      <div class="te-section">
        <div class="te-label">Custom colors</div>
        <div class="te-color-grid">
          ${[
            {key:'sidebar', label:'Sidebar',    hint:'Navigation color'},
            {key:'bg',      label:'Background', hint:'Main page color'},
            {key:'accent',  label:'Accent',     hint:'Buttons & highlights'},
            {key:'thumb',   label:'Card tint',  hint:'Recipe card fill'},
          ].map(c=>`
            <div class="te-color-row">
              <div class="te-color-info">
                <div class="te-color-name">${c.label}</div>
                <div class="te-color-hint">${c.hint}</div>
              </div>
              <label class="te-swatch-wrap" style="background:${working[c.key]||'#cccccc'}">
                <input type="color" value="${working[c.key]||'#cccccc'}"
                  data-key="${c.key}" class="te-color-input" />
              </label>
            </div>`).join('')}
        </div>
      </div>

      <div class="te-section">
        <div class="te-label">Preview</div>
        <div class="te-preview">
          <div class="te-pv-sb" style="background:${working.sidebar}">
            <div class="te-pv-dot" style="background:${working.accent}"></div>
            <div class="te-pv-dot" style="background:rgba(255,255,255,0.2)"></div>
            <div class="te-pv-dot" style="background:rgba(255,255,255,0.2)"></div>
          </div>
          <div class="te-pv-main" style="background:${working.bg}">
            <div class="te-pv-card">
              <div class="te-pv-thumb" style="background:${working.thumb||working.accentLt||'#eee'}"></div>
              <div class="te-pv-lines">
                <div class="te-pv-line"       style="background:${working.sidebar};opacity:.6"></div>
                <div class="te-pv-line te-pv-short" style="background:${working.sidebar};opacity:.25"></div>
              </div>
            </div>
            <div class="te-pv-card">
              <div class="te-pv-thumb" style="background:${working.thumb||working.accentLt||'#eee'}"></div>
              <div class="te-pv-lines">
                <div class="te-pv-line"       style="background:${working.sidebar};opacity:.6"></div>
                <div class="te-pv-line te-pv-short" style="background:${working.sidebar};opacity:.25"></div>
              </div>
            </div>
            <div class="te-pv-btn" style="background:${working.accent}">🛒 Add</div>
          </div>
        </div>
      </div>

      <div class="te-actions">
        <button class="te-apply-btn" onclick="themeApplyAndSave()">✓ Apply theme</button>
        <button class="te-reset-btn" onclick="themeReset()">Reset to default</button>
      </div>`;

    // Wire color pickers
    container.querySelectorAll('.te-color-input').forEach(input => {
      input.addEventListener('input', e => {
        const key = e.target.dataset.key;
        const val = e.target.value;
        working[key] = val;
        working.name = 'Custom';
        if (key==='accent') { const s=deriveShades(val); working.accentLt=s.lt; working.accentDk=s.dk; }
        if (key==='sidebar'){ working.muted=deriveShades(val).muted; }
        if (key==='bg')     { const s=deriveShades(val); working.bgMid=s.mid; working.bgDeep=s.dk; }
        e.target.parentElement.style.background = val;
        applyTheme(working);
        render();
      });
    });
  }

  // Global handlers (must be on window so inline onclick can reach them)
  window.themeSelectPreset = function(name) {
    const p = THEME_PRESETS.find(p=>p.name===name);
    if (!p) return;
    working = Object.assign({}, p);
    applyTheme(working);
    render();
  };
  window.themeApplyAndSave = function() {
    applyTheme(working);
    saveTheme(working);
    if (typeof showToast==='function') showToast('Theme saved ✓');
  };
  window.themeReset = function() {
    working = Object.assign({}, THEME_PRESETS[1]);
    applyTheme(working);
    saveTheme(working);
    render();
    if (typeof showToast==='function') showToast('Theme reset ✓');
  };

  render();
}
