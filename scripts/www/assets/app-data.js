/* SECTION: data-layer — 存储、提醒计算与示例数据 */
'use strict';

/* ---------- 常量与工具 ---------- */
const REMIND_DAYS = 3;              // 到期前 3 天开始提醒
const STORE_KEY = 'apt-rent-manager-v1';

const pad2 = n => String(n).padStart(2, '0');
const toDateStr = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => toDateStr(new Date());
const parseDate = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
function addMonths(dateStr, n) {
  const d = parseDate(dateStr);
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0); // 月末回退（1/31 -> 2/28）
  return toDateStr(d);
}
function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
// b - a 的天数差（正数表示 b 在未来）
function diffDays(a, b) {
  const ms = parseDate(b) - parseDate(a);
  return Math.round(ms / 86400000);
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = n => Number(n || 0).toLocaleString('zh-CN');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- 租约与提醒计算 ---------- */
// 找到下一个不早于今天的收租日；若已过期过远则按月顺延
function nextRentDue(tenant) {
  const anchor = tenant.firstRentDate || tenant.startDate;
  const gap = Math.max(0, diffDays(anchor, todayStr()));
  const months = Math.ceil(gap / 30.44) || 0;
  let d = addMonths(anchor, months);
  while (diffDays(todayStr(), d) < 0) d = addMonths(d, 1);
  return d;
}

// 生成全部提醒项：{id,type,title,due,daysLeft,done,meta}
function buildReminders(state) {
  const items = [];
  const doneMap = {};
  (state.dismissed || []).forEach(k => { doneMap[k] = true; });

  state.tenants.filter(t => t.status === 'active').forEach(t => {
    const house = state.houses.find(h => h.id === t.houseId);
    const label = `${t.name}（${house ? house.code : '未知房源'}）`;

    // 收租提醒：到期前 3 天进入提醒窗口，逾期持续置顶
    const due = nextRentDue(t);
    const left = diffDays(todayStr(), due);
    if (left <= REMIND_DAYS) {
      const id = `rent:${t.id}:${due}`;
      items.push({
        id, type: left < 0 ? 'rent-overdue' : 'rent',
        title: left < 0 ? `${label} 租金已逾期 ${-left} 天` : `${label} 应于 ${due} 缴纳租金`,
        due, daysLeft: left, amount: t.rent, done: !!doneMap[id],
        meta: { tenantId: t.id }
      });
    }

    // 租约到期提醒：到期前 3 天开始
    const exp = t.endDate;
    const leftE = diffDays(todayStr(), exp);
    if (leftE <= REMIND_DAYS) {
      const id = `lease:${t.id}:${exp}`;
      items.push({
        id, type: leftE < 0 ? 'lease-expired' : 'lease',
        title: leftE < 0 ? `${label} 租约已于 ${exp} 到期` : `${label} 租约将于 ${exp} 到期`,
        due: exp, daysLeft: leftE, done: !!doneMap[id],
        meta: { tenantId: t.id }
      });
    }
  });
  items.sort((a, b) => a.daysLeft - b.daysLeft);
  return items;
}

/* ---------- 状态存储 ---------- */
function defaultState() {
  const today = todayStr();
  const h = (code, building, room, layout, area, rent, status, floor, note) =>
    ({ id: uid(), code, building, room, layout, area, rent, status, floor, note: note || '', tenantId: null });

  const houses = [
    h('A-0101', '1栋', '0101', '一室一厅', 45, 2600, 'rented', 1, '朝南，采光好'),
    h('A-0202', '1栋', '0202', '两室一厅', 68, 3800, 'rented', 2, '带阳台'),
    h('A-0303', '1栋', '0303', '单间', 30, 1800, 'vacant', 3, '适合独居'),
    h('B-0401', '2栋', '0401', '两室两厅', 86, 4600, 'rented', 4, '近地铁'),
    h('B-0502', '2栋', '0502', '三室两厅', 118, 6200, 'maintenance', 5, '墙面翻新中'),
    h('B-0603', '2栋', '0603', '一室一厅', 48, 2800, 'vacant', 6, '新装交付'),
  ];

  // 示例租约：让提醒中心开箱即有不同状态（临期 / 逾期 / 正常）
  const tenants = [
    {
      id: uid(), name: '陈晓', phone: '138-0000-0101', gender: '女',
      houseId: houses[0].id, rent: 2600, payCycle: '月付',
      startDate: addMonths(today, -8), endDate: addDays(today, 2), // 2 天后租约到期 → 触发提醒
      firstRentDate: addDays(today, 3), status: 'active', deposit: 2600, note: '续租意向待确认'
    },
    {
      id: uid(), name: '刘成长', phone: '139-0000-0202', gender: '男',
      houseId: houses[1].id, rent: 3800, payCycle: '季付',
      startDate: addMonths(today, -5), endDate: addMonths(today, 7),
      firstRentDate: addDays(today, -2), status: 'active', deposit: 3800, note: '租金已逾期 2 天'
    },
    {
      id: uid(), name: '王雅婷', phone: '137-0000-0401', gender: '女',
      houseId: houses[3].id, rent: 4600, payCycle: '月付',
      startDate: addMonths(today, -2), endDate: addMonths(today, 10),
      firstRentDate: addDays(today, 15), status: 'active', deposit: 4600, note: ''
    },
  ];
  houses[0].tenantId = tenants[0].id;
  houses[1].tenantId = tenants[1].id;
  houses[3].tenantId = tenants[2].id;

  return {
    version: 1,
    houses, tenants,
    dismissed: [],                       // 已处理提醒 id
    bills: [],                           // 收租记录 {id, tenantId, houseCode, amount, period, paidAt}
    seedTag: 'demo-2026-09'
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.houses) || !Array.isArray(s.tenants)) return defaultState();
    s.dismissed = s.dismissed || [];
    s.bills = s.bills || [];
    return s;
  } catch (e) {
    return defaultState();
  }
}
function saveState(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* 存储不可用时仅内存态 */ }
}

/* SECTION: seed-records 收租记录补种（首次演示用） */
function seedBillsIfNeeded(state) {
  if (state.bills.length || state.tenants.length === 0) return;
  // 为每位在册租户预置最近一期已收记录，便于统计有基数
  state.tenants.filter(t => t.status === 'active').slice(0, 2).forEach(t => {
    const house = state.houses.find(h => h.id === t.houseId);
    state.bills.push({
      id: uid(), tenantId: t.id, houseCode: house ? house.code : '-',
      amount: t.rent, period: addMonths(nextRentDue(t), -1),
      paidAt: addDays(nextRentDue(t), -1)
    });
  });
  saveState(state);
}
