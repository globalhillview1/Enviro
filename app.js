const token = localStorage.getItem('enviro_token');

if (!token) {
  // not signed in
  if (location.pathname !== '/login.html') location.href = '/login.html';
}

async function apiGet(path, params={}) {
  const qs = new URLSearchParams({ ...params, token }).toString();
  const res = await fetch(`/api/${path}?${qs}`, { headers:{'accept':'application/json'} });
  return res.json();
}

async function apiPost(path, body={}) {
  const qs = new URLSearchParams({ token }).toString();
  const res = await fetch(`/api/${path}?${qs}`, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

function el(tag, attrs={}, ...children) {
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.substring(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

async function loadStats() {
  const res = await apiGet('stats');
  if (!res.ok) return;
  const s = res.data;
  document.getElementById('stat-total').textContent = s.total ?? '-';
  document.getElementById('stat-open').textContent  = s.open ?? '-';
  document.getElementById('stat-inp').textContent   = s.inProgress ?? '-';
  document.getElementById('stat-res').textContent   = s.resolved ?? '-';
  document.getElementById('stat-avg').textContent   = s.avgResolution ?? '-';
  document.getElementById('stat-rate').textContent  = s.avgRating ?? '-';
}

function mediaCell(url) {
  if (!url) return document.createTextNode('');
  // Small preview for jpg/png; otherwise link
  const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
  if (isImg) {
    const img = el('img',{src:url, class:'thumb'});
    const a = el('a',{href:url, target:'_blank'});
    a.append(img);
    return a;
  }
  return el('a',{href:url, target:'_blank'}, 'media');
}

function buildRow(r) {
  const statusSel = el('select',{class:'form-select form-select-sm'},
      ...['Open','InProgress','Resolved'].map(s => {
        const opt = el('option',{}, s);
        if (String(r.status).toLowerCase().replace(' ','') === s.toLowerCase()) opt.selected = true;
        return opt;
      })
  );
  const remarkInput = el('input',{class:'form-control form-control-sm', value: r.remark || ''});

  const saveBtn = el('button',{class:'btn btn-sm btn-primary', onclick: async () => {
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

  const tr = el('tr',{},
    el('td',{}, r.trackingId ?? ''),
    el('td',{}, r.dateRaised ?? ''),
    el('td',{}, r.tower ?? ''),
    el('td',{}, r.flat ?? ''),
    el('td',{}, r.issue ?? ''),
    el('td',{}, r.description ?? ''),
    el('td',{}, mediaCell(r.media)),
    el('td',{} , statusSel),
    el('td',{} , remarkInput),
    el('td',{}, r.userId ?? ''),
    el('td',{}, r.dateResolved ?? ''),
    el('td',{}, r.timeTaken ?? ''),
    el('td',{}, r.feedback ?? ''),
    el('td',{}, saveBtn),
  );
  return tr;
}

async function loadIssues() {
  const rows = Number(document.getElementById('rows').value) || 10;
  const res = await apiGet('issues', { limit: rows });
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  if (!res.ok || !Array.isArray(res.data)) {
    tbody.append(el('tr',{}, el('td',{colspan:14,class:'text-danger'}, res.error || 'Failed to load')));
    return;
  }
  res.data.forEach(r => tbody.appendChild(buildRow(r)));
}

document.getElementById('apply').addEventListener('click', loadIssues);
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('enviro_token');
  localStorage.removeItem('enviro_user');
  location.href = '/login.html';
});

// Initial load (only on dashboard page)
if (document.getElementById('tbody')) {
  loadStats().then(loadIssues);
}
