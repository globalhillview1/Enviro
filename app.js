/***********************
 * Enviro – app.js (direct-to-GAS version, no CORS preflight)
 ***********************/

// 1) Set your working GAS /exec URL here:
const GAS_EXEC_URL = "https://script.google.com/macros/s/AKfycbw8ta_GdLedTCp1L-I6QKVcJzbJTgy6-3GfBtHMhrCS0ESlXRi5jHVs0v_AFeM6ZICN/exec";

// 2) Token boot logic (unchanged)
const token = localStorage.getItem('enviro_token');
if (!token) {
  if (location.pathname !== '/login.html') location.href = '/login.html';
}

/* ---------------------------
   Low-level helpers to call GAS
   - form posts avoid CORS preflight
---------------------------- */
async function gasPostForm(payload) {
  const body = new URLSearchParams(payload);
  const res = await fetch(GAS_EXEC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  // If GAS returns a non-200, still try to read the JSON for error details
  let data;
  try { data = await res.json(); } catch (_) { data = { ok: false, error: "Bad response" }; }
  return data;
}

/* --------------------------------------------
   Shim your old apiGet/apiPost onto GAS ops
   - apiGet('whoami')        -> op: "sessionInfo"
   - apiGet('stats')         -> op: "data" then compute stats
   - apiGet('issues',{...})  -> op: "data" then map rows
   - apiPost('updateissue')  -> op: "update"
--------------------------------------------- */
async function apiGet(path, params = {}) {
  if (path === "whoami") {
    const r = await gasPostForm({ op: "sessionInfo", token });
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || "Unauthorized" };
    // Normalize to your UI’s expected shape
    return { ok: true, data: r.info || {} };
  }

  if (path === "stats") {
    const r = await gasPostForm({ op: "data" });
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || "Failed to load" };
    const rows = Array.isArray(r.data) ? r.data : [];

    // Compute stats from sheet rows
    let total = rows.length;
    let open = 0, inProgress = 0, resolved = 0;
    let totalMinutes = 0, resolvedCount = 0;
    let ratingSum = 0, ratingCount = 0;

    for (const row of rows) {
      const status = String(row["Status"] || "").toLowerCase().replace(/\s+/g,'');
      if (status === "open") open++;
      else if (status === "inprogress") inProgress++;
      else if (status === "resolved") resolved++;

      const tt = String(row["Time Taken"] || "").trim(); // e.g., "45m" or "1d 19h 37m"
      // Try to parse minutes roughly
      if (tt) {
        let minutes = 0;
        const d = /(\d+)\s*d/.exec(tt); if (d) minutes += parseInt(d[1],10) * 1440;
        const h = /(\d+)\s*h/.exec(tt); if (h) minutes += parseInt(h[1],10) * 60;
        const m = /(\d+)\s*m/.exec(tt); if (m) minutes += parseInt(m[1],10);
        if (minutes > 0) { totalMinutes += minutes; resolvedCount++; }
      }

      const fb = Number(row["Feedback"]);
      if (!Number.isNaN(fb)) { ratingSum += fb; ratingCount++; }
    }

    const avgResolution = (resolvedCount ? Math.round(totalMinutes / resolvedCount) : 0);
    // show like "14h 47m"
    const avgH = Math.floor(avgResolution / 60);
    const avgM = avgResolution % 60;
    const avgResolutionDisplay = (avgH || avgM) ? `${avgH}h ${avgM}m` : "-";

    const avgRating = ratingCount ? (ratingSum / ratingCount).toFixed(1) : "-";

    return {
      ok: true,
      data: {
        total, open, inProgress, resolved,
        avgResolution: avgResolutionDisplay,
        avgRating
      }
    };
  }

  if (path === "issues") {
    const r = await gasPostForm({ op: "data" });
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || "Failed to load" };
    const rows = Array.isArray(r.data) ? r.data : [];
    const limit = Number(params.limit) || 10;

    // Map sheet headers -> UI field names used by your table
    const mapped = rows.slice(0, limit).map(row => ({
      trackingId  : row["Tracking ID"],
      dateRaised  : row["Date and Time Raised"],
      tower       : row["Tower"],
      flat        : row["Flat"],
      issue       : row["Issue"],
      description : row["Description"],
      media       : row["Media"],
      status      : row["Status"],
      remark      : row["Redressal Remark"],
      userId      : row["User ID"],
      dateResolved: row["Date and Time Resolved"],
      timeTaken   : row["Time Taken"],
      feedback    : row["Feedback"],
    }));
    return { ok: true, data: mapped };
  }

  // Unknown path
  return { ok: false, error: `Unknown apiGet path: ${path}` };
}

async function apiPost(path, body = {}) {
  if (path === "updateissue") {
    // GAS expects: op=update, token, id, status, remark
    const payload = {
      op: "update",
      token,
      id: body.trackingId,      // your UI passes trackingId
      status: body.status ?? "",
      remark: body.remark ?? ""
    };
    const r = await gasPostForm(payload);
    return r && typeof r.ok !== "undefined"
      ? r
      : { ok: false, error: "Update failed" };
  }

  // Unknown path
  return { ok: false, error: `Unknown apiPost path: ${path}` };
}

/* ---------------------------
   Rest of your original file
---------------------------- */

// --- helpers for username pill ---
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
}
function userSvg(){
  return `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="7.5" r="4" stroke-width="1.6"></circle>
      <path d="M4.5 19.5a7.5 7.5 0 0115 0" stroke-width="1.6" stroke-linecap="round"></path>
    </svg>`;
}

async function ensureSession(){
  if (!token) {
    if (location.pathname !== '/login.html') location.replace('/login.html');
    return;
  }
  try {
    const res = await apiGet('whoami'); // {ok:true, data:{...}}
    if (!res.ok || !res.data) throw new Error('unauthorized');

    localStorage.setItem('enviro_user', JSON.stringify(res.data));

    const ub = document.getElementById('userBadge');
    if (ub) {
      ub.style.display = 'inline-flex';
      ub.innerHTML = `${userSvg()}<span>${escapeHtml(res.data.username || '')}</span>`;
    }
  } catch (e) {
    localStorage.removeItem('enviro_token');
    localStorage.removeItem('enviro_user');
    if (location.pathname !== '/login.html') location.replace('/login.html');
  }
}

// Immediately verify+render if we have a token
if (token) ensureSession();

// ---- DOM helpers & rest of dashboard code ----
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.substring(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c?.nodeType ? c : document.createTextNode(c));
  return e;
}

async function loadStats() {
  const res = await apiGet('stats');
  if (!res.ok) return;
  const s = res.data;
  document.getElementById('stat-total')?.textContent = s.total ?? '-';
  document.getElementById('stat-open') ?.textContent = s.open ?? '-';
  document.getElementById('stat-inp')  ?.textContent = s.inProgress ?? '-';
  document.getElementById('stat-res')  ?.textContent = s.resolved ?? '-';
  document.getElementById('stat-avg')  ?.textContent = s.avgResolution ?? '-';
  document.getElementById('stat-rate') ?.textContent = s.avgRating ?? '-';
}

function mediaCell(url) {
  if (!url) return document.createTextNode('');
  const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
  if (isImg) {
    const img = el('img', { src: url, class: 'thumb' });
    const a = el('a', { href: url, target: '_blank' });
    a.append(img);
    return a;
  }
  return el('a', { href: url, target: '_blank' }, 'media');
}

function buildRow(r) {
  const statusSel = el('select', { class: 'form-select form-select-sm' },
    ...['Open','InProgress','Resolved'].map(s => {
      const opt = el('option', {}, s);
      if (String(r.status).toLowerCase().replace(' ','') === s.toLowerCase()) opt.selected = true;
      return opt;
    })
  );
  const remarkInput = el('input', { class: 'form-control form-control-sm', value: r.remark || '' });

  const saveBtn = el('button', { class: 'btn btn-sm btn-primary', onclick: async () => {
      saveBtn.disabled = true;
      const payload = {
        trackingId: r.trackingId,
        status: statusSel.value,
        remark: remarkInput.value.trim()
      };
      const res = await apiPost('updateissue', payload);
      saveBtn.disabled = false;
      if (!res.ok) { alert(res.error || 'Failed'); return; }
      await loadStats();
      alert('Saved');
    }}, 'Save');

  const tr = el('tr', {},
    el('td', {}, r.trackingId ?? ''),
    el('td', {}, r.dateRaised ?? ''),
    el('td', {}, r.tower ?? ''),
    el('td', {}, r.flat ?? ''),
    el('td', {}, r.issue ?? ''),
    el('td', {}, r.description ?? ''),
    el('td', {}, mediaCell(r.media)),
    el('td', {}, statusSel),
    el('td', {}, remarkInput),
    el('td', {}, r.userId ?? ''),
    el('td', {}, r.dateResolved ?? ''),
    el('td', {}, r.timeTaken ?? ''),
    el('td', {}, r.feedback ?? ''),
    el('td', {}, saveBtn),
  );
  return tr;
}

async function loadIssues() {
  const rows = Number(document.getElementById('rows')?.value) || 10;
  const res = await apiGet('issues', { limit: rows });
  const tbody = document.getElementById('tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!res.ok || !Array.isArray(res.data)) {
    tbody.append(el('tr', {}, el('td', { colspan: 14, class: 'text-danger' }, res.error || 'Failed to load')));
    return;
  }
  res.data.forEach(r => tbody.appendChild(buildRow(r)));
}

document.getElementById('apply')?.addEventListener('click', loadIssues);
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  localStorage.removeItem('enviro_token');
  localStorage.removeItem('enviro_user');
  location.href = '/login.html';
});

// Initial load (only on dashboard page)
if (document.getElementById('tbody')) {
  loadStats().then(loadIssues);
}
