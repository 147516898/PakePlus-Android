/* SECTION: app-bootstrap — 全局状态与视图调度 */
'use strict';

let state = loadState();
seedBillsIfNeeded(state);
saveState(state);

let currentView = 'reminders';
let showDoneReminders = false;
const houseFilter = { q: '', status: 'all' };
const tenantFilter = { q: '', lease: 'all' };
const CYCLE_MONTHS = { '月付': 1, '季付': 3, '半年付': 6, '年付': 12 };

const $root = () => document.getElementById('view-root');

function commit() { saveState(state); rerender(); }

function rerender() {
  renderNav();
  renderBadge();
  const map = { reminders: renderReminders, houses: renderHouses, tenants: renderTenants, bills: renderBills };
  (map[currentView] || renderReminders)();
}

/* SECTION: helpers — 徽标、日期胶囊 */
function statusBadge(s) {
  const cls = { vacant: 'b-vacant', rented: 'b-rented', maintenance: 'b-maint' }[s] || 'b-vacant';
  const txt = { vacant: '空置', rented: '在租', maintenance: '维修中' }[s] || s;
  return `<span class="badge ${cls}">${txt}</span>`;
}
function daysChip(left) {
  if (left < 0) return `<span class="chip chip-red">已逾期 ${-left} 天</span>`;
  if (left === 0) return `<span class="chip chip-red">今天到期</span>`;
  if (left <= REMIND_DAYS) return `<span class="chip chip-orange">${left} 天后</span>`;
  return `<span class="chip chip-gray">${left} 天后</span>`;
}
function leaseChip(endDate) {
  const left = diffDays(todayStr(), endDate);
  if (left < 0) return `<span class="chip chip-red">已到期</span>`;
  if (left <= 30) return `<span class="chip chip-orange">剩 ${left} 天</span>`;
  return `<span class="chip chip-green">剩 ${left} 天</span>`;
}
const TYPE_ICON = { rent: '💰', 'rent-overdue': '⏰', lease: '📄', 'lease-expired': '⚠️' };

function renderNav() {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === currentView));
}
function renderBadge() {
  const n = buildReminders(state).filter(r => !r.done).length;
  const b = document.getElementById('nav-badge');
  b.textContent = n > 0 ? n : '';
  b.style.display = n > 0 ? 'inline-flex' : 'none';
}

/* SECTION: view-reminders — 提醒中心 */
function renderReminders() {
  const items = buildReminders(state);
  const pending = items.filter(r => !r.done);
  const done = items.filter(r => r.done);
  const m = todayStr().split('-');
  const st = state;
  const rented = st.houses.filter(h => h.status === 'rented').length;
  const vacant = st.houses.filter(h => h.status === 'vacant').length;
  const month = m[0] + '-' + m[1];
  const monthSum = st.bills.filter(b => String(b.paidAt).startsWith(month))
    .reduce((s, b) => s + Number(b.amount || 0), 0);

  const cards = [
    ['待处理提醒', pending.length, pending.length ? 'accent' : ''],
    ['在租房源', `${rented}/${st.houses.length}`, ''],
    ['空置房源', vacant, ''],
    ['本月已收租金', '¥' + fmtMoney(monthSum), 'money'],
  ].map(([k, v, c]) => `<div class="stat"><div class="stat-k">${k}</div><div class="stat-v ${c}">${v}</div></div>`).join('');

  const rows = pending.map(remItemHtml).join('');
  const doneRows = showDoneReminders ? done.map(remItemHtml).join('') : '';
  const doneToggle = done.length
    ? `<label class="done-toggle"><input type="checkbox" data-action="toggle-done" ${showDoneReminders ? 'checked' : ''}> 显示已处理（${done.length}）</label>` : '';

  $root().innerHTML = `
  <!-- SECTION: dashboard -->
  <div class="stats">${cards}</div>
  <div class="panel">
    <div class="panel-head">
      <h2>到期提醒<span class="hint">租约与收租在到期前 ${REMIND_DAYS} 天自动进入提醒</span></h2>
      ${doneToggle}
    </div>
    ${pending.length === 0 && !showDoneReminders
      ? `<div class="empty"><div class="empty-ico">✅</div><p>暂无待处理提醒，一切都在掌控中</p></div>`
      : `<ul class="rem-list">${rows}${doneRows}</ul>`}
  </div>`;
}

function remItemHtml(r) {
  const overdue = r.daysLeft < 0;
  const rentBtn = (r.type === 'rent' || r.type === 'rent-overdue')
    ? `<button class="btn btn-sm btn-primary" data-action="collect" data-id="${r.meta.tenantId}" data-primary-action>记为已收租</button>` : '';
  const endBtn = r.type === 'lease-expired'
    ? `<button class="btn btn-sm" data-action="end-lease" data-id="${r.meta.tenantId}">办理退租</button>` : '';
  return `<li class="rem ${r.type} ${overdue ? 'overdue' : ''} ${r.done ? 'done' : ''}">
    <span class="rem-ico">${TYPE_ICON[r.type] || '🔔'}</span>
    <div class="rem-body">
      <div class="rem-title">${esc(r.title)}</div>
      <div class="rem-sub">应处理日 ${r.due} ${r.amount ? '· 金额 ¥' + fmtMoney(r.amount) : ''}</div>
    </div>
    <div class="rem-right">${daysChip(r.daysLeft)}
      <div class="rem-acts">
        ${rentBtn}${endBtn}
        ${r.type === 'lease' || r.type === 'lease-expired'
          ? `<button class="btn btn-sm" data-action="goto-tenant" data-id="${r.meta.tenantId}">查看租户</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-action="dismiss" data-id="${r.id}">${r.done ? '撤销' : '忽略'}</button>
      </div>
    </div>
  </li>`;
}

/* SECTION: view-houses — 房源管理 */
function renderHouses() {
  const q = houseFilter.q.trim();
  const list = state.houses.filter(h =>
    (houseFilter.status === 'all' || h.status === houseFilter.status) &&
    (!q || (h.code + h.building + h.room + h.layout).toLowerCase().includes(q.toLowerCase())));
  const opts = ['all', 'vacant', 'rented', 'maintenance']
    .map(v => `<option value="${v}" ${houseFilter.status === v ? 'selected' : ''}>${{ all: '全部状态', vacant: '空置', rented: '在租', maintenance: '维修中' }[v]}</option>`).join('');

  const cards = list.map(h => {
    const t = h.tenantId ? state.tenants.find(x => x.id === h.tenantId && x.status === 'active') : null;
    return `<article class="h-card" data-id="${h.id}">
      <div class="h-top"><span class="h-code">${esc(h.code)}</span>${statusBadge(h.status)}</div>
      <div class="h-title">${esc(h.building)} · ${esc(h.room)} · ${esc(h.layout)}</div>
      <div class="h-meta">${h.area} ㎡ · ${h.floor} 层 · 月租 <b>¥${fmtMoney(h.rent)}</b></div>
      ${h.note ? `<div class="h-note">${esc(h.note)}</div>` : ''}
      <div class="h-tenant">${t ? `👤 ${esc(t.name)} · 到期 ${t.endDate}` : '—'}</div>
      <div class="h-acts">
        <button class="btn btn-sm" data-action="house-edit" data-id="${h.id}">编辑</button>
        ${h.status === 'vacant' ? `<button class="btn btn-sm" data-action="house-maint" data-id="${h.id}">报修</button>`
          : h.status === 'maintenance' ? `<button class="btn btn-sm" data-action="house-fix" data-id="${h.id}">完成维修</button>` : ''}
        <button class="btn btn-sm btn-danger-ghost" data-action="house-del" data-id="${h.id}">删除</button>
      </div>
    </article>`;
  }).join('');

  $root().innerHTML = `
  <!-- SECTION: houses-grid -->
  <div class="toolbar">
    <input class="inp search" placeholder="搜索房源编号 / 栋座 / 户型" data-action="house-q" value="${esc(houseFilter.q)}">
    <select class="inp" data-action="house-status">${opts}</select>
    <button class="btn btn-primary" data-action="house-new" data-primary-action>＋ 新增房源</button>
  </div>
  ${list.length ? `<div class="grid">${cards}</div>`
    : `<div class="empty panel"><div class="empty-ico">🏠</div><p>没有符合条件的房源，点击右上角「新增房源」录入</p></div>`}`;
}

/* SECTION: view-tenants — 租户与租约 */
function renderTenants() {
  const q = tenantFilter.q.trim();
  let list = state.tenants.filter(t => t.status === 'active');
  if (tenantFilter.lease !== 'all') {
    list = list.filter(t => {
      const left = diffDays(todayStr(), t.endDate);
      if (tenantFilter.lease === 'urgent') return left >= 0 && left <= 30;
      if (tenantFilter.lease === 'expired') return left < 0;
      return left > 30;
    });
  }
  if (q) list = list.filter(t => {
    const h = state.houses.find(x => x.id === t.houseId);
    return (t.name + t.phone + (h ? h.code : '')).toLowerCase().includes(q.toLowerCase());
  });
  list.sort((a, b) => diffDays(todayStr(), a.endDate) - diffDays(todayStr(), b.endDate));

  const opts = [['all', '全部租约'], ['urgent', '30 天内到期'], ['expired', '已到期'], ['ok', '租约正常']]
    .map(([v, l]) => `<option value="${v}" ${tenantFilter.lease === v ? 'selected' : ''}>${l}</option>`).join('');

  const rows = list.map(t => {
    const h = state.houses.find(x => x.id === t.houseId);
    const due = nextRentDue(t), left = diffDays(todayStr(), due);
    return `<tr>
      <td><b>${esc(t.name)}</b><div class="td-sub">${esc(t.phone)}</div></td>
      <td>${h ? esc(h.code) : '—'}</td>
      <td>¥${fmtMoney(t.rent)}<div class="td-sub">${esc(t.payCycle)}</div></td>
      <td class="td-dates">${t.startDate}<div class="td-sub">至 ${t.endDate}</div></td>
      <td>${leaseChip(t.endDate)}</td>
      <td>${left <= REMIND_DAYS ? daysChip(left) : `<span class="td-sub">${due} 收租</span>`}</td>
      <td><div class="row-acts">
        <button class="btn btn-sm btn-primary" data-action="collect" data-id="${t.id}">收租</button>
        <button class="btn btn-sm" data-action="tenant-edit" data-id="${t.id}">编辑</button>
        <button class="btn btn-sm btn-danger-ghost" data-action="end-lease" data-id="${t.id}">退租</button>
      </div></td>
    </tr>`;
  }).join('');

  $root().innerHTML = `
  <!-- SECTION: tenants-table -->
  <div class="toolbar">
    <input class="inp search" placeholder="搜索租户姓名 / 电话 / 房源" data-action="tenant-q" value="${esc(tenantFilter.q)}">
    <select class="inp" data-action="tenant-lease">${opts}</select>
    <button class="btn btn-primary" data-action="tenant-new">＋ 新增租约</button>
  </div>
  ${list.length
    ? `<div class="panel table-wrap"><table class="tbl">
        <thead><tr><th>租户</th><th>房源</th><th>租金</th><th>租期</th><th>租约状态</th><th>收租日</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    : `<div class="empty panel"><div class="empty-ico">👥</div><p>暂无符合条件的租户，点击「新增租约」为空置房源录入租户</p></div>`}`;
}

/* SECTION: view-bills — 收租记录 */
function renderBills() {
  const bills = [...state.bills].sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));
  const total = bills.reduce((s, b) => s + Number(b.amount || 0), 0);
  const rows = bills.map(b => {
    const t = state.tenants.find(x => x.id === b.tenantId);
    return `<tr>
      <td>${b.paidAt}</td>
      <td>${esc(t ? t.name : '—')}<div class="td-sub">${esc(b.houseCode || '')}</div></td>
      <td>${esc(b.period || '')}</td>
      <td class="td-money">¥${fmtMoney(b.amount)}</td>
      <td><button class="btn btn-sm btn-danger-ghost" data-action="bill-del" data-id="${b.id}">撤销</button></td>
    </tr>`;
  }).join('');
  $root().innerHTML = `
  <!-- SECTION: bills-table -->
  <div class="stats"><div class="stat"><div class="stat-k">累计收款</div><div class="stat-v money">¥${fmtMoney(total)}</div></div>
  <div class="stat"><div class="stat-k">记录条数</div><div class="stat-v">${bills.length}</div></div></div>
  ${bills.length
    ? `<div class="panel table-wrap"><table class="tbl">
        <thead><tr><th>收款日</th><th>租户 / 房源</th><th>租期</th><th>金额</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    : `<div class="empty panel"><div class="empty-ico">🧾</div><p>暂无收租记录，可在提醒中心或租户列表点击「收租」入账</p></div>`}`;
}

/* SECTION: actions — 业务操作 */
function tenantOf(id) { return state.tenants.find(t => t.id === id); }
function houseOf(id) { return state.houses.find(h => h.id === id); }

function collectRent(tenantId) {
  const t = tenantOf(tenantId); if (!t || t.status !== 'active') return;
  const due = nextRentDue(t);
  const h = houseOf(t.houseId);
  state.bills.push({ id: uid(), tenantId: t.id, houseCode: h ? h.code : '', amount: t.rent, period: due, paidAt: todayStr() });
  state.dismissed.push(`rent:${t.id}:${due}`);
  t.firstRentDate = addMonths(due, CYCLE_MONTHS[t.payCycle] || 1);
  commit();
  toast(`已记录 ${t.name} 租金 ¥${fmtMoney(t.rent)}（租期 ${due}）`);
}
function endLease(tenantId) {
  const t = tenantOf(tenantId); if (!t) return;
  if (!confirm(`确认为「${t.name}」办理退租？房源将恢复空置。`)) return;
  t.status = 'ended';
  const h = houseOf(t.houseId);
  if (h && h.tenantId === t.id) { h.tenantId = null; if (h.status === 'rented') h.status = 'vacant'; }
  commit();
  toast(`${t.name} 已退租，房源恢复空置`);
}

/* SECTION: modal — 房源 / 租约表单 */
function openModal(html) {
  document.getElementById('modal-root').innerHTML =
    `<div class="mask" data-action="modal-close"></div><div class="modal"><div class="modal-head">${html.title}
      <button class="x" data-action="modal-close">✕</button></div><form id="m-form" onsubmit="return false">${html.body}</form>
      <div class="modal-foot"><button class="btn" data-action="modal-close">取消</button>
      <button class="btn btn-primary" data-action="modal-save">保存</button></div></div>`;
  document.getElementById('modal-root').dataset.ctx = html.ctx || '';
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

function houseForm(h) {
  const f = h || { code: '', building: '1栋', room: '', layout: '一室一厅', area: 45, rent: 2500, floor: 1, status: 'vacant', note: '' };
  openModal({
    title: h ? '编辑房源' : '新增房源', ctx: 'house', body: `
    <div class="frow"><label>房源编号 *<input class="inp" id="f-code" required value="${esc(f.code)}" placeholder="如 A-0101"></label>
    <label>栋座<input class="inp" id="f-building" value="${esc(f.building)}"></label></div>
    <div class="frow"><label>房号<input class="inp" id="f-room" value="${esc(f.room)}"></label>
    <label>户型<input class="inp" id="f-layout" value="${esc(f.layout)}"></label></div>
    <div class="frow"><label>面积（㎡）<input class="inp" id="f-area" type="number" min="1" value="${f.area}"></label>
    <label>楼层<input class="inp" id="f-floor" type="number" min="0" value="${f.floor}"></label>
    <label>月租金 *<input class="inp" id="f-rent" type="number" min="0" required value="${f.rent}"></label></div>
    <div class="frow"><label>状态<select class="inp" id="f-status">${[['vacant', '空置'], ['rented', '在租'], ['maintenance', '维修中']].map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="grow">备注<input class="inp" id="f-note" value="${esc(f.note)}"></label></div>`
  });
  if (h) document.getElementById('modal-root').dataset.id = h.id;
}
function saveHouse() {
  const g = id => document.getElementById(id).value.trim();
  if (!g('f-code')) { toast('请填写房源编号'); return; }
  const data = { code: g('f-code'), building: g('f-building'), room: g('f-room'), layout: g('f-layout'), area: Number(g('f-area')) || 0, rent: Number(g('f-rent')) || 0, floor: Number(g('f-floor')) || 0, status: g('f-status'), note: g('f-note') };
  const id = document.getElementById('modal-root').dataset.id;
  if (id) { Object.assign(houseOf(id), data); toast('房源已更新'); }
  else { state.houses.push(Object.assign({ id: uid(), tenantId: null }, data)); toast('房源已新增'); }
  closeModal(); commit();
}

function tenantForm(t) {
  const houses = state.houses.filter(h => h.status !== 'maintenance' && (h.status === 'vacant' || (t && h.tenantId === t.id)));
  const hOpts = houses.map(h => `<option value="${h.id}">${esc(h.code)} · ${esc(h.layout)} · ¥${fmtMoney(h.rent)}</option>`).join('');
  const f = t || { name: '', phone: '', gender: '男', houseId: houses[0] ? houses[0].id : '', rent: 2600, payCycle: '月付', startDate: todayStr(), endDate: addMonths(todayStr(), 12), firstRentDate: addDays(todayStr(), 1), deposit: 2600, note: '' };
  if (!houses.length && !t) { toast('暂无可出租的空置房源，请先新增房源'); return; }
  openModal({
    title: t ? '编辑租约' : '新增租约', ctx: 'tenant', body: `
    <div class="frow"><label>姓名 *<input class="inp" id="f-name" required value="${esc(f.name)}"></label>
    <label>电话 *<input class="inp" id="f-phone" required value="${esc(f.phone)}" placeholder="11 位手机号"></label>
    <label>性别<select class="inp" id="f-gender"><option ${f.gender === '男' ? 'selected' : ''}>男</option><option ${f.gender === '女' ? 'selected' : ''}>女</option></select></label></div>
    <div class="frow"><label class="grow">房源 *<select class="inp" id="f-house" required>${houses.map(h => `<option value="${h.id}" ${h.id === f.houseId ? 'selected' : ''}>${esc(h.code)} · ${esc(h.layout)} · ¥${fmtMoney(h.rent)}</option>`).join('')}</select></label></div>
    <div class="frow"><label>月租金 *<input class="inp" id="f-trent" type="number" min="0" required value="${f.rent}"></label>
    <label>付款方式<select class="inp" id="f-cycle">${Object.keys(CYCLE_MONTHS).map(c => `<option ${c === f.payCycle ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label>押金<input class="inp" id="f-deposit" type="number" min="0" value="${f.deposit}"></label></div>
    <div class="frow"><label>起租日 *<input class="inp" type="date" id="f-start" required value="${f.startDate}"></label>
    <label>到期日 *<input class="inp" type="date" id="f-end" required value="${f.endDate}"></label>
    <label>首个收租日<input class="inp" type="date" id="f-first" value="${f.firstRentDate}"></label></div>
    <div class="frow"><label class="grow">备注<input class="inp" id="f-note" value="${esc(f.note)}"></label></div>
    <p class="f-tip">💡 到期日与收租日前 ${REMIND_DAYS} 天，提醒中心会自动出现待办。</p>`
  });
  if (t) document.getElementById('modal-root').dataset.id = t.id;
}
function saveTenant() {
  const g = id => document.getElementById(id).value.trim();
  if (!g('f-name') || !g('f-phone')) { toast('请填写姓名和电话'); return; }
  if (g('f-end') <= g('f-start')) { toast('到期日必须晚于起租日'); return; }
  const id = document.getElementById('modal-root').dataset.id;
  const old = id ? tenantOf(id) : null;
  const data = { name: g('f-name'), phone: g('f-phone'), gender: g('f-gender'), houseId: g('f-house'), rent: Number(g('f-trent')) || 0, payCycle: g('f-cycle'), deposit: Number(g('f-deposit')) || 0, startDate: g('f-start'), endDate: g('f-end'), firstRentDate: g('f-first') || g('f-start'), note: g('f-note'), status: 'active' };
  if (old) {
    const oh = houseOf(old.houseId);
    if (oh && oh.tenantId === old.id) { oh.tenantId = null; if (oh.status === 'rented') oh.status = 'vacant'; }
    Object.assign(old, data);
  } else {
    const t = Object.assign({ id: uid() }, data);
    state.tenants.push(t);
    old = t;
  }
  const nh = houseOf(data.houseId);
  if (nh) { nh.tenantId = old.id; nh.status = 'rented'; }
  closeModal(); commit();
  toast(id ? '租约已更新' : `已为 ${nh ? nh.code : ''} 录入租户 ${data.name}`);
}

/* SECTION: event-delegation */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action, id = el.dataset.id;
  switch (a) {
    case 'collect': collectRent(id); break;
    case 'dismiss': {
      const i = state.dismissed.indexOf(id);
      if (i >= 0) state.dismissed.splice(i, 1); else state.dismissed.push(id);
      commit(); break;
    }
    case 'goto-tenant': {
      const t = tenantOf(id);
      currentView = 'tenants'; tenantFilter.q = t ? t.name : ''; tenantFilter.lease = 'all';
      commit(); break;
    }
    case 'end-lease': endLease(id); break;
    case 'house-new': houseForm(null); break;
    case 'house-edit': houseForm(houseOf(id)); break;
    case 'house-del': {
      const h = houseOf(id);
      if (h.tenantId && tenantOf(h.tenantId) && tenantOf(h.tenantId).status === 'active') { toast('该房源在租，请先办理退租'); break; }
      if (confirm(`确认删除房源 ${h.code}？`)) { state.houses = state.houses.filter(x => x.id !== id); commit(); toast('房源已删除'); }
      break;
    }
    case 'house-maint': { const h = houseOf(id); h.status = 'maintenance'; commit(); break; }
    case 'house-fix': { const h = houseOf(id); h.status = h.tenantId ? 'rented' : 'vacant'; commit(); break; }
    case 'tenant-new': tenantForm(null); break;
    case 'tenant-edit': tenantForm(tenantOf(id)); break;
    case 'bill-del': state.bills = state.bills.filter(b => b.id !== id); commit(); toast('记录已撤销'); break;
    case 'toggle-done': showDoneReminders = el.checked; rerender(); break;
    case 'modal-close': closeModal(); break;
    case 'modal-save': {
      const ctx = document.getElementById('modal-root').dataset.ctx;
      if (ctx === 'house') saveHouse(); else saveTenant();
      break;
    }
    case 'reset-demo':
      if (confirm('重置为示例数据？当前录入的内容将清除。')) {
        state = defaultState(); seedBillsIfNeeded(state); commit(); toast('已重置为示例数据');
      }
      break;
  }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.action === 'house-q') { houseFilter.q = el.value; renderHouses(); restoreCursor(el); }
  if (el.dataset.action === 'tenant-q') { tenantFilter.q = el.value; renderTenants(); restoreCursor(el); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.action === 'house-status') { houseFilter.status = el.value; renderHouses(); }
  if (el.dataset.action === 'tenant-lease') { tenantFilter.lease = el.value; renderTenants(); }
});
function restoreCursor(el) {
  const inputs = document.querySelectorAll(`[data-action="${el.dataset.action}"]`);
  inputs.forEach(i => { i.value = el.value; i.focus(); });
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* SECTION: toast */
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* SECTION: init */
document.querySelectorAll('.tab').forEach(tab =>
  tab.addEventListener('click', () => { currentView = tab.dataset.view; rerender(); }));
rerender();
