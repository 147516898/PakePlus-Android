/* SECTION: actions — 收租、退租等业务操作 */
'use strict';

function tenantOf(id) { return state.tenants.find(t => t.id === id); }
function houseOf(id) { return state.houses.find(h => h.id === id); }

function collectRent(tenantId) {
  const t = tenantOf(tenantId);
  if (!t || t.status !== 'active') return;
  const due = nextRentDue(t);
  const h = houseOf(t.houseId);
  state.bills.push({
    id: uid(), tenantId: t.id, houseCode: h ? h.code : '',
    amount: t.rent, period: due, paidAt: todayStr()
  });
  state.dismissed.push(`rent:${t.id}:${due}`);
  t.firstRentDate = addMonths(due, CYCLE_MONTHS[t.payCycle] || 1);
  commit();
  toast(`已记录 ${t.name} 租金 ¥${fmtMoney(t.rent)}（租期 ${due}），下一期 ${t.firstRentDate}`);
}

function endLease(tenantId) {
  const t = tenantOf(tenantId);
  if (!t) return;
  if (!confirm(`确认为「${t.name}」办理退租？对应房源将恢复空置。`)) return;
  t.status = 'ended';
  const h = houseOf(t.houseId);
  if (h && h.tenantId === t.id) { h.tenantId = null; if (h.status === 'rented') h.status = 'vacant'; }
  commit();
  toast(`${t.name} 已退租，房源${h ? ' ' + h.code : ''} 恢复空置`);
}

/* SECTION: modal — 弹窗骨架 */
function openModal(cfg) {
  const root = document.getElementById('modal-root');
  root.dataset.ctx = cfg.ctx || '';
  root.dataset.id = cfg.id || '';
  root.innerHTML = `<div class="mask" data-action="modal-close"></div>
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">${cfg.title}<button class="x" data-action="modal-close" aria-label="关闭">✕</button></div>
      <form id="m-form" onsubmit="return false">${cfg.body}</form>
      <div class="modal-foot">
        <button class="btn" data-action="modal-close">取消</button>
        <button class="btn btn-primary" data-action="modal-save">保存</button>
      </div>
    </div>`;
  const first = root.querySelector('input, select');
  if (first) first.focus();
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

/* SECTION: house-form — 房源表单 */
function houseForm(h) {
  const f = h || { code: '', building: '1栋', room: '', layout: '一室一厅', area: 45, rent: 2500, floor: 1, status: 'vacant', note: '' };
  const statusOpts = [['vacant', '空置'], ['rented', '在租'], ['maintenance', '维修中']]
    .map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('');
  openModal({
    title: h ? '编辑房源' : '新增房源', ctx: 'house', id: h ? h.id : '', body: `
    <div class="frow">
      <label>房源编号 *<input class="inp" id="f-code" required value="${esc(f.code)}" placeholder="如 A-0101"></label>
      <label>栋座<input class="inp" id="f-building" value="${esc(f.building)}"></label>
    </div>
    <div class="frow">
      <label>房号<input class="inp" id="f-room" value="${esc(f.room)}"></label>
      <label>户型<input class="inp" id="f-layout" value="${esc(f.layout)}" placeholder="两室一厅"></label>
    </div>
    <div class="frow">
      <label>面积（㎡）<input class="inp" id="f-area" type="number" min="1" value="${f.area}"></label>
      <label>楼层<input class="inp" id="f-floor" type="number" min="0" value="${f.floor}"></label>
      <label>月租金 *<input class="inp" id="f-rent" type="number" min="0" required value="${f.rent}"></label>
    </div>
    <div class="frow">
      <label>状态<select class="inp" id="f-status">${statusOpts}</select></label>
      <label class="grow">备注<input class="inp" id="f-note" value="${esc(f.note)}" placeholder="采光、配套等"></label>
    </div>`
  });
}

function saveHouse() {
  if (!val('f-code')) { toast('请填写房源编号'); return; }
  const data = {
    code: val('f-code'), building: val('f-building'), room: val('f-room'), layout: val('f-layout'),
    area: Number(val('f-area')) || 0, rent: Number(val('f-rent')) || 0,
    floor: Number(val('f-floor')) || 0, status: val('f-status'), note: val('f-note')
  };
  const id = document.getElementById('modal-root').dataset.id;
  if (id) {
    const h = houseOf(id);
    Object.assign(h, data);
    if (h.status !== 'rented') h.tenantId = null;
    toast('房源信息已更新');
  } else {
    if (state.houses.some(h => h.code === data.code)) { toast('该房源编号已存在'); return; }
    state.houses.push(Object.assign({ id: uid(), tenantId: null }, data));
    toast(`房源 ${data.code} 已新增`);
  }
  closeModal(); commit();
}

/* SECTION: tenant-form — 租约表单 */
function tenantForm(t) {
  const free = state.houses.filter(h => h.status === 'vacant');
  if (!t && !free.length) { toast('暂无可出租的空置房源，请先在「房源」中新增'); return; }
  const usable = t ? state.houses.filter(h => h.tenantId === t.id || h.status === 'vacant') : free;
  const first = usable[0];
  const f = t || {
    name: '', phone: '', gender: '男', houseId: first.id, rent: first.rent, payCycle: '月付',
    startDate: todayStr(), endDate: addMonths(todayStr(), 12),
    firstRentDate: addDays(todayStr(), 1), deposit: first.rent, note: ''
  };
  const houseOpts = usable.map(h =>
    `<option value="${h.id}" ${h.id === f.houseId ? 'selected' : ''}>${esc(h.code)} · ${esc(h.layout)} · 月租 ¥${fmtMoney(h.rent)}</option>`).join('');
  const cycleOpts = Object.keys(CYCLE_MONTHS)
    .map(c => `<option ${c === f.payCycle ? 'selected' : ''}>${c}</option>`).join('');

  openModal({
    title: t ? '编辑租约 · ' + esc(t.name) : '新增租约', ctx: 'tenant', id: t ? t.id : '', body: `
    <div class="frow">
      <label>姓名 *<input class="inp" id="f-name" required value="${esc(f.name)}"></label>
      <label>联系电话 *<input class="inp" id="f-phone" required value="${esc(f.phone)}" placeholder="11 位手机号"></label>
      <label>性别<select class="inp" id="f-gender"><option ${f.gender === '男' ? 'selected' : ''}>男</option><option ${f.gender === '女' ? 'selected' : ''}>女</option></select></label>
    </div>
    <div class="frow"><label class="grow">关联房源 *<select class="inp" id="f-house" required>${houseOpts}</select></label></div>
    <div class="frow">
      <label>月租金 *<input class="inp" id="f-trent" type="number" min="0" required value="${f.rent}"></label>
      <label>付款方式<select class="inp" id="f-cycle">${cycleOpts}</select></label>
      <label>押金<input class="inp" id="f-deposit" type="number" min="0" value="${f.deposit}"></label>
    </div>
    <div class="frow">
      <label>起租日 *<input class="inp" type="date" id="f-start" required value="${f.startDate}"></label>
      <label>到期日 *<input class="inp" type="date" id="f-end" required value="${f.endDate}"></label>
      <label>首个收租日<input class="inp" type="date" id="f-first" value="${f.firstRentDate}"></label>
    </div>
    <div class="frow"><label class="grow">备注<input class="inp" id="f-note" value="${esc(f.note)}" placeholder="续租意向、门禁卡等"></label></div>
    <p class="f-tip">💡 租约到期日与每期收租日前 ${REMIND_DAYS} 天，提醒中心会自动生成待办；误记可在「收租记录」撤销。</p>`
  });
}

function saveTenant() {
  const name = val('f-name'), phone = val('f-phone');
  if (!name || !phone) { toast('请填写租户姓名和联系电话'); return; }
  const start = val('f-start'), end = val('f-end');
  if (!start || !end) { toast('请选择起租日与到期日'); return; }
  if (end <= start) { toast('到期日必须晚于起租日'); return; }

  const id = document.getElementById('modal-root').dataset.id;
  const data = {
    name, phone, gender: val('f-gender'), houseId: val('f-house'),
    rent: Number(val('f-trent')) || 0, payCycle: val('f-cycle'),
    deposit: Number(val('f-deposit')) || 0, startDate: start, endDate: end,
    firstRentDate: val('f-first') || start, note: val('f-note'), status: 'active'
  };
  let target = null;
  if (id) {
    target = tenantOf(id);
    const oldHouse = houseOf(target.houseId);
    if (oldHouse && oldHouse.tenantId === target.id && oldHouse.id !== data.houseId) {
      oldHouse.tenantId = null;
      if (oldHouse.status === 'rented') oldHouse.status = 'vacant';
    }
    Object.assign(target, data);
  } else {
    target = Object.assign({ id: uid() }, data);
    state.tenants.push(target);
  }
  const nh = houseOf(data.houseId);
  if (nh) { nh.tenantId = target.id; nh.status = 'rented'; }
  closeModal(); commit();
  toast(id ? `租约已更新：${target.name}` : `已为 ${nh ? nh.code : ''} 录入租户 ${target.name}`);
}

/* SECTION: event-delegation — 全局事件分发 */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action, id = el.dataset.id;
  switch (a) {
    case 'collect': collectRent(id); break;
    case 'dismiss': {
      const i = state.dismissed.indexOf(id);
      if (i >= 0) state.dismissed.splice(i, 1); else state.dismissed.push(id);
      commit();
      break;
    }
    case 'goto-tenant': {
      const t = tenantOf(id);
      currentView = 'tenants';
      tenantFilter.q = t ? t.name : '';
      tenantFilter.lease = 'all';
      commit();
      break;
    }
    case 'end-lease': endLease(id); break;
    case 'house-new': houseForm(null); break;
    case 'house-edit': houseForm(houseOf(id)); break;
    case 'house-maint': houseOf(id).status = 'maintenance'; commit(); toast('已标记为维修中'); break;
    case 'house-fix': { const h = houseOf(id); h.status = h.tenantId ? 'rented' : 'vacant'; commit(); toast('维修已完成'); break; }
    case 'house-del': {
      const h = houseOf(id);
      const cur = h.tenantId ? tenantOf(h.tenantId) : null;
      if (cur && cur.status === 'active') { toast('该房源仍在租，请先办理退租'); break; }
      if (confirm(`确认删除房源 ${h.code}？该操作不可撤销。`)) {
        state.houses = state.houses.filter(x => x.id !== id);
        commit(); toast(`房源 ${h.code} 已删除`);
      }
      break;
    }
    case 'tenant-new': tenantForm(null); break;
    case 'tenant-edit': tenantForm(tenantOf(id)); break;
    case 'bill-del':
      state.bills = state.bills.filter(b => b.id !== id);
      commit(); toast('收租记录已撤销');
      break;
    case 'toggle-done': showDoneReminders = el.checked; rerender(); break;
    case 'modal-close': closeModal(); break;
    case 'modal-save': {
      const ctx = document.getElementById('modal-root').dataset.ctx;
      if (ctx === 'house') saveHouse();
      else if (ctx === 'tenant') saveTenant();
      else closeModal();
      break;
    }
    case 'reset-demo':
      if (confirm('重置为示例数据？当前录入的内容将被清除。')) {
        state = defaultState();
        saveState(state);
        currentView = 'reminders';
        commit(); toast('已重置为示例数据');
      }
      break;
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.action === 'house-q') { houseFilter.q = el.value; renderHouses(); keepFocus('house-q', el.value); }
  if (el.dataset.action === 'tenant-q') { tenantFilter.q = el.value; renderTenants(); keepFocus('tenant-q', el.value); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.action === 'house-status') { houseFilter.status = el.value; renderHouses(); }
  if (el.dataset.action === 'tenant-lease') { tenantFilter.lease = el.value; renderTenants(); }
});
function keepFocus(action, value) {
  const box = document.querySelector(`[data-action="${action}"]`);
  if (box && document.activeElement !== box) {
    box.value = value; box.focus();
    box.setSelectionRange(value.length, value.length);
  }
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* SECTION: toast — 轻提示 */
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* SECTION: init — 启动 */
document.querySelectorAll('.tab').forEach(tab =>
  tab.addEventListener('click', () => { currentView = tab.dataset.view; rerender(); }));
rerender();
