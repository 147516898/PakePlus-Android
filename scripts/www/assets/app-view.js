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

/* SECTION: helpers — 状态徽标与剩余天数胶囊 */
function statusBadge(s) {
  const cls = { vacant: 'b-vacant', rented: 'b-rented', maintenance: 'b-maint' }[s] || 'b-vacant';
  const txt = { vacant: '空置', rented: '在租', maintenance: '维修中' }[s] || s;
  return `<span class="badge ${cls}">${txt}</span>`;
}
function daysChip(left) {
  if (left < 0) return `<span class="chip chip-red">已逾期 ${-left} 天</span>`;
  if (left === 0) return `<span class="chip chip-red">今天到期</span>`;
  if (left <= REMIND_DAYS) return `<span class="chip chip-orange">${left} 天后到期</span>`;
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

/* SECTION: view-reminders — 提醒中心与经营概览 */
function renderReminders() {
  const items = buildReminders(state);
  const pending = items.filter(r => !r.done);
  const done = items.filter(r => r.done);
  const month = todayStr().slice(0, 7);
  const rented = state.houses.filter(h => h.status === 'rented').length;
  const vacant = state.houses.filter(h => h.status === 'vacant').length;
  const monthSum = state.bills.filter(b => String(b.paidAt).startsWith(month))
    .reduce((s, b) => s + Number(b.amount || 0), 0);

  const cards = [
    ['待处理提醒', pending.length, pending.length ? 'accent' : ''],
    ['在租房源', `${rented}/${state.houses.length}`, ''],
    ['空置房源', vacant, ''],
    ['本月已收租金', '¥' + fmtMoney(monthSum), 'money'],
  ].map(([k, v, c]) =>
    `<div class="stat"><div class="stat-k">${k}</div><div class="stat-v ${c}">${v}</div></div>`).join('');

  const doneToggle = done.length
    ? `<label class="done-toggle"><input type="checkbox" data-action="toggle-done" ${showDoneReminders ? 'checked' : ''}> 显示已处理（${done.length}）</label>`
    : '';

  $root().innerHTML = `
  <!-- SECTION: dashboard -->
  <div class="stats">${cards}</div>
  <div class="panel">
    <div class="panel-head">
      <h2>到期提醒<span class="hint">租约与收租在到期前 ${REMIND_DAYS} 天自动进入提醒</span></h2>
      ${doneToggle}
    </div>
    ${(!pending.length && !showDoneReminders)
      ? `<div class="empty"><div class="empty-ico">✅</div><p>暂无待处理提醒，一切都在掌控中</p></div>`
      : `<ul class="rem-list">${pending.map(remItemHtml).join('')}${showDoneReminders ? done.map(remItemHtml).join('') : ''}</ul>`}
  </div>`;
}

function remItemHtml(r) {
  const isRent = r.type === 'rent' || r.type === 'rent-overdue';
  const isLease = r.type === 'lease' || r.type === 'lease-expired';
  return `<li class="rem ${r.type} ${r.daysLeft < 0 ? 'overdue' : ''} ${r.done ? 'is-done' : ''}">
    <span class="rem-ico">${TYPE_ICON[r.type] || '🔔'}</span>
    <div class="rem-body">
      <div class="rem-title">${esc(r.title)}</div>
      <div class="rem-sub">应处理日 ${r.due}${r.amount ? ' · 金额 ¥' + fmtMoney(r.amount) : ''}</div>
    </div>
    <div class="rem-right">${daysChip(r.daysLeft)}
      <div class="rem-acts">
        ${isRent ? `<button class="btn btn-sm btn-primary" data-action="collect" data-id="${r.meta.tenantId}" data-primary-action>记为已收租</button>` : ''}
        ${r.type === 'lease-expired' ? `<button class="btn btn-sm" data-action="end-lease" data-id="${r.meta.tenantId}">办理退租</button>` : ''}
        ${isLease ? `<button class="btn btn-sm" data-action="goto-tenant" data-id="${r.meta.tenantId}">查看租户</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-action="dismiss" data-id="${r.id}">${r.done ? '撤销忽略' : '忽略'}</button>
      </div>
    </div>
  </li>`;
}

/* SECTION: view-houses — 房源管理 */
function renderHouses() {
  const q = houseFilter.q.trim().toLowerCase();
  const list = state.houses.filter(h =>
    (houseFilter.status === 'all' || h.status === houseFilter.status) &&
    (!q || (h.code + h.building + h.room + h.layout).toLowerCase().includes(q)));
  const opts = [['all', '全部状态'], ['vacant', '空置'], ['rented', '在租'], ['maintenance', '维修中']]
    .map(([v, l]) => `<option value="${v}" ${houseFilter.status === v ? 'selected' : ''}>${l}</option>`).join('');

  const cards = list.map(h => {
    const t = h.tenantId ? state.tenants.find(x => x.id === h.tenantId && x.status === 'active') : null;
    const extra = h.status === 'vacant'
      ? `<button class="btn btn-sm" data-action="house-maint" data-id="${h.id}">标记维修</button>`
      : h.status === 'maintenance'
        ? `<button class="btn btn-sm" data-action="house-fix" data-id="${h.id}">完成维修</button>` : '';
    return `<article class="h-card">
      <div class="h-top"><span class="h-code">${esc(h.code)}</span>${statusBadge(h.status)}</div>
      <div class="h-title">${esc(h.building)} · ${esc(h.room)} · ${esc(h.layout)}</div>
      <div class="h-meta">${h.area} ㎡ · ${h.floor} 层 · 月租 <b>¥${fmtMoney(h.rent)}</b></div>
      ${h.note ? `<div class="h-note">${esc(h.note)}</div>` : ''}
      <div class="h-tenant">${t ? `👤 ${esc(t.name)} · 租约至 ${t.endDate}` : '<span class="muted">暂无在租租户</span>'}</div>
      <div class="h-acts">
        <button class="btn btn-sm" data-action="house-edit" data-id="${h.id}">编辑</button>${extra}
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
    : `<div class="empty panel"><div class="empty-ico">🏠</div><p>没有符合条件的房源，点右上角「新增房源」录入</p></div>`}`;
}

/* SECTION: view-tenants — 租户与租约 */
function renderTenants() {
  const q = tenantFilter.q.trim().toLowerCase();
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
    return (t.name + t.phone + (h ? h.code : '')).toLowerCase().includes(q);
  });
  list.sort((a, b) => diffDays(todayStr(), a.endDate) - diffDays(todayStr(), b.endDate));

  const opts = [['all', '全部租约'], ['urgent', '30 天内到期'], ['expired', '已到期'], ['ok', '租约正常']]
    .map(([v, l]) => `<option value="${v}" ${tenantFilter.lease === v ? 'selected' : ''}>${l}</option>`).join('');

  const rows = list.map(t => {
    const h = state.houses.find(x => x.id === t.houseId);
    const due = nextRentDue(t);
    const left = diffDays(todayStr(), due);
    return `<tr>
      <td><b>${esc(t.name)}</b><div class="td-sub">${esc(t.phone)}</div></td>
      <td>${h ? esc(h.code) : '—'}</td>
      <td>¥${fmtMoney(t.rent)}<div class="td-sub">${esc(t.payCycle)}</div></td>
      <td>${t.startDate}<div class="td-sub">至 ${t.endDate}</div></td>
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
    : `<div class="empty panel"><div class="empty-ico">👥</div><p>暂无符合条件的租户，点「新增租约」为空置房源录入</p></div>`}`;
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
  <div class="stats">
    <div class="stat"><div class="stat-k">累计收款</div><div class="stat-v money">¥${fmtMoney(total)}</div></div>
    <div class="stat"><div class="stat-k">记录条数</div><div class="stat-v">${bills.length}</div></div>
  </div>
  ${bills.length
    ? `<div class="panel table-wrap"><table class="tbl">
        <thead><tr><th>收款日</th><th>租户 / 房源</th><th>租期</th><th>金额</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    : `<div class="empty panel"><div class="empty-ico">🧾</div><p>暂无收租记录，可在提醒中心或租户列表点「收租」入账</p></div>`}`;
}
