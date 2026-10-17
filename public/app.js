const $ = (s) => document.querySelector(s);
let data = { apps: [], devices: [], history: [], daily: [] };
let ready = false;
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = s => s ? new Date(s).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'Never';
const apiBase = window.NITRATE_CONFIG.api;
async function api(path, options = {}) {
  const r = await fetch(apiBase + path, { credentials:'include', ...options, headers: { 'Content-Type':'application/json', ...options.headers } });
  let body; try { body = await r.json(); } catch { throw new Error('The API returned an unexpected response.'); }
  if (!r.ok) { if (r.status === 401 && ready) location.reload(); throw new Error(body.error || 'Request failed.'); }
  return body;
}
function notice(message) { $('#notice').textContent = message; $('#notice').hidden = !message; }
function page() {
  const name = ['overview','apps','devices','push','history'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  document.querySelectorAll('[data-view]').forEach(el => el.hidden = el.dataset.view !== name);
  document.querySelectorAll('[data-page]').forEach(el => el.classList.toggle('active',el.dataset.page === name));
  $('#breadcrumb').textContent = {overview:'Overview',apps:'Applications',devices:'Devices',push:'Push studio',history:'Activity log'}[name];
}
window.addEventListener('hashchange',page);
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => location.hash = b.dataset.go);
$('#discord').onclick = () => { location.href = apiBase + '/auth/discord'; };
$('#logout').onclick = async () => { try { await api('/auth/logout',{method:'POST'}); location.href = location.pathname; } catch(e) { notice(e.message); } };
function appCard(app) {
  return `<article class="app-card"><div class="app-top"><div class="app-icon" style="--app-color:${escapeHTML(app.color)}">${escapeHTML(app.name[0])}</div><div><h3>${escapeHTML(app.name)}</h3><small>${escapeHTML(app.platform)}</small></div><span class="app-arrow">↗</span></div><div class="connection ${app.connected ? 'connected' : ''}">${app.connected ? '● Receiving data' : '○ Integration not connected'}</div><div class="app-card-bottom"><span>Active · 7 days<strong>${app.connected ? app.active : '—'}</strong></span><span>Devices<strong>${app.devices}</strong></span><button data-compose="${escapeHTML(app.id)}">Test push ↗</button></div></article>`;
}
function renderApps() {
  const query = $('#app-search').value.toLowerCase();
  $('#all-apps').innerHTML = data.apps.filter(a=>a.name.toLowerCase().includes(query)).map(appCard).join('');
  $('#overview-apps').innerHTML = data.apps.slice(0,6).map(appCard).join('');
  document.querySelectorAll('[data-compose]').forEach(b=>b.onclick=()=> { $('#push-app').value=b.dataset.compose; updateAudience(); preview(); location.hash='push'; });
}
function eligibleDevices() { return data.devices.filter(d=>d.app_id===$('#push-app').value && d.environment===$('#push-environment').value && d.enabled); }
function targets() { const all = eligibleDevices(); const audience = $('#push-audience').value; return all.filter(d=>audience==='all' || (audience==='mine' ? d.mine : document.querySelector(`[data-target="${CSS.escape(d.id)}"]`)?.checked)); }
function updateAudience() {
  const selected = new Set([...document.querySelectorAll('[data-target]:checked')].map(x=>x.dataset.target));
  $('#push-devices').hidden = $('#push-audience').value !== 'selected';
  $('#push-devices').innerHTML = eligibleDevices().map(d=>`<label><input type="checkbox" data-target="${escapeHTML(d.id)}" ${selected.has(d.id)?'checked':''}> ${escapeHTML(d.label || d.model || 'Unnamed device')} ${d.mine?'· yours':''}</label>`).join('') || '<span class="muted">No devices in this environment.</span>';
  document.querySelectorAll('[data-target]').forEach(x=>x.onchange=audienceCount);
  audienceCount();
}
function audienceCount() { const count = targets().length; $('#audience-count').textContent = `${count} eligible device${count===1?'':'s'} · ${$('#push-environment').selectedOptions[0].text}`; $('#review-push').disabled = !count; }
function preview() {
  const app = data.apps.find(a=>a.id===$('#push-app').value);
  $('#preview-app').textContent=app?.name.toUpperCase() || 'APPLICATION';
  $('#preview-icon').textContent=app?.name[0] || 'N';
  $('#preview-title').textContent=$('#push-title').value || 'Your notification title';
  $('#preview-body').textContent=$('#push-body').value || 'Your message will appear here. A small preview of what’s on its way.';
  $('#title-count').textContent=`${$('#push-title').value.length} / 100`;
  $('#body-count').textContent=`${$('#push-body').value.length} / 1000`;
}
function renderDevices() {
  const devices = data.devices.filter(d=>(!$('#device-app').value || d.app_id===$('#device-app').value) && ($('#device-group').value!=='mine' || d.mine));
  $('#device-empty').hidden=devices.length>0;
  $('#device-rows').innerHTML=devices.map(d=>`<tr><td>${escapeHTML(d.model || 'Apple device')}${d.enabled?'':' · disabled'}</td><td>${escapeHTML(data.apps.find(a=>a.id===d.app_id)?.name)}</td><td>${escapeHTML(d.environment)}</td><td>${escapeHTML(date(d.last_seen))}</td><td><input type="checkbox" aria-label="Mark ${escapeHTML(d.model)} as my device" data-mine="${escapeHTML(d.id)}" ${d.mine?'checked':''}></td><td><input type="text" maxlength="80" aria-label="Device label" data-label="${escapeHTML(d.id)}" value="${escapeHTML(d.label)}"></td></tr>`).join('');
  document.querySelectorAll('[data-mine],[data-label]').forEach(el=>el.onchange=async()=>{
    const id=el.dataset.mine || el.dataset.label; const device=data.devices.find(d=>d.id===id);
    const body = el.dataset.mine ? {mine:el.checked} : {label:el.value};
    try { await api('/api/devices/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(body)}); Object.assign(device,body); updateAudience(); notice('Device updated.'); }
    catch(e) { notice(e.message); renderDevices(); }
  });
}
function render() {
  $('#nav-count').textContent = data.apps.length;
  $('#app-count').textContent = String(data.apps.length).padStart(2,'0');
  $('#stat-apps').textContent = data.apps.length;
  $('#stat-devices').textContent = data.devices.filter(d=>d.enabled).length;
  $('#stat-active').textContent = data.apps.some(a=>a.connected) ? data.apps.reduce((s,a)=>s+a.active,0) : '—';
  $('#stat-pushes').textContent = data.accepted7d;
  const max = Math.max(1,...data.daily.map(d=>d.count));
  $('#chart').classList.toggle('empty',!data.daily.some(d=>d.count));
  $('#chart').innerHTML = data.daily.some(d=>d.count) ? data.daily.map(d=>`<div class="bar-group" title="${escapeHTML(d.day)}: ${d.count} events"><div class="bar" style="height:${Math.max(1,d.count/max*90)}%"></div><span>${escapeHTML(new Date(d.day+'T12:00:00Z').toLocaleDateString(undefined,{weekday:'short',timeZone:'UTC'}))}</span></div>`).join('') : 'No activity reported yet. Connect an app to get started.';
  const options = data.apps.map(a=>`<option value="${escapeHTML(a.id)}">${escapeHTML(a.name)}</option>`).join('');
  const current = $('#push-app').value;
  $('#push-app').innerHTML=options; if (current) $('#push-app').value=current;
  $('#device-app').innerHTML='<option value="">All applications</option>'+options;
  $('#history-empty').hidden=data.history.length>0;
  $('#history-rows').innerHTML=data.history.map(h=>`<tr><td>${escapeHTML(h.title)}<br><span class="muted">${escapeHTML(h.status)}</span></td><td>${escapeHTML(data.apps.find(a=>a.id===h.app_id)?.name)}</td><td>${escapeHTML(h.audience)} · ${h.total}</td><td>${h.accepted}</td><td>${h.failed} / ${h.unknown}</td><td>${escapeHTML(date(h.created_at))}</td></tr>`).join('');
  renderApps(); renderDevices(); updateAudience(); preview();
}
$('#app-search').oninput=renderApps;
$('#device-app').onchange=renderDevices; $('#device-group').onchange=renderDevices;
['push-app','push-environment','push-audience'].forEach(id=>$('#'+id).onchange=()=>{updateAudience();preview();});
['push-title','push-body'].forEach(id=>$('#'+id).oninput=preview);
$('#push-form').onsubmit=async(e)=>{
  e.preventDefault();
  const chosen = targets(); if(!chosen.length)return;
  const request={appId:$('#push-app').value,environment:$('#push-environment').value,audience:$('#push-audience').value,deviceIds:chosen.map(d=>d.id),title:$('#push-title').value.trim(),body:$('#push-body').value.trim(),sound:$('#push-sound').checked};
  if(!request.title || !request.body)return;
  $('#confirm-summary').textContent=`${data.apps.find(a=>a.id===request.appId)?.name} · ${request.environment} · ${chosen.length} device${chosen.length===1?'':'s'} · ${$('#push-audience').selectedOptions[0].text}`;
  $('#confirm-title').textContent=request.title; $('#confirm-body').textContent=request.body;
  const dialog=$('#confirm'); dialog.returnValue='cancel'; dialog.showModal();
  dialog.onclose=async()=>{
    if(dialog.returnValue!=='send')return;
    $('#review-push').disabled=true;
    try {
      const result=await api('/api/push',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(request)});
      notice(`APNs accepted ${result.accepted} of ${result.total}. Failed: ${result.failed}. Unknown: ${result.unknown}. Acceptance does not confirm device delivery.`);
      data=await api('/api/overview');render();location.hash='history';
    }catch(err){notice(err.message);}finally{audienceCount();}
  };
};
(async()=>{
  $('#today').textContent=new Date().toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
  const error = new URLSearchParams(location.search).get('error');
  if(error){$('#login-status').textContent=error==='denied'?'Permission denied. This workspace is restricted to its owner.':'Discord sign-in could not be completed. Please try again.';history.replaceState(null,'',location.pathname);}
  try{
    const session=await api('/auth/me');
    $('#username').textContent=session.username;data=await api('/api/overview');ready=true;
    render();page();$('#login').hidden=true;$('#dashboard').hidden=false;
  }catch(e){if(!error)$('#login-status').textContent=e.message==='Authentication required'?'Owner access only · Discord authentication':'API not connected yet. Sign-in will be available after backend setup.';}
})();
