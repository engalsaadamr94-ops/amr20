import React, { useState, useRef, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, CartesianGrid } from "recharts";
import JsBarcode from "jsbarcode";
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from "html5-qrcode";
import {
  LayoutDashboard, Users, ShoppingBag, Shirt, Receipt, Briefcase,
  Truck, Wallet, ShieldCheck, BarChart3, Plus, Trash2, Pencil, Check,
  Printer, X, Search, Package, Building2, Star, ChevronLeft, ScanLine, Upload, CalendarClock, Store, RotateCcw
} from "lucide-react";

const STORAGE_KEY = "tailor-shop-data-v2";
const SESSION_KEY = "tailor-shop-session-v1";

const PALETTES = {
  classic: { ink: "#211D19", parchment: "#F4EFE3", panel: "#FBF8F1", brass: "#A9752E", teal: "#2E5A54", red: "#A4413A", border: "#E4DBC5", label: "كلاسيكي (بني وذهبي)" },
  royal: { ink: "#1B2333", parchment: "#EEF2F7", panel: "#FFFFFF", brass: "#2B6CB0", teal: "#B7791F", red: "#B91C1C", border: "#DCE4EE", label: "أزرق ملكي" },
  olive: { ink: "#22281E", parchment: "#F1F0E2", panel: "#FCFBF3", brass: "#55743F", teal: "#8A6A34", red: "#9C4235", border: "#E2E0C9", label: "أخضر زيتوني" },
};
const THEME = { ...PALETTES.classic };
function applyTheme(name) { Object.assign(THEME, PALETTES[name] || PALETTES.classic); }

const uid = (p = "id") => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const logEntry = (user, action, details) => ({ id: uid("log"), at: new Date().toLocaleString("ar-SA"), user: user || "غير معروف", action, details: details || "" });
const todayStr = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtNum = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
// Sequential numeric counters (vouchers, journal entries, employee ledger entries ...).
// Returns the new number plus the updated counters object to be saved together with the record.
const nextCounter = (counters, key, start = 1000) => { const no = (Number(counters?.[key]) || start) + 1; return { no, counters: { ...(counters || {}), [key]: no } }; };
// Builds a voucher with a purely numeric number (1001, 1002 ...) instead of a random id fragment.
// Numbers freed on purpose by the system admin (data.freedNumbers[key]) are handed out first, lowest first;
// otherwise the counter goes up. A freed number that is somehow in use again is skipped.
function issueNumber(data, counters, key, start, existing) {
  const freedAll = data?.freedNumbers || {};
  const used = new Set((existing || []).map((x) => Number(x)));
  const pool = [...(freedAll[key] || [])].map(Number).filter((n) => n > 0 && !used.has(n)).sort((a, b) => a - b);
  if (pool.length) return { no: pool[0], counters: counters || {}, freedNumbers: { ...freedAll, [key]: pool.slice(1) } };
  const no = (Number(counters?.[key]) || start) + 1;
  return { no, counters: { ...(counters || {}), [key]: no }, freedNumbers: { ...freedAll, [key]: [] } };
}
function buildVoucher(counters, fields, createdBy, data) {
  const t = data ? issueNumber(data, counters, "voucher", 1000, (data.vouchers || []).map((v) => v.voucherNo)) : { ...nextCounter(counters, "voucher"), freedNumbers: undefined };
  return { voucher: { id: uid("v"), voucherNo: t.no, createdAt: new Date().toISOString(), createdBy: createdBy || "", ...fields }, counters: t.counters, freedNumbers: t.freedNumbers };
}
// Numbers (orders, groups, customers, purchases, vouchers, journals, employee entries) only ever go UP.
// Deleting an invoice/voucher never frees its number: counters are raised to the highest number that exists
// (covers restored backups / imports with a stale counter) but are never lowered.
function normalizeCounters(d) {
  if (!d) return d;
  const c = { ...(d.counters || {}) };
  const up = (key, arr, field, start) => { const top = Math.max(Number(c[key]) || start, ...(arr || []).map((x) => Number(x?.[field]) || 0)); c[key] = top; };
  up("order", d.orders, "orderNo", 1000); up("group", d.orderGroups, "groupNo", 1000); up("customer", d.customers, "code", 1000);
  up("purchase", d.purchases, "purchaseNo", 1000); up("voucher", d.vouchers, "voucherNo", 1000); up("journal", d.journalEntries, "journalNo", 1000);
  up("empEntry", d.employeeLedger, "entryNo", 5000); up("return", d.returns, "returnNo", 1000);
  const same = Object.keys(c).every((k) => c[k] === (d.counters || {})[k]);
  return same ? d : { ...d, counters: c };
}
// ---------- Multi-device safe saving ----------
// The whole shop lives in one cloud row, so two devices saving "their copy" would erase each other's work.
// Every save therefore (1) reads the latest cloud copy, (2) does a 3-way merge between
// the last copy this device synced (base), what this device holds now (local) and the cloud copy,
// then (3) writes the merged result. Records are matched by id, fields are merged one by one,
// account balances are merged as deltas, counters take the maximum, and numbers that two devices
// issued at the same time are renumbered instead of duplicated.
function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false; return true; }
  const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEq(a[k], b[k]));
}
const isIdArray = (a) => Array.isArray(a) && a.every((x) => x && typeof x === "object" && x.id !== undefined);
function mergeRecord(b, l, c) {
  const out = { ...c };
  Object.keys(l).forEach((k) => {
    if (!deepEq(l[k], b[k])) out[k] = (k === "balance" && typeof l[k] === "number") ? (Number(c[k]) || 0) + (l[k] - (Number(b[k]) || 0)) : l[k];
  });
  Object.keys(b).forEach((k) => { if (!(k in l)) delete out[k]; });
  return out;
}
function mergeArrayById(base, local, cloud) {
  const bm = new Map(base.map((x) => [x.id, x])), lm = new Map(local.map((x) => [x.id, x])), cm = new Map(cloud.map((x) => [x.id, x]));
  const seen = new Set(), out = [];
  [...cloud, ...local].forEach((x) => {
    if (seen.has(x.id)) return; seen.add(x.id);
    const b = bm.get(x.id), l = lm.get(x.id), c = cm.get(x.id);
    let r = null;
    if (l && c) r = !b ? l : deepEq(l, b) ? c : deepEq(c, b) ? l : mergeRecord(b, l, c);
    else if (l && !c) r = b ? (deepEq(l, b) ? null : l) : l;       // deleted elsewhere: drop unless edited here
    else if (!l && c) r = b ? null : c;                              // deleted here / added elsewhere
    if (r) out.push(r);
  });
  return out;
}
function mergeValue(key, b, l, c) {
  if (key === "counters" && l && c) { const o = { ...c }; Object.keys(l).forEach((k) => { o[k] = Math.max(Number(o[k]) || 0, Number(l[k]) || 0); }); return o; }
  if (deepEq(l, b)) return c;
  if (deepEq(c, b)) return l;
  if (isIdArray(l) && isIdArray(c)) return mergeArrayById(isIdArray(b) ? b : [], l, c);
  if (Array.isArray(l) && Array.isArray(c)) { const out = [...c]; l.forEach((x) => { if (!out.some((y) => deepEq(x, y))) out.push(x); }); return out; }
  if (l && c && typeof l === "object" && typeof c === "object" && !Array.isArray(l) && !Array.isArray(c)) {
    const bb = b && typeof b === "object" && !Array.isArray(b) ? b : {};
    const out = {}; Object.keys({ ...c, ...l }).forEach((k) => { const v = mergeValue(k, bb[k], l[k], c[k]); if (v !== undefined) out[k] = v; });
    return out;
  }
  return l;
}
function mergeData(base, local, cloud) {
  if (!base || !cloud) return local;
  const out = {}; Object.keys({ ...cloud, ...local }).forEach((k) => { const v = mergeValue(k, base[k], local[k], cloud[k]); if (v !== undefined) out[k] = v; });
  return out;
}
const NUMBERED = [["orders", "orderNo", "order", "طلب"], ["orderGroups", "groupNo", "group", "طلبية"], ["customers", "code", "customer", "كود عميل"], ["purchases", "purchaseNo", "purchase", "شراء"], ["vouchers", "voucherNo", "voucher", "سند"], ["journalEntries", "journalNo", "journal", "قيد"], ["employeeLedger", "entryNo", "empEntry", "قيد موظف"], ["returns", "returnNo", "return", "مرتجع"]];
// If this device issued a number another device issued at the same time, the record that is NOT yet in the cloud takes a new number.
function dedupeNumbers(d, cloud) {
  const notes = []; const counters = { ...(d.counters || {}) }; const out = { ...d };
  NUMBERED.forEach(([col, field, ck, label]) => {
    const list = d[col]; if (!Array.isArray(list)) return;
    const cloudIds = new Set((cloud?.[col] || []).map((x) => x.id));
    const seen = new Set(list.filter((x) => cloudIds.has(x.id)).map((x) => x[field]));
    out[col] = list.map((x) => {
      if (cloudIds.has(x.id)) return x;
      const n = x[field];
      if (n === undefined || n === null || !seen.has(n)) { seen.add(n); return x; }
      const nn = (Number(counters[ck]) || 1000) + 1; counters[ck] = nn; seen.add(nn);
      notes.push(`${label} ${n} ← ${nn}`);
      return { ...x, [field]: nn };
    });
  });
  out.counters = counters;
  return { data: out, notes };
}

// A voucher is never deleted: cancelling keeps its number visible (status "cancelled"), reverses its effect on the
// account balance, and every report/statement ignores cancelled vouchers.
const liveVouchers = (data) => (data.vouchers || []).filter((v) => v.status !== "cancelled");
function cancelVouchersWhere(data, predicate, reason, by) {
  const targets = (data.vouchers || []).filter((v) => v.status !== "cancelled" && predicate(v));
  const ids = new Set(targets.map((v) => v.id)); const delta = {};
  targets.forEach((v) => { delta[v.accountId] = (delta[v.accountId] || 0) + (v.type === "قبض" ? -1 : 1) * (Number(v.amount) || 0); });
  const at = new Date().toISOString();
  return {
    vouchers: data.vouchers.map((v) => ids.has(v.id) ? { ...v, status: "cancelled", cancelledAt: at, cancelledBy: by || "", cancelReason: reason } : v),
    financeAccounts: data.financeAccounts.map((a) => delta[a.id] ? { ...a, balance: round2((Number(a.balance) || 0) + delta[a.id]) } : a),
    count: targets.length,
  };
}
// ---------- Branch permissions ----------
// "مدير عام" always sees everything. Any other user who has branches assigned (المستخدمون ← الفروع المتاحة) only sees
// the data of those branches. A user with no branches assigned keeps seeing everything (so old users are not locked out).
function userBranchScope(data, user) {
  if (!user || user.role === "مدير عام") return null;
  const ids = (user.branches || []).filter((id) => data.branches.some((b) => b.id === id));
  return ids.length ? ids : null;
}
const SCOPED_COLLECTIONS = ["orders", "orderGroups", "customers", "employees", "employeeLedger", "vouchers", "purchases", "appointments", "stockAdjustments", "returns"];
const MASKED_KEYS = ["branches", "journalEntries"];   // hidden from restricted users; their writes are ignored
function scopeData(data, allowed) {
  if (!allowed) return data;
  const A = new Set(allowed); const def = data.branches[0]?.id;
  const orders = data.orders.filter((o) => A.has(o.branch));
  const orderIds = new Set(orders.map((o) => o.id));
  const custAny = new Set(data.orders.map((o) => o.customerId)), custIn = new Set(orders.map((o) => o.customerId));
  const customers = data.customers.filter((c) => c.branch ? A.has(c.branch) : (custIn.has(c.id) || !custAny.has(c.id)));
  const employees = data.employees.filter((e) => empBranches(data, e).some((id) => A.has(id)));
  const empIds = new Set(employees.map((e) => e.id));
  return {
    ...data, _scope: allowed,
    branches: data.branches.filter((b) => A.has(b.id)),
    orders, customers, employees,
    orderGroups: (data.orderGroups || []).filter((g) => data.orders.some((o) => o.groupId === g.id && A.has(o.branch))),
    employeeLedger: (data.employeeLedger || []).filter((l) => empIds.has(l.employeeId)),
    vouchers: data.vouchers.filter((v) => A.has(v.branch || def) || (v.orderId && orderIds.has(v.orderId))),
    purchases: (data.purchases || []).filter((x) => A.has(x.branch || def)),
    appointments: (data.appointments || []).filter((a) => !a.branch || A.has(a.branch)),
    stockAdjustments: (data.stockAdjustments || []).filter((a) => A.has(a.branch || def)),
    returns: (data.returns || []).filter((r) => A.has(r.branch || def)),
    journalEntries: [],
  };
}
// A restricted view only holds part of each list. Writing its arrays back verbatim would erase the hidden rest,
// so changes are merged into the FULL lists: hidden records are kept, visible ones replaced/removed/added.
function mergeScopedPatch(full, allowed, patch) {
  const visible = scopeData(full, allowed); const out = { ...patch };
  MASKED_KEYS.forEach((k) => delete out[k]);
  SCOPED_COLLECTIONS.forEach((col) => {
    if (!Array.isArray(patch[col])) return;
    const fullList = full[col] || [];
    const visibleIds = new Set((visible[col] || []).map((x) => x.id)), fullIds = new Set(fullList.map((x) => x.id));
    const pm = new Map(patch[col].map((x) => [x.id, x])); const res = [];
    fullList.forEach((x) => { if (!visibleIds.has(x.id)) res.push(x); else if (pm.has(x.id)) res.push(pm.get(x.id)); });
    patch[col].forEach((x) => { if (!fullIds.has(x.id)) res.push(x); });
    out[col] = res;
  });
  return out;
}
const PAYMENT_ACCOUNT_MAP = { "نقدي": "cash", "شبكة": "network", "تحويل بنكي": "bank" };
const ROLE_STAGE_MAP = { "قصّاص": "القص", "خياط": "الخياطة", "كاوي": "الكي", "زرّار": "تركيب الأزرار" };
const STAGE_ROLE_MAP = Object.fromEntries(Object.entries(ROLE_STAGE_MAP).map(([role, stage]) => [stage, role]));

const ALL_MODULES = ["dashboard", "customers", "orders", "courier", "appointments", "designs", "invoices", "employees", "suppliers", "inventory", "returns", "finance", "users", "settings", "reports"];
const ROLES = ["مدير عام", "مدير فرع", "محاسب", "موظف استقبال"];

function defaultPermissions(role) {
  const perms = {};
  ALL_MODULES.forEach((m) => { perms[m] = { view: true, edit: false }; });
  if (role === "مدير عام") { ALL_MODULES.forEach((m) => { perms[m] = { view: true, edit: true }; }); }
  else if (role === "مدير فرع") { ALL_MODULES.forEach((m) => { perms[m] = { view: true, edit: m !== "users" && m !== "settings" }; }); perms.settings = { view: false, edit: false }; }
  else if (role === "محاسب") {
    ALL_MODULES.forEach((m) => { perms[m] = { view: true, edit: ["finance", "reports", "invoices"].includes(m) }; });
    perms.users = { view: false, edit: false };
    perms.settings = { view: false, edit: false };
  } else if (role === "موظف استقبال") {
    ALL_MODULES.forEach((m) => { perms[m] = { view: true, edit: ["customers", "orders", "invoices", "courier"].includes(m) }; });
    perms.users = { view: false, edit: false };
    perms.finance = { view: false, edit: false };
    perms.settings = { view: false, edit: false };
  }
  return perms;
}

const seedData = () => ({
  orderTypes: ["سعودي", "قطري", "كويتي", "عباية نوم"],
  embroideryTypes: [{ id: "emb-1", name: "داخلي" }, { id: "emb-2", name: "خارجي" }],
  measurementFields: [
    { key: "length", label: "الطول" }, { key: "shoulder", label: "الكتف" },
    { key: "chest", label: "الصدر" }, { key: "sleeve", label: "الكم" },
    { key: "neckSize", label: "محيط الرقبة" }, { key: "waist", label: "الوسط" },
    { key: "sleeveDrop", label: "إسقاط الكم" }, { key: "bottomWidth", label: "الدوارة" },
  ],
  designCategories: [
    { id: "neck", name: "الرقبة", items: [{ id: "neck-1", name: "قلاب" }, { id: "neck-2", name: "سادة" }] },
    { id: "cuff", name: "الكبك", items: [{ id: "cuff-1", name: "كبك عادي" }, { id: "cuff-2", name: "كبك فرنسي" }] },
    { id: "pocket", name: "الجيب", items: [{ id: "pocket-1", name: "جيب واحد" }, { id: "pocket-2", name: "جيب مزدوج" }, { id: "pocket-3", name: "بدون جيب" }, { id: "pocket-4", name: "جيب قلم" }] },
    { id: "gabzoor", name: "الجبزور", items: [{ id: "gab-1", name: "جبزور عادي" }, { id: "gab-2", name: "جبزور مخفي" }] },
  ],
  orderStages: ["تم الاستلام", "القص", "الخياطة", "الكي", "تركيب الأزرار", "جاهز للتسليم", "تم التسليم"],
  branches: [{ id: "b1", name: "الفرع الرئيسي" }],
  customers: [], orders: [], employees: [], suppliers: [], purchases: [],
  financeAccounts: [
    { id: "cash", name: "الصندوق", type: "نقدي", balance: 0 },
    { id: "bank", name: "البنك", type: "بنك", balance: 0 },
    { id: "network", name: "الشبكة", type: "شبكة", balance: 0 },
  ],
  vouchers: [], journalEntries: [], appointments: [],
  counters: { customer: 1000, order: 1000, group: 1000, purchase: 1000, voucher: 1000, journal: 1000, empEntry: 5000 },
  employeeLedger: [],
  printSettings: { defaults: {}, customTemplates: [] },
  inventoryItems: [], stockAdjustments: [], consumptionRules: [], freedNumbers: {}, returns: [], closedPeriods: [],
  freedCustomerCodes: [],
  orderGroups: [],
  auditLog: [],
  shopSettings: { name: "مشغل الخياطة الرجالية", legalName: "", logo: "", phone: "", whatsapp: "", address: "", city: "", crNumber: "", taxNumber: "", website: "", bankName: "", iban: "", invoiceFooter: "", appTheme: "classic", readyMessageTemplate: "مرحبًا {name}، طلبك رقم #{orderNo} جاهز للاستلام من {shop}. بانتظارك! 🙏\nتقدر تتابع حالة طلبك من هنا: {trackLink}", thankYouMessageTemplate: "شكرًا لك {name} على ثقتك بنا! يسعدنا تقييم تجربتك: {reviewLink}", reminderMessageTemplate: "تذكير: عندك موعد بـ{shop} بتاريخ {date} الساعة {time}. بانتظارك! 🙏", reviewLink: "", ...WA_NEW_DEFAULTS },
  fabricThresholds: {},
  users: [{ id: "u1", name: "مدير النظام", username: "admin", password: "admin123", phone: "", role: "مدير عام", branches: ["b1"], permissions: defaultPermissions("مدير عام") }],
  invoiceTheme: "classic",
});

// ---------- shared UI ----------
function Field({ label, children }) {
  return <label style={{ display: "block", marginBottom: 12 }}><div style={{ fontSize: 13, color: "#6B6255", marginBottom: 5 }}>{label}</div>{children}</label>;
}
const inputStyle = { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 6, border: `1px solid ${THEME.border}`, background: "#fff", fontSize: 14, fontFamily: "inherit", color: THEME.ink };
function TextInput(props) { return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />; }
function SelectInput({ options, ...props }) { return <select {...props} style={{ ...inputStyle, ...(props.style || {}) }}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>; }
function Badge({ children, color = THEME.brass }) { return <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: `${color}1a`, color }}>{children}</span>; }
function Btn({ children, onClick, variant = "primary", small, type = "button", style, className, disabled }) {
  const styles = {
    primary: { background: THEME.ink, color: THEME.parchment },
    ghost: { background: "transparent", color: THEME.ink, border: `1px solid ${THEME.border}` },
    danger: { background: "transparent", color: THEME.red, border: `1px solid ${THEME.red}55` },
    brass: { background: THEME.brass, color: "#fff" },
  };
  return <button type={type} className={className} onClick={onClick} disabled={disabled} style={{ ...styles[variant], border: styles[variant].border || "none", borderRadius: 7, padding: small ? "6px 10px" : "9px 16px", fontSize: small ? 13 : 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", ...style }}>{children}</button>;
}
function Panel({ children, style }) { return <div style={{ background: THEME.panel, border: `1px solid ${THEME.border}`, borderTop: `3px solid ${THEME.brass}`, borderRadius: 8, padding: 20, ...style }}>{children}</div>; }
function Modal({ title, onClose, children, wide, width }) {
  return (
    <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "#1a1712bb", zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }} onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ background: THEME.panel, borderRadius: 10, width: "100%", maxWidth: width || (wide ? 820 : 460), padding: 24, border: `1px solid ${THEME.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontFamily: "Amiri, serif", fontSize: 22, color: THEME.ink }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B6255" }}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function EmptyState({ text }) { return <div style={{ padding: "40px 10px", textAlign: "center", color: "#8A8071", fontSize: 14 }}>{text}</div>; }

// ---------- WhatsApp notification helpers ----------
function toWhatsAppNumber(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "966" + digits.slice(1);
  else if (!digits.startsWith("966") && digits.length <= 10) digits = "966" + digits;
  return digits;
}
function fillTemplate(template, vars) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}
// ---------- Password hashing (SHA-256 via the browser's built-in Web Crypto API) ----------
async function hashPassword(pw) {
  const enc = new TextEncoder().encode(String(pw));
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function looksHashed(pw) { return typeof pw === "string" && /^[a-f0-9]{64}$/.test(pw); }
async function verifyPassword(input, stored) {
  if (looksHashed(stored)) return (await hashPassword(input)) === stored;
  return (stored || "") === input; // legacy plaintext account, not yet migrated
}
function buildWhatsAppLink(phone, message) {
  return `https://wa.me/${toWhatsAppNumber(phone)}?text=${encodeURIComponent(message)}`;
}
function WhatsAppNotifyButton({ order, data, update, custPhone, custName, templateField = "readyMessageTemplate", trackField = "notifiedAt", buttonLabel = "📱 إرسال إشعار واتساب للعميل", sentLabel = "آخر إشعار مُرسل" }) {
  if (!custPhone) return <div style={{ fontSize: 12, color: "#8A8071" }}>لا يوجد رقم جوال مسجّل لهذا العميل لإرسال الإشعار.</div>;
  const message = fillTemplate(data.shopSettings?.[templateField] ?? WA_NEW_DEFAULTS[templateField], waVars(data, order, custName));
  const send = () => {
    window.open(buildWhatsAppLink(custPhone, message), "_blank");
    update({ orders: data.orders.map((o) => o.id === order.id ? { ...o, [trackField]: new Date().toLocaleString("ar-SA") } : o) });
  };
  return (
    <div style={{ marginTop: 6 }}>
      <Btn small variant="brass" onClick={send}>{buttonLabel}</Btn>
      {order[trackField] && <div style={{ fontSize: 11.5, color: THEME.teal, marginTop: 4 }}>{sentLabel}: {order[trackField]}</div>}
    </div>
  );
}

function BarcodeSVG({ value, height = 46, width = 1.8 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && value) {
      try { JsBarcode(ref.current, String(value), { format: "CODE128", displayValue: true, fontSize: 13, height, width, margin: 4, background: "#ffffff", lineColor: "#211D19" }); } catch (e) { /* ignore invalid value */ }
    }
  }, [value, height, width]);
  if (!value) return null;
  return <svg ref={ref}></svg>;
}

// Shrinks any uploaded image to a small JPEG before it's stored, since everything
// is saved as one JSON blob in the browser's limited local storage. Without this,
// a few full-size phone photos can silently blow past the storage quota.
function compressImageDataUrl(dataUrl, maxDim = 480, quality = 0.72) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
        else { width = Math.round(width * (maxDim / height)); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      try { resolve(canvas.toDataURL("image/jpeg", quality)); } catch (e) { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ---------- design icons / thumbnails ----------
function DesignIcon({ name, size = 44 }) {
  const s = size;
  const common = { width: s, height: s, viewBox: "0 0 64 64", fill: "none", stroke: THEME.ink, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name.includes("قلاب")) return <svg {...common}><path d="M12 14 L32 30 L52 14" /><path d="M12 14 L20 46" /><path d="M52 14 L44 46" /><path d="M20 46 Q32 40 44 46" /></svg>;
  if (name.includes("سادة") || name.includes("مخفي")) return <svg {...common}><rect x="20" y="12" width="24" height="14" rx="3" /><path d="M20 26 Q32 34 44 26" /></svg>;
  if (name.includes("فرنسي")) return <svg {...common}><rect x="14" y="20" width="36" height="16" rx="2" /><circle cx="22" cy="28" r="2.5" fill={THEME.ink} /><circle cx="42" cy="28" r="2.5" fill={THEME.ink} /></svg>;
  if (name.includes("كبك")) return <svg {...common}><rect x="16" y="18" width="32" height="20" rx="3" /><circle cx="32" cy="28" r="2.5" fill={THEME.ink} /></svg>;
  if (name.includes("مزدوج")) return <svg {...common}><rect x="10" y="16" width="18" height="24" rx="2" /><rect x="36" y="16" width="18" height="24" rx="2" /></svg>;
  if (name.includes("بدون")) return <svg {...common}><line x1="14" y1="14" x2="50" y2="50" stroke={THEME.red} /><rect x="20" y="20" width="24" height="24" rx="3" opacity="0.4" /></svg>;
  if (name.includes("جيب")) return <svg {...common}><rect x="18" y="18" width="28" height="26" rx="3" /><path d="M18 24 L46 24" /></svg>;
  if (name.includes("جبزور")) return <svg {...common}><path d="M12 50 V20 Q32 8 52 20 V50" /><path d="M12 50 L52 50" /></svg>;
  return <svg {...common}><circle cx="32" cy="32" r="22" strokeDasharray="4 4" /><text x="32" y="37" textAnchor="middle" fontSize="18" stroke="none" fill={THEME.ink} fontFamily="Tajawal">{name.slice(0, 1)}</text></svg>;
}
function DesignThumb({ item, size = 44 }) {
  if (!item) return null;
  if (item.image) return <img src={item.image} alt={item.name} style={{ width: size, height: size, objectFit: "cover", borderRadius: 6, border: `1px solid ${THEME.border}` }} />;
  return <DesignIcon name={item.name} size={size} />;
}
function FakeQR({ seed, size = 84 }) {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const cells = 7, rects = [];
  for (let r = 0; r < cells; r++) for (let c = 0; c < cells; c++) {
    h = (h * 1103515245 + 12345) >>> 0;
    if (h % 2 === 0) rects.push(<rect key={`${r}-${c}`} x={c * (size / cells)} y={r * (size / cells)} width={size / cells} height={size / cells} fill={THEME.ink} />);
  }
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ background: "#fff", border: `1px solid ${THEME.border}` }}>{rects}</svg>;
}

// ---------- generic crud section ----------
function CrudSection({ icon: Icon, title, columns, items, renderRow, onAdd, onEdit, onDelete, addLabel, searchKeys, extraHeader }) {
  const [q, setQ] = useState("");
  const filtered = q ? items.filter((it) => searchKeys.some((k) => String(it[k] || "").toLowerCase().includes(q.toLowerCase()))) : items;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Icon size={22} color={THEME.brass} /><h2 style={{ margin: 0, fontFamily: "Amiri, serif", fontSize: 26, color: THEME.ink }}>{title}</h2></div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {extraHeader}
          {searchKeys && <div style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", right: 10, top: 10, color: "#9a9182" }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث..." style={{ ...inputStyle, paddingRight: 32, width: 180 }} /></div>}
          {onAdd && <Btn variant="brass" onClick={onAdd}><Plus size={16} />{addLabel}</Btn>}
        </div>
      </div>
      <Panel style={{ padding: 0, overflow: "hidden" }}>
        {filtered.length === 0 ? <EmptyState text="لا توجد بيانات بعد" /> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ background: "#EFE7D6" }}>{columns.map((c) => <th key={c} style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#5C5344", fontSize: 12.5 }}>{c}</th>)}{(onEdit || onDelete) && <th></th>}</tr></thead>
              <tbody>
                {filtered.map((it) => (
                  <tr key={it.id} style={{ borderTop: `1px solid ${THEME.border}` }}>
                    {renderRow(it)}
                    {(onEdit || onDelete) && <td style={{ padding: "8px 14px", whiteSpace: "nowrap" }}><div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>{onEdit && <button onClick={() => onEdit(it)} style={{ background: "none", border: "none", cursor: "pointer", color: THEME.teal }}><Pencil size={16} /></button>}{onDelete && <button onClick={() => onDelete(it)} style={{ background: "none", border: "none", cursor: "pointer", color: THEME.red }}><Trash2 size={16} /></button>}</div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
function FormFields({ fields, values, setValues }) {
  return fields.map((f) => (
    <Field key={f.key} label={f.label}>
      {f.type === "select" ? <SelectInput options={f.options} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
        : f.type === "textarea" ? <textarea value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        : <TextInput type={f.type || "text"} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />}
    </Field>
  ));
}
function NoAccess() { return <Panel><EmptyState text="لا تملك صلاحية الوصول لهذه الشاشة — راجع مدير النظام." /></Panel>; }

function AttachmentField({ value, onChange }) {
  const fileRef = useRef(null);
  const onFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (file.type.startsWith("image/")) {
        const compressed = await compressImageDataUrl(reader.result, 700, 0.75);
        onChange({ dataUrl: compressed, name: file.name, type: "image/jpeg" });
      } else {
        if (file.size > 1.5 * 1024 * 1024) alert("هذا الملف كبير نسبيًا (أكبر من 1.5 ميجا) — قد لا يُحفظ بنجاح بمساحة تخزين المتصفح المحدودة. يُفضّل ملف أصغر إن أمكن.");
        onChange({ dataUrl: reader.result, name: file.name, type: file.type });
      }
    };
    reader.readAsDataURL(file);
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: "#6B6255", marginBottom: 5 }}>المرفق (صورة الفاتورة الأصلية أو مستند PDF)</div>
      {value?.dataUrl ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {value.type?.startsWith("image/") ? <img src={value.dataUrl} alt="" style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 6, border: `1px solid ${THEME.border}` }} /> : <div style={{ width: 46, height: 46, borderRadius: 6, border: `1px solid ${THEME.border}`, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", fontSize: 18 }}>📄</div>}
          <div style={{ fontSize: 12.5, flex: 1 }}>{value.name}</div>
          <span style={{ color: THEME.red, fontSize: 12.5, cursor: "pointer" }} onClick={() => onChange(null)}>إزالة</span>
        </div>
      ) : (
        <Btn small variant="ghost" onClick={() => fileRef.current.click()}><Upload size={14} />إرفاق ملف</Btn>
      )}
      <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={onFile} style={{ display: "none" }} />
    </div>
  );
}

// ---------- Professional A4 print system ----------
// Every printed document (invoices, vouchers, journal entries, statements) is rendered by <PrintSheet>,
// styled by a template object. Built-in templates are listed below; users can duplicate any of them
// (or start from scratch, with their own letterhead image) from "بيانات المحل" ← "قوالب الطباعة".
const FONT_MAP = { tajawal: "Tajawal, sans-serif", amiri: "Amiri, serif", cairo: "Cairo, Tajawal, sans-serif" };
const BUILTIN_TEMPLATES = [
  { id: "classic", label: "كلاسيكي", builtin: true, accent: "#A9752E", font: "amiri", header: "line", frame: "single", table: "striped", showLogo: true, showSignatures: true },
  { id: "modern", label: "عصري (شريط علوي)", builtin: true, accent: "#2E5A54", font: "tajawal", header: "band", frame: "none", table: "striped", showLogo: true, showSignatures: true },
  { id: "elegant", label: "أنيق (إطار مزدوج ذهبي)", builtin: true, accent: "#B8860B", font: "amiri", header: "center", frame: "double", table: "plain", showLogo: true, showSignatures: true },
  { id: "minimal", label: "مبسّط", builtin: true, accent: "#333333", font: "tajawal", header: "split", frame: "none", table: "plain", showLogo: true, showSignatures: true },
  { id: "royal", label: "ملكي (أزرق رسمي)", builtin: true, accent: "#1F3A68", font: "cairo", header: "band", frame: "single", table: "grid", showLogo: true, showSignatures: true },
  { id: "business", label: "تجاري (عنابي)", builtin: true, accent: "#7A1F2B", font: "cairo", header: "split", frame: "none", table: "grid", showLogo: true, showSignatures: true },
];
const DOC_TYPE_LABELS = [["invoice", "الفواتير وبطاقات الطلبات"], ["voucher", "السندات (قبض / صرف / مشتريات)"], ["journal", "قيود التحويل"], ["statement", "كشوفات الحساب (عملاء / موردين / موظفين)"]];
const allTemplates = (data) => [...BUILTIN_TEMPLATES, ...(data.printSettings?.customTemplates || [])];
function resolveTpl(data, docType, override) {
  const all = allTemplates(data);
  const id = override || data.printSettings?.defaults?.[docType] || "classic";
  return all.find((t) => t.id === id) || all[0];
}
const hexAlpha = (c, a) => (/^#[0-9a-fA-F]{6}$/.test(c || "") ? c + a : c);

function tplTable(t) {
  const A = t.accent || "#A9752E";
  const base = { width: "100%", borderCollapse: "collapse", fontSize: 12.5 };
  if (t.table === "grid") return { table: { ...base, border: `1px solid ${A}` }, th: { padding: "7px 8px", textAlign: "right", background: hexAlpha(A, "26"), color: "#211D19", border: `1px solid ${A}`, fontWeight: 700 }, td: () => ({ padding: "6px 8px", border: `1px solid ${hexAlpha(A, "66")}` }) };
  if (t.table === "plain") return { table: base, th: { padding: "7px 8px", textAlign: "right", borderBottom: `2px solid ${A}`, color: A, fontWeight: 700 }, td: () => ({ padding: "6px 8px", borderBottom: "1px solid #e6e1d6" }) };
  return { table: base, th: { padding: "7px 8px", textAlign: "right", background: A, color: "#fff", fontWeight: 700 }, td: (i) => ({ padding: "6px 8px", background: i % 2 ? hexAlpha(A, "10") : "transparent", borderBottom: "1px solid #eee8da" }) };
}
function PTable({ tpl, columns, rows }) {
  const T = tplTable(tpl);
  return (
    <table style={T.table}>
      <thead style={{ display: "table-header-group" }}><tr>{columns.map((c) => <th key={c.key} style={{ ...T.th, textAlign: c.align || "right", width: c.width }}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.key ?? i} style={{ pageBreakInside: "avoid" }}>{columns.map((c) => <td key={c.key} style={{ ...T.td(i), textAlign: c.align || "right", fontWeight: c.bold ? 700 : 400 }}>{r[c.key]}</td>)}</tr>)}</tbody>
    </table>
  );
}

// Amount in Arabic words ("فقط ... لا غير") for vouchers.
function tafqeet(num) {
  const n = round2(num);
  const riyals = Math.floor(n + 1e-9), halalas = Math.round((n - riyals) * 100);
  if (riyals >= 1e12) return "";
  const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
  const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
  const HUND = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
  const below1000 = (x) => {
    const parts = []; const h = Math.floor(x / 100), r = x % 100;
    if (h) parts.push(HUND[h]);
    if (r) { if (r < 20) parts.push(ONES[r]); else { const o = r % 10, t = Math.floor(r / 10); parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]); } }
    return parts.join(" و");
  };
  const scales = [{ one: "ألف", two: "ألفان", few: "آلاف", many: "ألف" }, { one: "مليون", two: "مليونان", few: "ملايين", many: "مليون" }, { one: "مليار", two: "ملياران", few: "مليارات", many: "مليار" }];
  const words = (x) => {
    const groups = []; let rest = x; while (rest > 0) { groups.push(rest % 1000); rest = Math.floor(rest / 1000); }
    const out = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i]; if (!g) continue;
      if (i === 0) out.push(below1000(g));
      else { const sc = scales[i - 1]; out.push(g === 1 ? sc.one : g === 2 ? sc.two : `${below1000(g)} ${g <= 10 ? sc.few : sc.many}`); }
    }
    return out.join(" و");
  };
  const unitText = (x, f) => { if (x === 1) return f[0]; if (x === 2) return f[1]; const l2 = x % 100; return `${words(x)} ${l2 >= 3 && l2 <= 10 ? f[2] : l2 >= 11 ? f[3] : f[4]}`; };
  const parts = [];
  if (riyals > 0) parts.push(unitText(riyals, ["ريال سعودي واحد", "ريالان سعوديان", "ريالات سعودية", "ريالاً سعوديًا", "ريال سعودي"]));
  if (halalas > 0) parts.push(unitText(halalas, ["هللة واحدة", "هللتان", "هللات", "هللة", "هللة"]));
  if (!parts.length) return "صفر ريال";
  return `${parts.join(" و")} فقط لا غير`;
}

function TemplatePicker({ data, value, onChange, docType }) {
  const cur = value || data.printSettings?.defaults?.[docType] || "classic";
  return <SelectInput options={allTemplates(data).map((t) => ({ value: t.id, label: t.label }))} value={cur} onChange={(e) => onChange(e.target.value)} />;
}

function PrintSheet({ data, tpl, preview, title, docNo, docNoLabel = "رقم", date, meta, parties, children, totals, amount, notes, signatures, barcode, attachment, showBank = true, footerNote }) {
  const t = tpl || BUILTIN_TEMPLATES[0];
  const full = !!t.pageImage;   // a complete ready-made page design (letterhead, borders, footer ... all inside the image)
  const A = t.accent || "#A9752E";
  const head = FONT_MAP[t.font] || FONT_MAP.tajawal;
  const body = t.font === "amiri" ? FONT_MAP.tajawal : head;
  const sh = data.shopSettings || {};
  const printedAt = new Date().toLocaleDateString("ar-SA") + " " + new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
  const shopLines = [[sh.phone, sh.city, sh.address].filter(Boolean).join(" — "), [sh.crNumber && `س.ت: ${sh.crNumber}`, sh.taxNumber && `الرقم الضريبي: ${sh.taxNumber}`].filter(Boolean).join(" — ")].filter(Boolean);
  const shopName = sh.legalName || sh.name || "المحل";
  const shopInfo = (light, center) => (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexDirection: center ? "column" : "row", textAlign: center ? "center" : "right" }}>
      {t.showLogo !== false && sh.logo && <img src={sh.logo} alt="" style={{ width: center ? 54 : 46, height: center ? 54 : 46, objectFit: "cover", borderRadius: 8, border: light ? "1px solid rgba(255,255,255,.6)" : `1px solid ${hexAlpha(A, "55")}` }} />}
      <div>
        <div style={{ fontFamily: head, fontSize: 21, fontWeight: 700, lineHeight: 1.25 }}>{shopName}</div>
        {sh.legalName && sh.name && sh.legalName !== sh.name && <div style={{ fontSize: 12, opacity: 0.85 }}>{sh.name}</div>}
        {shopLines.map((l, i) => <div key={i} style={{ fontSize: 11, opacity: 0.85 }}>{l}</div>)}
      </div>
    </div>
  );
  const titleBlock = (light, boxed) => (
    <div style={{ textAlign: "center", minWidth: 150, ...(boxed ? { border: `1.5px solid ${A}`, borderRadius: 6, padding: "8px 14px" } : {}) }}>
      <div style={{ fontFamily: head, fontSize: 24, fontWeight: 700, color: light ? "#fff" : A, lineHeight: 1.2 }}>{title}</div>
      {docNo !== undefined && docNo !== "" && <div style={{ fontSize: 13, marginTop: 4, fontWeight: 700 }}>{docNoLabel}: <span style={{ letterSpacing: 0.5 }}>{docNo}</span></div>}
      {date && <div style={{ fontSize: 12, marginTop: 2, opacity: 0.9 }}>التاريخ: {date}</div>}
    </div>
  );
  let header;
  if (full && (t.pageHeader || "compact") === "none") {
    header = null;
  } else if (full && (t.pageHeader || "compact") === "compact") {
    header = (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `2px solid ${A}`, paddingBottom: 6 }}>
        <div style={{ fontFamily: head, fontSize: 22, fontWeight: 700, color: A }}>{title}</div>
        <div style={{ textAlign: "left", fontSize: 12.5 }}>{docNo !== undefined && docNo !== "" && <div style={{ fontWeight: 700 }}>{docNoLabel}: {docNo}</div>}{date && <div>التاريخ: {date}</div>}</div>
      </div>
    );
  } else if (t.headerImage) {
    header = (
      <div>
        <img src={t.headerImage} alt="" style={{ width: "100%", display: "block" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, borderBottom: `2px solid ${A}`, paddingBottom: 8 }}>
          <div style={{ fontFamily: head, fontSize: 22, fontWeight: 700, color: A }}>{title}</div>
          <div style={{ textAlign: "left", fontSize: 12.5 }}>{docNo !== undefined && docNo !== "" && <div style={{ fontWeight: 700 }}>{docNoLabel}: {docNo}</div>}{date && <div>التاريخ: {date}</div>}</div>
        </div>
      </div>
    );
  } else if (t.header === "band") {
    header = <div style={{ background: A, color: "#fff", borderRadius: 6, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>{shopInfo(true)}{titleBlock(true)}</div>;
  } else if (t.header === "center") {
    header = (
      <div style={{ textAlign: "center" }}>
        {shopInfo(false, true)}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0" }}><div style={{ flex: 1, height: 1, background: A }} /><div style={{ width: 8, height: 8, background: A, transform: "rotate(45deg)" }} /><div style={{ flex: 1, height: 1, background: A }} /></div>
        {titleBlock(false, true)}
      </div>
    );
  } else if (t.header === "split") {
    header = <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottom: `1px solid ${A}` }}>{shopInfo(false)}{titleBlock(false, true)}</div>;
  } else {
    header = <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottom: `3px solid ${A}` }}>{shopInfo(false)}{titleBlock(false)}</div>;
  }
  const frameStyle = full ? { padding: 0 } : t.frame === "single" ? { border: `1.5px solid ${A}`, padding: "7mm" } : t.frame === "double" ? { border: `4px double ${A}`, padding: "7mm" } : { padding: 0 };
  const card = (c, i) => (
    <div key={i} style={{ border: `1px solid ${hexAlpha(A, "55")}`, borderTop: `3px solid ${A}`, borderRadius: 4, padding: "8px 10px", background: hexAlpha(A, "08") }}>
      <div style={{ fontWeight: 700, color: A, marginBottom: 5, fontSize: 13 }}>{c.title}</div>
      {(c.rows || []).map((r, j) => <div key={j} style={{ fontSize: 12.5, marginBottom: 2 }}>{r.label}: <b>{r.value}</b></div>)}
      {(c.lines || []).map((l, j) => <div key={`l${j}`} style={{ fontSize: 12.5, marginBottom: 2 }}>{l}</div>)}
    </div>
  );
  return (
    <div className={preview ? "" : "printable"} style={{ width: preview ? "794px" : "210mm", minHeight: preview ? "1123px" : "297mm", background: "#fff", color: "#211D19", boxSizing: "border-box", padding: full ? `${t.contentTop ?? 45}mm ${t.contentSide ?? 15}mm ${t.contentBottom ?? 30}mm` : "10mm", margin: "0 auto", position: "relative", fontFamily: body, display: "flex", flexDirection: "column", boxShadow: preview ? "none" : "0 2px 10px rgba(0,0,0,.18)", overflow: "hidden", ...(full ? { background: `#fff url(${t.pageImage}) top center / 100% ${preview ? "1123px" : "297mm"} repeat-y` } : {}) }}>
      {t.watermark && <div style={{ position: "absolute", top: "42%", left: 0, right: 0, textAlign: "center", fontSize: 96, fontWeight: 700, color: t.watermarkColor || A, opacity: t.watermarkOpacity || 0.06, transform: "rotate(-28deg)", pointerEvents: "none", fontFamily: head }}>{t.watermark}</div>}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", ...frameStyle }}>
        {header}
        {meta && meta.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 12 }}>
            {meta.map((m, i) => <div key={i} style={{ background: hexAlpha(A, "10"), borderRadius: 4, padding: "6px 9px" }}><div style={{ fontSize: 10.5, color: "#7A7061" }}>{m.label}</div><div style={{ fontSize: 13, fontWeight: 700 }}>{m.value}</div></div>)}
          </div>
        )}
        {amount !== undefined && amount !== null && (
          <div style={{ marginTop: 12, border: `2px solid ${A}`, borderRadius: 6, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, background: hexAlpha(A, "0c") }}>
            <div style={{ fontSize: 12, color: "#5C5344" }}>المبلغ</div>
            <div style={{ fontFamily: head, fontSize: 26, fontWeight: 700, color: A, whiteSpace: "nowrap" }}>{fmtNum(amount)} ر.س</div>
            <div style={{ fontSize: 12.5, flex: 1, textAlign: "left" }}>{tafqeet(amount)}</div>
          </div>
        )}
        {parties && parties.length > 0 && <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(parties.length, 2)}, 1fr)`, gap: 10, marginTop: 12 }}>{parties.map(card)}</div>}
        <div style={{ marginTop: 14, flex: 1 }}>{children}</div>
        {totals && totals.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <table style={{ width: "52%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>{totals.map((r, i) => <tr key={i} style={r.strong ? { background: A, color: "#fff", fontWeight: 700, fontSize: 14 } : {}}><td style={{ padding: "6px 10px", borderBottom: r.strong ? "none" : "1px solid #e6e1d6" }}>{r.label}</td><td style={{ padding: "6px 10px", textAlign: "left", borderBottom: r.strong ? "none" : "1px solid #e6e1d6", fontWeight: 700 }}>{r.value}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {notes && <div style={{ marginTop: 10, fontSize: 12, color: "#5C5344", borderRight: `3px solid ${A}`, padding: "2px 10px" }}>{notes}</div>}
        {attachment?.dataUrl && attachment.type?.startsWith("image/") && (
          <div style={{ marginTop: 12 }}><div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>المرفق</div><img src={attachment.dataUrl} alt="" style={{ maxWidth: "100%", maxHeight: 260, borderRadius: 4, border: `1px solid ${THEME.border}` }} /></div>
        )}
        {barcode && <div style={{ textAlign: "center", marginTop: 10 }}><BarcodeSVG value={barcode} height={34} width={1.4} /></div>}
        {t.showSignatures !== false && signatures && signatures.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${signatures.length}, 1fr)`, gap: 22, marginTop: 30, fontSize: 12.5, color: "#5C5344" }}>
            {signatures.map((sg) => <div key={sg} style={{ textAlign: "center" }}><div style={{ borderBottom: "1px solid #8A8071", height: 30, marginBottom: 5 }} />{sg}</div>)}
          </div>
        )}
        {(!full || t.pageShowFooter) && <div style={{ marginTop: 18, borderTop: `1px solid ${hexAlpha(A, "66")}`, paddingTop: 7, fontSize: 10.5, color: "#7A7061", textAlign: "center" }}>
          {showBank && sh.bankName && <div>تحويل بنكي: {sh.bankName}{sh.iban ? ` — آيبان: ${sh.iban}` : ""}</div>}
          {(t.footerText || footerNote) && <div style={{ fontSize: 11.5, color: "#5C5344", margin: "2px 0" }}>{t.footerText || footerNote}</div>}
          {t.footerImage && <img src={t.footerImage} alt="" style={{ width: "100%", display: "block", margin: "4px 0" }} />}
          <div>{[sh.website, `طُبع بتاريخ ${printedAt}`].filter(Boolean).join(" — ")}</div>
        </div>}
      </div>
    </div>
  );
}

// Preview stage shared by every print modal: template picker + print button + gray "desk" around the A4 sheet.
function PrintStage({ data, docType, tplId, setTplId, children, extraControls }) {
  return (
    <>
      <div className="no-print" style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ width: 250 }}><Field label="قالب الطباعة"><TemplatePicker data={data} docType={docType} value={tplId} onChange={setTplId} /></Field></div>
        {extraControls}
        <Btn variant="brass" onClick={() => window.print && window.print()} style={{ marginBottom: 12 }}><Printer size={15} />طباعة A4</Btn>
      </div>
      <div className="print-stage" style={{ background: "#E4DFD2", padding: 12, borderRadius: 8, overflowX: "auto" }}>{children}</div>
    </>
  );
}

function RecordPrintModal({ data, title, refLabel, refNo, rows, attachment, onClose, partyTitle, partyRows, signatures, docType = "voucher", amount, date, cancelled }) {
  const [tplId, setTplId] = useState(null);
  const tpl = { ...resolveTpl(data, docType, tplId), ...(cancelled ? { watermark: "ملغى", watermarkColor: "#B3261E", watermarkOpacity: 0.16 } : {}) };
  return (
    <Modal title={title} onClose={onClose} width={900}>
      <PrintStage data={data} docType={docType} tplId={tplId} setTplId={setTplId}>
        <PrintSheet data={data} tpl={tpl} title={title} docNo={refNo} docNoLabel="رقم" date={date}
          meta={rows} amount={amount} attachment={attachment} signatures={signatures}
          parties={partyRows && partyRows.length ? [{ title: partyTitle, rows: partyRows }] : undefined} barcode={refNo} />
      </PrintStage>
    </Modal>
  );
}

// Resolves the "who received / who paid" party of a voucher into printable rows.
// Looks the person up live (so edits to their data show up) and falls back to the
// snapshot saved on the voucher itself when the record no longer exists.
function voucherPartyInfo(data, v) {
  const rows = [];
  const add = (label, value) => { if (value !== undefined && value !== null && String(value).trim() !== "") rows.push({ label, value: String(value) }); };
  const branchName = (id) => data.branches.find((b) => b.id === id)?.name;
  let kind = v.partyType || "";
  if (!kind && v.employeeId) kind = "موظف";
  if (!kind && v.supplierId) kind = "مورد";
  const order = v.orderId ? data.orders.find((o) => o.id === v.orderId) : null;
  if (!kind && order) kind = "عميل";
  const partyId = v.partyId || v.employeeId || v.supplierId || order?.customerId;
  if (kind === "موظف") {
    const e = data.employees.find((x) => x.id === partyId);
    add("الاسم", e?.name || v.partyName); add("الصفة", "موظف" + (e?.role ? ` — ${e.role}` : "")); add("الجوال", e?.phone || v.partyPhone);
    add("رقم الهوية / الإقامة", e?.idNumber); add("الفرع", e ? empBranches(data, e).map(branchName).filter(Boolean).join("، ") : "");
  } else if (kind === "مورد") {
    const sp = data.suppliers.find((x) => x.id === partyId);
    add("الاسم", sp?.name || v.partyName); add("الصفة", "مورد" + (sp?.materialType ? ` — ${sp.materialType}` : "")); add("الجوال", sp?.phone || v.partyPhone);
  } else if (kind === "عميل") {
    const c = data.customers.find((x) => x.id === partyId);
    add("الاسم", c?.name || v.partyName); add("الصفة", "عميل" + (c?.code ? ` — كود ${c.code}` : "")); add("الجوال", c?.phone || v.partyPhone);
    if (order) add("رقم الطلب", `#${order.orderNo || order.id.slice(-6)}`);
  } else if (kind === "أخرى" || v.partyName) {
    add("الاسم", v.partyName); add("الجوال", v.partyPhone); add("الصفة", "جهة أخرى");
  }
  return rows;
}

function VoucherPrintModal({ data, voucher, onClose }) {
  const isReceipt = voucher.type === "قبض";
  const title = isReceipt ? "سند قبض" : "سند صرف";
  const partyRows = voucherPartyInfo(data, voucher);
  const created = voucher.createdAt ? new Date(voucher.createdAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <RecordPrintModal data={data} title={title} refLabel={title} refNo={voucher.voucherNo || voucher.id.slice(-6)} attachment={voucher.attachment} onClose={onClose}
      docType="voucher" cancelled={voucher.status === "cancelled"} date={`${voucher.date || "—"}${created ? " — " + created : ""}`} amount={Number(voucher.amount) || 0}
      partyTitle={isReceipt ? "بيانات الدافع (المقبوض منه)" : "بيانات المستلم (المصروف له)"}
      partyRows={partyRows.length ? partyRows : [{ label: isReceipt ? "المقبوض منه" : "المستلم", value: "غير محدد" }]}
      signatures={isReceipt ? ["توقيع الدافع", "توقيع المحاسب / أمين الصندوق"] : ["توقيع المستلم", "توقيع المحاسب / أمين الصندوق"]}
      rows={[
        { label: "الحساب", value: data.financeAccounts.find((a) => a.id === voucher.accountId)?.name || "—" },
        { label: "الفرع", value: data.branches.find((b) => b.id === voucher.branch)?.name || "—" },
        { label: "التصنيف", value: voucher.category || "—" },
        { label: "البيان", value: voucher.description || "—" },
        ...(voucher.createdBy ? [{ label: "أنشأه", value: voucher.createdBy }] : []),
        ...(voucher.status === "cancelled" ? [{ label: "الحالة", value: "ملغى" }, { label: "سبب الإلغاء", value: voucher.cancelReason || "—" }, { label: "ألغاه", value: `${voucher.cancelledBy || "—"} — ${voucher.cancelledAt ? new Date(voucher.cancelledAt).toLocaleDateString("ar-SA") : ""}` }] : []),
      ]} />
  );
}

// Lets a voucher say who it was received from / paid to (customer, supplier, employee or someone else).
function PartyPicker({ data, values, setValues }) {
  const t = values.partyType || "";
  const list = t === "عميل" ? data.customers : t === "مورد" ? data.suppliers : t === "موظف" ? data.employees : [];
  const pick = (id) => { const item = list.find((x) => x.id === id); setValues({ ...values, partyId: id, partyName: item?.name || "", partyPhone: item?.phone || "" }); };
  return (
    <>
      <Field label={values.type === "صرف" ? "المستلم (المصروف له)" : "المقبوض منه"}>
        <SelectInput options={[{ value: "", label: "بدون تحديد" }, ...["عميل", "مورد", "موظف", "أخرى"].map((x) => ({ value: x, label: x }))]} value={t} onChange={(e) => setValues({ ...values, partyType: e.target.value, partyId: "", partyName: "", partyPhone: "" })} />
      </Field>
      {["عميل", "مورد", "موظف"].includes(t) && (
        <Field label={`اختر ${t}`}>
          <SelectInput options={[{ value: "", label: "— اختر —" }, ...list.map((x) => ({ value: x.id, label: x.name }))]} value={values.partyId || ""} onChange={(e) => pick(e.target.value)} />
        </Field>
      )}
      {t === "أخرى" && (
        <>
          <Field label="الاسم"><TextInput value={values.partyName || ""} onChange={(e) => setValues({ ...values, partyName: e.target.value })} /></Field>
          <Field label="الجوال"><TextInput value={values.partyPhone || ""} onChange={(e) => setValues({ ...values, partyPhone: e.target.value })} /></Field>
        </>
      )}
    </>
  );
}

// Customer invoice / tailor card / grouped-order invoice on A4.
function InvoicePrintModal({ data, onClose, order, group, kind }) {
  const [tplId, setTplId] = useState(null);
  const tpl = resolveTpl(data, "invoice", tplId);
  const members = group ? data.orders.filter((o) => o.groupId === group.id) : [order];
  const customer = data.customers.find((c) => c.id === (group ? group.customerId : order.customerId));
  const branchName = (id) => data.branches.find((b) => b.id === id)?.name;
  const isTailor = kind === "tailor";
  const net = (o) => Math.max(0, (Number(o.price) || 0) - (Number(o.discount) || 0));
  const totalPrice = members.reduce((t, o) => t + (Number(o.price) || 0), 0);
  const totalDisc = members.reduce((t, o) => t + (Number(o.discount) || 0), 0);
  const totalNet = members.reduce((t, o) => t + net(o), 0);
  const totalPaid = members.reduce((t, o) => t + (Number(o.deposit) || 0), 0);
  const first = members[0] || {};
  const docNo = group ? group.groupNo : (first.orderNo || first.id?.slice(-6));
  const title = group ? "فاتورة طلبية" : isTailor ? "بطاقة تفصيل" : "فاتورة";
  const A = tpl.accent || "#A9752E";
  const lineRows = members.map((o, i) => {
    const emb = o.embroideryType && o.embroideryType !== "بدون" ? ` — تطريز ${o.embroideryType}` : "";
    return isTailor
      ? { key: o.id, n: i + 1, d: `طلب #${o.orderNo || o.id.slice(-6)} — ${o.orderType || ""}${emb}`, fabric: o.fabricType || "—", used: `${o.fabricUsed || 0} م`, due: o.deliveryDate || "—" }
      : { key: o.id, n: i + 1, d: `طلب #${o.orderNo || o.id.slice(-6)} — ${o.orderType || ""}${emb}`, q: 1, p: fmtNum(o.price), disc: Number(o.discount) ? fmtNum(o.discount) : "—", net: fmtNum(net(o)) };
  });
  const columns = isTailor
    ? [{ key: "n", label: "#", width: 30 }, { key: "d", label: "الطلب" }, { key: "fabric", label: "القماش" }, { key: "used", label: "الكمية المستخدمة" }, { key: "due", label: "موعد التسليم" }]
    : [{ key: "n", label: "#", width: 30 }, { key: "d", label: "البيان" }, { key: "q", label: "الكمية", align: "center", width: 60 }, { key: "p", label: "السعر", align: "center", width: 80 }, { key: "disc", label: "الخصم", align: "center", width: 70 }, { key: "net", label: "الصافي", align: "center", width: 90, bold: true }];
  const details = (o) => (
    <div key={o.id} style={{ marginTop: 12, pageBreakInside: "avoid" }}>
      <div style={{ fontWeight: 700, color: A, fontSize: 13, marginBottom: 4 }}>المقاسات والتصاميم — طلب #{o.orderNo || o.id.slice(-6)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, fontSize: 12 }}>
        {data.measurementFields.map((m) => <div key={m.key} style={{ border: "1px solid #e6e1d6", borderRadius: 3, padding: "3px 7px" }}>{m.label}: <b>{o.measurements?.[m.key] || "—"}</b></div>)}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        {data.designCategories.map((c) => { const item = c.items.find((i) => i.id === o.designs?.[c.id]); return item ? <div key={c.id} style={{ textAlign: "center" }}><DesignThumb item={item} size={32} /><div style={{ fontSize: 10 }}>{c.name}: {item.name}</div></div> : null; })}
      </div>
      {isTailor && o.embroideryType && o.embroideryType !== "بدون" && <div style={{ fontSize: 12, marginTop: 6 }}>التطريز: {o.embroideryType}{o.embroideryNotes ? ` — ${o.embroideryNotes}` : ""}</div>}
      {o.notes && <div style={{ fontSize: 12, marginTop: 4 }}>ملاحظات: {o.notes}</div>}
    </div>
  );
  return (
    <Modal title={title} onClose={onClose} width={900}>
      <PrintStage data={data} docType="invoice" tplId={tplId} setTplId={setTplId}>
        <PrintSheet data={data} tpl={tpl} title={title} docNo={docNo} docNoLabel={group ? "طلبية رقم" : "رقم الطلب"} date={first.createdAt || ""}
          barcode={String(docNo || "")} footerNote={isTailor ? "" : data.shopSettings?.invoiceFooter}
          parties={[
            { title: "بيانات العميل", rows: [{ label: "الاسم", value: customer?.name || "—" }, ...(customer?.phone ? [{ label: "الجوال", value: customer.phone }] : []), ...(customer?.code ? [{ label: "كود العميل", value: `#${customer.code}` }] : [])] },
            { title: "بيانات الطلب", rows: [{ label: "الفرع", value: branchName(first.branch) || "—" }, { label: "موعد التسليم", value: first.deliveryDate || "—" }, ...(!isTailor ? [{ label: "طريقة الدفع", value: first.paymentMethod || "—" }] : [])] },
          ]}
          totals={isTailor ? undefined : [
            { label: "الإجمالي", value: `${fmtNum(totalPrice)} ر.س` },
            ...(totalDisc > 0 ? [{ label: "الخصم", value: `− ${fmtNum(totalDisc)} ر.س` }] : []),
            { label: "الصافي المستحق", value: `${fmtNum(totalNet)} ر.س` },
            { label: "المدفوع (عربون ودفعات)", value: `${fmtNum(totalPaid)} ر.س` },
            { label: "المتبقي", value: `${fmtNum(totalNet - totalPaid)} ر.س`, strong: true },
          ]}
          notes={!isTailor && first.paymentMethod?.includes("تقسيط") ? "خيار التقسيط يتطلب ربط حساب تاجر فعلي مع المزوّد لإتمام العملية." : undefined}
          signatures={isTailor ? ["القصّاص", "الخياط", "المراجع"] : ["توقيع العميل", "المستلم / أمين الصندوق"]}>
          <PTable tpl={tpl} columns={columns} rows={lineRows} />
          {members.map(details)}
          {tpl.showQR && !isTailor && <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}><FakeQR seed={String(docNo)} /><div style={{ fontSize: 9, color: "#8A8071", maxWidth: 140 }}>رمز تجريبي — الفاتورة الإلكترونية المعتمدة تتطلب حلًا مرخّصًا من هيئة الزكاة والضريبة</div></div>}
        </PrintSheet>
      </PrintStage>
    </Modal>
  );
}

// ---------- Shared statement viewer (customers / suppliers / employees) ----------
// Rows are { key, no, noLabel, date, desc, kind, inc, dec, branch | weights, ... }.
// balance = opening + Σinc − Σdec. `weights` ({branchId: 0..1}) lets one row (e.g. a salary shared
// between branches) be split when the statement is filtered to a single branch.
function StatementView({ data, title, partyLines, rows, opening = 0, labels, onClose, renderAction }) {
  const [mode, setMode] = useState("detail");
  const [branch, setBranch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tplId, setTplId] = useState(null);
  const tpl = resolveTpl(data, "statement", tplId);
  const T = tplTable(tpl);
  const defaultBranch = data.branches[0]?.id;
  const L = { inc: "مدين", dec: "دائن", ...labels };
  const bName = (id) => data.branches.find((b) => b.id === id)?.name || "—";
  const forBranch = (bid) => rows.map((r) => {
    if (r.weights) { const w = Number(r.weights[bid]) || 0; return w > 0 ? { ...r, inc: r.inc * w, dec: r.dec * w, partial: w < 0.9999 ? w : null } : null; }
    return (r.branch || defaultBranch) === bid ? r : null;
  }).filter(Boolean);
  const inRange = (r) => (!from || (r.date || "") >= from) && (!to || (r.date || "") <= to);
  const sum = (arr, k) => round2(arr.reduce((t, r) => t + (Number(r[k]) || 0), 0));
  const base = branch ? forBranch(branch) : rows;
  const open = (branch || data._scope) ? 0 : (Number(opening) || 0);
  let run = open;
  const withRun = base.map((r) => { run += r.inc - r.dec; return { ...r, running: round2(run) }; });
  const carried = from ? (withRun.filter((r) => (r.date || "") < from).slice(-1)[0]?.running ?? open) : open;
  const shown = withRun.filter(inRange);
  const totalInc = sum(shown, "inc"), totalDec = sum(shown, "dec");
  const closing = round2(carried + totalInc - totalDec);
  const byKind = {}; shown.forEach((r) => { const k = r.kind || "أخرى"; byKind[k] = byKind[k] || { count: 0, inc: 0, dec: 0 }; byKind[k].count += 1; byKind[k].inc += r.inc; byKind[k].dec += r.dec; });
  const showBranchTable = !branch && data.branches.length > 1;
  const rowBranchLabel = (r) => r.weights ? (Object.keys(r.weights).filter((id) => r.weights[id] > 0).map(bName).join("، ")) : bName(r.branch || defaultBranch);
  const periodText = (from || to) ? `${from || "…"} إلى ${to || "…"}` : "كل الفترات";
  const num = (v) => (v ? fmtNum(v) : "—");
  return (
    <Modal title={title} onClose={onClose} width={900}>
      <div className="no-print" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) auto", gap: 8, alignItems: "end", marginBottom: 4 }}>
        <Field label="نوع الكشف"><SelectInput options={[{ value: "detail", label: "تفصيلي" }, { value: "summary", label: "إجمالي" }]} value={mode} onChange={(e) => setMode(e.target.value)} /></Field>
        <Field label="الفرع"><SelectInput options={[{ value: "", label: "كل الفروع" }, ...data.branches.map((b) => ({ value: b.id, label: b.name }))]} value={branch} onChange={(e) => setBranch(e.target.value)} /></Field>
        <Field label="من تاريخ"><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="إلى تاريخ"><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {(from || to || branch) && <Btn small variant="ghost" onClick={() => { setFrom(""); setTo(""); setBranch(""); }} style={{ marginBottom: 12 }}>مسح</Btn>}
      </div>
      <PrintStage data={data} docType="statement" tplId={tplId} setTplId={setTplId}>
        <PrintSheet data={data} tpl={tpl} title={mode === "detail" ? "كشف حساب تفصيلي" : "كشف حساب إجمالي"} date={new Date().toISOString().slice(0, 10)}
          parties={[{ title: title.replace("كشف حساب ", ""), lines: (partyLines || []).filter(Boolean) }]}
          meta={[{ label: "الفرع", value: branch ? bName(branch) : "كل الفروع" }, { label: "الفترة", value: periodText }, { label: from ? "الرصيد المُرحَّل" : "الرصيد الافتتاحي", value: `${fmtNum(carried)} ر.س` }]}
          totals={[{ label: `إجمالي ${L.inc}`, value: `${fmtNum(totalInc)} ر.س` }, { label: `إجمالي ${L.dec}`, value: `${fmtNum(totalDec)} ر.س` }, { label: L.finalLabel || "الرصيد النهائي", value: `${fmtNum(closing)} ر.س`, strong: true }]}
          notes={[L.balanceText ? L.balanceText(closing) : "", branch && Number(opening) !== 0 ? `الرصيد الافتتاحي (${fmtNum(opening)}) غير منسوب لفرع، لذلك يظهر فقط في كشف «كل الفروع».` : ""].filter(Boolean).join(" — ")}
          signatures={["المحاسب", "المراجع / الطرف الآخر"]}>
          {mode === "detail" ? (
            <table style={T.table}>
              <thead style={{ display: "table-header-group" }}><tr><th style={T.th}>الرقم</th><th style={T.th}>التاريخ</th>{!branch && <th style={T.th}>الفرع</th>}<th style={T.th}>البيان</th><th style={T.th}>{L.inc}</th><th style={T.th}>{L.dec}</th><th style={T.th}>الرصيد</th>{renderAction && <th className="no-print" style={T.th}></th>}</tr></thead>
              <tbody>
                {shown.length === 0 ? <tr><td colSpan={8} style={{ padding: 14, textAlign: "center", color: "#8A8071" }}>لا توجد حركات</td></tr> : shown.map((r, i) => (
                  <tr key={r.key} style={{ pageBreakInside: "avoid" }}>
                    <td style={{ ...T.td(i), fontWeight: 700, whiteSpace: "nowrap" }}>{r.noLabel ? `${r.noLabel} ` : ""}{r.no || "—"}</td>
                    <td style={{ ...T.td(i), whiteSpace: "nowrap" }}>{r.date || "—"}</td>
                    {!branch && <td style={{ ...T.td(i), fontSize: 11.5 }}>{rowBranchLabel(r)}</td>}
                    <td style={T.td(i)}>{r.desc}{r.partial ? ` (حصة الفرع ${fmtNum(r.partial * 100)}%)` : ""}</td>
                    <td style={T.td(i)}>{num(r.inc)}</td>
                    <td style={T.td(i)}>{num(r.dec)}</td>
                    <td style={{ ...T.td(i), fontWeight: 700 }}>{fmtNum(r.running)}</td>
                    {renderAction && <td className="no-print" style={{ ...T.td(i), whiteSpace: "nowrap" }}>{renderAction(r)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <div style={{ fontWeight: 700, margin: "0 0 6px", fontSize: 13, color: tpl.accent }}>إجمالي حسب نوع الحركة</div>
              <table style={T.table}>
                <thead><tr><th style={T.th}>النوع</th><th style={T.th}>العدد</th><th style={T.th}>{L.inc}</th><th style={T.th}>{L.dec}</th></tr></thead>
                <tbody>
                  {Object.keys(byKind).length === 0 ? <tr><td colSpan={4} style={{ padding: 14, textAlign: "center", color: "#8A8071" }}>لا توجد حركات</td></tr> : Object.entries(byKind).map(([k, v], i) => (
                    <tr key={k}><td style={{ ...T.td(i), fontWeight: 600 }}>{k}</td><td style={T.td(i)}>{v.count}</td><td style={T.td(i)}>{num(v.inc)}</td><td style={T.td(i)}>{num(v.dec)}</td></tr>
                  ))}
                  <tr style={{ fontWeight: 700 }}><td style={{ padding: "7px 8px", borderTop: `2px solid ${tpl.accent}` }}>الإجمالي</td><td style={{ padding: "7px 8px", borderTop: `2px solid ${tpl.accent}` }}>{shown.length}</td><td style={{ padding: "7px 8px", borderTop: `2px solid ${tpl.accent}` }}>{fmtNum(totalInc)}</td><td style={{ padding: "7px 8px", borderTop: `2px solid ${tpl.accent}` }}>{fmtNum(totalDec)}</td></tr>
                </tbody>
              </table>
              {showBranchTable && (
                <>
                  <div style={{ fontWeight: 700, margin: "16px 0 6px", fontSize: 13, color: tpl.accent }}>إجمالي حسب الفرع</div>
                  <table style={T.table}>
                    <thead><tr><th style={T.th}>الفرع</th><th style={T.th}>{L.inc}</th><th style={T.th}>{L.dec}</th><th style={T.th}>الصافي</th></tr></thead>
                    <tbody>
                      {data.branches.map((b, i) => { const rs = forBranch(b.id).filter(inRange); const inc = sum(rs, "inc"), dec = sum(rs, "dec"); return (
                        <tr key={b.id}><td style={{ ...T.td(i), fontWeight: 600 }}>{b.name}</td><td style={T.td(i)}>{num(inc)}</td><td style={T.td(i)}>{num(dec)}</td><td style={{ ...T.td(i), fontWeight: 700 }}>{fmtNum(inc - dec)}</td></tr>); })}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </PrintSheet>
      </PrintStage>
    </Modal>
  );
}

// ---------- Print templates manager (inside "بيانات المحل") ----------
function TemplateSample({ data, tpl, scale = 0.3 }) {
  return (
    <div style={{ width: 794 * scale, height: 1123 * scale, overflow: "hidden", border: `1px solid ${THEME.border}`, background: "#fff", position: "relative", flexShrink: 0 }}>
      <div style={{ width: 794, transform: `scale(${scale})`, transformOrigin: "top right", position: "absolute", top: 0, right: 0 }}>
        <PrintSheet preview data={data} tpl={tpl} title="سند قبض" docNo="1001" date="2026-10-03"
          meta={[{ label: "الحساب", value: "الصندوق" }, { label: "الفرع", value: data.branches[0]?.name || "—" }, { label: "التصنيف", value: "دفعة على الحساب" }]}
          amount={1250.5} parties={[{ title: "بيانات الدافع", rows: [{ label: "الاسم", value: "محمد أحمد" }, { label: "الجوال", value: "05XXXXXXXX" }] }]}
          signatures={["توقيع الدافع", "توقيع المحاسب"]} showBank={false}>
          <PTable tpl={tpl} columns={[{ key: "a", label: "البيان" }, { key: "b", label: "الكمية", align: "center" }, { key: "c", label: "المبلغ", align: "center" }]} rows={[{ a: "ثوب سعودي", b: 2, c: "800" }, { a: "ثوب قطري", b: 1, c: "450.5" }]} />
        </PrintSheet>
      </div>
    </div>
  );
}

function PrintTemplatesPanel({ data, update }) {
  const [edit, setEdit] = useState(null);
  const ps = data.printSettings || { defaults: {}, customTemplates: [] };
  const setPs = (patch) => update({ printSettings: { ...ps, ...patch } });
  const setDefault = (k, v) => setPs({ defaults: { ...(ps.defaults || {}), [k]: v } });
  const startNew = (from) => setEdit({ ...(from || { accent: "#1F3A68", font: "cairo", header: "band", frame: "single", table: "striped", showLogo: true, showSignatures: true }), id: uid("tpl"), builtin: false, label: from ? `${from.label} (نسخة)` : "قالبي الخاص", isNew: true });
  const saveTpl = () => {
    const { isNew, ...t } = edit;
    if (!String(t.label || "").trim()) { alert("أدخل اسم القالب"); return; }
    const list = ps.customTemplates || [];
    setPs({ customTemplates: isNew ? [...list, t] : list.map((x) => x.id === t.id ? t : x) });
    setEdit(null);
  };
  const delTpl = (t) => {
    if (!window.confirm(`حذف القالب «${t.label}»؟`)) return;
    const defaults = { ...(ps.defaults || {}) }; Object.keys(defaults).forEach((k) => { if (defaults[k] === t.id) delete defaults[k]; });
    setPs({ customTemplates: (ps.customTemplates || []).filter((x) => x.id !== t.id), defaults });
  };
  const pickImage = (key, maxDim) => (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => { const img = await compressImageDataUrl(reader.result, maxDim, 0.85); setEdit((v) => ({ ...v, [key]: img })); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const opt = (arr) => arr.map(([value, label]) => ({ value, label }));
  const all = allTemplates(data);
  return (
    <Panel style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>قوالب الطباعة (A4)</div>
      <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 14 }}>اختر القالب الافتراضي لكل نوع مستند، أو أنشئ قالبك الخاص بألوانك وترويستك. يمكن أيضًا تغيير القالب لحظة الطباعة من نافذة المعاينة.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10, marginBottom: 16 }}>
        {DOC_TYPE_LABELS.map(([k, label]) => (
          <Field key={k} label={label}><SelectInput options={all.map((t) => ({ value: t.id, label: t.label }))} value={ps.defaults?.[k] || "classic"} onChange={(e) => setDefault(k, e.target.value)} /></Field>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 700 }}>القوالب المتاحة</div>
        <Btn variant="brass" small onClick={() => startNew()}><Plus size={14} />قالب جديد</Btn>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {all.map((t) => (
          <div key={t.id} style={{ width: 794 * 0.3 + 4 }}>
            <TemplateSample data={data} tpl={t} />
            <div style={{ fontWeight: 700, fontSize: 13, margin: "6px 0 4px" }}>{t.label} {!t.builtin && <Badge color={THEME.teal}>خاص</Badge>}</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {!t.builtin && <Btn small variant="ghost" onClick={() => setEdit({ ...t })}>تعديل</Btn>}
              <Btn small variant="ghost" onClick={() => startNew(t)}>نسخ</Btn>
              {!t.builtin && <Btn small variant="danger" onClick={() => delTpl(t)}>حذف</Btn>}
            </div>
          </div>
        ))}
      </div>

      {edit && (
        <Modal title={edit.isNew ? "قالب طباعة جديد" : "تعديل القالب"} onClose={() => setEdit(null)} width={1060}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "start" }}>
            <div>
              <Field label="اسم القالب"><TextInput value={edit.label || ""} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="لون القالب"><input type="color" value={edit.accent || "#A9752E"} onChange={(e) => setEdit({ ...edit, accent: e.target.value })} style={{ width: "100%", height: 38, border: `1px solid ${THEME.border}`, borderRadius: 6, background: "#fff" }} /></Field>
                <Field label="الخط"><SelectInput options={opt([["tajawal", "تجوال (عصري)"], ["amiri", "أميري (كلاسيكي)"], ["cairo", "القاهرة (رسمي)"]])} value={edit.font || "tajawal"} onChange={(e) => setEdit({ ...edit, font: e.target.value })} /></Field>
                <Field label="شكل الترويسة"><SelectInput options={opt([["line", "خط سفلي"], ["band", "شريط ملوّن"], ["center", "مركزية مزخرفة"], ["split", "مقسومة بإطار للعنوان"]])} value={edit.header || "line"} onChange={(e) => setEdit({ ...edit, header: e.target.value })} /></Field>
                <Field label="إطار الصفحة"><SelectInput options={opt([["none", "بدون"], ["single", "إطار مفرد"], ["double", "إطار مزدوج"]])} value={edit.frame || "none"} onChange={(e) => setEdit({ ...edit, frame: e.target.value })} /></Field>
                <Field label="شكل الجداول"><SelectInput options={opt([["striped", "رأس ملوّن وصفوف متبادلة"], ["grid", "شبكة كاملة"], ["plain", "خطوط خفيفة"]])} value={edit.table || "striped"} onChange={(e) => setEdit({ ...edit, table: e.target.value })} /></Field>
                <Field label="علامة مائية (اختياري)"><TextInput value={edit.watermark || ""} onChange={(e) => setEdit({ ...edit, watermark: e.target.value })} placeholder="مثال: نسخة أصلية" /></Field>
              </div>
              <Field label="نص تذييل ثابت (اختياري — يظهر أسفل كل مستند)"><TextInput value={edit.footerText || ""} onChange={(e) => setEdit({ ...edit, footerText: e.target.value })} /></Field>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 12, fontSize: 13.5 }}>
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={edit.showLogo !== false} onChange={(e) => setEdit({ ...edit, showLogo: e.target.checked })} />إظهار شعار المحل</label>
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={edit.showSignatures !== false} onChange={(e) => setEdit({ ...edit, showSignatures: e.target.checked })} />خانات التوقيع</label>
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={!!edit.showQR} onChange={(e) => setEdit({ ...edit, showQR: e.target.checked })} />رمز QR تجريبي بالفاتورة</label>
              </div>
              <div style={{ border: `2px dashed ${THEME.brass}`, borderRadius: 8, padding: 12, marginBottom: 14, background: `${THEME.brass}0d` }}>
                <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 14 }}>🖼 قالب جاهز كامل (صفحة A4 كاملة)</div>
                <div style={{ fontSize: 12, color: "#7A7061", marginBottom: 8 }}>صمّم الصفحة كاملة بترويستها وإطارها وتذييلها وشعارها وبياناتك (من Canva أو Word أو Photoshop) وصدّرها <b>صورة عمودية بمقاس A4</b> (مثلًا 2480×3508 بكسل). ارفعها هنا فتُطبع خلفية لكل مستند، ويُوضع المحتوى داخل المنطقة التي تحددها بالهوامش أدناه.</div>
                <input type="file" accept="image/*" onChange={pickImage("pageImage", 1754)} style={{ fontSize: 12 }} />
                {edit.pageImage && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                      <Field label="هامش أعلى (مم)"><TextInput type="number" value={edit.contentTop ?? 45} onChange={(e) => setEdit({ ...edit, contentTop: Number(e.target.value) })} /></Field>
                      <Field label="هامش أسفل (مم)"><TextInput type="number" value={edit.contentBottom ?? 30} onChange={(e) => setEdit({ ...edit, contentBottom: Number(e.target.value) })} /></Field>
                      <Field label="هامش جانبي (مم)"><TextInput type="number" value={edit.contentSide ?? 15} onChange={(e) => setEdit({ ...edit, contentSide: Number(e.target.value) })} /></Field>
                    </div>
                    <Field label="رأس المستند فوق المحتوى"><SelectInput options={[{ value: "compact", label: "مختصر (عنوان المستند ورقمه وتاريخه فقط)" }, { value: "none", label: "بدون رأس (تصميمي يحتوي كل شيء)" }, { value: "full", label: "كامل (بيانات المحل والشعار أيضًا)" }]} value={edit.pageHeader || "compact"} onChange={(e) => setEdit({ ...edit, pageHeader: e.target.value })} /></Field>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13.5, marginBottom: 8 }}><input type="checkbox" checked={!!edit.pageShowFooter} onChange={(e) => setEdit({ ...edit, pageShowFooter: e.target.checked })} />إظهار سطر التذييل (الآيبان وتاريخ الطباعة)</label>
                    <div><Btn small variant="danger" onClick={() => setEdit({ ...edit, pageImage: "" })}>إزالة التصميم الكامل</Btn></div>
                    <div style={{ fontSize: 11.5, color: "#8A8071", marginTop: 6 }}>المعاينة على اليسار تعكس الهوامش مباشرة. يناسب الفواتير والسندات؛ الكشوفات الطويلة (أكثر من صفحة) تُعاد فيها الخلفية لكن المحتوى قد يتداخل مع الترويسة في الصفحة الثانية، فاستخدم لها قالبًا عاديًا.</div>
                  </div>
                )}
              </div>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13.5 }}>تصميمك الخاص (اختياري)</div>
              <div style={{ fontSize: 12, color: "#7A7061", marginBottom: 8 }}>ارفع صورة ترويسة جاهزة صممتها (مثلًا بعرض 2100 بكسل وارتفاع 400) فتحل محل الترويسة المبنية. وكذلك صورة للتذييل.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <input type="file" accept="image/*" onChange={pickImage("headerImage", 1600)} style={{ fontSize: 12 }} />
                  {edit.headerImage && <div style={{ marginTop: 6 }}><img src={edit.headerImage} alt="" style={{ width: "100%", border: `1px solid ${THEME.border}` }} /><Btn small variant="danger" onClick={() => setEdit({ ...edit, headerImage: "" })} style={{ marginTop: 4 }}>إزالة الترويسة</Btn></div>}
                  <div style={{ fontSize: 11, color: "#8A8071", marginTop: 4 }}>صورة الترويسة</div>
                </div>
                <div>
                  <input type="file" accept="image/*" onChange={pickImage("footerImage", 1600)} style={{ fontSize: 12 }} />
                  {edit.footerImage && <div style={{ marginTop: 6 }}><img src={edit.footerImage} alt="" style={{ width: "100%", border: `1px solid ${THEME.border}` }} /><Btn small variant="danger" onClick={() => setEdit({ ...edit, footerImage: "" })} style={{ marginTop: 4 }}>إزالة التذييل</Btn></div>}
                  <div style={{ fontSize: 11, color: "#8A8071", marginTop: 4 }}>صورة التذييل</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}><Btn variant="brass" onClick={saveTpl}>حفظ القالب</Btn><Btn variant="ghost" onClick={() => setEdit(null)}>إلغاء</Btn></div>
            </div>
            <div><div style={{ fontSize: 12, color: "#7A7061", marginBottom: 4 }}>معاينة مباشرة</div><TemplateSample data={data} tpl={edit} scale={0.42} /></div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

// ---------- Inventory (stock of fabrics, buttons, thread, lining ... per branch) ----------
// Stock is DERIVED, never stored: purchases (+) − order consumption (−, cancelled orders excluded) ± manual adjustments.
// So it can't drift or conflict between devices. Items are matched to purchases by name.
const DEFAULT_LISTS = { expenseCategories: ["إيجار", "رواتب", "فواتير خدمات", "صيانة", "أخرى"], incomeCategories: ["عربون", "دفعة على الحساب", "أخرى"], purchaseCategories: ["قماش", "أزرار", "خيوط", "بطانة", "أخرى"], inventoryCategories: ["قماش", "أزرار", "خيوط", "بطانة", "أخرى"] };
const getList = (data, key) => (data.lists?.[key]?.length ? data.lists[key] : DEFAULT_LISTS[key]);
const INV_CATEGORIES = DEFAULT_LISTS.inventoryCategories;
const normName = (x) => String(x || "").trim().toLowerCase();
function inventoryMovements(data) {
  const def = data.branches[0]?.id;
  const byName = new Map((data.inventoryItems || []).map((i) => [normName(i.name), i]));
  const mv = [];
  (data.purchases || []).forEach((p) => {
    const it = byName.get(normName(p.item));
    if (it && Number(p.qty) > 0) mv.push({ id: p.id, itemId: it.id, branch: p.branch || def, qty: Number(p.qty), kind: "شراء", date: p.date || "", ref: `شراء #${p.purchaseNo || ""}` });
  });
  (data.orders || []).filter((o) => !o.cancelled).forEach((o) => {
    const fab = o.fabricType && Number(o.fabricUsed) > 0 ? byName.get(normName(o.fabricType)) : null;
    if (fab) mv.push({ id: `${o.id}:f`, itemId: fab.id, branch: o.branch || def, qty: -Number(o.fabricUsed), kind: "استهلاك طلب", date: o.createdAt || "", ref: `طلب #${o.orderNo || ""} (قماش)` });
    (o.materials || []).forEach((m, i) => {
      if (m.itemId && Number(m.qty) > 0 && !(fab && m.itemId === fab.id)) mv.push({ id: `${o.id}:m${i}`, itemId: m.itemId, branch: o.branch || def, qty: -Number(m.qty), kind: "استهلاك طلب", date: o.createdAt || "", ref: `طلب #${o.orderNo || ""}` });
    });
  });
  (data.stockAdjustments || []).forEach((a) => mv.push({ id: a.id, itemId: a.itemId, branch: a.branch || def, qty: Number(a.qty) || 0, kind: a.kind, date: a.date || "", ref: a.reason || "" }));
  return mv;
}
function stockLevels(data, branchId) {
  const out = {}; (data.inventoryItems || []).forEach((i) => { out[i.id] = 0; });
  inventoryMovements(data).forEach((m) => { if (branchId && m.branch !== branchId) return; out[m.itemId] = round2((out[m.itemId] || 0) + m.qty); });
  return out;
}
// Items at or below their minimum, evaluated per branch (only branches that ever moved the item).
function lowStockList(data) {
  const mv = inventoryMovements(data); const res = [];
  (data.inventoryItems || []).forEach((it) => {
    const min = Number(it.minQty) || 0; if (min <= 0) return;
    const per = {}; mv.filter((m) => m.itemId === it.id).forEach((m) => { per[m.branch] = round2((per[m.branch] || 0) + m.qty); });
    Object.keys(per).forEach((b) => { if (per[b] <= min) res.push({ item: it, branch: b, qty: per[b], branchName: data.branches.find((x) => x.id === b)?.name || "" }); });
  });
  return res;
}
const materialsFromRules = (data, orderType) => (data.consumptionRules || []).filter((r) => r.orderType === orderType && Number(r.qty) > 0).map((r) => ({ itemId: r.itemId, qty: Number(r.qty) }));

function InventoryView({ data, update, canEdit, currentUser }) {
  const [branch, setBranch] = useState("");
  const [itemModal, setItemModal] = useState(null);
  const [adjModal, setAdjModal] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleType, setRuleType] = useState(data.orderTypes[0] || "");
  const [ruleNew, setRuleNew] = useState({ itemId: "", qty: "" });
  const items = data.inventoryItems || [];
  const levels = stockLevels(data, branch);
  const low = lowStockList(data).filter((x) => !branch || x.branch === branch);
  const mv = inventoryMovements(data);
  const bName = (id) => data.branches.find((b) => b.id === id)?.name || "—";
  const itemName = (id) => items.find((i) => i.id === id)?.name || "—";
  const th = { padding: "8px 10px", textAlign: "right" };

  const saveItem = () => {
    const v = itemModal.values;
    if (!String(v.name || "").trim()) { alert("أدخل اسم الصنف"); return; }
    if (items.some((i) => i.id !== v.id && normName(i.name) === normName(v.name))) { alert("يوجد صنف بنفس الاسم"); return; }
    const clean = { ...v, name: v.name.trim(), minQty: Number(v.minQty) || 0 };
    update({ inventoryItems: itemModal.mode === "add" ? [...items, { id: uid("inv"), ...clean }] : items.map((i) => i.id === clean.id ? clean : i) });
    setItemModal(null);
  };
  const deleteItem = (it) => {
    const used = mv.some((m) => m.itemId === it.id) || (data.consumptionRules || []).some((r) => r.itemId === it.id);
    if (used && !data._isAdmin) { alert("لا يمكن حذف صنف له حركات أو قواعد استهلاك. اجعل حده الأدنى 0 بدل حذفه."); return; }
    if (!window.confirm(used ? `الصنف «${it.name}» له حركات أو قواعد استهلاك. حذفه يُسقط رصيده وقواعده من المخزون (تبقى المشتريات والطلبات كما هي). هل تحذفه نهائيًا؟` : `حذف الصنف «${it.name}»؟`)) return;
    update({ inventoryItems: items.filter((i) => i.id !== it.id), consumptionRules: (data.consumptionRules || []).filter((r) => r.itemId !== it.id) });
  };
  const saveAdjustment = () => {
    const { item, values } = adjModal; const q = Number(values.qty);
    if (!values.branch) { alert("اختر الفرع"); return; }
    if (values.kind !== "جرد" && (!q || q <= 0)) { alert("أدخل كمية صحيحة"); return; }
    if (values.kind === "جرد" && (values.qty === "" || isNaN(q) || q < 0)) { alert("أدخل الكمية الفعلية الموجودة"); return; }
    const base = { itemId: item.id, date: values.date || todayStr(), by: currentUser, reason: values.reason || "" };
    const now = stockLevels(data, values.branch)[item.id] || 0;
    let adds = [];
    if (values.kind === "جرد") { const diff = round2(q - now); if (!diff) { setAdjModal(null); return; } adds = [{ ...base, id: uid("adj"), branch: values.branch, qty: diff, kind: "جرد" }]; }
    else if (values.kind === "تالف / فاقد") adds = [{ ...base, id: uid("adj"), branch: values.branch, qty: -q, kind: "تالف / فاقد" }];
    else if (values.kind === "إضافة يدوية") adds = [{ ...base, id: uid("adj"), branch: values.branch, qty: q, kind: "إضافة يدوية" }];
    else if (values.kind === "نقل لفرع آخر") {
      if (!values.toBranch || values.toBranch === values.branch) { alert("اختر فرعًا مختلفًا للنقل"); return; }
      if (q > now) {
        if (!data._isAdmin) { alert(`الكمية المتاحة في الفرع (${fmtNum(now)}) أقل من المطلوب نقلها`); return; }
        if (!window.confirm(`الكمية المتاحة في الفرع (${fmtNum(now)}) أقل من المطلوب نقلها (${fmtNum(q)}). سيصبح رصيد الفرع سالبًا. هل تتابع؟`)) return;
      }
      const ref = `نقل من ${bName(values.branch)} إلى ${bName(values.toBranch)}`;
      adds = [{ ...base, id: uid("adj"), branch: values.branch, qty: -q, kind: "نقل صادر", reason: ref }, { ...base, id: uid("adj"), branch: values.toBranch, qty: q, kind: "نقل وارد", reason: ref }];
    }
    update({ stockAdjustments: [...(data.stockAdjustments || []), ...adds] });
    setAdjModal(null);
  };
  const addRule = () => {
    if (!ruleNew.itemId || !(Number(ruleNew.qty) > 0)) { alert("اختر الصنف وأدخل كمية أكبر من صفر"); return; }
    update({ consumptionRules: [...(data.consumptionRules || []), { id: uid("rule"), orderType: ruleType, itemId: ruleNew.itemId, qty: Number(ruleNew.qty) }] });
    setRuleNew({ itemId: "", qty: "" });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Package size={22} color={THEME.brass} /><h2 style={{ margin: 0, fontFamily: "Amiri, serif", fontSize: 26 }}>المخزون</h2></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {data.branches.length > 1 && <div style={{ width: 190 }}><SelectInput options={[{ value: "", label: "كل الفروع" }, ...data.branches.map((b) => ({ value: b.id, label: b.name }))]} value={branch} onChange={(e) => setBranch(e.target.value)} /></div>}
          <Btn variant="ghost" onClick={() => setRulesOpen(true)}>قواعد الاستهلاك التلقائي</Btn>
          {canEdit && <Btn variant="brass" onClick={() => setItemModal({ mode: "add", values: { category: getList(data, "inventoryCategories")[0], minQty: 0 } })}><Plus size={16} />صنف جديد</Btn>}
        </div>
      </div>

      {low.length > 0 && (
        <div style={{ background: `${THEME.red}12`, border: `1px solid ${THEME.red}`, borderRadius: 8, padding: 12, fontSize: 13.5, marginBottom: 14 }}>
          <b style={{ color: THEME.red }}>⚠ أصناف وصلت للحد الأدنى:</b> {low.map((x) => `${x.item.name} (${fmtNum(x.qty)} ${x.item.unit || ""}${data.branches.length > 1 ? ` — ${x.branchName}` : ""})`).join("، ")}
        </div>
      )}

      <Panel>
        {items.length === 0 ? <EmptyState text="لا توجد أصناف بعد. تُضاف الأصناف تلقائيًا عند تسجيل مشتريات، أو أضفها يدويًا." /> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead><tr style={{ background: "#EFE7D6" }}><th style={th}>الصنف</th><th style={th}>التصنيف</th><th style={th}>المتاح{branch ? ` (${bName(branch)})` : ""}</th><th style={th}>الحد الأدنى</th><th style={th}>الحالة</th><th style={th}></th></tr></thead>
              <tbody>
                {items.map((it) => {
                  const q = levels[it.id] || 0; const min = Number(it.minQty) || 0;
                  const state = q <= 0 ? ["نفد", THEME.red] : (min > 0 && q <= min) ? ["منخفض", "#C77700"] : ["كافٍ", THEME.teal];
                  return (
                    <tr key={it.id} style={{ borderTop: `1px solid ${THEME.border}` }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>{it.name}</td>
                      <td style={{ padding: "8px 10px" }}>{it.category}</td>
                      <td style={{ padding: "8px 10px", fontWeight: 700 }}>{fmtNum(q)} {it.unit}</td>
                      <td style={{ padding: "8px 10px" }}>{min ? `${fmtNum(min)} ${it.unit || ""}` : "—"}</td>
                      <td style={{ padding: "8px 10px" }}><Badge color={state[1]}>{state[0]}</Badge></td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                          <Btn small variant="ghost" onClick={() => setHistoryFor(it)}>الحركات</Btn>
                          {canEdit && <Btn small variant="ghost" onClick={() => setAdjModal({ item: it, values: { kind: "جرد", branch: branch || data.branches[0]?.id, date: todayStr(), qty: "", reason: "" } })}>جرد / تسوية</Btn>}
                          {canEdit && <Btn small variant="ghost" onClick={() => setItemModal({ mode: "edit", values: it })}><Pencil size={13} /></Btn>}
                          {canEdit && <Btn small variant="danger" onClick={() => deleteItem(it)}><Trash2 size={13} /></Btn>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <div style={{ fontSize: 12, color: "#8A8071", marginTop: 10 }}>المتاح = المشتريات − استهلاك الطلبات (غير الملغاة) ± التسويات. إلغاء طلب يُرجع ما استهلكه تلقائيًا. القماش يُخصم من «نوع القماش» و«الكمية المستخدمة» في الطلب، وبقية المواد من قواعد الاستهلاك.</div>

      {itemModal && (
        <Modal title={itemModal.mode === "add" ? "صنف جديد" : "تعديل الصنف"} onClose={() => setItemModal(null)}>
          <FormFields values={itemModal.values} setValues={(v) => setItemModal({ ...itemModal, values: v })} fields={[
            { key: "name", label: "اسم الصنف (نفس الاسم المستخدم في المشتريات والطلبات)" },
            { key: "category", label: "التصنيف", type: "select", options: getList(data, "inventoryCategories").map((c) => ({ value: c, label: c })) },
            { key: "unit", label: "الوحدة (متر، قطعة، بكرة…)" },
            { key: "minQty", label: "الحد الأدنى للتنبيه", type: "number" },
          ]} />
          {itemModal.mode === "edit" && <div style={{ fontSize: 11.5, color: "#8A8071", marginBottom: 8 }}>تنبيه: إن غيّرت الاسم فلن تُحسب المشتريات والطلبات المسجّلة بالاسم القديم.</div>}
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={saveItem}>حفظ</Btn><Btn variant="ghost" onClick={() => setItemModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}

      {adjModal && (
        <Modal title={`جرد / تسوية — ${adjModal.item.name}`} onClose={() => setAdjModal(null)}>
          <FormFields values={adjModal.values} setValues={(v) => setAdjModal({ ...adjModal, values: v })} fields={[
            { key: "kind", label: "نوع العملية", type: "select", options: ["جرد", "تالف / فاقد", "إضافة يدوية", "نقل لفرع آخر"].map((k) => ({ value: k, label: k === "جرد" ? "جرد (أدخل الكمية الفعلية الموجودة)" : k })) },
            { key: "branch", label: adjModal.values.kind === "نقل لفرع آخر" ? "من فرع" : "الفرع", type: "select", options: data.branches.map((b) => ({ value: b.id, label: b.name })) },
            ...(adjModal.values.kind === "نقل لفرع آخر" ? [{ key: "toBranch", label: "إلى فرع", type: "select", options: [{ value: "", label: "— اختر —" }, ...data.branches.filter((b) => b.id !== adjModal.values.branch).map((b) => ({ value: b.id, label: b.name }))] }] : []),
            { key: "qty", label: adjModal.values.kind === "جرد" ? `الكمية الفعلية (${adjModal.item.unit || "وحدة"})` : `الكمية (${adjModal.item.unit || "وحدة"})`, type: "number" },
            { key: "date", label: "التاريخ", type: "date" }, { key: "reason", label: "السبب / ملاحظة" },
          ]} />
          <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 10 }}>المتاح الآن في الفرع المختار: <b>{fmtNum(stockLevels(data, adjModal.values.branch)[adjModal.item.id] || 0)} {adjModal.item.unit}</b></div>
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={saveAdjustment}>حفظ</Btn><Btn variant="ghost" onClick={() => setAdjModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}

      {historyFor && (
        <Modal title={`حركات الصنف — ${historyFor.name}`} onClose={() => setHistoryFor(null)} wide>
          {(() => {
            const rows = mv.filter((m) => m.itemId === historyFor.id && (!branch || m.branch === branch)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
            return rows.length === 0 ? <EmptyState text="لا توجد حركات" /> : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#EFE7D6" }}><th style={th}>التاريخ</th><th style={th}>الحركة</th><th style={th}>الفرع</th><th style={th}>المرجع</th><th style={th}>الكمية</th></tr></thead>
                <tbody>{rows.map((m) => <tr key={m.id} style={{ borderTop: `1px solid ${THEME.border}` }}><td style={{ padding: "6px 10px" }}>{String(m.date).slice(0, 10)}</td><td style={{ padding: "6px 10px" }}>{m.kind}</td><td style={{ padding: "6px 10px" }}>{bName(m.branch)}</td><td style={{ padding: "6px 10px" }}>{m.ref}</td><td style={{ padding: "6px 10px", fontWeight: 700, color: m.qty < 0 ? THEME.red : THEME.teal }} dir="ltr">{m.qty > 0 ? "+" : ""}{fmtNum(m.qty)}</td></tr>)}</tbody>
              </table>
            );
          })()}
        </Modal>
      )}

      {rulesOpen && (
        <Modal title="قواعد الاستهلاك التلقائي" onClose={() => setRulesOpen(false)} wide>
          <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 10 }}>حدّد لكل نوع خياطة المواد التي يستهلكها الطلب الواحد (غير القماش). عند إنشاء طلب جديد تُنسخ هذه الكميات إلى الطلب وتُخصم من المخزون تلقائيًا. تغيير القاعدة لاحقًا لا يغيّر الطلبات السابقة.</div>
          <Field label="نوع الخياطة"><SelectInput options={data.orderTypes.map((t) => ({ value: t, label: t }))} value={ruleType} onChange={(e) => setRuleType(e.target.value)} /></Field>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, marginBottom: 10 }}>
            <tbody>
              {(data.consumptionRules || []).filter((r) => r.orderType === ruleType).map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${THEME.border}` }}>
                  <td style={{ padding: "7px 10px", fontWeight: 600 }}>{itemName(r.itemId)}</td>
                  <td style={{ padding: "7px 10px" }}>{fmtNum(r.qty)} {items.find((i) => i.id === r.itemId)?.unit}</td>
                  <td style={{ padding: "7px 10px", textAlign: "left" }}>{canEdit && <Btn small variant="danger" onClick={() => update({ consumptionRules: data.consumptionRules.filter((x) => x.id !== r.id) })}><Trash2 size={13} /></Btn>}</td>
                </tr>
              ))}
              {!(data.consumptionRules || []).some((r) => r.orderType === ruleType) && <tr><td style={{ padding: 12, color: "#8A8071" }}>لا توجد قواعد لهذا النوع</td></tr>}
            </tbody>
          </table>
          {canEdit && (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8, alignItems: "end" }}>
              <Field label="الصنف"><SelectInput options={[{ value: "", label: "— اختر —" }, ...items.filter((i) => i.category !== "قماش").map((i) => ({ value: i.id, label: `${i.name} (${i.unit || "وحدة"})` }))]} value={ruleNew.itemId} onChange={(e) => setRuleNew({ ...ruleNew, itemId: e.target.value })} /></Field>
              <Field label="الكمية لكل طلب"><TextInput type="number" value={ruleNew.qty} onChange={(e) => setRuleNew({ ...ruleNew, qty: e.target.value })} /></Field>
              <Btn variant="brass" onClick={addRule} style={{ marginBottom: 12 }}><Plus size={14} />إضافة</Btn>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ---------- WhatsApp alert centre (free: opens wa.me with the message pre-filled; sending stays one tap) ----------
const WA_NEW_DEFAULTS = {
  delayMessageTemplate: "مرحبًا {name}، نعتذر عن تأخر طلبك رقم #{orderNo} عن الموعد ({deliveryDate}). نعمل على إنهائه بأسرع وقت وسنوافيك فور جاهزيته.\nتابع حالة طلبك: {trackLink}",
  balanceMessageTemplate: "مرحبًا {name}، نذكّرك بأن المتبقي على طلبك رقم #{orderNo} هو {balance} ر.س. بانتظارك في {shop} 🙏",
};
const orderBalance = (o) => Math.max(0, round2((Number(o.price) || 0) - (Number(o.discount) || 0) - (Number(o.deposit) || 0)));
function waVars(data, order, name) {
  const no = order.orderNo || String(order.id || "").slice(-6);
  const base = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";
  return { name, orderNo: no, shop: data.shopSettings?.name || "", trackLink: `${base}?track=${no}`, reviewLink: data.shopSettings?.reviewLink || "", balance: fmtNum(orderBalance(order)), deliveryDate: order.deliveryDate || "" };
}
const WA_TYPES = {
  ready: { label: "جاهز للاستلام", icon: "🎉", templateField: "readyMessageTemplate", field: "notifiedAt", locale: true },
  delay: { label: "اعتذار عن تأخير", icon: "⏰", templateField: "delayMessageTemplate", field: "delayNotifiedAt" },
  balance: { label: "تذكير بمبلغ متبقٍ", icon: "💰", templateField: "balanceMessageTemplate", field: "balanceNotifiedAt" },
  thanks: { label: "شكر وطلب تقييم", icon: "🙏", templateField: "thankYouMessageTemplate", field: "thankedAt", locale: true },
  appointment: { label: "تذكير بموعد", icon: "📅", templateField: "reminderMessageTemplate", field: "remindedAt" },
};
// What is worth sending today. Nothing is ever sent automatically — the person taps each message.
function waPending(data) {
  const today = todayStr(); const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const cust = (id) => data.customers.find((c) => c.id === id);
  const out = [];
  (data.orders || []).filter((o) => !o.cancelled).forEach((o) => {
    const c = cust(o.customerId); const skipped = o.waSkipped || {};
    const add = (type, detail) => { if (!skipped[type]) out.push({ key: `${type}:${o.id}`, type, order: o, customer: c, detail }); };
    const recent = (o.createdAt || "") >= daysAgo(45);
    if (o.stage === "جاهز للتسليم" && !o.notifiedAt) add("ready", "");
    if (o.stage !== "جاهز للتسليم" && o.stage !== "تم التسليم" && o.deliveryDate && o.deliveryDate < today && !o.delayNotifiedAt) add("delay", `الموعد كان ${o.deliveryDate}`);
    const bal = orderBalance(o);
    const lastBal = o.balanceNotifiedAt ? new Date(o.balanceNotifiedAt).getTime() : 0;
    if (bal > 0 && (o.stage === "جاهز للتسليم" || (o.stage === "تم التسليم" && recent)) && Date.now() - lastBal > 3 * 86400000) add("balance", `المتبقي ${fmtNum(bal)} ر.س`);
    if (o.stage === "تم التسليم" && recent && !o.thankedAt) add("thanks", "");
  });
  (data.appointments || []).filter((a) => a.status === "مجدول" && (a.date === today || a.date === tomorrow) && !a.remindedAt).forEach((a) => out.push({ key: `appointment:${a.id}`, type: "appointment", apt: a, customer: cust(a.customerId), detail: `${a.date} ${a.time || ""}` }));
  return out;
}
function WhatsAppCenter({ data, update, canEdit, onClose }) {
  const [, force] = useState(0);
  const items = waPending(data);
  const send = (it) => {
    const t = WA_TYPES[it.type]; const name = it.customer?.name || "";
    const message = it.type === "appointment"
      ? fillTemplate(data.shopSettings?.[t.templateField], { name, date: it.apt.date, time: it.apt.time, shop: data.shopSettings?.name || "" })
      : fillTemplate(data.shopSettings?.[t.templateField] ?? WA_NEW_DEFAULTS[t.templateField], waVars(data, it.order, name));
    window.open(buildWhatsAppLink(it.customer.phone, message), "_blank");
    const stamp = t.locale ? new Date().toLocaleString("ar-SA") : new Date().toISOString();
    if (it.type === "appointment") update({ appointments: data.appointments.map((a) => a.id === it.apt.id ? { ...a, [t.field]: stamp } : a) });
    else update({ orders: data.orders.map((o) => o.id === it.order.id ? { ...o, [t.field]: stamp } : o) });
    force((n) => n + 1);
  };
  const skip = (it) => {
    if (it.type === "appointment") update({ appointments: data.appointments.map((a) => a.id === it.apt.id ? { ...a, remindedAt: "تم التجاهل" } : a) });
    else update({ orders: data.orders.map((o) => o.id === it.order.id ? { ...o, waSkipped: { ...(o.waSkipped || {}), [it.type]: new Date().toISOString() } } : o) });
  };
  const groups = Object.keys(WA_TYPES).map((k) => [k, items.filter((x) => x.type === k)]).filter(([, l]) => l.length);
  return (
    <Modal title="رسائل واتساب المقترحة" onClose={onClose} wide>
      <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 12 }}>لا يُرسل النظام أي رسالة بنفسه: الضغط على «إرسال» يفتح واتساب برسالة جاهزة تضغط إرسال فيها. بعدها يُسجَّل الإرسال ويختفي من القائمة. «تجاهل» يخفيها دون إرسال.</div>
      {groups.length === 0 ? <EmptyState text="لا توجد رسائل مقترحة الآن ✓" /> : groups.map(([k, list]) => (
        <div key={k} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{WA_TYPES[k].icon} {WA_TYPES[k].label} <Badge color={THEME.teal}>{list.length}</Badge></div>
          {list.map((it) => (
            <div key={it.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "7px 10px", borderBottom: `1px dashed ${THEME.border}`, fontSize: 13.5 }}>
              <span><b>{it.customer?.name || "—"}</b>{it.order ? ` — طلب #${it.order.orderNo || ""}` : ""}{it.detail ? ` — ${it.detail}` : ""}{!it.customer?.phone && <span style={{ color: THEME.red }}> (لا يوجد جوال)</span>}</span>
              {canEdit && <span style={{ display: "flex", gap: 6 }}>
                <Btn small variant="brass" onClick={() => it.customer?.phone ? send(it) : alert("لا يوجد رقم جوال لهذا العميل")}>إرسال واتساب</Btn>
                <Btn small variant="ghost" onClick={() => skip(it)}>تجاهل</Btn>
              </span>}
            </div>
          ))}
        </div>
      ))}
    </Modal>
  );
}

// Permanent deletion is reserved for the system admin ("مدير عام"). The admin may also hand the deleted document's
// number back so the next new document reuses it (refill); otherwise the number stays retired.
function AdminDeleteModal({ title, lines, numberLabel, number, onConfirm, onClose }) {
  const [free, setFree] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ background: `${THEME.red}12`, border: `1px solid ${THEME.red}`, borderRadius: 8, padding: 12, fontSize: 13.5, marginBottom: 12 }}>
        <b style={{ color: THEME.red }}>حذف نهائي لا يمكن التراجع عنه.</b>
        {(lines || []).map((l, i) => <div key={i} style={{ marginTop: 4 }}>{l}</div>)}
      </div>
      {number !== undefined && number !== null && number !== "" && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, marginBottom: 14 }}>
          <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} style={{ marginTop: 4 }} />
          <span>إتاحة {numberLabel} <b>{number}</b> لإعادة الاستخدام: يأخذه أول مستند جديد من نفس النوع (تعبئة الرقم المحذوف). وإن تركتها فارغة يبقى الرقم محذوفًا ولا يتكرر.</span>
        </label>
      )}
      <div style={{ display: "flex", gap: 8 }}><Btn variant="danger" onClick={() => onConfirm(free)}>تأكيد الحذف النهائي</Btn><Btn variant="ghost" onClick={onClose}>تراجع</Btn></div>
    </Modal>
  );
}
const withFreed = (data, key, no, free) => (free && no ? { freedNumbers: { ...(data.freedNumbers || {}), [key]: [...new Set([...((data.freedNumbers || {})[key] || []), Number(no)])].sort((a, b) => a - b) } } : {});

function ListsPanel({ data, update }) {
  const defs = [["expenseCategories", "فئات المصروفات (سندات الصرف)"], ["incomeCategories", "فئات الإيرادات (سندات القبض)"], ["purchaseCategories", "فئات المشتريات"], ["inventoryCategories", "تصنيفات المخزون"]];
  const [draft, setDraft] = useState({});
  const set = (k, arr) => update({ lists: { ...(data.lists || {}), [k]: arr } });
  return (
    <Panel style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>القوائم القابلة للتخصيص (مدير النظام)</div>
      <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 12 }}>أضف أو احذف أي بند. حذف بند لا يغيّر السندات أو المشتريات المسجَّلة به سابقًا.</div>
      {defs.map(([k, label]) => (
        <div key={k} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 6 }}>{label}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
            {getList(data, k).map((c) => <span key={c} style={{ background: `${THEME.teal}18`, border: `1px solid ${THEME.teal}`, borderRadius: 14, padding: "2px 10px", fontSize: 13 }}>{c} <span style={{ cursor: "pointer", color: THEME.red, marginRight: 4 }} onClick={() => set(k, getList(data, k).filter((x) => x !== c))}>×</span></span>)}
          </div>
          <div style={{ display: "flex", gap: 6, maxWidth: 320 }}>
            <TextInput placeholder="بند جديد" value={draft[k] || ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
            <Btn small variant="brass" onClick={() => { const v = (draft[k] || "").trim(); if (!v || getList(data, k).includes(v)) return; set(k, [...getList(data, k), v]); setDraft({ ...draft, [k]: "" }); }}><Plus size={14} /></Btn>
          </div>
        </div>
      ))}
      {(data.lists && Object.keys(data.lists).length > 0) && <Btn small variant="ghost" onClick={() => { if (window.confirm("إعادة كل القوائم إلى الافتراضي؟")) update({ lists: {} }); }}>إعادة الافتراضي</Btn>}
    </Panel>
  );
}

function FreedNumbersPanel({ data, update }) {
  const labels = { order: "أرقام الطلبات / الفواتير", group: "أرقام الطلبيات", voucher: "أرقام السندات", purchase: "أرقام المشتريات", customer: "أكواد العملاء" };
  const fn = data.freedNumbers || {};
  const keys = Object.keys(labels).filter((k) => (fn[k] || []).length);
  return (
    <Panel style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>الأرقام الشاغرة المتاحة لإعادة الاستخدام</div>
      <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 10 }}>أرقام أتحتَها عند الحذف النهائي. يأخذ أول مستند جديد أصغرها. هذه الصلاحية لمدير النظام فقط.</div>
      {keys.length === 0 ? <div style={{ fontSize: 13, color: "#8A8071" }}>لا توجد أرقام شاغرة — كل رقم محذوف يبقى محذوفًا ولا يتكرر.</div> : keys.map((k) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px dashed ${THEME.border}`, fontSize: 13.5 }}>
          <span><b>{labels[k]}:</b> {(fn[k] || []).join("، ")}</span>
          <Btn small variant="danger" onClick={() => update({ freedNumbers: { ...fn, [k]: [] } })}>مسح (لا تُستخدم مجددًا)</Btn>
        </div>
      ))}
    </Panel>
  );
}

// ---------- Returns & amendments ----------
// A return refunds money (a numbered payment voucher + the order's paid amount goes down); an amendment redoes work.
// Either can charge the responsible employee and/or cancel the earnings they got for the order.
function buildReturnPatch(data, order, v, currentUser) {
  const isRefund = v.kind === "مرتجع واسترداد";
  const amt = isRefund ? Number(v.amount) || 0 : 0;
  const ded = Number(v.deduction) || 0;
  const paid = Number(order.deposit) || 0;
    const no = order.orderNo || order.id.slice(-6);
    let counters = data.counters, freedNumbers = data.freedNumbers;
    const tr = issueNumber(data, counters, "return", 1000, (data.returns || []).map((r) => r.returnNo)); counters = tr.counters; freedNumbers = tr.freedNumbers;
    let vouchers = data.vouchers, financeAccounts = data.financeAccounts, voucherId = "";
    if (isRefund && amt > 0) {
      const bv = buildVoucher(counters, { type: "صرف", accountId: v.accountId, branch: order.branch, category: "مرتجع عميل", amount: amt, description: `مرتجع طلب #${no} — ${v.reason}`, date: v.date, orderId: order.id, partyType: "عميل", partyId: order.customerId }, currentUser, { ...data, freedNumbers });
      counters = bv.counters; freedNumbers = bv.freedNumbers; voucherId = bv.voucher.id;
      vouchers = [...data.vouchers, bv.voucher];
      financeAccounts = data.financeAccounts.map((a) => a.id === v.accountId ? { ...a, balance: round2((Number(a.balance) || 0) - amt) } : a);
    }
    let employeeLedger = data.employeeLedger || [];
    if (v.dropEarnings) employeeLedger = employeeLedger.filter((l) => !(l.auto && l.orderId === order.id));
    if (ded > 0) {
      const te = nextCounter(counters, "empEntry", 5000); counters = te.counters;
      employeeLedger = [...employeeLedger, { id: uid("el"), entryNo: te.no, employeeId: v.employeeId, date: v.date, createdAt: new Date().toISOString(), kind: "خصم", desc: `خصم بسبب ${v.kind} — طلب #${no}: ${v.reason}`, credit: 0, debit: ded, orderId: order.id, by: currentUser }];
    }
    const stageLog = v.redoStage ? [...(order.stageLog || []), { stage: v.redoStage, at: new Date().toLocaleString("ar-SA"), ts: new Date().toISOString(), note: `إعادة للتعديل — ${v.reason}` }] : order.stageLog;
    const orders = data.orders.map((o) => o.id === order.id ? { ...o, deposit: isRefund ? Math.max(0, paid - amt) : o.deposit, returnedAmount: round2((Number(o.returnedAmount) || 0) + amt), ...(v.redoStage ? { stage: v.redoStage, stageLog } : {}) } : o);
    const rec = { id: uid("ret"), returnNo: tr.no, orderId: order.id, orderNo: no, customerId: order.customerId, branch: order.branch, date: v.date, kind: v.kind, reason: v.reason.trim(), amount: amt, voucherId, employeeId: v.employeeId || "", deduction: ded, droppedEarnings: !!v.dropEarnings, redoStage: v.redoStage || "", createdBy: currentUser, createdAt: new Date().toISOString() };
    const auditLog = [...(data.auditLog || []), logEntry(currentUser, v.kind, `طلب #${no} — ${v.reason}${amt ? ` — استرداد ${fmtNum(amt)} ر.س` : ""}${ded ? ` — خصم ${fmtNum(ded)} من الموظف` : ""}`)];
    return { patch: { returns: [...(data.returns || []), rec], orders, vouchers, financeAccounts, employeeLedger, counters, freedNumbers, auditLog }, rec };
}

function ReturnModal({ data, update, order, currentUser, onClose }) {
  const cust = data.customers.find((c) => c.id === order.customerId);
  const paid = Number(order.deposit) || 0;
  const tailorId = order.stageAssignments?.["الخياطة"] || order.assignedTailorId || "";
  const [v, setV] = useState({ kind: "مرتجع واسترداد", amount: paid, accountId: data.financeAccounts[0]?.id, reason: "", employeeId: tailorId, deduction: "", dropEarnings: false, redoStage: "", date: todayStr() });
  const isRefund = v.kind === "مرتجع واسترداد";
  const save = () => {
    const amt = isRefund ? Number(v.amount) || 0 : 0;
    if (!String(v.reason || "").trim()) { alert("اكتب سبب المرتجع / التعديل"); return; }
    if (!periodAllowed(data, v.date, "تسجيل مرتجع بهذا التاريخ")) return;
    if (isRefund && amt > paid) {
      if (!data._isAdmin) { alert(`المبلغ المسترد (${fmtNum(amt)}) أكبر من المدفوع على الطلب (${fmtNum(paid)})`); return; }
      if (!window.confirm(`المبلغ المسترد (${fmtNum(amt)}) أكبر من المدفوع على الطلب (${fmtNum(paid)}). كمدير للنظام يمكنك المتابعة. هل تتابع؟`)) return;
    }
    if (isRefund && amt > 0 && !v.accountId) { alert("اختر الحساب الذي يُصرف منه المبلغ"); return; }
    const ded = Number(v.deduction) || 0;
    if (ded > 0 && !v.employeeId) { alert("اختر الموظف المراد الخصم منه"); return; }
    if (!isRefund && !v.redoStage && !ded && !v.dropEarnings) { if (!window.confirm("لم تحدد إعادة مرحلة ولا خصمًا. سيُسجَّل التعديل للمتابعة فقط. متابعة؟")) return; }
    const { patch, rec } = buildReturnPatch(data, order, v, currentUser);
    update(patch);
    onClose(rec);
  };
  return (
    <Modal title={`مرتجع / تعديل — طلب #${order.orderNo || ""}`} onClose={() => onClose(null)}>
      <div style={{ fontSize: 13, marginBottom: 10 }}>العميل: <b>{cust?.name || "—"}</b> — المدفوع على الطلب: <b>{fmtNum(paid)} ر.س</b></div>
      <Field label="النوع"><SelectInput options={[{ value: "مرتجع واسترداد", label: "مرتجع واسترداد مبلغ" }, { value: "تعديل / إعادة تفصيل", label: "تعديل / إعادة تفصيل (بدون استرداد)" }]} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} /></Field>
      {isRefund && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="المبلغ المسترد (ر.س)"><TextInput type="number" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
          <Field label="يُصرف من حساب"><SelectInput options={data.financeAccounts.map((a) => ({ value: a.id, label: a.name }))} value={v.accountId} onChange={(e) => setV({ ...v, accountId: e.target.value })} /></Field>
        </div>
      )}
      <Field label="السبب (إلزامي)"><TextInput value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="مثال: مقاس خاطئ، عيب في الخياطة" /></Field>
      <Field label="إعادة الطلب إلى مرحلة (اختياري)"><SelectInput options={[{ value: "", label: "بدون" }, ...data.orderStages.slice(0, -1).map((s) => ({ value: s, label: s }))]} value={v.redoStage} onChange={(e) => setV({ ...v, redoStage: e.target.value })} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="الموظف المسؤول (اختياري)"><SelectInput options={[{ value: "", label: "— لا أحد —" }, ...data.employees.map((e) => ({ value: e.id, label: `${e.name} (${e.role})` }))]} value={v.employeeId} onChange={(e) => setV({ ...v, employeeId: e.target.value })} /></Field>
        <Field label="خصم من الموظف (ر.س)"><TextInput type="number" value={v.deduction} onChange={(e) => setV({ ...v, deduction: e.target.value })} /></Field>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginBottom: 12 }}><input type="checkbox" checked={v.dropEarnings} onChange={(e) => setV({ ...v, dropEarnings: e.target.checked })} />إلغاء أجر القطعة والنسبة التي احتُسبت للموظفين على هذا الطلب</label>
      <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={save}>حفظ{isRefund ? " وإصدار سند الصرف" : ""}</Btn><Btn variant="ghost" onClick={() => onClose(null)}>إلغاء</Btn></div>
    </Modal>
  );
}

function ReturnsView({ data, update, canEdit, currentUser }) {
  const [pick, setPick] = useState(null);
  const [orderId, setOrderId] = useState("");
  const [printing, setPrinting] = useState(null);
  const custName = (id) => data.customers.find((c) => c.id === id)?.name || "—";
  const rows = [...(data.returns || [])].sort((a, b) => (b.returnNo || 0) - (a.returnNo || 0));
  const pickable = data.orders.filter((o) => !o.cancelled);
  const th = { padding: "8px 10px", textAlign: "right" };
  const totalRefund = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><RotateCcw size={22} color={THEME.brass} /><h2 style={{ margin: 0, fontFamily: "Amiri, serif", fontSize: 26 }}>المرتجعات والتعديلات</h2></div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ width: 280 }}><SelectInput options={[{ value: "", label: "— اختر الطلب —" }, ...pickable.map((o) => ({ value: o.id, label: `#${o.orderNo} — ${custName(o.customerId)}` }))]} value={orderId} onChange={(e) => setOrderId(e.target.value)} /></div>
            <Btn variant="brass" onClick={() => { const o = data.orders.find((x) => x.id === orderId); if (!o) { alert("اختر الطلب أولًا"); return; } setPick(o); }}><Plus size={16} />مرتجع / تعديل جديد</Btn>
          </div>
        )}
      </div>
      <Panel>
        {rows.length === 0 ? <EmptyState text="لا توجد مرتجعات أو تعديلات مسجَّلة" /> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead><tr style={{ background: "#EFE7D6" }}><th style={th}>الرقم</th><th style={th}>التاريخ</th><th style={th}>الطلب</th><th style={th}>العميل</th><th style={th}>النوع</th><th style={th}>السبب</th><th style={th}>المسترد</th><th style={th}>الموظف / الخصم</th><th style={th}></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${THEME.border}` }}>
                    <td style={{ padding: "8px 10px", fontWeight: 700, color: THEME.brass }}>{r.returnNo}</td>
                    <td style={{ padding: "8px 10px" }}>{r.date}</td>
                    <td style={{ padding: "8px 10px" }}>#{r.orderNo}</td>
                    <td style={{ padding: "8px 10px" }}>{custName(r.customerId)}</td>
                    <td style={{ padding: "8px 10px" }}><Badge color={r.amount ? THEME.red : THEME.teal}>{r.kind}</Badge>{r.redoStage && <div style={{ fontSize: 11.5, color: "#8A8071" }}>أُعيد إلى: {r.redoStage}</div>}</td>
                    <td style={{ padding: "8px 10px" }}>{r.reason}</td>
                    <td style={{ padding: "8px 10px", fontWeight: 700 }}>{r.amount ? `${fmtNum(r.amount)} ر.س` : "—"}</td>
                    <td style={{ padding: "8px 10px", fontSize: 12.5 }}>{r.employeeId ? (data.employees.find((e) => e.id === r.employeeId)?.name || "—") : "—"}{r.deduction ? ` — خصم ${fmtNum(r.deduction)}` : ""}{r.droppedEarnings ? " — أُلغيت أجوره" : ""}</td>
                    <td style={{ padding: "8px 10px" }}><Btn small variant="ghost" onClick={() => setPrinting(r)}><Printer size={13} /></Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {rows.length > 0 && <div style={{ marginTop: 10, fontSize: 13, color: "#7A7061" }}>إجمالي المسترد: <b>{fmtNum(totalRefund)} ر.س</b> في {rows.length} سجل</div>}
      <div style={{ fontSize: 12, color: "#8A8071", marginTop: 8 }}>يمكنك أيضًا فتح المرتجع من تفاصيل أي طلب. المبلغ المسترد يُصدر له سند صرف مرقَّم ويُنقص المدفوع من الطلب ويظهر في كشف العميل.</div>
      {pick && <ReturnModal data={data} update={update} order={pick} currentUser={currentUser} onClose={() => { setPick(null); setOrderId(""); }} />}
      {printing && (
        <RecordPrintModal data={data} docType="voucher" title={printing.amount ? "إشعار مرتجع" : "طلب تعديل"} refLabel="مرتجع" refNo={printing.returnNo} date={printing.date} amount={printing.amount || undefined}
          onClose={() => setPrinting(null)} signatures={["توقيع العميل", "المحاسب / المسؤول"]}
          partyTitle="بيانات العميل" partyRows={[{ label: "الاسم", value: custName(printing.customerId) }, ...(data.customers.find((c) => c.id === printing.customerId)?.phone ? [{ label: "الجوال", value: data.customers.find((c) => c.id === printing.customerId).phone }] : [])]}
          rows={[{ label: "الطلب", value: `#${printing.orderNo}` }, { label: "النوع", value: printing.kind }, { label: "الفرع", value: data.branches.find((b) => b.id === printing.branch)?.name || "—" }, { label: "السبب", value: printing.reason }, ...(printing.redoStage ? [{ label: "أُعيد إلى مرحلة", value: printing.redoStage }] : [])]} />
      )}
    </div>
  );
}

// ---------- Employee performance ----------
// Pieces and earnings come from the employee ledger (credited when the courier hands a piece over);
// rework comes from returns/amendments; speed is measured from hand-over to receipt (recorded from this version on).
function employeePerformance(data, { from, to, branch }) {
  const inRange = (d) => (!from || (d || "") >= from) && (!to || (d || "") <= to);
  const def = data.branches[0]?.id;
  const orderById = new Map(data.orders.map((o) => [o.id, o]));
  return data.employees.filter((e) => !branch || empBranches(data, e).includes(branch)).map((e) => {
    const earn = (data.employeeLedger || []).filter((l) => {
      const o = orderById.get(l.orderId);
      return l.employeeId === e.id && l.auto && (l.kind === "قطعة" || l.kind === "نسبة") && o && !o.cancelled && inRange(l.date) && (!branch || (o.branch || def) === branch);
    });
    const pieceKeys = new Set(earn.map((l) => `${l.orderId}|${l.stage}`));
    const orderIds = new Set(earn.map((l) => l.orderId));
    const value = round2([...orderIds].reduce((t, id) => { const o = orderById.get(id); return t + Math.max(0, (Number(o.price) || 0) - (Number(o.discount) || 0)); }, 0));
    const wages = round2(earn.reduce((t, l) => t + (Number(l.credit) || 0), 0));
    const returns = (data.returns || []).filter((r) => r.employeeId === e.id && inRange(r.date) && (!branch || (r.branch || def) === branch));
    const deductions = round2((data.employeeLedger || []).filter((l) => l.employeeId === e.id && l.kind === "خصم" && inRange(l.date)).reduce((t, l) => t + (Number(l.debit) || 0), 0));
    const durs = [];
    data.orders.forEach((o) => {
      if (o.cancelled || (branch && (o.branch || def) !== branch)) return;
      const log = o.stageLog || [];
      log.forEach((en, i) => {
        if (!en.ts || !String(en.note || "").startsWith("تسليم إلى") || !String(en.note).endsWith(`— ${e.name}`) || !inRange(String(en.ts).slice(0, 10))) return;
        const rec = log.slice(i + 1).find((x) => x.ts && String(x.note || "").startsWith(`استلام من ${en.stage}`));
        if (rec) { const h = (new Date(rec.ts) - new Date(en.ts)) / 3600000; if (h >= 0) durs.push(h); }
      });
    });
    const avgHours = durs.length ? round2(durs.reduce((a, b) => a + b, 0) / durs.length) : null;
    const pieces = pieceKeys.size;
    return { emp: e, pieces, value, wages, returns, deductions, avgHours, timed: durs.length, reworkRate: pieces ? round2(returns.length / pieces * 100) : 0, earn };
  });
}
const fmtHours = (h) => h === null ? "—" : h >= 48 ? `${fmtNum(h / 24)} يوم` : `${fmtNum(h)} ساعة`;

function EmployeePerformance({ data }) {
  const now = new Date();
  const [from, setFrom] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
  const [to, setTo] = useState(todayStr());
  const [branch, setBranch] = useState("");
  const [sort, setSort] = useState("pieces");
  const [detail, setDetail] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [tplId, setTplId] = useState(null);
  const rows = employeePerformance(data, { from, to, branch }).filter((r) => r.pieces || r.returns.length || r.deductions || r.wages)
    .sort((a, b) => sort === "rework" ? b.reworkRate - a.reworkRate : sort === "speed" ? (a.avgHours ?? 1e9) - (b.avgHours ?? 1e9) : sort === "value" ? b.value - a.value : b.pieces - a.pieces);
  const maxPieces = Math.max(1, ...rows.map((r) => r.pieces));
  const th = { padding: "8px 10px", textAlign: "right" };
  const tpl = resolveTpl(data, "statement", tplId);
  const periodText = `${from || "…"} إلى ${to || "…"}${branch ? ` — ${data.branches.find((b) => b.id === branch)?.name}` : ""}`;
  return (
    <Panel style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>أداء الموظفين</div>
        <Btn small variant="ghost" onClick={() => setPrinting(true)}><Printer size={13} />طباعة التقرير</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 6 }}>
        <Field label="من"><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="إلى"><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {data.branches.length > 1 && <Field label="الفرع"><SelectInput options={[{ value: "", label: "كل الفروع" }, ...data.branches.map((b) => ({ value: b.id, label: b.name }))]} value={branch} onChange={(e) => setBranch(e.target.value)} /></Field>}
        <Field label="الترتيب حسب"><SelectInput options={[{ value: "pieces", label: "عدد القطع" }, { value: "value", label: "قيمة الطلبات" }, { value: "speed", label: "الأسرع إنجازًا" }, { value: "rework", label: "الأكثر إعادة" }]} value={sort} onChange={(e) => setSort(e.target.value)} /></Field>
      </div>
      {rows.length === 0 ? <EmptyState text="لا توجد بيانات أداء في هذه الفترة" /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead><tr style={{ background: "#EFE7D6" }}><th style={th}>الموظف</th><th style={th}>القطع</th><th style={th}>قيمة الطلبات</th><th style={th}>أجور القطع والنسب</th><th style={th}>متوسط زمن الإنجاز</th><th style={th}>إعادات</th><th style={th}>خصومات</th><th style={th}></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.emp.id} style={{ borderTop: `1px solid ${THEME.border}` }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600 }}>{r.emp.name}<div style={{ fontSize: 11.5, color: "#8A8071", fontWeight: 400 }}>{r.emp.role}</div></td>
                  <td style={{ padding: "8px 10px", minWidth: 120 }}><b>{r.pieces}</b><div style={{ height: 5, background: "#EFE7D6", borderRadius: 3, marginTop: 3 }}><div style={{ width: `${r.pieces / maxPieces * 100}%`, height: 5, background: THEME.brass, borderRadius: 3 }} /></div></td>
                  <td style={{ padding: "8px 10px" }}>{fmtNum(r.value)}</td>
                  <td style={{ padding: "8px 10px" }}>{fmtNum(r.wages)}</td>
                  <td style={{ padding: "8px 10px" }}>{fmtHours(r.avgHours)}{r.timed > 0 && <div style={{ fontSize: 11, color: "#8A8071" }}>من {r.timed} قياس</div>}</td>
                  <td style={{ padding: "8px 10px", color: r.reworkRate > 10 ? THEME.red : "inherit", fontWeight: r.returns.length ? 700 : 400 }}>{r.returns.length}{r.pieces ? ` (${fmtNum(r.reworkRate)}%)` : ""}</td>
                  <td style={{ padding: "8px 10px" }}>{r.deductions ? fmtNum(r.deductions) : "—"}</td>
                  <td style={{ padding: "8px 10px" }}><Btn small variant="ghost" onClick={() => setDetail(r)}>تفاصيل</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "#8A8071", marginTop: 8 }}>القطع = ما سلّمه المراسل للموظف في الفترة (قطعة لكل طلب ومرحلة). الإعادات من «المرتجعات والتعديلات» المسجَّلة عليه. زمن الإنجاز = من التسليم للموظف حتى الاستلام منه، ويُقاس للتسليمات الجديدة فقط.</div>

      {detail && (
        <Modal title={`تفاصيل أداء — ${detail.emp.name}`} onClose={() => setDetail(null)} wide>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>القطع المستلمة ({detail.pieces})</div>
          {detail.earn.length === 0 ? <EmptyState text="لا قطع" /> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#EFE7D6" }}><th style={th}>التاريخ</th><th style={th}>الطلب</th><th style={th}>المرحلة</th><th style={th}>النوع</th><th style={th}>المبلغ</th></tr></thead>
              <tbody>{detail.earn.map((l) => <tr key={l.id} style={{ borderTop: `1px solid ${THEME.border}` }}><td style={{ padding: "6px 10px" }}>{l.date}</td><td style={{ padding: "6px 10px" }}>{data.orders.find((o) => o.id === l.orderId)?.orderNo ? `#${data.orders.find((o) => o.id === l.orderId).orderNo}` : "—"}</td><td style={{ padding: "6px 10px" }}>{l.stage}</td><td style={{ padding: "6px 10px" }}>{l.kind}</td><td style={{ padding: "6px 10px" }}>{fmtNum(l.credit)}</td></tr>)}</tbody>
            </table>
          )}
          {detail.returns.length > 0 && (
            <>
              <div style={{ fontWeight: 700, margin: "14px 0 6px", color: THEME.red }}>الإعادات والمرتجعات ({detail.returns.length})</div>
              {detail.returns.map((r) => <div key={r.id} style={{ fontSize: 13, padding: "5px 0", borderBottom: `1px dashed ${THEME.border}` }}>#{r.returnNo} — طلب #{r.orderNo} — {r.kind} — {r.reason}{r.deduction ? ` — خصم ${fmtNum(r.deduction)}` : ""}</div>)}
            </>
          )}
        </Modal>
      )}

      {printing && (
        <Modal title="طباعة تقرير الأداء" onClose={() => setPrinting(false)} width={900}>
          <PrintStage data={data} docType="statement" tplId={tplId} setTplId={setTplId}>
            <PrintSheet data={data} tpl={tpl} title="تقرير أداء الموظفين" date={todayStr()} meta={[{ label: "الفترة", value: periodText }, { label: "عدد الموظفين", value: rows.length }, { label: "إجمالي القطع", value: rows.reduce((t, r) => t + r.pieces, 0) }]} signatures={["المدير", "المراجع"]}>
              <PTable tpl={tpl} columns={[{ key: "n", label: "الموظف" }, { key: "p", label: "القطع", align: "center" }, { key: "v", label: "قيمة الطلبات", align: "center" }, { key: "w", label: "أجور القطع والنسب", align: "center" }, { key: "t", label: "متوسط الزمن", align: "center" }, { key: "r", label: "إعادات", align: "center" }, { key: "d", label: "خصومات", align: "center" }]}
                rows={rows.map((r) => ({ key: r.emp.id, n: `${r.emp.name} (${r.emp.role})`, p: r.pieces, v: fmtNum(r.value), w: fmtNum(r.wages), t: fmtHours(r.avgHours), r: `${r.returns.length}${r.pieces ? ` (${fmtNum(r.reworkRate)}%)` : ""}`, d: r.deductions ? fmtNum(r.deductions) : "—" }))} />
            </PrintSheet>
          </PrintStage>
        </Modal>
      )}
    </Panel>
  );
}

// ---------- Branch profit & loss ----------
function branchPnL(data, month, branchId) {
  const def = data.branches[0]?.id;
  const inMonth = (d) => String(d || "").slice(0, 7) === month;
  const sum = (arr, f) => round2(arr.reduce((t, x) => t + (Number(f(x)) || 0), 0));
  const group = (arr, keyF, valF) => { const m = {}; arr.forEach((x) => { const k = keyF(x) || "أخرى"; m[k] = round2((m[k] || 0) + (Number(valF(x)) || 0)); }); return m; };
  const orders = data.orders.filter((o) => !o.cancelled && (o.branch || def) === branchId && inMonth(o.createdAt));
  const revenue = sum(orders, (o) => Math.max(0, (Number(o.price) || 0) - (Number(o.discount) || 0)));
  const outV = liveVouchers(data).filter((v) => v.type === "صرف" && (v.branch || def) === branchId && inMonth(v.date));
  const refunds = sum(outV.filter((v) => v.category === "مرتجع عميل"), (v) => v.amount);
  const expList = outV.filter((v) => !v.employeeId && !v.supplierId && v.category !== "مرتجع عميل");
  const expenses = sum(expList, (v) => v.amount); const expensesByCat = group(expList, (v) => v.category, (v) => v.amount);
  const purList = (data.purchases || []).filter((x) => (x.branch || def) === branchId && inMonth(x.date));
  const purchases = sum(purList, (x) => x.cost); const purchasesByCat = group(purList, (x) => x.category, (x) => x.cost);
  const weightOf = (l) => {
    const emp = data.employees.find((e) => e.id === l.employeeId);
    const ord = l.orderId ? data.orders.find((o) => o.id === l.orderId) : null;
    return ord ? ((ord.branch || def) === branchId ? 1 : 0) : (emp ? empBranchWeight(data, emp, branchId) : (def === branchId ? 1 : 0));
  };
  const ledger = data.employeeLedger || [];
  const wages = round2(ledger.filter((l) => ["راتب", "قطعة", "نسبة", "مكافأة"].includes(l.kind) && (l.month ? l.month === month : inMonth(l.date))).reduce((t, l) => t + (Number(l.credit) || 0) * weightOf(l), 0));
  const shares = round2(ledger.filter((l) => l.kind === "أرباح" && l.month === month && (!l.branchId || l.branchId === branchId)).reduce((t, l) => t + (Number(l.credit) || 0), 0));
  const profit = round2(revenue - refunds - purchases - expenses - wages);
  return { revenue, refunds, purchases, purchasesByCat, expenses, expensesByCat, wages, profit, shares, net: round2(profit - shares), orders: orders.length };
}
function sumPnL(list) {
  const out = { revenue: 0, refunds: 0, purchases: 0, expenses: 0, wages: 0, profit: 0, shares: 0, net: 0, orders: 0, purchasesByCat: {}, expensesByCat: {} };
  list.forEach((p) => {
    ["revenue", "refunds", "purchases", "expenses", "wages", "profit", "shares", "net", "orders"].forEach((k) => { out[k] = round2(out[k] + p[k]); });
    ["purchasesByCat", "expensesByCat"].forEach((k) => Object.keys(p[k]).forEach((c) => { out[k][c] = round2((out[k][c] || 0) + p[k][c]); }));
  });
  return out;
}
function PnLReport({ data, initialMode }) {
  const isAdmin = !!data._isAdmin;   // only the system admin sees the consolidated total of all branches
  const now = new Date(); const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const [mode, setMode] = useState(initialMode || "branches");
  const [month, setMonth] = useState(ym(now));
  const [fromM, setFromM] = useState(ym(new Date(now.getFullYear(), now.getMonth() - 5, 1)));
  const [toM, setToM] = useState(ym(now));
  const [branch, setBranch] = useState(isAdmin ? "" : (data.branches[0]?.id || ""));
  const [metric, setMetric] = useState("profit");
  const [printing, setPrinting] = useState(false);
  const [tplId, setTplId] = useState(null);
  const tpl = resolveTpl(data, "statement", tplId);
  const monthsBetween = (a, b) => { const out = []; let [y, m] = a.split("-").map(Number); const [y2, m2] = b.split("-").map(Number); let guard = 0; while ((y < y2 || (y === y2 && m <= m2)) && guard++ < 36) { out.push(`${y}-${String(m).padStart(2, "0")}`); m += 1; if (m > 12) { m = 1; y += 1; } } return out; };
  const mLabel = (m) => new Date(`${m}-01`).toLocaleDateString("ar-SA", { month: "short", year: "2-digit" });
  const bName = (id) => data.branches.find((b) => b.id === id)?.name || "—";
  const metrics = { profit: ["صافي الربح", (p) => p.profit], revenue: ["الإيرادات", (p) => p.revenue], net: ["الصافي بعد حصص الموظفين", (p) => p.net] };
  const months = monthsBetween(fromM, toM);
  const effBranch = branch || (isAdmin ? "" : data.branches[0]?.id);
  const branchIds = effBranch ? [effBranch] : data.branches.map((b) => b.id);

  let head = [], tableRows = [], chartData = [];
  const money = (v) => fmtNum(v);
  if (mode === "matrix") {
    // every branch on its own line, month by month — the branch comparison
    const [mlabel, mget] = metrics[metric];
    const perBranch = data.branches.map((b) => ({ b, vals: months.map((m) => mget(branchPnL(data, m, b.id))) }));
    head = ["الفرع", ...months.map(mLabel), "المجموع"];
    const best = months.map((_, j) => Math.max(...perBranch.map((x) => x.vals[j])));
    tableRows = perBranch.map((x) => ({ label: x.b.name, cells: [...x.vals.map((v) => money(v)), money(x.vals.reduce((a, c) => a + c, 0))], nums: x.vals, best: x.vals.map((v, j) => data.branches.length > 1 && v === best[j] && v > 0) }));
    if (isAdmin && data.branches.length > 1) { const tot = months.map((_, j) => round2(perBranch.reduce((t, x) => t + x.vals[j], 0))); tableRows.push({ label: `إجمالي الفروع (${mlabel})`, cells: [...tot.map(money), money(tot.reduce((a, c) => a + c, 0))], nums: tot, strong: true }); }
    chartData = months.map((m, j) => { const o = { name: mLabel(m) }; perBranch.forEach((x) => { o[x.b.name] = x.vals[j]; }); return o; });
  } else {
    let cols;
    if (mode === "branches") {
      cols = data.branches.map((b) => ({ label: b.name, p: branchPnL(data, month, b.id) }));
      if (isAdmin && cols.length > 1) cols.push({ label: "إجمالي الفروع", p: sumPnL(cols.map((c) => c.p)), total: true });
    } else {
      cols = months.map((m) => ({ label: mLabel(m), p: sumPnL(branchIds.map((id) => branchPnL(data, m, id))) }));
      if (cols.length > 1) cols.push({ label: "الإجمالي", p: sumPnL(cols.map((c) => c.p)), total: true });
      chartData = cols.filter((c) => !c.total).map((c) => ({ name: c.label, الإيرادات: c.p.revenue, "صافي الربح": c.p.profit }));
    }
    const catKeys = (k) => [...new Set(cols.flatMap((c) => Object.keys(c.p[k])))];
    const defs = [
      { label: "إيرادات الطلبات (بعد الخصم)", get: (p) => p.revenue, sign: "+" },
      { label: "مرتجعات واستردادات", get: (p) => p.refunds, sign: "−" },
      { label: "مشتريات", get: (p) => p.purchases, sign: "−" },
      ...catKeys("purchasesByCat").map((c) => ({ label: c, get: (p) => p.purchasesByCat[c] || 0, sub: true })),
      { label: "مصروفات تشغيلية", get: (p) => p.expenses, sign: "−" },
      ...catKeys("expensesByCat").map((c) => ({ label: c, get: (p) => p.expensesByCat[c] || 0, sub: true })),
      { label: "رواتب وأجور وعمولات", get: (p) => p.wages, sign: "−" },
      { label: "صافي الربح", get: (p) => p.profit, strong: true },
      { label: "هامش الربح %", get: (p) => p.revenue ? `${fmtNum(p.profit / p.revenue * 100)}%` : "—", pct: true },
      { label: "حصص أرباح الموظفين", get: (p) => p.shares, sign: "−" },
      { label: "الصافي بعد الحصص", get: (p) => p.net, strong: true },
    ];
    head = ["البند", ...cols.map((c) => c.label)];
    tableRows = defs.map((r) => ({ label: `${r.sign ? r.sign + " " : ""}${r.label}`, cells: cols.map((c) => { const v = r.get(c.p); return typeof v === "number" ? money(v) : v; }), nums: cols.map((c) => r.get(c.p)), strong: r.strong, sub: r.sub, pct: r.pct, totalCol: cols.map((c) => !!c.total) }));
  }
  const th = { padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" };
  const periodText = mode === "branches" ? `شهر ${month}` : `من ${fromM} إلى ${toM}${mode === "months" ? (effBranch ? ` — ${bName(effBranch)}` : " — كل الفروع") : ` — ${metrics[metric][0]}`}`;
  const palette = [THEME.brass, THEME.teal, "#7A1F2B", "#1F3A68", "#B8860B", "#6B8E23"];
  const branchOptions = [...(isAdmin ? [{ value: "", label: "كل الفروع (إجمالي)" }] : []), ...data.branches.map((b) => ({ value: b.id, label: b.name }))];
  return (
    <Panel style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>قائمة الأرباح والخسائر — لكل فرع على حدة</div>
        <Btn small variant="ghost" onClick={() => setPrinting(true)}><Printer size={13} />طباعة</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginBottom: 6 }}>
        <Field label="العرض"><SelectInput options={[{ value: "branches", label: "مقارنة الفروع (شهر واحد)" }, { value: "matrix", label: "مقارنة الفروع عبر الأشهر" }, { value: "months", label: "فرع واحد عبر الأشهر" }]} value={mode} onChange={(e) => setMode(e.target.value)} /></Field>
        {mode === "branches" ? <Field label="الشهر"><TextInput type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field> : (
          <>
            <Field label="من شهر"><TextInput type="month" value={fromM} onChange={(e) => setFromM(e.target.value)} /></Field>
            <Field label="إلى شهر"><TextInput type="month" value={toM} onChange={(e) => setToM(e.target.value)} /></Field>
            {mode === "months" && data.branches.length > 1 && <Field label="الفرع"><SelectInput options={branchOptions} value={branch} onChange={(e) => setBranch(e.target.value)} /></Field>}
            {mode === "matrix" && <Field label="المؤشر"><SelectInput options={Object.entries(metrics).map(([value, m]) => ({ value, label: m[0] }))} value={metric} onChange={(e) => setMetric(e.target.value)} /></Field>}
          </>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr style={{ background: "#EFE7D6" }}>{head.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {tableRows.map((r, i) => (
              <tr key={i} style={{ borderTop: r.strong ? `2px solid ${THEME.brass}` : `1px solid ${THEME.border}`, fontWeight: r.strong ? 700 : 400, background: r.strong ? `${THEME.brass}14` : "transparent", color: r.sub || r.pct ? "#7A7061" : "inherit", fontSize: r.sub || r.pct ? 12.5 : 13.5 }}>
                <td style={{ padding: "7px 10px", paddingRight: r.sub ? 26 : 10, fontWeight: r.strong || mode === "matrix" ? 700 : "inherit" }}>{r.label}</td>
                {r.cells.map((c, j) => { const n = r.nums?.[j]; const isLast = mode === "matrix" && j === r.cells.length - 1; return <td key={j} style={{ padding: "7px 10px", fontWeight: (r.best?.[j] || isLast) ? 700 : "inherit", color: typeof n === "number" && (r.strong || mode === "matrix") ? (n < 0 ? THEME.red : (r.best?.[j] ? THEME.teal : "inherit")) : undefined, background: r.totalCol?.[j] ? "#F3EBDA" : undefined }}>{c}{r.best?.[j] ? " ★" : ""}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mode === "matrix" && <div style={{ fontSize: 11.5, color: "#8A8071", marginTop: 6 }}>★ = أعلى فرع في ذلك الشهر.</div>}
      {chartData.length > 1 && (
        <div style={{ width: "100%", height: 240, marginTop: 14 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={THEME.border} /><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Legend />
              {mode === "matrix" ? data.branches.map((b, i) => <Bar key={b.id} dataKey={b.name} fill={palette[i % palette.length]} radius={[4, 4, 0, 0]} />) : <><Bar dataKey="الإيرادات" fill={THEME.brass} radius={[4, 4, 0, 0]} /><Bar dataKey="صافي الربح" fill={THEME.teal} radius={[4, 4, 0, 0]} /></>}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "#8A8071", marginTop: 8 }}>الإيراد = قيمة الطلبات غير الملغاة في شهر إنشائها بعد الخصم (استحقاق لا نقد). المشتريات والمصروفات حسب فرعها وتاريخها؛ سندات الموردين والموظفين لا تُحسب مصروفًا لأن المشتريات والرواتب محسوبة أصلًا. الرواتب والمكافآت للموظف متعدد الفروع تُوزَّع بنسب فروعه.{isAdmin ? "" : " إجمالي الفروع يراه مدير النظام فقط."}</div>

      {printing && (
        <Modal title="طباعة قائمة الأرباح والخسائر" onClose={() => setPrinting(false)} width={900}>
          <PrintStage data={data} docType="statement" tplId={tplId} setTplId={setTplId}>
            <PrintSheet data={data} tpl={tpl} title="قائمة الأرباح والخسائر" date={todayStr()} meta={[{ label: "الفترة", value: periodText }, { label: "العرض", value: mode === "branches" ? "مقارنة الفروع" : mode === "matrix" ? "الفروع عبر الأشهر" : "فرع عبر الأشهر" }]} signatures={["المحاسب", "المدير"]}>
              <PTable tpl={tpl} columns={head.map((h, i) => ({ key: `c${i}`, label: h, align: i ? "center" : "right" }))}
                rows={tableRows.map((r, i) => { const o = { key: i, c0: `${r.sub ? "   " : ""}${r.label}` }; r.cells.forEach((c, j) => { o[`c${j + 1}`] = c; }); return o; })} />
            </PrintSheet>
          </PrintStage>
        </Modal>
      )}
    </Panel>
  );
}

// ---------- Month close ----------
// A closed month is frozen: nobody but the system admin can add, cancel, delete or change anything dated in it,
// and the admin gets an explicit warning first (he is never blocked).
const isMonthClosed = (data, d) => (data.closedPeriods || []).some((p) => p.month === String(d || "").slice(0, 7));
function periodAllowed(data, dateStr, what) {
  if (!dateStr || !isMonthClosed(data, dateStr)) return true;
  const m = String(dateStr).slice(0, 7);
  if (!data._isAdmin) { alert(`شهر ${m} مقفل ولا يمكن ${what}. اطلب ذلك من مدير النظام.`); return false; }
  return window.confirm(`شهر ${m} مقفل. ${what} سيغيّر أرقامًا مقفلة. كمدير للنظام يمكنك المتابعة. هل تتابع؟`);
}
function ClosePeriodsPanel({ data, update, currentUser }) {
  const isAdmin = !!data._isAdmin;
  const now = new Date(); const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(ym(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
  const closed = [...(data.closedPeriods || [])].sort((a, b) => b.month.localeCompare(a.month));
  const ledger = data.employeeLedger || [];
  const unsalaried = data.employees.filter((e) => Number(e.baseSalary) > 0 && !ledger.some((l) => l.employeeId === e.id && l.kind === "راتب" && l.month === month));
  const noShare = data.employees.filter((e) => Number(e.profitSharePercent) > 0 && !ledger.some((l) => l.employeeId === e.id && l.kind === "أرباح" && l.month === month));
  const openOrders = data.orders.filter((o) => !o.cancelled && o.stage !== "تم التسليم" && String(o.createdAt || "").slice(0, 7) === month).length;
  const alreadyClosed = isMonthClosed(data, `${month}-01`);
  const close = () => {
    if (!month) return;
    const warnings = [];
    if (unsalaried.length) warnings.push(`${unsalaried.length} موظف لم تُثبَّت رواتبهم`);
    if (noShare.length) warnings.push(`${noShare.length} موظف لم تُثبَّت نسبة أرباحهم`);
    if (month >= ym(now)) warnings.push("الشهر لم ينتهِ بعد");
    if (!window.confirm(`إقفال شهر ${month}؟ لن يستطيع أحد غير مدير النظام تعديل أي شيء مؤرَّخ فيه.${warnings.length ? `\n\nتنبيهات: ${warnings.join("، ")}.` : ""}`)) return;
    const snapshot = {}; data.branches.forEach((b) => { const r = branchPnL(data, month, b.id); snapshot[b.id] = { revenue: r.revenue, profit: r.profit, net: r.net }; });
    update({ closedPeriods: [...(data.closedPeriods || []), { id: uid("cl"), month, closedAt: new Date().toISOString(), by: currentUser, snapshot }], auditLog: [...(data.auditLog || []), logEntry(currentUser, "إقفال شهر", month)] });
  };
  const reopen = (pr) => {
    if (!window.confirm(`إعادة فتح شهر ${pr.month}؟ سيتمكن المستخدمون من التعديل عليه من جديد.`)) return;
    update({ closedPeriods: (data.closedPeriods || []).filter((x) => x.id !== pr.id), auditLog: [...(data.auditLog || []), logEntry(currentUser, "إعادة فتح شهر", pr.month)] });
  };
  return (
    <Panel style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>🔒 إقفال الأشهر</div>
      <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 10 }}>الشهر المقفل لا يُضاف إليه سند ولا مشتريات ولا مرتجع ولا يُلغى أو يُحذف منه شيء، إلا بإذن مدير النظام.</div>
      {isAdmin && (
        <div style={{ background: `${THEME.brass}12`, border: `1px solid ${THEME.brass}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ width: 180 }}><Field label="الشهر المراد إقفاله"><TextInput type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field></div>
            <Btn variant="brass" onClick={close} disabled={alreadyClosed} style={{ marginBottom: 12 }}>{alreadyClosed ? "مقفل" : "إقفال الشهر"}</Btn>
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.9 }}>
            <div>{unsalaried.length ? "⚠" : "✓"} الرواتب: {unsalaried.length ? `لم تُثبَّت لـ ${unsalaried.map((e) => e.name).join("، ")}` : "مُثبتة لكل أصحاب الرواتب"}</div>
            <div>{noShare.length ? "⚠" : "✓"} نسب الأرباح: {noShare.length ? `لم تُثبَّت لـ ${noShare.map((e) => e.name).join("، ")}` : "مُثبتة (أو لا توجد نسب)"}</div>
            <div>{openOrders ? "ℹ" : "✓"} طلبات الشهر غير المسلّمة: {openOrders}</div>
          </div>
        </div>
      )}
      {closed.length === 0 ? <div style={{ fontSize: 13, color: "#8A8071" }}>لا توجد أشهر مقفلة.</div> : closed.map((c) => (
        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px dashed ${THEME.border}`, fontSize: 13.5, flexWrap: "wrap" }}>
          <span><b>🔒 {c.month}</b> — أقفله {c.by || "—"} في {new Date(c.closedAt).toLocaleDateString("ar-SA")}</span>
          <span style={{ fontSize: 12.5, color: "#5C5344" }}>
            {data.branches.map((b) => c.snapshot?.[b.id] ? `${b.name}: ${fmtNum(c.snapshot[b.id].profit)}` : null).filter(Boolean).join(" | ")}
            {isAdmin && data.branches.length > 1 && c.snapshot ? ` | الإجمالي: ${fmtNum(Object.values(c.snapshot).reduce((t, x) => t + (x.profit || 0), 0))}` : ""}
          </span>
          {isAdmin && <Btn small variant="danger" onClick={() => reopen(c)}>إعادة فتح</Btn>}
        </div>
      ))}
    </Panel>
  );
}

// ---------- Dashboard ----------
function Dashboard({ data, update, canEdit }) {
  const [waOpen, setWaOpen] = useState(false);
  const waCount = waPending(data).length;
  const activeOrders = data.orders.filter((o) => o.stage !== "تم التسليم" && !o.cancelled);
  const revenue = data.orders.filter((o) => !o.cancelled).reduce((s, o) => s + (Number(o.price) || 0), 0);
  const stageCounts = data.orderStages.map((s) => ({ stage: s, count: data.orders.filter((o) => o.stage === s).length }));
  const maxCount = Math.max(1, ...stageCounts.map((s) => s.count));
  const kpis = [
    { label: "العملاء", value: data.customers.length, icon: Users },
    { label: "الطلبات النشطة", value: activeOrders.length, icon: ShoppingBag },
    { label: "إجمالي الطلبات", value: data.orders.length, icon: Package },
    { label: "إجمالي المبيعات", value: `${revenue.toLocaleString()} ر.س`, icon: Wallet },
  ];
  const lowStockItems = lowStockList(data).map((x) => `${x.item.name} (${fmtNum(x.qty)} ${x.item.unit || ""}${data.branches.length > 1 ? ` — ${x.branchName}` : ""})`);
  const today = new Date().toISOString().slice(0, 10);
  const todaysAppointments = (data.appointments || []).filter((a) => a.date === today && a.status !== "ملغى");

  return (
    <div>
      <h2 style={{ fontFamily: "Amiri, serif", fontSize: 28, color: THEME.ink, marginTop: 0 }}>لوحة التحكم</h2>
      {update && waCount > 0 && (
        <div style={{ background: "#25D36618", border: "1px solid #25D366", borderRadius: 8, padding: 12, fontSize: 13.5, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span><b style={{ color: "#128C7E" }}>📱 رسائل واتساب بانتظارك:</b> {waCount} رسالة (جاهز للاستلام، تأخير، متبقٍ، شكر، مواعيد)</span>
          <Btn small variant="brass" onClick={() => setWaOpen(true)}>فتح القائمة</Btn>
        </div>
      )}
      {waOpen && <WhatsAppCenter data={data} update={update} canEdit={canEdit} onClose={() => setWaOpen(false)} />}
      {(lowStockItems.length > 0 || todaysAppointments.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: lowStockItems.length && todaysAppointments.length ? "1fr 1fr" : "1fr", gap: 14, marginBottom: 20 }}>
          {lowStockItems.length > 0 && (
            <div style={{ background: `${THEME.red}12`, border: `1px solid ${THEME.red}`, borderRadius: 8, padding: 12, fontSize: 13.5 }}>
              <b style={{ color: THEME.red }}>⚠ مخزون منخفض:</b> {lowStockItems.join("، ")}
            </div>
          )}
          {todaysAppointments.length > 0 && (
            <div style={{ background: `${THEME.teal}12`, border: `1px solid ${THEME.teal}`, borderRadius: 8, padding: 12, fontSize: 13.5 }}>
              <b style={{ color: THEME.teal }}>📅 مواعيد اليوم:</b> {todaysAppointments.length} موعد
            </div>
          )}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 20 }}>
        {kpis.map((k) => <Panel key={k.label} style={{ display: "flex", flexDirection: "column", gap: 8 }}><k.icon size={20} color={THEME.brass} /><div style={{ fontSize: 24, fontWeight: 700, color: THEME.ink }}>{k.value}</div><div style={{ fontSize: 13, color: "#7A7061" }}>{k.label}</div></Panel>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, alignItems: "start" }}>
        <Panel>
          <div style={{ fontWeight: 700, marginBottom: 14, color: THEME.ink }}>الطلبات حسب المرحلة</div>
          {stageCounts.map((s) => (
            <div key={s.stage} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4, color: "#5C5344" }}><span>{s.stage}</span><span>{s.count}</span></div>
              <div style={{ background: "#EFE7D6", height: 8, borderRadius: 4 }}><div style={{ width: `${(s.count / maxCount) * 100}%`, background: THEME.brass, height: 8, borderRadius: 4 }} /></div>
            </div>
          ))}
        </Panel>
        <Panel>
          <div style={{ fontWeight: 700, marginBottom: 14, color: THEME.ink }}>أحدث الطلبات</div>
          {data.orders.slice(-5).reverse().map((o) => { const c = data.customers.find((c) => c.id === o.customerId); return <div key={o.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${THEME.border}`, fontSize: 13.5 }}><span>{c ? c.name : "—"}</span><Badge color={THEME.teal}>{o.stage}</Badge></div>; })}
          {data.orders.length === 0 && <EmptyState text="لا توجد طلبات بعد" />}
        </Panel>
      </div>
    </div>
  );
}

// ---------- Customers ----------
function customerStatementRows(data, c) {
  const def = data.branches[0]?.id;
  const orders = data.orders.filter((o) => o.customerId === c.id && !o.cancelled);
  const ids = new Set(orders.map((o) => o.id));
  const refunds = liveVouchers(data).filter((v) => v.type === "صرف" && v.category === "مرتجع عميل" && v.orderId && ids.has(v.orderId)).map((v) => ({ key: v.id, no: v.voucherNo, noLabel: "سند", isVoucher: true, voucher: v, date: v.date, createdAt: v.createdAt || "", desc: v.description || "مرتجع", kind: "مرتجع", inc: Number(v.amount) || 0, dec: 0, branch: v.branch || data.orders.find((o) => o.id === v.orderId)?.branch || def }));
  const rows = [
    ...refunds,
    ...orders.map((o) => ({ key: o.id, no: o.orderNo, noLabel: "طلب", date: o.createdAt, createdAt: "", desc: `${o.orderType || "طلب"}${Number(o.discount) > 0 ? ` (بعد خصم ${fmtNum(o.discount)})` : ""}`, kind: "طلبات", inc: Math.max(0, (Number(o.price) || 0) - (Number(o.discount) || 0)), dec: 0, branch: o.branch || def })),
    ...liveVouchers(data).filter((v) => v.type === "قبض" && v.orderId && ids.has(v.orderId)).map((v) => ({ key: v.id, no: v.voucherNo, noLabel: "سند", isVoucher: true, voucher: v, date: v.date, createdAt: v.createdAt || "", desc: v.description || "دفعة", kind: v.category || "دفعة", inc: 0, dec: Number(v.amount) || 0, branch: v.branch || data.orders.find((o) => o.id === v.orderId)?.branch || def })),
  ].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || "").localeCompare(b.createdAt || ""));
  return rows;
}
function CustomersView({ data, update, canEdit, currentUser }) {
  const [modal, setModal] = useState(null);
  const [statementFor, setStatementFor] = useState(null);
  const [printingVoucher, setPrintingVoucher] = useState(null);
  const [delCustomer, setDelCustomer] = useState(null);
  const deleteCustomer = (c, free) => {
    update({ customers: data.customers.filter((x) => x.id !== c.id), auditLog: [...(data.auditLog || []), logEntry(currentUser, "حذف عميل (مدير النظام)", `${c.name}${free ? " — الكود أُتيح لإعادة الاستخدام" : ""}`)], ...withFreed(data, "customer", c.code, free) });
    setDelCustomer(null);
  };
  const save = (values) => {
    const list = [...data.customers];
    if (modal.mode === "add") {
      const t = issueNumber(data, data.counters, "customer", 1000, data.customers.map((c) => c.code));
      list.push({ id: uid("cust"), rating: 5, code: t.no, ...values });
      update({ customers: list, counters: t.counters, freedNumbers: t.freedNumbers });
    } else {
      const i = list.findIndex((c) => c.id === values.id); list[i] = values;
      update({ customers: list });
    }
    setModal(null);
  };
  const fields = [
    { key: "name", label: "اسم العميل" }, { key: "phone", label: "رقم الجوال" },
    { key: "familyGroup", label: "اسم العائلة / ملاحظة (لربط الأبناء)" }, { key: "preferredFabric", label: "تفضيل القماش" },
    { key: "branch", label: "الفرع", type: "select", options: data.branches.map((b) => ({ value: b.id, label: b.name })) },
    { key: "notes", label: "ملاحظات", type: "textarea" },
  ];
  return (
    <>
      <CrudSection icon={Users} title="إدارة العملاء" addLabel="عميل جديد" columns={["الكود", "الاسم", "الجوال", "عدد الطلبات", "نقاط الولاء", "التقييم", "المتبقي عليه", ""]} items={data.customers} searchKeys={["name", "phone", "code"]}
        onAdd={canEdit ? () => setModal({ mode: "add", values: { branch: data.branches[0]?.id } }) : undefined}
        onEdit={canEdit ? (it) => setModal({ mode: "edit", values: it }) : undefined}
        onDelete={canEdit && data._isAdmin ? (it) => setDelCustomer(it) : undefined}
        renderRow={(it) => {
          const custOrders = data.orders.filter((o) => o.customerId === it.id);
          const spend = custOrders.reduce((s, o) => s + (Number(o.price) || 0), 0);
          const points = Math.floor(spend / 10);
          return (<><td style={{ padding: "10px 14px", fontWeight: 700, color: THEME.brass }}>#{it.code || "—"}</td><td style={{ padding: "10px 14px", fontWeight: 600 }}>{it.name}</td><td style={{ padding: "10px 14px" }}>{it.phone}</td><td style={{ padding: "10px 14px" }}>{custOrders.length}</td>
            <td style={{ padding: "10px 14px" }}>{points}</td>
            <td style={{ padding: "10px 14px" }}><span style={{ display: "inline-flex", gap: 2 }}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} fill={n <= (it.rating || 5) ? THEME.brass : "none"} color={THEME.brass} />)}</span></td>
            {(() => { const rs = customerStatementRows(data, it); const bal = rs.reduce((t, r) => t + r.inc - r.dec, 0); return <td style={{ padding: "10px 14px", fontWeight: 700, color: bal > 0 ? THEME.red : THEME.teal }}>{fmtNum(bal)} ر.س</td>; })()}
            <td style={{ padding: "10px 14px" }}><Btn small variant="ghost" onClick={() => setStatementFor(it)}>كشف حساب</Btn></td></>);
        }} />
      {delCustomer && <AdminDeleteModal title={`حذف العميل ${delCustomer.name}`} numberLabel="كود العميل" number={delCustomer.code} lines={["يُحذف سجل العميل فقط، وتبقى طلباته وسنداته في النظام."]} onConfirm={(free) => deleteCustomer(delCustomer, free)} onClose={() => setDelCustomer(null)} />}
      {statementFor && (() => {
        const c = data.customers.find((x) => x.id === statementFor.id) || statementFor;
        return (
          <StatementView data={data} title={`كشف حساب العميل — ${c.name}`} onClose={() => setStatementFor(null)}
            partyLines={[c.code ? `كود #${c.code}` : "", c.phone]} rows={customerStatementRows(data, c)} opening={0}
            labels={{ inc: "قيمة الطلبات", dec: "المدفوع", balanceText: (b) => `المتبقي على العميل: ${fmtNum(b)} ر.س` }}
            renderAction={(r) => r.isVoucher ? <button onClick={() => setPrintingVoucher(r.voucher)} title="طباعة السند" style={{ background: "none", border: "none", cursor: "pointer" }}><Printer size={14} /></button> : null} />
        );
      })()}
      {printingVoucher && <VoucherPrintModal data={data} voucher={printingVoucher} onClose={() => setPrintingVoucher(null)} />}
      {modal && (
        <Modal title={modal.mode === "add" ? "إضافة عميل" : "تعديل بيانات العميل"} onClose={() => setModal(null)} wide>
          <FormFields fields={fields} values={modal.values} setValues={(v) => setModal({ ...modal, values: v })} />
          <Field label={`تقييم العميل: ${modal.values.rating || 5}`}><input type="range" min="1" max="5" value={modal.values.rating || 5} onChange={(e) => setModal({ ...modal, values: { ...modal.values, rating: Number(e.target.value) } })} style={{ width: "100%" }} /></Field>
          <div style={{ fontWeight: 700, margin: "14px 0 8px" }}>القياسات الدائمة (تُستخدم تلقائيًا عند إنشاء طلب جديد له)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {data.measurementFields.map((m) => (
              <Field key={m.key} label={m.label}>
                <TextInput value={modal.values.measurements?.[m.key] || ""} onChange={(e) => setModal({ ...modal, values: { ...modal.values, measurements: { ...(modal.values.measurements || {}), [m.key]: e.target.value } } })} />
              </Field>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}><Btn variant="brass" onClick={() => save(modal.values)}>حفظ</Btn><Btn variant="ghost" onClick={() => setModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}
    </>
  );
}

// ---------- Design Library ----------
function DesignsView({ data, update, canEdit }) {
  const [typeModal, setTypeModal] = useState(null);
  const [newType, setNewType] = useState("");
  const fileRef = useRef(null);
  const addOrderType = (name) => { if (name && !data.orderTypes.includes(name)) update({ orderTypes: [...data.orderTypes, name] }); };
  const removeOrderType = (name) => update({ orderTypes: data.orderTypes.filter((t) => t !== name) });
  const [newMeasureLabel, setNewMeasureLabel] = useState("");
  const [editingMeasureKey, setEditingMeasureKey] = useState(null);
  const [editingMeasureLabel, setEditingMeasureLabel] = useState("");
  const addMeasurementField = (label) => { if (!label) return; update({ measurementFields: [...data.measurementFields, { key: uid("m"), label }] }); };
  const removeMeasurementField = (key) => update({ measurementFields: data.measurementFields.filter((m) => m.key !== key) });
  const saveMeasurementLabel = (key) => { update({ measurementFields: data.measurementFields.map((m) => m.key === key ? { ...m, label: editingMeasureLabel || m.label } : m) }); setEditingMeasureKey(null); };
  const addItem = (catId, name, image) => {
    if (catId === "embroidery") { update({ embroideryTypes: [...(data.embroideryTypes || []), { id: uid("emb"), name, image }] }); return; }
    const cats = data.designCategories.map((c) => c.id === catId ? { ...c, items: [...c.items, { id: uid("d"), name, image }] } : c); update({ designCategories: cats });
  };
  const removeItem = (catId, itemId) => {
    if (catId === "embroidery") { update({ embroideryTypes: (data.embroideryTypes || []).filter((t) => t.id !== itemId) }); return; }
    const cats = data.designCategories.map((c) => c.id === catId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c); update({ designCategories: cats });
  };
  const onFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => { const compressed = await compressImageDataUrl(reader.result, 300, 0.75); setTypeModal((m) => ({ ...m, image: compressed })); };
    reader.readAsDataURL(file);
  };
  return (
    <div>
      <h2 style={{ fontFamily: "Amiri, serif", fontSize: 28, color: THEME.ink, marginTop: 0 }}>دليل التصاميم وأنواع الخياطة</h2>
      {!canEdit && <div style={{ marginBottom: 14, fontSize: 12.5, color: "#8A8071" }}>وضع العرض فقط — لا تملك صلاحية التعديل هنا.</div>}
      <Panel style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, color: THEME.ink }}>أنواع الخياطة (قابلة للإضافة)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {data.orderTypes.map((t) => <span key={t} style={{ display: "flex", alignItems: "center", gap: 6, background: "#EFE7D6", padding: "6px 12px", borderRadius: 20, fontSize: 13.5 }}>{t}{canEdit && <X size={13} style={{ cursor: "pointer" }} onClick={() => removeOrderType(t)} />}</span>)}
        </div>
        {canEdit && <div style={{ display: "flex", gap: 8 }}><TextInput placeholder="نوع جديد مثل: بشت، سديري..." value={newType} onChange={(e) => setNewType(e.target.value)} style={{ maxWidth: 260 }} /><Btn variant="brass" onClick={() => { addOrderType(newType.trim()); setNewType(""); }}><Plus size={16} />إضافة</Btn></div>}
      </Panel>

      <Panel style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, color: THEME.ink }}>مسميات القياسات (قابلة للتعديل والإضافة والحذف)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {data.measurementFields.map((m) => (
            <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {editingMeasureKey === m.key ? (
                <>
                  <TextInput value={editingMeasureLabel} onChange={(e) => setEditingMeasureLabel(e.target.value)} style={{ maxWidth: 220 }} />
                  <Btn small variant="brass" onClick={() => saveMeasurementLabel(m.key)}>حفظ</Btn>
                  <Btn small variant="ghost" onClick={() => setEditingMeasureKey(null)}>إلغاء</Btn>
                </>
              ) : (
                <>
                  <span style={{ background: "#EFE7D6", padding: "6px 12px", borderRadius: 20, fontSize: 13.5 }}>{m.label}</span>
                  {canEdit && <Pencil size={14} style={{ cursor: "pointer", color: THEME.teal }} onClick={() => { setEditingMeasureKey(m.key); setEditingMeasureLabel(m.label); }} />}
                  {canEdit && <X size={15} style={{ cursor: "pointer", color: THEME.red }} onClick={() => removeMeasurementField(m.key)} />}
                </>
              )}
            </div>
          ))}
        </div>
        {canEdit && <div style={{ display: "flex", gap: 8 }}><TextInput placeholder="مسمى قياس جديد مثل: طول الكم الأيسر" value={newMeasureLabel} onChange={(e) => setNewMeasureLabel(e.target.value)} style={{ maxWidth: 260 }} /><Btn variant="brass" onClick={() => { addMeasurementField(newMeasureLabel.trim()); setNewMeasureLabel(""); }}><Plus size={16} />إضافة</Btn></div>}
      </Panel>

      <Panel style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: THEME.ink, fontFamily: "Amiri, serif" }}>التطريز</div>
          {canEdit && <Btn small variant="ghost" onClick={() => setTypeModal({ catId: "embroidery", name: "", image: null })}><Plus size={14} />إضافة نوع</Btn>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 12 }}>
          {(data.embroideryTypes || []).map((it) => (
            <div key={it.id} style={{ border: `1px solid ${THEME.border}`, borderRadius: 8, padding: 10, textAlign: "center", position: "relative", background: "#fff" }}>
              {canEdit && <X size={13} style={{ position: "absolute", top: 6, left: 6, cursor: "pointer", color: THEME.red }} onClick={() => removeItem("embroidery", it.id)} />}
              <DesignThumb item={it} />
              <div style={{ fontSize: 12.5, marginTop: 6, color: "#4a4436" }}>{it.name}</div>
            </div>
          ))}
        </div>
      </Panel>

      {data.designCategories.map((cat) => (
        <Panel key={cat.id} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 17, color: THEME.ink, fontFamily: "Amiri, serif" }}>{cat.name}</div>
            {canEdit && <Btn small variant="ghost" onClick={() => setTypeModal({ catId: cat.id, name: "", image: null })}><Plus size={14} />إضافة نوع</Btn>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 12 }}>
            {cat.items.map((it) => (
              <div key={it.id} style={{ border: `1px solid ${THEME.border}`, borderRadius: 8, padding: 10, textAlign: "center", position: "relative", background: "#fff" }}>
                {canEdit && <X size={13} style={{ position: "absolute", top: 6, left: 6, cursor: "pointer", color: THEME.red }} onClick={() => removeItem(cat.id, it.id)} />}
                <DesignThumb item={it} />
                <div style={{ fontSize: 12.5, marginTop: 6, color: "#4a4436" }}>{it.name}</div>
              </div>
            ))}
          </div>
        </Panel>
      ))}
      {typeModal && (
        <Modal title="إضافة نوع تصميم جديد" onClose={() => setTypeModal(null)}>
          <Field label="اسم التصميم"><TextInput value={typeModal.name} onChange={(e) => setTypeModal({ ...typeModal, name: e.target.value })} /></Field>
          <Field label="صورة توضيحية (اختياري — إن لم ترفع صورة سيُستخدم رسم تلقائي)">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {typeModal.image && <img src={typeModal.image} style={{ width: 50, height: 50, objectFit: "cover", borderRadius: 6, border: `1px solid ${THEME.border}` }} />}
              <Btn small variant="ghost" onClick={() => fileRef.current.click()}><Upload size={14} />رفع صورة</Btn>
              <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
            </div>
          </Field>
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={() => { addItem(typeModal.catId, typeModal.name.trim(), typeModal.image); setTypeModal(null); }}>حفظ</Btn><Btn variant="ghost" onClick={() => setTypeModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Orders ----------
function emptyOrder(data) {
  const designs = {}; data.designCategories.forEach((c) => { designs[c.id] = c.items[0]?.id || ""; });
  const measurements = {}; data.measurementFields.forEach((m) => { measurements[m.key] = ""; });
  return {
    id: uid("ord"), customerId: data.customers[0]?.id || "", orderType: data.orderTypes[0] || "", branch: data.branches[0]?.id || "",
    measurements, designs, price: "", deposit: "", deliveryDate: "", stage: data.orderStages[0],
    shelf: "", column: "", notes: "", fabricType: "", fabricUsed: "", paymentMethod: "نقدي",
    assignedTailorId: "", discount: "", couponCode: "", alterationsRemaining: 2, alterationLog: [],
    embroideryType: "بدون", embroideryNotes: "", stageAssignments: {}, groupId: "",
    externalDeliveryProvider: "", externalTrackingNumber: "",
    createdAt: new Date().toISOString().slice(0, 10), stageLog: [],
  };
}
function OrdersView({ data, update, canEdit, currentUser, currentUserRole }) {
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [altNote, setAltNote] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("نقدي");
  const fabricOptions = [...new Set(data.purchases.filter((p) => p.category === "قماش").map((p) => p.item))];
  const tailorOptions = data.employees.filter((e) => e.role === "خياط");

  const logAlteration = (order) => {
    if ((order.alterationsRemaining ?? 2) <= 0) { alert("لا يوجد تعديلات مجانية متبقية لهذا الطلب"); return; }
    const updated = { ...order, alterationsRemaining: (order.alterationsRemaining ?? 2) - 1, alterationLog: [...(order.alterationLog || []), { note: altNote || "تعديل", at: new Date().toLocaleString("ar-SA") }] };
    save(updated); setDetail(updated); setAltNote("");
  };

  const save = (orderInput) => {
    const list = [...data.orders];
    const i = list.findIndex((o) => o.id === orderInput.id);
    const isNew = i === -1;
    let order = orderInput;
    let patch = {};
    if (isNew) {
      const tn = issueNumber(data, data.counters, "order", 1000, data.orders.map((o) => o.orderNo));
      order = { ...orderInput, orderNo: tn.no };
      patch.counters = tn.counters; patch.freedNumbers = tn.freedNumbers;
      if (order.groupId === "__new__") {
        const tg = issueNumber({ ...data, freedNumbers: patch.freedNumbers }, patch.counters, "group", 1000, data.orderGroups.map((g) => g.groupNo));
        const group = { id: uid("grp"), groupNo: tg.no, customerId: order.customerId, createdAt: new Date().toISOString().slice(0, 10) };
        patch.orderGroups = [...data.orderGroups, group];
        patch.counters = tg.counters; patch.freedNumbers = tg.freedNumbers;
        order = { ...order, groupId: group.id };
      }
      order = { ...order, materials: order.materials || materialsFromRules(data, order.orderType) };
      list.push(order);
    } else {
      if (list[i].orderType !== order.orderType && !order.materialsEdited) order = { ...order, materials: materialsFromRules(data, order.orderType) };
      list[i] = order;
    }
    patch.orders = list;
    if (isNew && Number(order.deposit) > 0) {
      const accountId = PAYMENT_ACCOUNT_MAP[order.paymentMethod];
      if (accountId) {
        const bv = buildVoucher(patch.counters || data.counters, { type: "قبض", accountId, branch: order.branch, category: "عربون", amount: Number(order.deposit), description: `عربون طلب #${order.orderNo} — ${custName(order.customerId)}`, date: todayStr(), orderId: order.id, partyType: "عميل", partyId: order.customerId }, currentUser, { ...data, freedNumbers: patch.freedNumbers });
        patch.vouchers = [...data.vouchers, bv.voucher];
        patch.counters = bv.counters; patch.freedNumbers = bv.freedNumbers;
        patch.financeAccounts = data.financeAccounts.map((a) => a.id === accountId ? { ...a, balance: (Number(a.balance) || 0) + Number(order.deposit) } : a);
      }
    }
    if (order.saveMeasurementsToProfile !== false && order.customerId) {
      patch.customers = (patch.customers || data.customers).map((c) => c.id === order.customerId ? { ...c, measurements: { ...(c.measurements || {}), ...order.measurements } } : c);
    }
    update(patch);
    setModal(null);
  };
  const recordPayment = (order, amount, method) => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { alert("أدخل مبلغًا صحيحًا"); return; }
    if (!periodAllowed(data, todayStr(), "تسجيل دفعة اليوم")) return;
    const accountId = PAYMENT_ACCOUNT_MAP[method];
    if (!accountId) { alert("طريقة الدفع هذه (تقسيط) تحتاج ربط مزوّد خارجي فعلي ولا يمكن تسجيلها في الصندوق مباشرة الآن"); return; }
    const bv = buildVoucher(data.counters, { type: "قبض", accountId, branch: order.branch, category: "دفعة على الحساب", amount: amt, description: `دفعة لطلب #${order.orderNo || order.id.slice(-6)} — ${custName(order.customerId)}`, date: todayStr(), orderId: order.id, partyType: "عميل", partyId: order.customerId }, currentUser, data);
    const vouchers = [...data.vouchers, bv.voucher];
    const financeAccounts = data.financeAccounts.map((a) => a.id === accountId ? { ...a, balance: (Number(a.balance) || 0) + amt } : a);
    const updatedOrder = { ...order, deposit: (Number(order.deposit) || 0) + amt };
    const orders = data.orders.map((o) => o.id === order.id ? updatedOrder : o);
    update({ orders, vouchers, financeAccounts, counters: bv.counters, freedNumbers: bv.freedNumbers });
    setDetail(updatedOrder);
    setPayAmount("");
  };
  const advanceStage = (order) => {
    const idx = data.orderStages.indexOf(order.stage);
    const next = data.orderStages[Math.min(idx + 1, data.orderStages.length - 1)];
    const updated = { ...order, stage: next, stageLog: [...(order.stageLog || []), { stage: next, at: new Date().toLocaleString("ar-SA") }] };
    save(updated); setDetail(updated);
  };
  const custName = (id) => data.customers.find((c) => c.id === id)?.name || "—";

  const isSystemAdmin = currentUserRole === "مدير عام";
  const [delOrder, setDelOrder] = useState(null);
  const [returnFor, setReturnFor] = useState(null);
  const permanentlyDeleteOrder = (order, freeNo) => {
    if (!periodAllowed(data, order.createdAt, "حذف طلب من هذا الشهر")) return;
    const cv = cancelVouchersWhere(data, (v) => v.orderId === order.id, `حذف نهائي للطلب #${order.orderNo || order.id.slice(-6)}`, currentUser);
    const { vouchers, financeAccounts } = cv;
    const orders = data.orders.filter((o) => o.id !== order.id);
    const auditLog = [...(data.auditLog || []), logEntry(currentUser, "حذف نهائي لطلب (مدير النظام)", `طلب #${order.orderNo || order.id.slice(-6)} — ${custName(order.customerId)}${freeNo ? " — الرقم أُتيح لإعادة الاستخدام" : ""}`)];
    update({ orders, vouchers, financeAccounts, auditLog, employeeLedger: (data.employeeLedger || []).filter((l) => l.orderId !== order.id), ...withFreed(data, "order", order.orderNo, freeNo) });
    setDetail(null); setDelOrder(null);
  };

  return (
    <>
      {returnFor && <ReturnModal data={data} update={update} order={returnFor} currentUser={currentUser} onClose={(r) => { setReturnFor(null); if (r) setDetail(null); }} />}
      {delOrder && <AdminDeleteModal title={`حذف نهائي للطلب #${delOrder.orderNo || ""}`} numberLabel="رقم الطلب" number={delOrder.orderNo} lines={["يُحذف الطلب مع قيود الموظفين المرتبطة به، وتُلغى سنداته وتُعاد أرصدة الحسابات."]} onConfirm={(free) => permanentlyDeleteOrder(delOrder, free)} onClose={() => setDelOrder(null)} />}
      <CrudSection icon={ShoppingBag} title="إدارة الطلبات" addLabel="طلب جديد" columns={["الرقم", "العميل", "النوع", "الطلبية", "الفرع", "التسليم", "المرحلة", "الموقع"]} items={data.orders} searchKeys={["orderNo"]}
        onAdd={canEdit ? () => data.customers.length ? setModal({ ...emptyOrder(data) }) : alert("أضف عميلاً أولاً من قسم إدارة العملاء") : undefined}
        onEdit={canEdit ? (it) => setModal(it) : undefined}
        onDelete={canEdit ? (it) => {
          if (it.cancelled) { alert("هذا الطلب ملغى بالفعل."); return; }
          if (!window.confirm(`سيتم إلغاء الطلب #${it.orderNo || it.id.slice(-6)} مع الاحتفاظ بسجله (لا يُحذف نهائيًا). متابعة؟`)) return;
          if (!periodAllowed(data, it.createdAt, "إلغاء طلب من هذا الشهر")) return;
          const cv = cancelVouchersWhere(data, (v) => v.orderId === it.id, `إلغاء الطلب #${it.orderNo || it.id.slice(-6)}`, currentUser);
          const { vouchers, financeAccounts } = cv;
          const orders = data.orders.map((o) => o.id === it.id ? { ...o, cancelled: true, cancelledAt: new Date().toLocaleString("ar-SA") } : o);
          const auditLog = [...(data.auditLog || []), logEntry(currentUser, "إلغاء طلب", `طلب #${it.orderNo || it.id.slice(-6)} — ${custName(it.customerId)}`)];
          update({ orders, vouchers, financeAccounts, auditLog, employeeLedger: (data.employeeLedger || []).filter((l) => l.orderId !== it.id) });
        } : undefined}
        renderRow={(it) => (
          <>
            <td style={{ padding: "10px 14px", fontWeight: 700, color: THEME.brass, cursor: "pointer", opacity: it.cancelled ? 0.5 : 1 }} onClick={() => setDetail(it)}>#{it.orderNo || it.id.slice(-6)}</td>
            <td style={{ padding: "10px 14px", fontWeight: 600, cursor: "pointer", opacity: it.cancelled ? 0.5 : 1 }} onClick={() => setDetail(it)}>{custName(it.customerId)}</td>
            <td style={{ padding: "10px 14px", opacity: it.cancelled ? 0.5 : 1 }}>{it.orderType}</td>
            <td style={{ padding: "10px 14px", fontSize: 12, opacity: it.cancelled ? 0.5 : 1 }}>{it.groupId ? <Badge color={THEME.teal}>#{data.orderGroups.find((g) => g.id === it.groupId)?.groupNo || "—"}</Badge> : "—"}</td>
            <td style={{ padding: "10px 14px", opacity: it.cancelled ? 0.5 : 1 }}>{data.branches.find((b) => b.id === it.branch)?.name || "—"}</td>
            <td style={{ padding: "10px 14px", opacity: it.cancelled ? 0.5 : 1 }}>{it.deliveryDate || "—"}</td>
            <td style={{ padding: "10px 14px" }}>{it.cancelled ? <Badge color={THEME.red}>ملغى</Badge> : <Badge color={it.stage === "تم التسليم" ? THEME.teal : THEME.brass}>{it.stage}</Badge>}</td>
            <td style={{ padding: "10px 14px", fontSize: 12.5, color: "#7A7061", opacity: it.cancelled ? 0.5 : 1 }}>{it.shelf ? `رف ${it.shelf} / عمود ${it.column}` : "—"}</td>
          </>
        )} />

      {detail && (
        <Modal title={`تفاصيل الطلب #${detail.orderNo || detail.id.slice(-6)} — ${custName(detail.customerId)}`} onClose={() => setDetail(null)} wide>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            <Badge color={THEME.brass}>{detail.stage}</Badge>
            {canEdit && detail.stage !== "تم التسليم" && <Btn small variant="ghost" onClick={() => advanceStage(detail)}>ترقية للمرحلة التالية<ChevronLeft size={14} /></Btn>}
            <Btn small variant="ghost" onClick={() => { const link = `${window.location.origin}${window.location.pathname}?track=${detail.orderNo}`; navigator.clipboard?.writeText(link); alert("تم نسخ رابط التتبع:\n" + link); }}>نسخ رابط تتبع للعميل</Btn>
            {isSystemAdmin && <Btn small variant="danger" onClick={() => setDelOrder(detail)}>🗑 حذف نهائي (مدير النظام فقط)</Btn>}
            <BarcodeSVG value={detail.orderNo} height={34} width={1.4} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>المقاسات</div>
              {data.measurementFields.map((m) => <div key={m.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "5px 0", borderBottom: `1px dashed ${THEME.border}` }}><span>{m.label}</span><span>{detail.measurements[m.key] || "—"}</span></div>)}
              <div style={{ fontWeight: 700, margin: "12px 0 6px" }}>القماش</div>
              <div style={{ fontSize: 13.5 }}>النوع: {detail.fabricType || "—"} — الكمية: {detail.fabricUsed || 0} متر</div>
              {(detail.materials || []).length > 0 && <div style={{ fontSize: 12.5, color: "#5C5344", marginTop: 4 }}>مواد أخرى مخصومة من المخزون: {detail.materials.map((m) => { const it = (data.inventoryItems || []).find((x) => x.id === m.itemId); return `${it?.name || "—"} ${fmtNum(m.qty)} ${it?.unit || ""}`; }).join("، ")}</div>}
              <div style={{ fontWeight: 700, margin: "12px 0 6px" }}>التطريز</div>
              {detail.embroideryType && detail.embroideryType !== "بدون" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <DesignThumb item={data.embroideryTypes?.find((t) => t.name === detail.embroideryType)} size={30} />
                  <span style={{ fontSize: 13.5 }}>{detail.embroideryType}{detail.embroideryNotes ? " — " + detail.embroideryNotes : ""}</span>
                </div>
              ) : <div style={{ fontSize: 13.5 }}>بدون تطريز</div>}
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>التصاميم المختارة</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {data.designCategories.map((c) => { const item = c.items.find((i) => i.id === detail.designs[c.id]); return item ? <div key={c.id} style={{ textAlign: "center", border: `1px solid ${THEME.border}`, borderRadius: 8, padding: 8, width: 90 }}><DesignThumb item={item} size={36} /><div style={{ fontSize: 11, marginTop: 4 }}>{c.name}: {item.name}</div></div> : null; })}
              </div>
              <div style={{ marginTop: 14, fontSize: 13.5 }}>
                <div>السعر: {detail.price || 0} ر.س — العربون: {detail.deposit || 0} ر.س — الدفع: {detail.paymentMethod}</div>
                {detail.externalDeliveryProvider && <div style={{ marginTop: 4 }}>توصيل خارجي: {detail.externalDeliveryProvider}{detail.externalTrackingNumber ? ` — رقم التتبع: ${detail.externalTrackingNumber}` : ""}</div>}
              </div>
              <div style={{ fontWeight: 700, margin: "12px 0 6px" }}>الدفعات المالية المسجّلة</div>
              {(() => {
                const linked = liveVouchers(data).filter((v) => v.orderId === detail.id);
                const totalPaid = linked.reduce((s, v) => s + (Number(v.amount) || 0), 0);
                const remaining = (Number(detail.price) || 0) - totalPaid;
                return (
                  <>
                    <div style={{ fontSize: 12.5, color: "#5C5344" }}>{linked.length === 0 ? "لا توجد دفعات مسجّلة بالمالية بعد" : linked.map((v) => <div key={v.id}>{v.amount} ر.س — {data.financeAccounts.find((a) => a.id === v.accountId)?.name} — {v.date}</div>)}</div>
                    <div style={{ fontSize: 13.5, marginTop: 6 }}>إجمالي المُحصَّل: <b>{totalPaid} ر.س</b> — المتبقي: <b>{remaining > 0 ? remaining : 0} ر.س</b></div>
                  </>
                );
              })()}
              {canEdit && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "flex-end" }}>
                  <div style={{ width: 110 }}><Field label="مبلغ الدفعة"><TextInput type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></Field></div>
                  <div style={{ width: 130 }}><Field label="طريقة الدفع"><SelectInput options={["نقدي", "شبكة", "تحويل بنكي", "تقسيط تابي", "تقسيط تمارا"].map((p) => ({ value: p, label: p }))} value={payMethod} onChange={(e) => setPayMethod(e.target.value)} /></Field></div>
                  <Btn small variant="brass" onClick={() => recordPayment(detail, payAmount, payMethod)} style={{ marginBottom: 12 }}>تسجيل الدفعة بالمالية</Btn>
                </div>
              )}
              <div style={{ fontWeight: 700, margin: "12px 0 6px" }}>سجل تتبع المراحل</div>
              <div style={{ fontSize: 12.5, color: "#5C5344" }}>{(detail.stageLog || []).length === 0 ? "لا يوجد سجل بعد" : detail.stageLog.map((l, i) => <div key={i}>{l.stage} — {l.at}{l.deliveredBy ? ` — سلّم: ${l.deliveredBy}` : ""}{l.receivedBy ? ` — استلم: ${l.receivedBy}` : ""}{l.by ? ` — ${l.by}` : ""}</div>)}</div>
              <div style={{ fontWeight: 700, margin: "12px 0 6px" }}>الضمان والتعديلات المجانية</div>
              <div style={{ fontSize: 13.5 }}>المتبقي: {detail.alterationsRemaining ?? 2} تعديل مجاني</div>
              <div style={{ fontSize: 12.5, color: "#5C5344", margin: "4px 0" }}>{(detail.alterationLog || []).length === 0 ? "لا يوجد تعديلات مسجلة" : detail.alterationLog.map((l, i) => <div key={i}>{l.note} — {l.at}</div>)}</div>
              {canEdit && (detail.alterationsRemaining ?? 2) > 0 && (
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <TextInput placeholder="سبب التعديل" value={altNote} onChange={(e) => setAltNote(e.target.value)} />
                  <Btn small variant="ghost" onClick={() => logAlteration(detail)}>تسجيل</Btn>
                </div>
              )}
              <div style={{ fontWeight: 700, margin: "12px 0 6px" }}>فريق التنفيذ المسؤول</div>
              <div style={{ fontSize: 13.5 }}>
                {Object.entries(ROLE_STAGE_MAP).map(([role, stage]) => {
                  const empId = stage === "الخياطة" ? (detail.stageAssignments?.[stage] || detail.assignedTailorId) : detail.stageAssignments?.[stage];
                  const emp = data.employees.find((e) => e.id === empId);
                  return emp ? <div key={role}>{role}: {emp.name}</div> : null;
                })}
                {!Object.keys(ROLE_STAGE_MAP).some((role) => { const stage = ROLE_STAGE_MAP[role]; return (stage === "الخياطة" ? (detail.stageAssignments?.[stage] || detail.assignedTailorId) : detail.stageAssignments?.[stage]); }) && "لم يُسند الطلب لأحد بعد"}
              </div>
              {detail.stage === "جاهز للتسليم" && (
                <div style={{ marginTop: 14, background: `${THEME.teal}1a`, border: `1px solid ${THEME.teal}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 700, color: THEME.teal, marginBottom: 8 }}>🎉 الطلب جاهز للتسليم — أرسل إشعار للعميل الآن</div>
                  {canEdit ? <WhatsAppNotifyButton order={detail} data={data} update={update} custPhone={data.customers.find((c) => c.id === detail.customerId)?.phone} custName={custName(detail.customerId)} /> : <div style={{ fontSize: 12, color: "#8A8071" }}>لا تملك صلاحية إرسال إشعارات.</div>}
                </div>
              )}
              {canEdit && !detail.cancelled && <div style={{ marginTop: 14 }}><Btn small variant="ghost" onClick={() => setReturnFor(detail)}>↩ مرتجع / تعديل</Btn>{Number(detail.returnedAmount) > 0 && <span style={{ fontSize: 12.5, color: THEME.red, marginRight: 10 }}>استُرد سابقًا: {fmtNum(detail.returnedAmount)} ر.س</span>}</div>}
              {canEdit && orderBalance(detail) > 0 && !detail.cancelled && (
                <div style={{ marginTop: 14, background: `#C7770018`, border: `1px solid #C77700`, borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 700, color: "#C77700", marginBottom: 8 }}>💰 المتبقي على العميل {fmtNum(orderBalance(detail))} ر.س</div>
                  <WhatsAppNotifyButton order={detail} data={data} update={update} custPhone={data.customers.find((c) => c.id === detail.customerId)?.phone} custName={custName(detail.customerId)} templateField="balanceMessageTemplate" trackField="balanceNotifiedAt" buttonLabel="📱 تذكير بالمبلغ المتبقي" sentLabel="آخر تذكير" />
                </div>
              )}
              {canEdit && !detail.cancelled && detail.stage !== "جاهز للتسليم" && detail.stage !== "تم التسليم" && detail.deliveryDate && detail.deliveryDate < todayStr() && (
                <div style={{ marginTop: 14, background: `${THEME.red}12`, border: `1px solid ${THEME.red}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 700, color: THEME.red, marginBottom: 8 }}>⏰ الطلب متأخر عن موعد التسليم ({detail.deliveryDate})</div>
                  <WhatsAppNotifyButton order={detail} data={data} update={update} custPhone={data.customers.find((c) => c.id === detail.customerId)?.phone} custName={custName(detail.customerId)} templateField="delayMessageTemplate" trackField="delayNotifiedAt" buttonLabel="📱 اعتذار عن التأخير" sentLabel="آخر اعتذار" />
                </div>
              )}
              {detail.stage === "تم التسليم" && (
                <div style={{ marginTop: 14, background: `${THEME.brass}1a`, border: `1px solid ${THEME.brass}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 700, color: THEME.brass, marginBottom: 8 }}>✅ تم التسليم — أرسل شكر وطلب تقييم</div>
                  {canEdit ? <WhatsAppNotifyButton order={detail} data={data} update={update} custPhone={data.customers.find((c) => c.id === detail.customerId)?.phone} custName={custName(detail.customerId)} templateField="thankYouMessageTemplate" trackField="thankedAt" buttonLabel="📱 إرسال رسالة شكر وتقييم" sentLabel="آخر رسالة شكر مُرسلة" /> : <div style={{ fontSize: 12, color: "#8A8071" }}>لا تملك صلاحية إرسال إشعارات.</div>}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {modal && (
        <Modal title="بيانات الطلب" onClose={() => setModal(null)} wide>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="العميل"><SelectInput options={data.customers.map((c) => ({ value: c.id, label: c.name }))} value={modal.customerId} onChange={(e) => {
              const cust = data.customers.find((c) => c.id === e.target.value);
              const hasSaved = cust?.measurements && Object.values(cust.measurements).some((v) => v);
              setModal({ ...modal, customerId: e.target.value, measurements: hasSaved ? { ...modal.measurements, ...cust.measurements } : modal.measurements });
            }} /></Field>
            <Field label="نوع الخياطة"><SelectInput options={data.orderTypes.map((t) => ({ value: t, label: t }))} value={modal.orderType} onChange={(e) => setModal({ ...modal, orderType: e.target.value })} /></Field>
            <Field label="الفرع"><SelectInput options={data.branches.map((b) => ({ value: b.id, label: b.name }))} value={modal.branch} onChange={(e) => setModal({ ...modal, branch: e.target.value })} /></Field>
          </div>
          {!data.orders.find((o) => o.id === modal.id) && (
            <div style={{ marginBottom: 8 }}>
              <Field label="ربط بطلبية (اختياري — لو العميل طالب أكثر من نوع بنفس الزيارة وتبي فاتورة واحدة تجمعهم)">
                <SelectInput
                  options={[
                    { value: "", label: "طلب مستقل (الوضع الافتراضي)" },
                    { value: "__new__", label: "إنشاء طلبية جديدة تجمع هذا الطلب مع طلبات قادمة" },
                    ...data.orderGroups.filter((g) => g.customerId === modal.customerId).map((g) => ({ value: g.id, label: `إضافة إلى طلبية #${g.groupNo}` })),
                  ]}
                  value={modal.groupId || ""}
                  onChange={(e) => setModal({ ...modal, groupId: e.target.value })}
                />
              </Field>
            </div>
          )}
          <div style={{ fontWeight: 700, margin: "14px 0 8px" }}>المقاسات</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {data.measurementFields.map((m) => <Field key={m.key} label={m.label}><TextInput value={modal.measurements[m.key] || ""} onChange={(e) => setModal({ ...modal, measurements: { ...modal.measurements, [m.key]: e.target.value } })} /></Field>)}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#6B6255", marginBottom: 10 }}>
            <input type="checkbox" checked={modal.saveMeasurementsToProfile !== false} onChange={(e) => setModal({ ...modal, saveMeasurementsToProfile: e.target.checked })} />
            تحديث القياسات الدائمة المحفوظة بملف العميل بهذي القيم
          </label>
          <div style={{ fontWeight: 700, margin: "14px 0 8px" }}>التصاميم</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {data.designCategories.map((c) => <Field key={c.id} label={c.name}><SelectInput options={c.items.map((i) => ({ value: i.id, label: i.name }))} value={modal.designs[c.id] || ""} onChange={(e) => setModal({ ...modal, designs: { ...modal.designs, [c.id]: e.target.value } })} /></Field>)}
          </div>
          <div style={{ fontWeight: 700, margin: "14px 0 8px" }}>القماش</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="نوع القماش المستخدم">
              {fabricOptions.length ? <SelectInput options={[{ value: "", label: "اختر..." }, ...fabricOptions.map((f) => ({ value: f, label: f }))]} value={modal.fabricType} onChange={(e) => setModal({ ...modal, fabricType: e.target.value })} />
                : <TextInput placeholder="لا يوجد قماش مسجل — سجّل شراء أولاً أو اكتب النوع" value={modal.fabricType} onChange={(e) => setModal({ ...modal, fabricType: e.target.value })} />}
            </Field>
            <Field label="الكمية المستخدمة (متر)"><TextInput type="number" value={modal.fabricUsed} onChange={(e) => setModal({ ...modal, fabricUsed: e.target.value })} /></Field>
          </div>
          <div style={{ fontWeight: 700, margin: "14px 0 8px" }}>التطريز</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
            <Field label="نوع التطريز"><SelectInput options={[{ value: "بدون", label: "بدون تطريز" }, ...(data.embroideryTypes || []).map((t) => ({ value: t.name, label: t.name }))]} value={modal.embroideryType || "بدون"} onChange={(e) => setModal({ ...modal, embroideryType: e.target.value })} /></Field>
            <Field label="ملاحظات التطريز"><TextInput value={modal.embroideryNotes || ""} onChange={(e) => setModal({ ...modal, embroideryNotes: e.target.value })} placeholder="مثال: تطريز الاسم على الجيب" /></Field>
          </div>
          <div style={{ fontWeight: 700, margin: "14px 0 8px" }}>الفوترة والتسليم</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            <Field label="السعر (ر.س)"><TextInput type="number" value={modal.price} onChange={(e) => setModal({ ...modal, price: e.target.value })} /></Field>
            <Field label="العربون (ر.س)"><TextInput type="number" value={modal.deposit} onChange={(e) => setModal({ ...modal, deposit: e.target.value })} /></Field>
            <Field label="موعد التسليم"><TextInput type="date" value={modal.deliveryDate} onChange={(e) => setModal({ ...modal, deliveryDate: e.target.value })} /></Field>
            <Field label="طريقة الدفع"><SelectInput options={["نقدي", "شبكة", "تحويل بنكي", "تقسيط تابي", "تقسيط تمارا"].map((p) => ({ value: p, label: p }))} value={modal.paymentMethod} onChange={(e) => setModal({ ...modal, paymentMethod: e.target.value })} /></Field>
            <Field label="المرحلة"><SelectInput options={data.orderStages.map((s) => ({ value: s, label: s }))} value={modal.stage} onChange={(e) => setModal({ ...modal, stage: e.target.value })} /></Field>
            <Field label="رقم الرف"><TextInput value={modal.shelf} onChange={(e) => setModal({ ...modal, shelf: e.target.value })} /></Field>
            <Field label="رقم العمود"><TextInput value={modal.column} onChange={(e) => setModal({ ...modal, column: e.target.value })} /></Field>
            <Field label="الخياط المسؤول"><SelectInput options={[{ value: "", label: "غير محدد" }, ...tailorOptions.map((t) => ({ value: t.id, label: t.name }))]} value={modal.assignedTailorId || ""} onChange={(e) => setModal({ ...modal, assignedTailorId: e.target.value })} /></Field>
            <Field label="الخصم (ر.س)"><TextInput type="number" value={modal.discount || ""} onChange={(e) => setModal({ ...modal, discount: e.target.value })} /></Field>
            <Field label="كود الكوبون"><TextInput value={modal.couponCode || ""} onChange={(e) => setModal({ ...modal, couponCode: e.target.value })} /></Field>
            <Field label="شركة توصيل خارجية (اختياري)"><TextInput placeholder="مثال: مرسول" value={modal.externalDeliveryProvider || ""} onChange={(e) => setModal({ ...modal, externalDeliveryProvider: e.target.value })} /></Field>
            <Field label="رقم تتبع التوصيل الخارجي"><TextInput value={modal.externalTrackingNumber || ""} onChange={(e) => setModal({ ...modal, externalTrackingNumber: e.target.value })} /></Field>
          </div>
          {!data.orders.find((o) => o.id === modal.id) && <div style={{ fontSize: 11.5, color: "#7A7061", marginTop: -8, marginBottom: 8 }}>العربون سيُسجَّل تلقائيًا بالمالية عند الحفظ (لغير التقسيط). لتسجيل دفعات إضافية لاحقًا استخدم "تسجيل دفعة" من تفاصيل الطلب.</div>}
          <Field label="ملاحظات"><textarea rows={2} value={modal.notes} onChange={(e) => setModal({ ...modal, notes: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} /></Field>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}><Btn variant="brass" onClick={() => save(modal)}>حفظ الطلب</Btn><Btn variant="ghost" onClick={() => setModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}
    </>
  );
}

// ---------- Courier screen ----------
function CourierView({ data, update, canEdit }) {
  const [code, setCode] = useState("");
  const [found, setFound] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState({ text: "", ok: true });
  const [courierId, setCourierId] = useState("");
  const [batchStage, setBatchStage] = useState("");
  const [opType, setOpType] = useState("تسليم"); // "تسليم" | "استلام"
  const [staffId, setStaffId] = useState("");
  const dataRef = useRef(data);
  const updateRef = useRef(update);
  const courierRef = useRef(courierId);
  const stageRef = useRef(batchStage);
  const opRef = useRef(opType);
  const staffRef = useRef(staffId);
  const lastScanRef = useRef({ code: "", time: 0 });
  useEffect(() => { dataRef.current = data; updateRef.current = update; }, [data, update]);
  useEffect(() => { courierRef.current = courierId; stageRef.current = batchStage; opRef.current = opType; staffRef.current = staffId; }, [courierId, batchStage, opType, staffId]);

  const couriers = data.employees.filter((e) => e.role === "مراسل");
  const findOrder = (raw) => {
    const v = String(raw || "").trim();
    return dataRef.current.orders.find((o) => String(o.orderNo) === v || o.id === v || o.id.endsWith(v));
  };
  const custName = (id) => dataRef.current.customers.find((c) => c.id === id)?.name || "—";
  const empName = (id) => dataRef.current.employees.find((e) => e.id === id)?.name || "";
  const stageIndex = (stage) => dataRef.current.orderStages.indexOf(stage);
  const recordedStaffFor = (order, stage) => stage === "الخياطة" ? (order.stageAssignments?.[stage] || order.assignedTailorId) : order.stageAssignments?.[stage];

  // Delivering to a stage assigns the chosen staff member to it. Receiving from a stage
  // needs no employee selection — it looks up whoever the order was delivered to for that
  // exact stage and logs the receipt automatically, then moves on to the next stage.
  const moveOrder = (order) => {
    const stage = stageRef.current, op = opRef.current, courier = empName(courierRef.current);
    let nextStage, assignmentPatch = {}, logNote, ledgerPatch = {};
    if (!stage) {
      nextStage = dataRef.current.orderStages[Math.min(stageIndex(order.stage) + 1, dataRef.current.orderStages.length - 1)];
    } else if (op === "تسليم") {
      nextStage = stage;
      const staff = dataRef.current.employees.find((e) => e.id === staffRef.current);
      if (staff) {
        assignmentPatch = { stageAssignments: { ...(order.stageAssignments || {}), [stage]: staff.id } };
        if (stage === "الخياطة") assignmentPatch.assignedTailorId = staff.id;
        logNote = `تسليم إلى ${stage} — ${staff.name}`;
        ledgerPatch = buildEarningsPatch(dataRef.current, order, stage, staff);
      } else {
        logNote = `تسليم إلى ${stage}`;
      }
    } else {
      const idx = stageIndex(stage);
      nextStage = dataRef.current.orderStages[Math.min(idx + 1, dataRef.current.orderStages.length - 1)];
      const recordedId = recordedStaffFor(order, stage);
      const recordedEmp = dataRef.current.employees.find((e) => e.id === recordedId);
      logNote = `استلام من ${stage}${recordedEmp ? " — " + recordedEmp.name : ""}`;
    }
    const updated = { ...order, ...assignmentPatch, stage: nextStage, stageLog: [...(order.stageLog || []), { stage: nextStage, at: new Date().toLocaleString("ar-SA"), ts: new Date().toISOString(), note: logNote, courier: courier || undefined }] };
    updateRef.current({ orders: dataRef.current.orders.map((o) => o.id === updated.id ? updated : o), ...ledgerPatch });
    return updated;
  };

  const search = () => { const o = findOrder(code); setFound(o || null); };
  const advance = () => { const updated = moveOrder(found); setFound(updated); };

  useEffect(() => {
    if (!scanning) return;
    const scanner = new Html5QrcodeScanner("qr-reader-box", {
      fps: 10, qrbox: 230,
      formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.QR_CODE],
    }, false);
    scanner.render((decodedText) => {
      const now = Date.now();
      if (decodedText === lastScanRef.current.code && now - lastScanRef.current.time < 2500) return;
      lastScanRef.current = { code: decodedText, time: now };
      setCode(decodedText);
      const order = findOrder(decodedText);
      if (!order) { setScanMsg({ text: `⚠ لم يتم إيجاد طلب بالرمز ${decodedText}`, ok: false }); setFound(null); return; }
      if (canEdit && order.stage !== "تم التسليم") {
        const updated = moveOrder(order);
        setFound(updated);
        setScanMsg({ text: `✔ ${custName(updated.customerId)} — طلب #${updated.orderNo} انتقل إلى: ${updated.stage}`, ok: true });
      } else {
        setFound(order);
        setScanMsg({ text: `تم العثور على طلب #${order.orderNo}`, ok: true });
      }
    }, () => {});
    return () => { scanner.clear().catch(() => {}); };
  }, [scanning]);

  const roleForStage = STAGE_ROLE_MAP[batchStage];
  const staffOptions = roleForStage ? data.employees.filter((e) => e.role === roleForStage).map((e) => ({ value: e.id, label: e.name })) : [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><ScanLine size={22} color={THEME.brass} /><h2 style={{ margin: 0, fontFamily: "Amiri, serif", fontSize: 26, color: THEME.ink }}>شاشة المراسل</h2></div>
      <Panel style={{ maxWidth: 480 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13.5 }}>إعداد الدفعة (اختره مرة وحدة قبل ما تبدأ المسح)</div>
        <div style={{ marginBottom: 10 }}>
          <Field label="المراسل الحالي">
            <SelectInput options={[{ value: "", label: "بدون تحديد" }, ...couriers.map((c) => ({ value: c.id, label: c.name }))]} value={courierId} onChange={(e) => setCourierId(e.target.value)} />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <Field label="المرحلة">
            <SelectInput options={[{ value: "", label: "بدون تحديد (تقدّم تلقائي)" }, ...data.orderStages.map((s) => ({ value: s, label: s }))]} value={batchStage} onChange={(e) => { setBatchStage(e.target.value); setStaffId(""); }} />
          </Field>
          <Field label="نوع العملية">
            <SelectInput options={[{ value: "تسليم", label: "تسليم" }, { value: "استلام", label: "استلام" }]} value={opType} onChange={(e) => setOpType(e.target.value)} disabled={!batchStage} />
          </Field>
        </div>
        {batchStage && opType === "تسليم" && roleForStage && (
          <div style={{ marginBottom: 12 }}>
            <Field label={`تسليم إلى (${roleForStage})`}>
              <SelectInput options={[{ value: "", label: "بدون تحديد اسم" }, ...staffOptions]} value={staffId} onChange={(e) => setStaffId(e.target.value)} />
            </Field>
          </div>
        )}
        {batchStage && opType === "استلام" && (
          <div style={{ fontSize: 11.5, color: "#8A8071", marginBottom: 10 }}>ما يلزم تحديد اسم — يتم تلقائيًا استلام كل طلب من الشخص المسجّل أنه سلّمه له بمرحلة "{batchStage}".</div>
        )}
        {(courierId || batchStage) && (
          <div style={{ fontSize: 12, background: `${THEME.teal}1a`, color: THEME.teal, padding: "6px 10px", borderRadius: 6, marginBottom: 12 }}>
            {batchStage ? `كل مسح: ${opType} — مرحلة ${batchStage}${staffId ? ` — ${empName(staffId)}` : ""}` : "كل مسح: تقدّم تلقائي للمرحلة التالية"}
            {courierId ? ` — المراسل: ${empName(courierId)}` : ""}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <Btn variant={scanning ? "danger" : "brass"} onClick={() => { setScanning(!scanning); setScanMsg({ text: "", ok: true }); }}>
            <ScanLine size={16} />{scanning ? "إيقاف الكاميرا" : "مسح بالكاميرا"}
          </Btn>
        </div>
        {scanning && (
          <div style={{ marginBottom: 14 }}>
            <div id="qr-reader-box" style={{ width: "100%" }}></div>
            <div style={{ fontSize: 11.5, color: "#8A8071", marginTop: 6 }}>وجّه الكاميرا نحو باركود الطلب — تقدر تمسح طلبات متتالية بدون إغلاق الكاميرا ولا إعادة اختيار الدفعة.</div>
            {scanMsg.text && <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, fontSize: 13, background: scanMsg.ok ? `${THEME.teal}1a` : `${THEME.red}1a`, color: scanMsg.ok ? THEME.teal : THEME.red }}>{scanMsg.text}</div>}
          </div>
        )}
        <div style={{ fontSize: 13, color: "#7A7061", marginBottom: 10 }}>أو أدخل رقم الطلب يدويًا</div>
        <div style={{ display: "flex", gap: 8 }}>
          <TextInput placeholder="رقم الطلب" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <Btn variant="brass" onClick={search}>بحث</Btn>
        </div>
        {found === null && code && !scanning && <div style={{ marginTop: 14, color: THEME.red, fontSize: 13.5 }}>لم يتم إيجاد طلب بهذا الرقم</div>}
        {found && (
          <div style={{ marginTop: 18, borderTop: `1px solid ${THEME.border}`, paddingTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: THEME.brass }}>طلب #{found.orderNo || found.id.slice(-6)}</div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{custName(found.customerId)}</div>
            <div style={{ fontSize: 13.5, color: "#5C5344", marginBottom: 8 }}>{found.orderType} — {found.deliveryDate || "بدون موعد"}</div>
            <Badge color={found.stage === "تم التسليم" ? THEME.teal : THEME.brass}>{found.stage}</Badge>
            {canEdit && found.stage !== "تم التسليم" && !scanning && <div style={{ marginTop: 14 }}><Btn variant="brass" onClick={advance}>{batchStage ? `${opType} — ${batchStage}` : "تسجيل الانتقال للمرحلة التالية"}</Btn></div>}
            {found.stage === "جاهز للتسليم" && !scanning && (
              <div style={{ marginTop: 12, background: `${THEME.teal}1a`, border: `1px solid ${THEME.teal}`, borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 700, color: THEME.teal, marginBottom: 8 }}>🎉 الطلب جاهز للتسليم — أرسل إشعار للعميل الآن</div>
                {canEdit ? <WhatsAppNotifyButton order={found} data={data} update={update} custPhone={data.customers.find((c) => c.id === found.customerId)?.phone} custName={custName(found.customerId)} /> : null}
              </div>
            )}
            <div style={{ marginTop: 14, fontSize: 12.5, color: "#7A7061" }}>{(found.stageLog || []).map((l, i) => <div key={i}>{l.stage} — {l.at}{l.note ? ` — ${l.note}` : ""}{l.courier ? ` — المراسل: ${l.courier}` : ""}{l.deliveredBy ? ` — سلّم: ${l.deliveredBy}` : ""}{l.receivedBy ? ` — استلم: ${l.receivedBy}` : ""}{l.by ? ` — ${l.by}` : ""}</div>)}</div>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------- Appointments ----------
function AppointmentsView({ data, update, canEdit }) {
  const [modal, setModal] = useState(null);
  const types = ["قياس أول", "بروفة تعديل", "استلام"];
  const statuses = ["مجدول", "تم", "ملغى"];
  const fields = [
    { key: "customerId", label: "العميل", type: "select", options: data.customers.map((c) => ({ value: c.id, label: c.name })) },
    { key: "type", label: "نوع الموعد", type: "select", options: types.map((t) => ({ value: t, label: t })) },
    { key: "date", label: "التاريخ", type: "date" }, { key: "time", label: "الوقت", type: "text" },
    { key: "branch", label: "الفرع", type: "select", options: data.branches.map((b) => ({ value: b.id, label: b.name })) },
    { key: "status", label: "الحالة", type: "select", options: statuses.map((s) => ({ value: s, label: s })) },
    { key: "notes", label: "ملاحظات", type: "textarea" },
  ];
  const save = (values) => { const list = [...data.appointments]; if (modal.mode === "add") list.push({ id: uid("apt"), ...values }); else { const i = list.findIndex((a) => a.id === values.id); list[i] = values; } update({ appointments: list }); setModal(null); };
  const custName = (id) => data.customers.find((c) => c.id === id)?.name || "—";
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const sendReminder = (apt) => {
    const cust = data.customers.find((c) => c.id === apt.customerId);
    if (!cust?.phone) { alert("لا يوجد رقم جوال مسجّل لهذا العميل."); return; }
    const message = fillTemplate(data.shopSettings?.reminderMessageTemplate, { name: cust.name, date: apt.date, time: apt.time, shop: data.shopSettings?.name || "" });
    window.open(buildWhatsAppLink(cust.phone, message), "_blank");
    update({ appointments: data.appointments.map((a) => a.id === apt.id ? { ...a, remindedAt: new Date().toISOString() } : a) });
  };
  return (
    <>
      <CrudSection icon={CalendarClock} title="مواعيد القياس والبروفة" addLabel="موعد جديد" columns={["العميل", "النوع", "التاريخ", "الوقت", "الفرع", "الحالة", ""]} items={data.appointments} searchKeys={[]}
        onAdd={canEdit ? () => data.customers.length ? setModal({ mode: "add", values: { type: types[0], status: statuses[0], branch: data.branches[0]?.id } }) : alert("أضف عميلاً أولاً") : undefined}
        onEdit={canEdit ? (it) => setModal({ mode: "edit", values: it }) : undefined}
        onDelete={canEdit ? (it) => update({ appointments: data.appointments.filter((a) => a.id !== it.id) }) : undefined}
        renderRow={(it) => (
          <>
            <td style={{ padding: "10px 14px", fontWeight: 600 }}>{custName(it.customerId)}</td>
            <td style={{ padding: "10px 14px" }}>{it.type}</td>
            <td style={{ padding: "10px 14px" }}>{it.date} {it.date === today && <Badge color={THEME.teal}>اليوم</Badge>}{it.date === tomorrow && <Badge color={THEME.brass}>غدًا</Badge>}</td>
            <td style={{ padding: "10px 14px" }}>{it.time}</td>
            <td style={{ padding: "10px 14px" }}>{data.branches.find((b) => b.id === it.branch)?.name}</td>
            <td style={{ padding: "10px 14px" }}><Badge color={it.status === "تم" ? THEME.teal : it.status === "ملغى" ? THEME.red : THEME.brass}>{it.status}</Badge></td>
            <td style={{ padding: "10px 14px" }}>{it.status === "مجدول" && <Btn small variant="ghost" onClick={() => sendReminder(it)}>📱 تذكير</Btn>}</td>
          </>
        )} />
      {modal && (
        <Modal title={modal.mode === "add" ? "إضافة موعد" : "تعديل موعد"} onClose={() => setModal(null)}>
          <FormFields fields={fields} values={modal.values} setValues={(v) => setModal({ ...modal, values: v })} />
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={() => save(modal.values)}>حفظ</Btn><Btn variant="ghost" onClick={() => setModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}
    </>
  );
}

// ---------- Invoices ----------
function InvoicesView({ data, update }) {
  const [printing, setPrinting] = useState(null);
  const [printingGroup, setPrintingGroup] = useState(null);
  const custName = (id) => data.customers.find((c) => c.id === id)?.name || "—";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Receipt size={22} color={THEME.brass} /><h2 style={{ margin: 0, fontFamily: "Amiri, serif", fontSize: 26, color: THEME.ink }}>الفواتير</h2></div>
      </div>

      {data.orderGroups.length > 0 && (
        <Panel style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>الطلبيات المجمّعة (عدة أنواع بفاتورة واحدة)</div>
          {data.orderGroups.map((g) => {
            const members = data.orders.filter((o) => o.groupId === g.id);
            return (
              <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px dashed ${THEME.border}`, fontSize: 13.5 }}>
                <span>طلبية #{g.groupNo} — {custName(g.customerId)} — {members.length} طلب</span>
                <Btn small variant="ghost" onClick={() => setPrintingGroup(g)}><Printer size={13} />فاتورة الطلبية</Btn>
              </div>
            );
          })}
        </Panel>
      )}

      <Panel style={{ padding: 0 }}>
        {data.orders.length === 0 ? <EmptyState text="لا توجد طلبات لإصدار فواتير لها" /> : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead><tr style={{ background: "#EFE7D6" }}><th style={{ padding: "10px 14px", textAlign: "right" }}>العميل</th><th style={{ padding: "10px 14px", textAlign: "right" }}>النوع</th><th style={{ padding: "10px 14px", textAlign: "right" }}>السعر</th><th></th></tr></thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id} style={{ borderTop: `1px solid ${THEME.border}` }}>
                  <td style={{ padding: "10px 14px" }}>{custName(o.customerId)}</td>
                  <td style={{ padding: "10px 14px" }}>{o.orderType}</td>
                  <td style={{ padding: "10px 14px" }}>{o.price || 0} ر.س</td>
                  <td style={{ padding: "8px 14px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Btn small variant="ghost" onClick={() => setPrinting({ order: o, kind: "customer" })}><Printer size={14} />فاتورة العميل</Btn>
                    <Btn small variant="ghost" onClick={() => setPrinting({ order: o, kind: "tailor" })}><Printer size={14} />بطاقة الخياط</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {printingGroup && <InvoicePrintModal data={data} group={printingGroup} kind="customer" onClose={() => setPrintingGroup(null)} />}
      {printing && <InvoicePrintModal data={data} order={printing.order} kind={printing.kind} onClose={() => setPrinting(null)} />}
    </div>
  );
}

// ---------- Employees ----------
// ---------- Employee ledger helpers ----------
// Every employee has an account: money owed to them (salary, per-piece wages, percentages, bonuses)
// is a "credit" entry in data.employeeLedger; money paid out (payment / advance vouchers) or deducted is a "debit".
function employeeStatement(data, e) {
  const def = data.branches[0]?.id;
  const ebr = empBranches(data, e);
  const weights = {}; ebr.forEach((id) => { weights[id] = empBranchWeight(data, e, id); });
  const rows = [
    ...(data.employeeLedger || []).filter((l) => l.employeeId === e.id).map((l) => {
      const ord = l.orderId ? data.orders.find((o) => o.id === l.orderId) : null;
      const where = l.branchId ? { branch: l.branchId } : ord ? { branch: ord.branch || def } : ebr.length > 1 ? { weights } : { branch: ebr[0] || def };
      return { key: l.id, no: l.entryNo, noLabel: "قيد", date: l.date, createdAt: l.createdAt || "", desc: l.desc, kind: l.kind, inc: Number(l.credit) || 0, dec: Number(l.debit) || 0, ...where };
    }),
    ...liveVouchers(data).filter((v) => v.employeeId === e.id).map((v) => {
      const amt = Number(v.amount) || 0, out = v.type === "صرف";
      return { key: v.id, no: v.voucherNo, noLabel: "سند", isVoucher: true, voucher: v, date: v.date, createdAt: v.createdAt || "", desc: (out ? (v.category || "دفعة") : "مبلغ مقبوض من الموظف") + (v.description ? ` — ${v.description}` : ""), kind: out ? (v.category === "سلفة موظف" ? "سلفة" : "دفعة") : "قبض", inc: out ? 0 : amt, dec: out ? amt : 0, branch: v.branch || ebr[0] || def };
    }),
  ].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || "").localeCompare(b.createdAt || ""));
  let running = Number(e.openingBalance) || 0;
  const withRunning = rows.map((r) => { running += r.inc - r.dec; return { ...r, running: round2(running) }; });
  return { rows: withRunning, balance: round2(running) };
}
// An employee can work in several branches: e.branches is the full list, e.branch is kept as the primary one.
const empBranches = (data, e) => (Array.isArray(e?.branches) && e.branches.length ? e.branches : [e?.branch || data.branches[0]?.id]).filter(Boolean);
// Share (0..1) of an employee's salary/bonus that belongs to a given branch. Uses the percentages
// entered in his profile (e.branchShares); falls back to an equal split when none were entered.
function empBranchWeight(data, e, branchId) {
  const brs = empBranches(data, e);
  if (!brs.includes(branchId)) return 0;
  const sh = e?.branchShares || {};
  const total = brs.reduce((t, id) => t + (Number(sh[id]) || 0), 0);
  return total > 0 ? (Number(sh[branchId]) || 0) / total : 1 / brs.length;
}
const equalShares = (ids) => { const o = {}; ids.forEach((id, i) => { o[id] = i === 0 ? round2(100 - round2(100 / ids.length) * (ids.length - 1)) : round2(100 / ids.length); }); return o; };
const employeeBalance = (data, e) => employeeStatement(data, e).balance;
function payTypeText(e) {
  const p = [];
  if (Number(e.baseSalary) > 0) p.push(`راتب ${fmtNum(e.baseSalary)}`);
  if (Number(e.commissionPercent) > 0) p.push(`نسبة ${e.commissionPercent}%`);
  if (Number(e.commissionPerPiece) > 0) p.push(`${fmtNum(e.commissionPerPiece)} / قطعة`);
  if (Number(e.profitSharePercent) > 0) p.push(`${e.profitSharePercent}% من الأرباح`);
  return p.length ? p.join(" + ") : "غير محدد";
}
// When a courier hands a piece to an employee, credit that employee right away:
// the per-piece wage and/or the agreed percentage of the order value (price minus discount).
// Re-scanning the same order/stage for the same employee never double-credits.
function buildEarningsPatch(data, order, stage, staff) {
  const ledger = data.employeeLedger || [];
  const same = ledger.filter((l) => l.auto && l.orderId === order.id && l.stage === stage);
  if (same.some((l) => l.employeeId === staff.id)) return {};
  const kept = ledger.filter((l) => !same.includes(l));
  let counters = data.counters || {};
  const added = [];
  const net = Math.max(0, (Number(order.price) || 0) - (Number(order.discount) || 0));
  const label = `طلب #${order.orderNo || order.id.slice(-6)} — ${stage}`;
  const mk = (kind, amount, desc) => {
    const n = nextCounter(counters, "empEntry", 5000); counters = n.counters;
    added.push({ id: uid("el"), entryNo: n.no, employeeId: staff.id, date: todayStr(), createdAt: new Date().toISOString(), kind, desc, credit: round2(amount), debit: 0, orderId: order.id, stage, auto: true });
  };
  if (Number(staff.commissionPerPiece) > 0) mk("قطعة", Number(staff.commissionPerPiece), `أجر قطعة — ${label}`);
  if (Number(staff.commissionPercent) > 0 && net > 0) mk("نسبة", net * Number(staff.commissionPercent) / 100, `نسبة ${staff.commissionPercent}% من ${fmtNum(net)} ر.س — ${label}`);
  if (!added.length && kept.length === ledger.length) return {};
  return { employeeLedger: [...kept, ...added], counters };
}

function EmployeesView({ data, update, canEdit, currentUser }) {
  const [modal, setModal] = useState(null);
  const [payModal, setPayModal] = useState(null);
  const [adjModal, setAdjModal] = useState(null);
  const [salaryModal, setSalaryModal] = useState(null);
  const [profitModal, setProfitModal] = useState(null);
  const [statementFor, setStatementFor] = useState(null);
  const [printingVoucher, setPrintingVoucher] = useState(null);
  const roles = ["خياط", "مدير فرع", "قصّاص", "مراسل", "كاوي", "زرّار", "كاشير"];
  const fields = [
    { key: "name", label: "الاسم" }, { key: "phone", label: "الجوال" }, { key: "idNumber", label: "رقم الهوية / الإقامة (يظهر في السند)" },
    { key: "role", label: "الدور الوظيفي", type: "select", options: roles.map((r) => ({ value: r, label: r })) },
    { key: "baseSalary", label: "الراتب الشهري (ر.س) — اختياري", type: "number" },
    { key: "commissionPercent", label: "نسبة % من قيمة كل طلب (تُحتسب فور تسليمه القطعة) — اختياري", type: "number" },
    { key: "commissionPerPiece", label: "مبلغ ثابت لكل طلب/قطعة بالريال (مثال 5 ر.س) — اختياري", type: "number" },
    { key: "profitSharePercent", label: "نسبة % من أرباح المحل (تُثبَّت آخر الشهر) — اختياري", type: "number" },
    { key: "openingBalance", label: "رصيد افتتاحي (ر.س) — مستحقات له قبل النظام (سالب = عليه)", type: "number" },
  ];
  const save = (values) => {
    if (!String(values.name || "").trim()) { alert("أدخل اسم الموظف"); return; }
    const brs = empBranches(data, values);
    if (!brs.length) { alert("اختر فرعًا واحدًا على الأقل"); return; }
    let shares = {};
    if (brs.length > 1) {
      const total = brs.reduce((t, id) => t + (Number(values.branchShares?.[id]) || 0), 0);
      if (Math.abs(total - 100) > 0.01) {
        if (!data._isAdmin) { alert(`مجموع نسب الفروع يجب أن يساوي 100% (الحالي ${fmtNum(total)}%)`); return; }
        if (!window.confirm(`مجموع النسب ${fmtNum(total)}% وليس 100%. سيُوزَّع الراتب بنسبة كل فرع إلى المجموع. هل تتابع؟`)) return;
      }
      brs.forEach((id) => { shares[id] = Number(values.branchShares[id]) || 0; });
    }
    const clean = { ...values, branches: brs, branch: brs[0], branchShares: shares };
    const list = [...data.employees];
    if (modal.mode === "add") list.push({ id: uid("emp"), ...clean }); else { const i = list.findIndex((e) => e.id === clean.id); list[i] = clean; }
    update({ employees: list }); setModal(null);
  };

  const savePayment = () => {
    const { employee, values } = payModal;
    const amt = Number(values.amount);
    if (!amt || amt <= 0) { alert("أدخل مبلغًا صحيحًا"); return; }
    if (!periodAllowed(data, values.date || todayStr(), "تسجيل صرف بهذا التاريخ")) return;
    const isAdvance = values.kind === "سلفة موظف";
    const bv = buildVoucher(data.counters, { type: "صرف", accountId: values.accountId, branch: values.branch || empBranches(data, employee)[0], category: isAdvance ? "سلفة موظف" : "رواتب", amount: amt, description: values.note || (isAdvance ? `سلفة للموظف ${employee.name}` : `صرف مستحقات الموظف ${employee.name}`), date: values.date || todayStr(), partyType: "موظف", partyId: employee.id, employeeId: employee.id, partyName: employee.name, partyPhone: employee.phone || "" }, currentUser, data);
    const financeAccounts = data.financeAccounts.map((a) => a.id === values.accountId ? { ...a, balance: (Number(a.balance) || 0) - amt } : a);
    update({ vouchers: [...data.vouchers, bv.voucher], financeAccounts, counters: bv.counters, freedNumbers: bv.freedNumbers });
    setPayModal(null);
    setPrintingVoucher(bv.voucher);
  };

  const saveAdjustment = () => {
    const { employee, values } = adjModal;
    const amt = Number(values.amount);
    if (!amt || amt <= 0) { alert("أدخل مبلغًا صحيحًا"); return; }
    if (!periodAllowed(data, values.date || todayStr(), "تسجيل مكافأة أو خصم بهذا التاريخ")) return;
    const n = nextCounter(data.counters, "empEntry", 5000);
    const isBonus = values.kind === "مكافأة";
    const entry = { id: uid("el"), entryNo: n.no, employeeId: employee.id, date: values.date || todayStr(), createdAt: new Date().toISOString(), kind: values.kind, desc: values.note || values.kind, credit: isBonus ? amt : 0, debit: isBonus ? 0 : amt, by: currentUser };
    update({ employeeLedger: [...(data.employeeLedger || []), entry], counters: n.counters });
    setAdjModal(null);
  };

  // Month-end salary: credits every selected employee's account with base / monthDays × days worked.
  const openSalary = () => {
    const month = todayStr().slice(0, 7);
    const rows = {}; data.employees.filter((e) => Number(e.baseSalary) > 0).forEach((e) => { rows[e.id] = { include: true, days: 30 }; });
    setSalaryModal({ month, monthDays: 30, rows });
  };
  const salaryDone = (empId, month) => (data.employeeLedger || []).some((l) => l.employeeId === empId && l.kind === "راتب" && l.month === month);
  const saveSalaries = () => {
    const { month, monthDays, rows } = salaryModal;
    if (!periodAllowed(data, `${month}-01`, "إثبات رواتب هذا الشهر")) return;
    let counters = data.counters; const added = [];
    data.employees.filter((e) => rows[e.id]?.include && !salaryDone(e.id, month)).forEach((e) => {
      const days = Number(rows[e.id].days) || 0; const md = Number(monthDays) || 30;
      if (days <= 0) return;
      const amount = round2(Number(e.baseSalary) / md * days);
      const n = nextCounter(counters, "empEntry", 5000); counters = n.counters;
      added.push({ id: uid("el"), entryNo: n.no, employeeId: e.id, date: todayStr(), createdAt: new Date().toISOString(), kind: "راتب", month, days, desc: `راتب شهر ${month} — ${days} يوم من ${md}`, credit: amount, debit: 0, by: currentUser });
    });
    if (!added.length) { alert("لا يوجد رواتب جديدة لإثباتها"); return; }
    update({ employeeLedger: [...(data.employeeLedger || []), ...added], counters });
    setSalaryModal(null);
  };

  // Monthly net profit PER BRANCH, shown with its full breakdown before anything is posted.
  // Purchases / vouchers / orders belong to their own branch; purchases saved before branches
  // existed count toward the first branch. Wages count toward the branch of the employee who earned them.
  const defaultBranch = data.branches[0]?.id;
  const computeProfit = (month, branchId) => { const p = branchPnL(data, month, branchId); return { revenue: p.revenue, purchases: p.purchases, expenses: round2(p.expenses + p.refunds), wages: p.wages, profit: p.profit }; };
  const profitBranches = () => data.branches.filter((br) => data.employees.some((e) => empBranches(data, e).includes(br.id) && Number(e.profitSharePercent) > 0));
  const profitDone = (empId, month, branchId) => (data.employeeLedger || []).some((l) => l.employeeId === empId && l.kind === "أرباح" && l.month === month && (!l.branchId || l.branchId === branchId));
  const calcProfits = (month) => { const o = {}; profitBranches().forEach((br) => { o[br.id] = computeProfit(month, br.id).profit; }); return o; };
  const openProfit = () => { const month = todayStr().slice(0, 7); setProfitModal({ month, profits: calcProfits(month), include: {} }); };
  const saveProfit = () => {
    const { month, profits, include } = profitModal;
    if (!periodAllowed(data, `${month}-01`, "إثبات نسب أرباح هذا الشهر")) return;
    let counters = data.counters; const added = [];
    data.employees.filter((e) => Number(e.profitSharePercent) > 0).forEach((e) => empBranches(data, e).forEach((br) => {
      if (include[`${e.id}:${br}`] === false || profitDone(e.id, month, br)) return;
      const base = Number(profits[br]) || 0;
      if (base <= 0) return;
      const n = nextCounter(counters, "empEntry", 5000); counters = n.counters;
      const brName = data.branches.find((x) => x.id === br)?.name || "";
      added.push({ id: uid("el"), entryNo: n.no, employeeId: e.id, date: todayStr(), createdAt: new Date().toISOString(), kind: "أرباح", month, branchId: br, desc: `نسبة ${e.profitSharePercent}% من أرباح ${brName} لشهر ${month} (${fmtNum(base)} ر.س)`, credit: round2(base * Number(e.profitSharePercent) / 100), debit: 0, by: currentUser });
    }));
    if (!added.length) { alert("لا توجد نسب أرباح جديدة لإثباتها (تأكد أن ربح الفرع موجب)"); return; }
    update({ employeeLedger: [...(data.employeeLedger || []), ...added], counters });
    setProfitModal(null);
  };

  const removeEntry = (entry) => {
    if (!periodAllowed(data, entry.date, "حذف قيد من هذا الشهر")) return;
    if (!window.confirm(`حذف القيد رقم ${entry.no}؟ سيتغيّر رصيد الموظف.`)) return;
    update({ employeeLedger: (data.employeeLedger || []).filter((l) => l.id !== entry.key), auditLog: [...(data.auditLog || []), logEntry(currentUser, "حذف قيد موظف", `قيد #${entry.no} — ${entry.desc}`)] });
  };

  const totalDue = data.employees.reduce((s, e) => s + Math.max(0, employeeBalance(data, e)), 0);

  return (
    <>
      <CrudSection icon={Briefcase} title="إدارة الموظفين وكشوف حساباتهم" addLabel="موظف جديد" columns={["الاسم", "الدور", "نظام الأجر", "الرصيد المستحق", ""]} items={data.employees} searchKeys={["name", "role"]}
        extraHeader={canEdit ? <><Btn variant="ghost" onClick={openSalary}>إثبات رواتب الشهر</Btn><Btn variant="ghost" onClick={openProfit}>إثبات نسبة الأرباح</Btn></> : null}
        onAdd={canEdit ? () => setModal({ mode: "add", values: { role: roles[0], branch: data.branches[0]?.id, branches: data.branches[0] ? [data.branches[0].id] : [], openingBalance: 0 } }) : undefined}
        onEdit={canEdit ? (it) => setModal({ mode: "edit", values: it }) : undefined}
        onDelete={canEdit ? (it) => {
          const has = (data.employeeLedger || []).some((l) => l.employeeId === it.id) || data.vouchers.some((v) => v.employeeId === it.id);
          if (has && !window.confirm(`لهذا الموظف حركات مالية مسجّلة في كشف حسابه. الحذف يُخفي كشفه. متابعة؟`)) return;
          update({ employees: data.employees.filter((e) => e.id !== it.id), auditLog: [...(data.auditLog || []), logEntry(currentUser, "حذف موظف", `${it.name} (${it.role})`)] });
        } : undefined}
        renderRow={(it) => {
          const bal = employeeBalance(data, it);
          return (
            <>
              <td style={{ padding: "10px 14px", fontWeight: 600 }}>{it.name}<div style={{ fontSize: 11.5, color: "#8A8071", fontWeight: 400 }}>{it.phone}</div></td>
              <td style={{ padding: "10px 14px" }}><Badge color={THEME.teal}>{it.role}</Badge><div style={{ fontSize: 11.5, color: "#8A8071", marginTop: 3 }}>{empBranches(data, it).map((id) => data.branches.find((b) => b.id === id)?.name).filter(Boolean).join("، ")}</div></td>
              <td style={{ padding: "10px 14px", fontSize: 13 }}>{payTypeText(it)}</td>
              <td style={{ padding: "10px 14px", fontWeight: 700, color: bal > 0 ? THEME.red : THEME.teal }}>{fmtNum(bal)} ر.س{bal < 0 && <div style={{ fontSize: 11, fontWeight: 400 }}>(عليه)</div>}</td>
              <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {canEdit && <Btn small variant="ghost" onClick={() => setPayModal({ employee: it, values: { kind: "رواتب", accountId: data.financeAccounts[0]?.id, amount: bal > 0 ? bal : "", date: todayStr(), note: "" } })}>صرف / سلفة</Btn>}
                  {canEdit && <Btn small variant="ghost" onClick={() => setAdjModal({ employee: it, values: { kind: "مكافأة", amount: "", date: todayStr(), note: "" } })}>مكافأة / خصم</Btn>}
                  <Btn small variant="ghost" onClick={() => setStatementFor(it)}>كشف حساب</Btn>
                </div>
              </td>
            </>
          );
        }} />
      <div style={{ marginTop: 10, fontSize: 13, color: "#7A7061" }}>إجمالي المستحق للموظفين حاليًا: <b>{fmtNum(totalDue)} ر.س</b></div>

      {modal && (
        <Modal title={modal.mode === "add" ? "إضافة موظف" : "تعديل موظف"} onClose={() => setModal(null)}>
          <FormFields fields={fields} values={modal.values} setValues={(v) => setModal({ ...modal, values: v })} />
          <Field label="الفروع التي يعمل بها (يمكن اختيار أكثر من فرع)">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {data.branches.map((b) => {
                const cur = empBranches(data, modal.values);
                const on = cur.includes(b.id);
                return <label key={b.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5 }}><input type="checkbox" checked={on} onChange={(ev) => { const next = ev.target.checked ? [...cur, b.id] : cur.filter((x) => x !== b.id); setModal({ ...modal, values: { ...modal.values, branches: next, branch: next[0] || "", branchShares: next.length > 1 ? equalShares(next) : {} } }); }} />{b.name}</label>;
              })}
            </div>
          </Field>
          {empBranches(data, modal.values).length > 1 && (
            <Field label="نسبة توزيع راتبه ومكافآته على الفروع % (المجموع 100)">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {empBranches(data, modal.values).map((id) => (
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <span style={{ minWidth: 70 }}>{data.branches.find((b) => b.id === id)?.name}</span>
                    <TextInput type="number" value={modal.values.branchShares?.[id] ?? ""} onChange={(ev) => setModal({ ...modal, values: { ...modal.values, branchShares: { ...(modal.values.branchShares || {}), [id]: ev.target.value } } })} style={{ padding: "5px 8px" }} />
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, marginTop: 4, color: Math.abs(empBranches(data, modal.values).reduce((t, id) => t + (Number(modal.values.branchShares?.[id]) || 0), 0) - 100) < 0.01 ? THEME.teal : THEME.red }}>
                المجموع الحالي: {fmtNum(empBranches(data, modal.values).reduce((t, id) => t + (Number(modal.values.branchShares?.[id]) || 0), 0))}%
              </div>
            </Field>
          )}
          <div style={{ fontSize: 11.5, color: "#8A8071", marginBottom: 10 }}>يمكن الجمع بين أكثر من نظام. الراتب ونسبة الأرباح يُثبَّتان آخر الشهر، أما النسبة من الطلب والمبلغ الثابت لكل طلب فيدخلان حسابه فور تسليم القطعة له من المراسل.</div>
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={() => save(modal.values)}>حفظ</Btn><Btn variant="ghost" onClick={() => setModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}

      {payModal && (
        <Modal title={`صرف للموظف: ${payModal.employee.name}`} onClose={() => setPayModal(null)}>
          <FormFields values={payModal.values} setValues={(v) => setPayModal({ ...payModal, values: v })} fields={[
            { key: "kind", label: "نوع الصرف", type: "select", options: [{ value: "رواتب", label: "دفع مستحقات / راتب" }, { value: "سلفة موظف", label: "سلفة" }] },
            { key: "accountId", label: "من حساب", type: "select", options: data.financeAccounts.map((a) => ({ value: a.id, label: a.name })) },
            ...(empBranches(data, payModal.employee).length > 1 ? [{ key: "branch", label: "يُحمَّل على فرع", type: "select", options: empBranches(data, payModal.employee).map((id) => ({ value: id, label: data.branches.find((b) => b.id === id)?.name || id })) }] : []),
            { key: "amount", label: "المبلغ (ر.س)", type: "number" }, { key: "date", label: "التاريخ", type: "date" }, { key: "note", label: "ملاحظة (اختياري)" },
          ]} />
          <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 10 }}>الرصيد الحالي: {fmtNum(employeeBalance(data, payModal.employee))} ر.س — يُنشأ سند صرف برقم تسلسلي ويُخصم من الحساب.</div>
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={savePayment}>حفظ وإصدار السند</Btn><Btn variant="ghost" onClick={() => setPayModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}

      {adjModal && (
        <Modal title={`مكافأة / خصم: ${adjModal.employee.name}`} onClose={() => setAdjModal(null)}>
          <FormFields values={adjModal.values} setValues={(v) => setAdjModal({ ...adjModal, values: v })} fields={[
            { key: "kind", label: "النوع", type: "select", options: [{ value: "مكافأة", label: "مكافأة (تزيد مستحقاته)" }, { value: "خصم", label: "خصم / جزاء (يُنقص مستحقاته)" }] },
            { key: "amount", label: "المبلغ (ر.س)", type: "number" }, { key: "date", label: "التاريخ", type: "date" }, { key: "note", label: "السبب" },
          ]} />
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={saveAdjustment}>حفظ</Btn><Btn variant="ghost" onClick={() => setAdjModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}

      {salaryModal && (
        <Modal title="إثبات رواتب الشهر" onClose={() => setSalaryModal(null)} wide>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="الشهر"><TextInput type="month" value={salaryModal.month} onChange={(e) => setSalaryModal({ ...salaryModal, month: e.target.value })} /></Field>
            <Field label="عدد أيام الشهر (للقسمة)"><TextInput type="number" value={salaryModal.monthDays} onChange={(e) => setSalaryModal({ ...salaryModal, monthDays: e.target.value })} /></Field>
          </div>
          {Object.keys(salaryModal.rows).length === 0 ? <EmptyState text="لا يوجد موظفون لديهم راتب شهري" /> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead><tr style={{ background: "#EFE7D6" }}><th style={{ padding: 8, textAlign: "right" }}></th><th style={{ padding: 8, textAlign: "right" }}>الموظف</th><th style={{ padding: 8, textAlign: "right" }}>الراتب</th><th style={{ padding: 8, textAlign: "right" }}>أيام الدوام</th><th style={{ padding: 8, textAlign: "right" }}>المستحق</th></tr></thead>
              <tbody>
                {data.employees.filter((e) => salaryModal.rows[e.id]).map((e) => {
                  const r = salaryModal.rows[e.id]; const done = salaryDone(e.id, salaryModal.month);
                  const amount = round2(Number(e.baseSalary) / (Number(salaryModal.monthDays) || 30) * (Number(r.days) || 0));
                  const setRow = (patch) => setSalaryModal({ ...salaryModal, rows: { ...salaryModal.rows, [e.id]: { ...r, ...patch } } });
                  return (
                    <tr key={e.id} style={{ borderTop: `1px solid ${THEME.border}`, opacity: done ? 0.5 : 1 }}>
                      <td style={{ padding: 8 }}><input type="checkbox" checked={r.include && !done} disabled={done} onChange={(ev) => setRow({ include: ev.target.checked })} /></td>
                      <td style={{ padding: 8, fontWeight: 600 }}>{e.name}{done && <Badge color={THEME.teal}> مُثبت</Badge>}</td>
                      <td style={{ padding: 8 }}>{fmtNum(e.baseSalary)}</td>
                      <td style={{ padding: 8, width: 90 }}><TextInput type="number" value={r.days} disabled={done} onChange={(ev) => setRow({ days: ev.target.value })} style={{ padding: "5px 8px" }} /></td>
                      <td style={{ padding: 8, fontWeight: 700 }}>{fmtNum(amount)} ر.س</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 11.5, color: "#8A8071", margin: "10px 0" }}>المستحق = الراتب ÷ أيام الشهر × أيام الدوام. لا يمكن إثبات راتب نفس الشهر مرتين لنفس الموظف.</div>
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={saveSalaries}>إثبات الرواتب في الحسابات</Btn><Btn variant="ghost" onClick={() => setSalaryModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}

      {profitModal && (() => {
        const line = (label, v, minus) => <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px dashed ${THEME.border}`, fontSize: 13.5 }}><span>{label}</span><b>{minus ? "− " : ""}{fmtNum(v)} ر.س</b></div>;
        const brs = profitBranches();
        return (
          <Modal title="إثبات نسبة الأرباح — لكل فرع" onClose={() => setProfitModal(null)} wide>
            <Field label="الشهر"><TextInput type="month" value={profitModal.month} onChange={(ev) => { const m = ev.target.value; setProfitModal({ ...profitModal, month: m, profits: calcProfits(m) }); }} /></Field>
            {brs.length === 0 ? <EmptyState text="لا يوجد موظفون لديهم نسبة من الأرباح — أضفها من تعديل الموظف" /> : brs.map((br) => {
              const c = computeProfit(profitModal.month, br.id);
              const base = Number(profitModal.profits[br.id]) || 0;
              const list = data.employees.filter((e) => empBranches(data, e).includes(br.id) && Number(e.profitSharePercent) > 0);
              return (
                <Panel key={br.id} style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8, color: THEME.brass }}>{br.name}</div>
                  {line("إيرادات الطلبات (بعد الخصم، غير الملغاة)", c.revenue)}
                  {line("مشتريات الفرع", c.purchases, true)}
                  {line("مصروفات الفرع (سندات صرف غير الموظفين والموردين)", c.expenses, true)}
                  {line("مستحقات موظفي الفرع (رواتب وقطع ونسب ومكافآت)", c.wages, true)}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontWeight: 700 }}><span>صافي ربح الفرع</span><span style={{ color: c.profit > 0 ? THEME.teal : THEME.red }}>{fmtNum(c.profit)} ر.س</span></div>
                  <Field label="الربح المعتمد للتوزيع (يمكنك تعديله)"><TextInput type="number" value={profitModal.profits[br.id] ?? ""} onChange={(ev) => setProfitModal({ ...profitModal, profits: { ...profitModal.profits, [br.id]: ev.target.value } })} /></Field>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                    <tbody>
                      {list.map((e) => { const done = profitDone(e.id, profitModal.month, br.id); const ik = `${e.id}:${br.id}`; return (
                        <tr key={e.id} style={{ borderTop: `1px solid ${THEME.border}`, opacity: done ? 0.5 : 1 }}>
                          <td style={{ padding: 8, width: 30 }}><input type="checkbox" disabled={done} checked={profitModal.include[ik] !== false && !done} onChange={(ev) => setProfitModal({ ...profitModal, include: { ...profitModal.include, [ik]: ev.target.checked } })} /></td>
                          <td style={{ padding: 8, fontWeight: 600 }}>{e.name}{done && <Badge color={THEME.teal}> مُثبت</Badge>}</td>
                          <td style={{ padding: 8 }}>{e.profitSharePercent}%</td>
                          <td style={{ padding: 8, fontWeight: 700 }}>{fmtNum(base > 0 ? base * Number(e.profitSharePercent) / 100 : 0)} ر.س</td>
                        </tr>); })}
                    </tbody>
                  </table>
                </Panel>
              );
            })}
            <div style={{ fontSize: 11.5, color: "#8A8071", margin: "10px 0" }}>كل موظف يأخذ نسبته من ربح فرعه، والموظف الذي يعمل في أكثر من فرع يأخذ نسبته من ربح كل فرع يعمل به (قيد منفصل لكل فرع). مستحقات الراتب والمكافآت له توزَّع على فروعه بالنسب المحددة في بياناته عند حساب الربح، أما أجر القطعة والنسبة فتُحسب على فرع الطلب. يُفضَّل إثبات الرواتب أولًا حتى تدخل في حساب الربح. لا يمكن إثبات نسبة نفس الشهر مرتين للموظف.</div>
            <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={saveProfit}>إثبات في الحسابات</Btn><Btn variant="ghost" onClick={() => setProfitModal(null)}>إلغاء</Btn></div>
          </Modal>
        );
      })()}

      {statementFor && (() => {
        const e = data.employees.find((x) => x.id === statementFor.id) || statementFor;
        return (
          <StatementView data={data} title={`كشف حساب الموظف — ${e.name}`} onClose={() => setStatementFor(null)}
            partyLines={[`${e.role}${e.phone ? ` — ${e.phone}` : ""}`, e.idNumber ? `هوية: ${e.idNumber}` : "", `فروعه: ${empBranches(data, e).map((id) => data.branches.find((b) => b.id === id)?.name).filter(Boolean).join("، ")}`, `نظام الأجر: ${payTypeText(e)}`]}
            rows={employeeStatement(data, e).rows} opening={e.openingBalance}
            labels={{ inc: "له (مستحق)", dec: "عليه (مدفوع / مخصوم)", balanceText: (b) => `الرصيد: ${fmtNum(b)} ر.س ${b > 0 ? "(مستحق للموظف)" : b < 0 ? "(مستحق على الموظف)" : ""}` }}
            renderAction={(r) => r.isVoucher
              ? <button onClick={() => setPrintingVoucher(r.voucher)} title="طباعة السند" style={{ background: "none", border: "none", cursor: "pointer" }}><Printer size={14} /></button>
              : (canEdit && data._isAdmin && <button onClick={() => removeEntry(r)} title="حذف القيد" style={{ background: "none", border: "none", cursor: "pointer", color: THEME.red }}><Trash2 size={14} /></button>)} />
        );
      })()}
      {printingVoucher && <VoucherPrintModal data={data} voucher={printingVoucher} onClose={() => setPrintingVoucher(null)} />}
    </>
  );
}

// ---------- Suppliers & Purchases ----------
function SuppliersView({ data, update, canEdit }) {
  const [sModal, setSModal] = useState(null);
  const [pModal, setPModal] = useState(null);
  const [payModal, setPayModal] = useState(null);
  const [statementFor, setStatementFor] = useState(null);
  const [printingPurchase, setPrintingPurchase] = useState(null);
  const sFields = [{ key: "name", label: "اسم المورد" }, { key: "phone", label: "الجوال" }, { key: "materialType", label: "نوع المواد (أقمشة، أزرار، خيوط...)" }, { key: "openingBalance", label: "الرصيد الافتتاحي (ر.س) — ما كنت مديون به له قبل النظام", type: "number" }];
  const saveSupplier = (values) => { const list = [...data.suppliers]; if (sModal.mode === "add") list.push({ id: uid("sup"), ...values }); else { const i = list.findIndex((s) => s.id === values.id); list[i] = values; } update({ suppliers: list }); setSModal(null); };
  const categories = getList(data, "purchaseCategories");
  const pFields = [
    { key: "supplierId", label: "المورد", type: "select", options: data.suppliers.map((s) => ({ value: s.id, label: s.name })) },
    { key: "branch", label: "الفرع (لحساب أرباح الفرع)", type: "select", options: data.branches.map((b) => ({ value: b.id, label: b.name })) },
    { key: "category", label: "التصنيف", type: "select", options: categories.map((c) => ({ value: c, label: c })) },
    { key: "item", label: "الصنف" }, { key: "qty", label: "الكمية", type: "number" },
    { key: "unit", label: "الوحدة (متر، قطعة...)" }, { key: "cost", label: "التكلفة (ر.س)", type: "number" },
    { key: "date", label: "التاريخ", type: "date" },
  ];
  // buying an item that is not in the inventory catalog yet adds it automatically
  const [delPurchase, setDelPurchase] = useState(null);
  const deletePurchase = (pu, free) => {
    if (!periodAllowed(data, pu.date, "حذف مشتريات من هذا الشهر")) return;
    update({ purchases: data.purchases.filter((x) => x.id !== pu.id), auditLog: [...(data.auditLog || []), logEntry("مدير النظام", "حذف عملية شراء", `#${pu.purchaseNo} — ${pu.item}${free ? " — الرقم أُتيح لإعادة الاستخدام" : ""}`)], ...withFreed(data, "purchase", pu.purchaseNo, free) });
    setDelPurchase(null);
  };
  const withItem = (values) => {
    const items = data.inventoryItems || []; const nm = normName(values.item);
    if (!nm || !(Number(values.qty) > 0) || items.some((i) => normName(i.name) === nm)) return {};
    return { inventoryItems: [...items, { id: uid("inv"), name: String(values.item).trim(), category: values.category || "أخرى", unit: values.unit || "", minQty: 0 }] };
  };
  const savePurchase = (values) => {
    if (!periodAllowed(data, values.date, "تسجيل أو تعديل مشتريات بهذا التاريخ")) return;
    const list = [...data.purchases];
    if (pModal.mode === "add") {
      const t = issueNumber(data, data.counters, "purchase", 1000, data.purchases.map((x) => x.purchaseNo));
      list.push({ id: uid("pur"), purchaseNo: t.no, ...values });
      update({ purchases: list, counters: t.counters, freedNumbers: t.freedNumbers, ...withItem(values) });
    } else {
      const i = list.findIndex((p) => p.id === values.id); list[i] = values;
      update({ purchases: list, ...withItem(values) });
    }
    setPModal(null);
  };

  const supplierBalance = (s) => {
    const purchased = data.purchases.filter((p) => p.supplierId === s.id).reduce((sum, p) => sum + (Number(p.cost) || 0), 0);
    const paid = liveVouchers(data).filter((v) => v.type === "صرف" && v.supplierId === s.id).reduce((sum, v) => sum + (Number(v.amount) || 0), 0);
    return (Number(s.openingBalance) || 0) + purchased - paid;
  };
  const payFields = [
    { key: "accountId", label: "الحساب", type: "select", options: data.financeAccounts.map((a) => ({ value: a.id, label: a.name })) },
    { key: "amount", label: "المبلغ (ر.س)", type: "number" }, { key: "date", label: "التاريخ", type: "date" },
  ];
  const savePayment = () => {
    const amt = Number(payModal.values.amount);
    if (!amt || amt <= 0) { alert("أدخل مبلغًا صحيحًا"); return; }
    if (!periodAllowed(data, payModal.values.date || todayStr(), "تسجيل دفعة بهذا التاريخ")) return;
    const bv = buildVoucher(data.counters, { type: "صرف", accountId: payModal.values.accountId, branch: data.branches[0]?.id, category: "دفعة لمورد", amount: amt, description: `دفعة للمورد ${payModal.supplier.name}`, date: payModal.values.date || todayStr(), supplierId: payModal.supplier.id, partyType: "مورد", partyId: payModal.supplier.id }, undefined, data);
    const vouchers = [...data.vouchers, bv.voucher];
    const financeAccounts = data.financeAccounts.map((a) => a.id === payModal.values.accountId ? { ...a, balance: (Number(a.balance) || 0) - amt } : a);
    update({ vouchers, financeAccounts, counters: bv.counters, freedNumbers: bv.freedNumbers });
    setPayModal(null);
  };


  return (
    <div>
      <CrudSection icon={Building2} title="الموردون" addLabel="مورد جديد" columns={["الاسم", "المواد", "الجوال", "الرصيد المستحق", ""]} items={data.suppliers} searchKeys={["name"]}
        onAdd={canEdit ? () => setSModal({ mode: "add", values: { openingBalance: 0 } }) : undefined}
        onEdit={canEdit ? (it) => setSModal({ mode: "edit", values: it }) : undefined}
        onDelete={canEdit ? (it) => update({ suppliers: data.suppliers.filter((s) => s.id !== it.id) }) : undefined}
        renderRow={(it) => {
          const bal = supplierBalance(it);
          return (
            <>
              <td style={{ padding: "10px 14px", fontWeight: 600 }}>{it.name}</td>
              <td style={{ padding: "10px 14px" }}>{it.materialType}</td>
              <td style={{ padding: "10px 14px" }}>{it.phone}</td>
              <td style={{ padding: "10px 14px", fontWeight: 700, color: bal > 0 ? THEME.red : THEME.teal }}>{bal.toLocaleString()} ر.س</td>
              <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {canEdit && <Btn small variant="ghost" onClick={() => setPayModal({ supplier: it, values: { accountId: data.financeAccounts[0]?.id, amount: "", date: new Date().toISOString().slice(0, 10) } })}>تسجيل دفعة</Btn>}
                  <Btn small variant="ghost" onClick={() => setStatementFor(it)}>كشف حساب</Btn>
                </div>
              </td>
            </>
          );
        }} />

      <div style={{ height: 24 }} />
      <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 14 }}>المخزون الحالي والتنبيهات وقواعد الاستهلاك في شاشة «المخزون». أي صنف تشتريه يُضاف إليها تلقائيًا.</div>

      {delPurchase && <AdminDeleteModal title={`حذف عملية الشراء #${delPurchase.purchaseNo || ""}`} numberLabel="رقم الشراء" number={delPurchase.purchaseNo} lines={[`${delPurchase.item} — ${fmtNum(delPurchase.cost)} ر.س. سيتأثر المخزون وكشف المورد.`]} onConfirm={(free) => deletePurchase(delPurchase, free)} onClose={() => setDelPurchase(null)} />}
      <CrudSection icon={Truck} title="سجل المشتريات" addLabel="عملية شراء" columns={["الرقم", "المورد", "التصنيف", "الصنف", "الكمية", "التكلفة", "التاريخ", "مرفق"]} items={data.purchases} searchKeys={["item", "purchaseNo"]}
        onAdd={canEdit ? () => data.suppliers.length ? setPModal({ mode: "add", values: { category: categories[0], supplierId: data.suppliers[0]?.id || "", branch: data.branches[0]?.id || "", date: todayStr() } }) : alert("أضف موردًا أولاً") : undefined}
        onEdit={canEdit ? (it) => setPModal({ mode: "edit", values: it }) : undefined}
        onDelete={canEdit && data._isAdmin ? (it) => setDelPurchase(it) : undefined}
        renderRow={(it) => (<><td style={{ padding: "10px 14px", fontWeight: 700, color: THEME.brass }}>#{it.purchaseNo || it.id.slice(-6)}</td><td style={{ padding: "10px 14px" }}>{data.suppliers.find((s) => s.id === it.supplierId)?.name || "—"}</td><td style={{ padding: "10px 14px" }}>{it.category}</td><td style={{ padding: "10px 14px" }}>{it.item}</td><td style={{ padding: "10px 14px" }}>{it.qty} {it.unit}</td><td style={{ padding: "10px 14px" }}>{it.cost} ر.س</td><td style={{ padding: "10px 14px" }}>{it.date}</td><td style={{ padding: "10px 14px" }}><Btn small variant="ghost" onClick={() => setPrintingPurchase(it)}><Printer size={13} />{it.attachment ? "📎" : ""}</Btn></td></>)} />

      {sModal && <Modal title={sModal.mode === "add" ? "إضافة مورد" : "تعديل مورد"} onClose={() => setSModal(null)}><FormFields fields={sFields} values={sModal.values} setValues={(v) => setSModal({ ...sModal, values: v })} /><div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={() => saveSupplier(sModal.values)}>حفظ</Btn><Btn variant="ghost" onClick={() => setSModal(null)}>إلغاء</Btn></div></Modal>}
      {pModal && (
        <Modal title={pModal.mode === "add" ? "تسجيل عملية شراء" : "تعديل عملية شراء"} onClose={() => setPModal(null)}>
          <FormFields fields={pFields} values={pModal.values} setValues={(v) => setPModal({ ...pModal, values: v })} />
          <AttachmentField value={pModal.values.attachment} onChange={(att) => setPModal({ ...pModal, values: { ...pModal.values, attachment: att } })} />
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={() => savePurchase(pModal.values)}>حفظ</Btn><Btn variant="ghost" onClick={() => setPModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}
      {payModal && (
        <Modal title={`تسجيل دفعة للمورد: ${payModal.supplier.name}`} onClose={() => setPayModal(null)}>
          <FormFields fields={payFields} values={payModal.values} setValues={(v) => setPayModal({ ...payModal, values: v })} />
          <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 10 }}>الرصيد المستحق حاليًا: {supplierBalance(payModal.supplier).toLocaleString()} ر.س</div>
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={savePayment}>حفظ الدفعة</Btn><Btn variant="ghost" onClick={() => setPayModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}
      {statementFor && (() => {
        const sp = statementFor;
        const def = data.branches[0]?.id;
        const rows = [
          ...data.purchases.filter((x) => x.supplierId === sp.id).map((x) => ({ key: x.id, no: x.purchaseNo, noLabel: "شراء", date: x.date, createdAt: "", desc: `شراء: ${x.item}${x.qty ? ` (${x.qty} ${x.unit || ""})` : ""}`, kind: `شراء ${x.category || ""}`.trim(), inc: Number(x.cost) || 0, dec: 0, branch: x.branch || def })),
          ...liveVouchers(data).filter((v) => v.type === "صرف" && v.supplierId === sp.id).map((v) => ({ key: v.id, no: v.voucherNo, noLabel: "سند", date: v.date, createdAt: v.createdAt || "", desc: v.description || "دفعة مسدّدة", kind: "سداد", inc: 0, dec: Number(v.amount) || 0, branch: v.branch || def })),
        ].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || "").localeCompare(b.createdAt || ""));
        return (
          <StatementView data={data} title={`كشف حساب المورد — ${sp.name}`} onClose={() => setStatementFor(null)}
            partyLines={[sp.materialType, sp.phone]} rows={rows} opening={sp.openingBalance}
            labels={{ inc: "مدين (مشتريات)", dec: "دائن (سداد)", balanceText: (b) => `الرصيد المستحق للمورد: ${fmtNum(b)} ر.س` }} />
        );
      })()}
      {printingPurchase && (
        <RecordPrintModal data={data} signatures={["توقيع المورد / المستلم", "توقيع المحاسب"]} title="سند شراء" refLabel="عملية شراء" refNo={printingPurchase.purchaseNo || printingPurchase.id.slice(-6)} attachment={printingPurchase.attachment} onClose={() => setPrintingPurchase(null)}
          rows={[
            { label: "المورد", value: data.suppliers.find((s) => s.id === printingPurchase.supplierId)?.name || "—" },
            { label: "التصنيف", value: printingPurchase.category },
            { label: "الصنف", value: printingPurchase.item },
            { label: "الكمية", value: `${printingPurchase.qty} ${printingPurchase.unit || ""}` },
            { label: "التكلفة", value: `${printingPurchase.cost || 0} ر.س` },
            { label: "التاريخ", value: printingPurchase.date || "—" },
          ]} />
      )}
    </div>
  );
}

// ---------- Finance ----------
// ---------- Finance charts (shared by Finance & Reports) ----------
function FinanceCharts({ data }) {
  const collectedFor = (orderId) => liveVouchers(data).filter((v) => v.orderId === orderId).reduce((s, v) => s + (Number(v.amount) || 0), 0);

  const perBranch = data.branches.map((b) => {
    const income = liveVouchers(data).filter((v) => v.type === "قبض" && v.branch === b.id).reduce((s, v) => s + (Number(v.amount) || 0), 0);
    const expense = liveVouchers(data).filter((v) => v.type === "صرف" && v.branch === b.id).reduce((s, v) => s + (Number(v.amount) || 0), 0);
    const remaining = data.orders.filter((o) => o.branch === b.id && !o.cancelled).reduce((s, o) => { const rem = (Number(o.price) || 0) - collectedFor(o.id); return s + (rem > 0 ? rem : 0); }, 0);
    return { name: b.name, الوارد: income, المصروف: expense, المتبقي: remaining };
  });

  const totalIncome = liveVouchers(data).filter((v) => v.type === "قبض").reduce((s, v) => s + (Number(v.amount) || 0), 0);
  const totalDeposits = liveVouchers(data).filter((v) => v.type === "قبض" && v.category === "عربون").reduce((s, v) => s + (Number(v.amount) || 0), 0);
  const totalExpense = liveVouchers(data).filter((v) => v.type === "صرف").reduce((s, v) => s + (Number(v.amount) || 0), 0);
  const totalRemaining = data.orders.reduce((s, o) => { const rem = (Number(o.price) || 0) - collectedFor(o.id); return s + (rem > 0 ? rem : 0); }, 0);
  const totalInvoiced = data.orders.reduce((s, o) => s + (Number(o.price) || 0), 0);
  const collectionRate = totalInvoiced > 0 ? Math.round((totalIncome / totalInvoiced) * 100) : 0;

  const compositionMap = {};
  liveVouchers(data).filter((v) => v.type === "قبض").forEach((v) => { const c = v.category || "أخرى"; compositionMap[c] = (compositionMap[c] || 0) + (Number(v.amount) || 0); });
  const compositionData = Object.entries(compositionMap).map(([name, value]) => ({ name, value }));
  const PIE_COLORS = [THEME.brass, THEME.teal, "#8A8071", THEME.red];

  const kpis = [
    { label: "الوارد", value: totalIncome, color: THEME.teal },
    { label: "العربون", value: totalDeposits, color: THEME.brass },
    { label: "المتبقي (ذمم)", value: totalRemaining, color: THEME.red },
    { label: "المصروف", value: totalExpense, color: THEME.ink },
  ];

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14, marginBottom: 16 }}>
        {kpis.map((k) => <Panel key={k.label}><div style={{ fontSize: 13, color: "#7A7061" }}>{k.label}</div><div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value.toLocaleString()} ر.س</div></Panel>)}
      </div>
      {data.orders.length === 0 && data.vouchers.length === 0 ? (
        <Panel><EmptyState text="أضف طلبات وسندات ليظهر المخطط والنسب" /></Panel>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
          <Panel>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>الوارد والمصروف والمتبقي حسب الفرع</div>
            <div style={{ width: "100%", height: 240, direction: "ltr" }}>
              <ResponsiveContainer>
                <BarChart data={perBranch}>
                  <CartesianGrid strokeDasharray="3 3" stroke={THEME.border} />
                  <XAxis dataKey="name" stroke={THEME.ink} fontSize={12} />
                  <YAxis stroke={THEME.ink} fontSize={11} />
                  <Tooltip formatter={(v) => `${v.toLocaleString()} ر.س`} />
                  <Legend />
                  <Bar dataKey="الوارد" fill={THEME.teal} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="المصروف" fill={THEME.red} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="المتبقي" fill={THEME.brass} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>تكوين الوارد ونسبة التحصيل</div>
            <div style={{ textAlign: "center", fontSize: 13.5, marginBottom: 6 }}>نسبة التحصيل من إجمالي قيمة الطلبات: <b>{collectionRate}%</b></div>
            {compositionData.length === 0 ? <EmptyState text="لا يوجد وارد مسجّل بعد" /> : (
              <div style={{ width: "100%", height: 200, direction: "ltr" }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={compositionData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={3}>
                      {compositionData.map((entry, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => `${v.toLocaleString()} ر.س`} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function FinanceView({ data, update, canEdit, currentUser }) {
  const [cancelModal, setCancelModal] = useState(null);
  const [delVoucher, setDelVoucher] = useState(null);
  const deleteVoucherForever = (v, free) => {
    if (!periodAllowed(data, v.date, "حذف سند من هذا الشهر")) return;
    const live = v.status !== "cancelled"; const amt = Number(v.amount) || 0;
    const financeAccounts = live ? data.financeAccounts.map((a) => a.id === v.accountId ? { ...a, balance: round2((Number(a.balance) || 0) + (v.type === "قبض" ? -amt : amt)) } : a) : data.financeAccounts;
    const orders = live && v.orderId && v.type === "قبض" ? data.orders.map((o) => o.id === v.orderId ? { ...o, deposit: Math.max(0, (Number(o.deposit) || 0) - amt) } : o)
      : live && v.orderId && v.category === "مرتجع عميل" ? data.orders.map((o) => o.id === v.orderId ? { ...o, deposit: (Number(o.deposit) || 0) + amt } : o) : data.orders;
    const auditLog = [...(data.auditLog || []), logEntry(currentUser, "حذف نهائي لسند (مدير النظام)", `سند ${v.type} رقم ${v.voucherNo} — ${fmtNum(amt)} ر.س${free ? " — الرقم أُتيح لإعادة الاستخدام" : ""}`)];
    update({ vouchers: data.vouchers.filter((x) => x.id !== v.id), financeAccounts, orders, auditLog, ...withFreed(data, "voucher", v.voucherNo, free) });
    setDelVoucher(null);
  };
  const cancelVoucher = () => {
    const { voucher: v, reason } = cancelModal;
    if (!String(reason || "").trim()) { alert("اكتب سبب الإلغاء"); return; }
    if (!periodAllowed(data, v.date, "إلغاء سند من هذا الشهر")) return;
    const cv = cancelVouchersWhere(data, (x) => x.id === v.id, reason.trim(), currentUser);
    if (!cv.count) { setCancelModal(null); return; }
    const amt = Number(v.amount) || 0;
    const orders = v.orderId && v.type === "قبض" ? data.orders.map((o) => o.id === v.orderId ? { ...o, deposit: Math.max(0, (Number(o.deposit) || 0) - amt) } : o)
      : v.orderId && v.category === "مرتجع عميل" ? data.orders.map((o) => o.id === v.orderId ? { ...o, deposit: (Number(o.deposit) || 0) + amt } : o) : data.orders;
    const auditLog = [...(data.auditLog || []), logEntry(currentUser, "إلغاء سند", `سند ${v.type} رقم ${v.voucherNo} — ${fmtNum(amt)} ر.س — السبب: ${reason.trim()}`)];
    update({ vouchers: cv.vouchers, financeAccounts: cv.financeAccounts, orders, auditLog });
    setCancelModal(null);
  };
  const [vModal, setVModal] = useState(null);
  const [jModal, setJModal] = useState(null);
  const [printingVoucher, setPrintingVoucher] = useState(null);
  const [printingJournal, setPrintingJournal] = useState(null);
  const expenseCategories = getList(data, "expenseCategories");
  const incomeCategories = getList(data, "incomeCategories");
  const vFields = [
    { key: "type", label: "نوع السند", type: "select", options: [{ value: "قبض", label: "سند قبض" }, { value: "صرف", label: "سند صرف" }] },
    { key: "accountId", label: "الحساب", type: "select", options: data.financeAccounts.map((a) => ({ value: a.id, label: a.name })) },
    { key: "branch", label: "الفرع", type: "select", options: data.branches.map((b) => ({ value: b.id, label: b.name })) },
    { key: "amount", label: "المبلغ (ر.س)", type: "number" }, { key: "description", label: "البيان" }, { key: "date", label: "التاريخ", type: "date" },
  ];
  const saveVoucher = (values) => {
    if (!Number(values.amount) || Number(values.amount) <= 0) { alert("أدخل مبلغًا صحيحًا"); return; }
    if (!periodAllowed(data, values.date || todayStr(), "إضافة سند بهذا التاريخ")) return;
    const extra = {};
    if (values.partyType === "موظف" && values.partyId) extra.employeeId = values.partyId;
    if (values.partyType === "مورد" && values.partyId) extra.supplierId = values.partyId;
    const bv = buildVoucher(data.counters, { ...values, ...extra, date: values.date || todayStr() }, currentUser, data);
    const vouchers = [...data.vouchers, bv.voucher];
    const accounts = data.financeAccounts.map((a) => a.id === values.accountId ? { ...a, balance: (Number(a.balance) || 0) + (values.type === "قبض" ? Number(values.amount) : -Number(values.amount)) } : a);
    update({ vouchers, financeAccounts: accounts, counters: bv.counters, freedNumbers: bv.freedNumbers }); setVModal(null);
  };
  const jFields = [
    { key: "fromAccount", label: "من حساب", type: "select", options: data.financeAccounts.map((a) => ({ value: a.id, label: a.name })) },
    { key: "toAccount", label: "إلى حساب", type: "select", options: data.financeAccounts.map((a) => ({ value: a.id, label: a.name })) },
    { key: "amount", label: "المبلغ (ر.س)", type: "number" }, { key: "description", label: "البيان" }, { key: "date", label: "التاريخ", type: "date" },
  ];
  const saveJournal = (values) => {
    if (values.fromAccount === values.toAccount) { alert("اختر حسابين مختلفين"); return; }
    const jn = nextCounter(data.counters, "journal");
    const entries = [...data.journalEntries, { id: uid("j"), journalNo: jn.no, createdBy: currentUser || "", ...values }];
    const accounts = data.financeAccounts.map((a) => {
      if (a.id === values.fromAccount) return { ...a, balance: (Number(a.balance) || 0) - Number(values.amount) };
      if (a.id === values.toAccount) return { ...a, balance: (Number(a.balance) || 0) + Number(values.amount) };
      return a;
    });
    update({ journalEntries: entries, financeAccounts: accounts, counters: jn.counters }); setJModal(null);
  };

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const inRange = (d) => { if (!d) return !dateFrom && !dateTo; if (dateFrom && d < dateFrom) return false; if (dateTo && d > dateTo) return false; return true; };
  const filteredOrders = data.orders.filter((o) => inRange(o.createdAt));
  const filteredVouchers = liveVouchers(data).filter((v) => inRange(v.date));
  const filteredData = { ...data, orders: filteredOrders, vouchers: filteredVouchers };

  const revenueByBranch = data.branches.map((b) => ({ name: b.name, total: filteredOrders.filter((o) => o.branch === b.id && !o.cancelled).reduce((s, o) => s + (Number(o.price) || 0), 0) }));
  const expensesByBranch = data.branches.map((b) => ({ name: b.name, total: filteredVouchers.filter((v) => v.branch === b.id && v.type === "صرف").reduce((s, v) => s + (Number(v.amount) || 0), 0) }));

  return (
    <div>
      <h2 style={{ fontFamily: "Amiri, serif", fontSize: 28, color: THEME.ink, marginTop: 0 }}>الإدارة المالية</h2>
      <Panel style={{ marginBottom: 16, maxWidth: 480 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13.5 }}>فلترة التقارير بمدى تاريخي (لا يؤثر على أرصدة الحسابات الفعلية)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
          <Field label="من تاريخ"><TextInput type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
          <Field label="إلى تاريخ"><TextInput type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
          {(dateFrom || dateTo) && <Btn small variant="ghost" onClick={() => { setDateFrom(""); setDateTo(""); }} style={{ marginBottom: 12 }}>مسح الفلتر</Btn>}
        </div>
      </Panel>
      <FinanceCharts data={filteredData} />
      <ClosePeriodsPanel data={data} update={update} currentUser={currentUser} />
      {!data._scope && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 20 }}>
        {data.financeAccounts.map((a) => <Panel key={a.id}><div style={{ fontSize: 13, color: "#7A7061" }}>{a.name}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{a.balance.toLocaleString()} ر.س</div></Panel>)}
      </div>}
      <Panel style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>الأرباح والخسائر حسب الفرع {(dateFrom || dateTo) && <span style={{ fontSize: 11.5, color: THEME.teal, fontWeight: 400 }}>(بالمدى المحدد)</span>}</div>
        {data.branches.map((b) => {
          const rev = revenueByBranch.find((r) => r.name === b.name)?.total || 0;
          const exp = expensesByBranch.find((r) => r.name === b.name)?.total || 0;
          return <div key={b.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px dashed ${THEME.border}`, fontSize: 13.5 }}><span>{b.name}</span><span>إيراد: {rev.toLocaleString()} — مصروف: {exp.toLocaleString()} — <b>صافي: {(rev - exp).toLocaleString()} ر.س</b></span></div>;
        })}
        <div style={{ marginTop: 10, fontSize: 12.5, color: "#7A7061" }}>خيارات الدفع تابي وتمارا متاحة عند الفوترة؛ تفعيلها الفعلي يتطلب ربط API مع حساب تاجر معتمد لدى كل مزوّد.</div>
      </Panel>

      <CrudSection icon={Wallet} title="السندات (قبض / صرف)" addLabel="سند جديد" columns={["الرقم", "النوع", "الطرف", "الحساب", "التصنيف", "المبلغ", "البيان", "التاريخ", ""]} items={data.vouchers} searchKeys={["description", "voucherNo", "partyName"]}
        onAdd={canEdit ? () => setVModal({ mode: "add", values: { type: "قبض", accountId: data.financeAccounts[0]?.id, branch: data.branches[0]?.id, category: incomeCategories[incomeCategories.length - 1], date: todayStr() } }) : undefined}
        renderRow={(it) => {
          const pr = voucherPartyInfo(data, it); const dead = it.status === "cancelled";
          const cell = { padding: "10px 14px", opacity: dead ? 0.55 : 1, textDecoration: dead ? "line-through" : "none" };
          return (<><td style={{ ...cell, fontWeight: 700, color: THEME.brass }}>{it.voucherNo || "—"}{dead && <div style={{ textDecoration: "none" }}><Badge color={THEME.red}>ملغى</Badge></div>}</td><td style={cell}><Badge color={it.type === "قبض" ? THEME.teal : THEME.red}>{it.type}</Badge></td><td style={{ ...cell, fontSize: 13 }}>{pr.find((r) => r.label === "الاسم")?.value || "—"}</td><td style={cell}>{data.financeAccounts.find((a) => a.id === it.accountId)?.name}</td><td style={cell}>{it.category || "—"}</td><td style={cell}>{fmtNum(it.amount)} ر.س</td><td style={cell}>{it.description}{dead && it.cancelReason && <div style={{ fontSize: 11.5, color: THEME.red, textDecoration: "none" }}>سبب الإلغاء: {it.cancelReason}</div>}</td><td style={cell}>{it.date}{isMonthClosed(data, it.date) ? " 🔒" : ""}</td><td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}><Btn small variant="ghost" onClick={() => setPrintingVoucher(it)}><Printer size={13} /></Btn>{canEdit && !dead && <Btn small variant="danger" onClick={() => setCancelModal({ voucher: it, reason: "" })} style={{ marginRight: 4 }}>إلغاء</Btn>}{canEdit && data._isAdmin && <Btn small variant="danger" onClick={() => setDelVoucher(it)} style={{ marginRight: 4 }} title="حذف نهائي (مدير النظام)"><Trash2 size={13} /></Btn>}</td></>);
        }} />
      {delVoucher && <AdminDeleteModal title={`حذف نهائي للسند رقم ${delVoucher.voucherNo}`} numberLabel="رقم السند" number={delVoucher.voucherNo} lines={[`${delVoucher.type} بمبلغ ${fmtNum(delVoucher.amount)} ر.س — ${delVoucher.description || ""}`, delVoucher.status === "cancelled" ? "السند ملغى أصلًا، فلن يتغير رصيد الحساب." : "يُعاد أثره على رصيد الحساب."]} onConfirm={(free) => deleteVoucherForever(delVoucher, free)} onClose={() => setDelVoucher(null)} />}
      {cancelModal && (
        <Modal title={`إلغاء السند رقم ${cancelModal.voucher.voucherNo}`} onClose={() => setCancelModal(null)}>
          <div style={{ fontSize: 13.5, marginBottom: 10 }}>{cancelModal.voucher.type} بمبلغ <b>{fmtNum(cancelModal.voucher.amount)} ر.س</b> — {cancelModal.voucher.description}</div>
          <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 10 }}>يبقى السند ظاهرًا برقمه وحالة «ملغى»، ويُعاد أثره على رصيد الحساب{cancelModal.voucher.orderId && cancelModal.voucher.type === "قبض" ? " ويُنقص المدفوع من الطلب" : ""}، ويُستثنى من الكشوفات والتقارير. لا يمكن التراجع.</div>
          <Field label="سبب الإلغاء (إلزامي)"><TextInput value={cancelModal.reason} onChange={(e) => setCancelModal({ ...cancelModal, reason: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 8 }}><Btn variant="danger" onClick={cancelVoucher}>تأكيد الإلغاء</Btn><Btn variant="ghost" onClick={() => setCancelModal(null)}>تراجع</Btn></div>
        </Modal>
      )}

      <div style={{ height: 20 }} />
      {!data._scope && <CrudSection icon={Wallet} title="قيود التحويل بين الحسابات" addLabel="قيد جديد" columns={["الرقم", "من", "إلى", "المبلغ", "البيان", "التاريخ", "طباعة"]} items={data.journalEntries} searchKeys={["description", "journalNo"]}
        onAdd={canEdit ? () => setJModal({ mode: "add", values: { fromAccount: data.financeAccounts[0]?.id, toAccount: data.financeAccounts[1]?.id || data.financeAccounts[0]?.id } }) : undefined}
        renderRow={(it) => (<><td style={{ padding: "10px 14px", fontWeight: 700, color: THEME.brass }}>{it.journalNo || "—"}</td><td style={{ padding: "10px 14px" }}>{data.financeAccounts.find((a) => a.id === it.fromAccount)?.name}</td><td style={{ padding: "10px 14px" }}>{data.financeAccounts.find((a) => a.id === it.toAccount)?.name}</td><td style={{ padding: "10px 14px" }}>{it.amount} ر.س</td><td style={{ padding: "10px 14px" }}>{it.description}</td><td style={{ padding: "10px 14px" }}>{it.date}</td><td style={{ padding: "10px 14px" }}><Btn small variant="ghost" onClick={() => setPrintingJournal(it)}><Printer size={13} /></Btn></td></>)} />}

      {vModal && (
        <Modal title="سند جديد" onClose={() => setVModal(null)}>
          <FormFields fields={vFields} values={vModal.values} setValues={(v) => setVModal({ ...vModal, values: v })} />
          <Field label={vModal.values.type === "صرف" ? "تصنيف المصروف" : "تصنيف الوارد"}>
            <SelectInput options={(vModal.values.type === "صرف" ? expenseCategories : incomeCategories).map((c) => ({ value: c, label: c }))} value={vModal.values.category || ""} onChange={(e) => setVModal({ ...vModal, values: { ...vModal.values, category: e.target.value } })} />
          </Field>
          <PartyPicker data={data} values={vModal.values} setValues={(v) => setVModal({ ...vModal, values: v })} />
          <AttachmentField value={vModal.values.attachment} onChange={(att) => setVModal({ ...vModal, values: { ...vModal.values, attachment: att } })} />
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={() => saveVoucher(vModal.values)}>حفظ</Btn><Btn variant="ghost" onClick={() => setVModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}
      {jModal && (
        <Modal title="قيد تحويل جديد" onClose={() => setJModal(null)}>
          <FormFields fields={jFields} values={jModal.values} setValues={(v) => setJModal({ ...jModal, values: v })} />
          <AttachmentField value={jModal.values.attachment} onChange={(att) => setJModal({ ...jModal, values: { ...jModal.values, attachment: att } })} />
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={() => saveJournal(jModal.values)}>حفظ</Btn><Btn variant="ghost" onClick={() => setJModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}
      {printingVoucher && <VoucherPrintModal data={data} voucher={printingVoucher} onClose={() => setPrintingVoucher(null)} />}
      {printingJournal && (
        <RecordPrintModal data={data} docType="journal" amount={Number(printingJournal.amount) || 0} date={printingJournal.date || ""} signatures={["أمين الصندوق / المحاسب", "المدير المعتمد"]} title="قيد تحويل" refLabel="قيد تحويل" refNo={printingJournal.journalNo || printingJournal.id.slice(-6)} attachment={printingJournal.attachment} onClose={() => setPrintingJournal(null)}
          rows={[
            { label: "من حساب", value: data.financeAccounts.find((a) => a.id === printingJournal.fromAccount)?.name || "—" },
            { label: "إلى حساب", value: data.financeAccounts.find((a) => a.id === printingJournal.toAccount)?.name || "—" },
            { label: "البيان", value: printingJournal.description || "—" },
          ]} />
      )}
    </div>
  );
}

// ---------- Users / System admin ----------
function UsersView({ data, update, canEdit, currentUser, isAdmin }) {
  const [modal, setModal] = useState(null);
  const [branchName, setBranchName] = useState("");
  const renameBranch = (b) => {
    const name = window.prompt("الاسم الجديد للفرع:", b.name); if (!name || !name.trim() || name.trim() === b.name) return;
    update({ branches: data.branches.map((x) => x.id === b.id ? { ...x, name: name.trim() } : x), auditLog: [...(data.auditLog || []), logEntry(currentUser, "تعديل اسم فرع", `${b.name} ← ${name.trim()}`)] });
  };
  const deleteBranch = (b) => {
    if (data.branches.length <= 1) { alert("يجب أن يبقى فرع واحد على الأقل في النظام."); return; }
    const refs = { طلبات: data.orders.filter((o) => o.branch === b.id).length, سندات: data.vouchers.filter((v) => v.branch === b.id).length, موظفين: data.employees.filter((e) => empBranches(data, e).includes(b.id)).length, مشتريات: (data.purchases || []).filter((x) => x.branch === b.id).length };
    const used = Object.entries(refs).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join("، ");
    if (!window.confirm(`حذف الفرع «${b.name}»؟${used ? `\nمرتبط به: ${used}. تبقى هذه السجلات في النظام لكن بلا فرع معروف، ولن تظهر في أرباح أي فرع.` : ""}`)) return;
    update({
      branches: data.branches.filter((x) => x.id !== b.id),
      users: data.users.map((u) => (u.branches || []).includes(b.id) ? { ...u, branches: u.branches.filter((id) => id !== b.id) } : u),
      employees: data.employees.map((e) => (e.branch === b.id || (e.branches || []).includes(b.id)) ? { ...e, branches: (e.branches || []).filter((id) => id !== b.id), branch: e.branch === b.id ? ((e.branches || []).filter((id) => id !== b.id)[0] || data.branches.find((x) => x.id !== b.id)?.id) : e.branch } : e),
      auditLog: [...(data.auditLog || []), logEntry(currentUser, "حذف فرع (مدير النظام)", b.name)],
    });
  };
  const addBranch = () => { if (branchName.trim()) { update({ branches: [...data.branches, { id: uid("br"), name: branchName.trim() }] }); setBranchName(""); } };
  const toggleBranch = (values, bId) => { const cur = values.branches || []; const next = cur.includes(bId) ? cur.filter((x) => x !== bId) : [...cur, bId]; setModal({ ...modal, values: { ...values, branches: next } }); };
  const togglePerm = (values, moduleId, field) => {
    const perms = { ...(values.permissions || {}) };
    perms[moduleId] = { ...perms[moduleId], [field]: !perms[moduleId]?.[field] };
    setModal({ ...modal, values: { ...values, permissions: perms } });
  };
  const save = async (values) => {
    const list = [...data.users];
    let toSave = { ...values };
    if (toSave.password && toSave.password.trim()) { toSave.password = await hashPassword(toSave.password.trim()); }
    else { const existing = data.users.find((u) => u.id === values.id); toSave.password = existing?.password || ""; }
    if (modal.mode === "add") list.push({ id: uid("usr"), ...toSave });
    else { const i = list.findIndex((u) => u.id === toSave.id); list[i] = toSave; }
    update({ users: list }); setModal(null);
  };
  const moduleLabels = { dashboard: "لوحة التحكم", customers: "العملاء", orders: "الطلبات", courier: "شاشة المراسل", appointments: "المواعيد", designs: "دليل التصاميم", invoices: "الفواتير", employees: "الموظفون", suppliers: "المشتريات", inventory: "المخزون", returns: "المرتجعات", finance: "المالية", users: "المستخدمون", settings: "بيانات المحل", reports: "التقارير" };

  return (
    <div>
      <Panel style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>الفروع</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>{data.branches.map((b) => <span key={b.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Badge color={THEME.teal}>{b.name}</Badge>{isAdmin && <><span style={{ cursor: "pointer", fontSize: 12, color: THEME.brass }} onClick={() => renameBranch(b)}>تعديل</span><span style={{ cursor: "pointer", fontSize: 12, color: THEME.red }} onClick={() => deleteBranch(b)}>حذف</span></>}</span>)}</div>
        {canEdit && <div style={{ display: "flex", gap: 8 }}><TextInput placeholder="اسم فرع جديد" value={branchName} onChange={(e) => setBranchName(e.target.value)} style={{ maxWidth: 220 }} /><Btn variant="brass" onClick={addBranch}><Plus size={16} />إضافة فرع</Btn></div>}
      </Panel>

      {(data.auditLog || []).length > 0 && (
        <Panel style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>سجل التدقيق (آخر العمليات الحساسة)</div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {[...data.auditLog].reverse().slice(0, 50).map((l) => (
              <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px dashed ${THEME.border}`, fontSize: 12.5 }}>
                <span><b>{l.action}</b>{l.details ? ` — ${l.details}` : ""}</span>
                <span style={{ color: "#7A7061" }}>{l.user} — {l.at}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>حالة الدخول والاتصال</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#EFE7D6" }}><th style={{ padding: "8px 10px", textAlign: "right" }}>المستخدم</th><th style={{ padding: "8px 10px", textAlign: "right" }}>الحالة</th><th style={{ padding: "8px 10px", textAlign: "right" }}>عدد مرات الدخول</th><th style={{ padding: "8px 10px", textAlign: "right" }}>آخر دخول</th></tr></thead>
            <tbody>
              {data.users.map((u) => {
                const isOnlineNow = u.lastSeen && (Date.now() - new Date(u.lastSeen).getTime()) < 120000;
                return (
                  <tr key={u.id} style={{ borderTop: `1px solid ${THEME.border}` }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600 }}>{u.name}</td>
                    <td style={{ padding: "7px 10px" }}>{isOnlineNow ? <Badge color={THEME.teal}>🟢 متصل الآن</Badge> : <span style={{ color: "#8A8071" }}>⚪ غير متصل</span>}</td>
                    <td style={{ padding: "7px 10px" }}>{u.loginCount || 0}</td>
                    <td style={{ padding: "7px 10px" }}>{u.lastLogin || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: "#8A8071", marginTop: 8 }}>"متصل الآن" تقديري بناءً على آخر نشاط خلال دقيقتين — قد يتأخر قليلاً بسبب تزامن البيانات بين الأجهزة.</div>
      </Panel>

      <CrudSection icon={ShieldCheck} title="المستخدمون والصلاحيات" addLabel="مستخدم جديد" columns={["الاسم", "اسم الدخول", "الجوال", "الدور", "الفروع المتاحة"]} items={data.users} searchKeys={["name", "username"]}
        onAdd={canEdit ? () => setModal({ mode: "add", values: { role: ROLES[0], branches: [], phone: "", password: "", permissions: defaultPermissions(ROLES[0]) } }) : undefined}
        onEdit={canEdit ? (it) => setModal({ mode: "edit", values: { ...it, password: "" } }) : undefined}
        onDelete={canEdit ? (it) => update({ users: data.users.filter((u) => u.id !== it.id), auditLog: [...(data.auditLog || []), logEntry(currentUser, "حذف مستخدم", `${it.name} (${it.username})`)] }) : undefined}
        renderRow={(it) => (<><td style={{ padding: "10px 14px", fontWeight: 600 }}>{it.name}</td><td style={{ padding: "10px 14px" }}>{it.username}</td><td style={{ padding: "10px 14px" }}>{it.phone || "—"}</td><td style={{ padding: "10px 14px" }}><Badge>{it.role}</Badge></td><td style={{ padding: "10px 14px", fontSize: 12.5 }}>{(it.branches || []).map((id) => data.branches.find((b) => b.id === id)?.name).filter(Boolean).join("، ") || "—"}</td></>)} />

      {modal && (
        <Modal title={modal.mode === "add" ? "إضافة مستخدم" : "تعديل مستخدم"} onClose={() => setModal(null)} wide>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="الاسم"><TextInput value={modal.values.name || ""} onChange={(e) => setModal({ ...modal, values: { ...modal.values, name: e.target.value } })} /></Field>
            <Field label="اسم الدخول"><TextInput value={modal.values.username || ""} onChange={(e) => setModal({ ...modal, values: { ...modal.values, username: e.target.value } })} /></Field>
            <Field label="الدور"><SelectInput options={ROLES.map((r) => ({ value: r, label: r }))} value={modal.values.role || ROLES[0]} onChange={(e) => setModal({ ...modal, values: { ...modal.values, role: e.target.value, permissions: defaultPermissions(e.target.value) } })} /></Field>
            <Field label="رقم الجوال (لاستعادة كلمة المرور)"><TextInput value={modal.values.phone || ""} onChange={(e) => setModal({ ...modal, values: { ...modal.values, phone: e.target.value } })} /></Field>
            <Field label={modal.mode === "edit" ? "كلمة مرور جديدة (اتركه فارغًا للإبقاء على الحالية)" : "كلمة المرور"}><TextInput type="text" value={modal.values.password || ""} onChange={(e) => setModal({ ...modal, values: { ...modal.values, password: e.target.value } })} /></Field>
          </div>
          <Field label="الفروع المسموح بالدخول لها">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {data.branches.map((b) => <label key={b.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, border: `1px solid ${THEME.border}`, padding: "4px 10px", borderRadius: 16, cursor: "pointer" }}><input type="checkbox" checked={(modal.values.branches || []).includes(b.id)} onChange={() => toggleBranch(modal.values, b.id)} />{b.name}</label>)}
            </div>
          </Field>
          <Field label="صلاحيات الوصول التفصيلية">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "#EFE7D6" }}><th style={{ padding: "6px 10px", textAlign: "right" }}>الشاشة</th><th style={{ padding: "6px 10px" }}>عرض</th><th style={{ padding: "6px 10px" }}>تعديل</th></tr></thead>
                <tbody>
                  {ALL_MODULES.map((m) => (
                    <tr key={m} style={{ borderTop: `1px solid ${THEME.border}` }}>
                      <td style={{ padding: "6px 10px" }}>{moduleLabels[m]}</td>
                      <td style={{ padding: "6px 10px", textAlign: "center" }}><input type="checkbox" checked={!!modal.values.permissions?.[m]?.view} onChange={() => togglePerm(modal.values, m, "view")} /></td>
                      <td style={{ padding: "6px 10px", textAlign: "center" }}><input type="checkbox" checked={!!modal.values.permissions?.[m]?.edit} onChange={() => togglePerm(modal.values, m, "edit")} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Field>
          <div style={{ display: "flex", gap: 8 }}><Btn variant="brass" onClick={() => save(modal.values)}>حفظ</Btn><Btn variant="ghost" onClick={() => setModal(null)}>إلغاء</Btn></div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Shop Settings ----------
// ---------- Storage usage indicator ----------
const STORAGE_ESTIMATED_LIMIT = 5 * 1024 * 1024; // typical browser localStorage quota per origin
function StorageUsagePanel({ data }) {
  const [bytes, setBytes] = useState(0);
  useEffect(() => {
    try { setBytes(new Blob([JSON.stringify(data)]).size); } catch (e) { setBytes(0); }
  }, [data]);
  const pct = Math.min(100, Math.round((bytes / STORAGE_ESTIMATED_LIMIT) * 100));
  const color = pct > 85 ? THEME.red : pct > 60 ? "#C9A227" : THEME.teal;
  return (
    <Panel style={{ maxWidth: 640, marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span>مساحة التخزين المستخدمة بمتصفحك</span>
        <span>{(bytes / 1024 / 1024).toFixed(2)} ميجا تقريبًا ({pct}%)</span>
      </div>
      <div style={{ background: "#EFE7D6", height: 8, borderRadius: 4 }}><div style={{ width: `${pct}%`, background: color, height: 8, borderRadius: 4 }} /></div>
      {pct > 70 && <div style={{ fontSize: 11.5, color: THEME.red, marginTop: 6 }}>تحذير: المساحة قاربت على الامتلاء — قلّل الصور الكبيرة بدليل التصاميم أو المرفقات لتفادي فشل الحفظ.</div>}
    </Panel>
  );
}

function ShopSettingsView({ data, update, canEdit, backupApi, currentUser, isAdmin }) {
  const [values, setValues] = useState(data.shopSettings || {});
  const initialRef = useRef(data.shopSettings || {});
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const backupFileRef = useRef(null);

  const onLogoFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressImageDataUrl(reader.result, 480, 0.85);
      setValues((v) => ({ ...v, logo: compressed }));
      setLogoNow(compressed);                       // the logo applies to every invoice/voucher right away
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const setLogoNow = (logo) => { update({ shopSettings: { ...(latestShopRef.current || {}), logo } }); initialRef.current = { ...initialRef.current, logo }; };
  const latestShopRef = useRef(data.shopSettings);
  latestShopRef.current = data.shopSettings;
  // only the fields you actually edited are written, so a stale form can never undo something saved elsewhere (e.g. the logo)
  const save = () => {
    const changed = {}; Object.keys(values).forEach((k) => { if (!deepEq(values[k], initialRef.current[k])) changed[k] = values[k]; });
    update({ shopSettings: { ...(data.shopSettings || {}), ...changed } });
    initialRef.current = { ...values };
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `نسخة-احتياطية-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const importBackup = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!window.confirm("سيتم استبدال كل البيانات الحالية بمحتوى هذا الملف بالكامل. هل أنت متأكد؟")) return;
        update(parsed);
        alert("تم استيراد النسخة الاحتياطية بنجاح.");
      } catch (err) { alert("تعذّرت قراءة الملف — تأكد إنه ملف نسخة احتياطية صحيح."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  if (!canEdit) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><Store size={22} color={THEME.brass} /><h2 style={{ margin: 0, fontFamily: "Amiri, serif", fontSize: 26, color: THEME.ink }}>بيانات المحل والمؤسسة</h2></div>
        <Panel><EmptyState text="لا تملك صلاحية الوصول لهذه الشاشة — راجع مدير النظام." /></Panel>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><Store size={22} color={THEME.brass} /><h2 style={{ margin: 0, fontFamily: "Amiri, serif", fontSize: 26, color: THEME.ink }}>بيانات المحل والمؤسسة</h2></div>
      <Panel style={{ maxWidth: 640, marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>النسخ الاحتياطي</div>
        <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 10 }}>حمّل نسخة كاملة من كل بيانات النظام كملف على جهازك بشكل دوري — احتياط إضافي مستقل عن قاعدة البيانات السحابية.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="brass" onClick={exportBackup}><Printer size={14} />تصدير نسخة احتياطية</Btn>
          <Btn variant="ghost" onClick={() => backupFileRef.current.click()}><Upload size={14} />استيراد نسخة احتياطية</Btn>
          <input ref={backupFileRef} type="file" accept="application/json" onChange={importBackup} style={{ display: "none" }} />
        </div>
      </Panel>
      <StorageUsagePanel data={data} />
      <Panel style={{ maxWidth: 640 }}>
        <div style={{ fontWeight: 700, marginBottom: 14 }}>الشعار واسم المحل</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 8, border: `1px solid ${THEME.border}`, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", overflow: "hidden", flexShrink: 0 }}>
            {values.logo ? <img src={values.logo} alt="الشعار" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Store size={26} color="#B9AF9C" />}
          </div>
          <div>
            <Btn small variant="ghost" onClick={() => fileRef.current.click()}><Upload size={14} />رفع شعار</Btn>
            <input ref={fileRef} type="file" accept="image/*" onChange={onLogoFile} style={{ display: "none" }} />
            {values.logo && <span style={{ marginRight: 10, fontSize: 12.5, color: THEME.red, cursor: "pointer" }} onClick={() => { setValues({ ...values, logo: "" }); setLogoNow(""); }}>إزالة الشعار</span>}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="اسم المحل / الاسم التجاري"><TextInput value={values.name || ""} onChange={(e) => setValues({ ...values, name: e.target.value })} /></Field>
          <Field label="الاسم القانوني للمنشأة (اختياري إن اختلف)"><TextInput value={values.legalName || ""} onChange={(e) => setValues({ ...values, legalName: e.target.value })} /></Field>
          <Field label="رقم الجوال / الهاتف"><TextInput value={values.phone || ""} onChange={(e) => setValues({ ...values, phone: e.target.value })} /></Field>
          <Field label="رقم واتساب العملاء (اختياري)"><TextInput value={values.whatsapp || ""} onChange={(e) => setValues({ ...values, whatsapp: e.target.value })} /></Field>
          <Field label="المدينة"><TextInput value={values.city || ""} onChange={(e) => setValues({ ...values, city: e.target.value })} /></Field>
          <Field label="الموقع الإلكتروني (اختياري)"><TextInput value={values.website || ""} onChange={(e) => setValues({ ...values, website: e.target.value })} /></Field>
          <Field label="السجل التجاري"><TextInput value={values.crNumber || ""} onChange={(e) => setValues({ ...values, crNumber: e.target.value })} /></Field>
          <Field label="الرقم الضريبي (VAT)"><TextInput value={values.taxNumber || ""} onChange={(e) => setValues({ ...values, taxNumber: e.target.value })} /></Field>
        </div>
        <Field label="العنوان الكامل"><textarea rows={2} value={values.address || ""} onChange={(e) => setValues({ ...values, address: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} /></Field>

        <div style={{ fontWeight: 700, margin: "16px 0 10px" }}>بيانات الحساب البنكي (تظهر بالسندات والفواتير عند الحاجة للتحويل)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="اسم البنك"><TextInput value={values.bankName || ""} onChange={(e) => setValues({ ...values, bankName: e.target.value })} /></Field>
          <Field label="رقم الآيبان (IBAN)"><TextInput value={values.iban || ""} onChange={(e) => setValues({ ...values, iban: e.target.value })} /></Field>
        </div>
        <Field label="ملاحظة تظهر أسفل فاتورة العميل (اختياري)"><textarea rows={2} value={values.invoiceFooter || ""} onChange={(e) => setValues({ ...values, invoiceFooter: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} /></Field>

        <div style={{ fontWeight: 700, margin: "16px 0 6px" }}>نص إشعار واتساب عند جاهزية الطلب</div>
        <div style={{ fontSize: 11.5, color: "#8A8071", marginBottom: 6 }}>استخدم {"{name}"} لاسم العميل، {"{orderNo}"} لرقم الطلب، {"{shop}"} لاسم المحل، {"{trackLink}"} لرابط تتبع الطلب — تُستبدل تلقائيًا وقت الإرسال.</div>
        <Field label=""><textarea rows={3} value={values.readyMessageTemplate || ""} onChange={(e) => setValues({ ...values, readyMessageTemplate: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} /></Field>

        <div style={{ fontWeight: 700, margin: "16px 0 6px" }}>نص رسالة الشكر وطلب التقييم (تُرسل بعد التسليم)</div>
        <div style={{ fontSize: 11.5, color: "#8A8071", marginBottom: 6 }}>استخدم {"{name}"} و{"{reviewLink}"} (رابط تقييمك بجوجل مثلاً، حدده بالأسفل).</div>
        <Field label=""><textarea rows={2} value={values.thankYouMessageTemplate || ""} onChange={(e) => setValues({ ...values, thankYouMessageTemplate: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} /></Field>
        <Field label="رابط التقييم (اختياري — رابط تقييم Google للمحل)"><TextInput value={values.reviewLink || ""} onChange={(e) => setValues({ ...values, reviewLink: e.target.value })} placeholder="https://g.page/r/..." /></Field>

        <div style={{ fontWeight: 700, margin: "16px 0 6px" }}>نص تذكير المواعيد</div>
        <div style={{ fontSize: 11.5, color: "#8A8071", marginBottom: 6 }}>استخدم {"{name}"} و{"{date}"} و{"{time}"} و{"{shop}"}.</div>
        <Field label=""><textarea rows={2} value={values.reminderMessageTemplate || ""} onChange={(e) => setValues({ ...values, reminderMessageTemplate: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} /></Field>

        <div style={{ fontWeight: 700, margin: "16px 0 6px" }}>نص الاعتذار عن تأخير الطلب</div>
        <div style={{ fontSize: 11.5, color: "#8A8071", marginBottom: 6 }}>استخدم {"{name}"} و{"{orderNo}"} و{"{deliveryDate}"} و{"{trackLink}"} و{"{shop}"}.</div>
        <Field label=""><textarea rows={3} value={values.delayMessageTemplate ?? WA_NEW_DEFAULTS.delayMessageTemplate} onChange={(e) => setValues({ ...values, delayMessageTemplate: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} /></Field>

        <div style={{ fontWeight: 700, margin: "16px 0 6px" }}>نص تذكير المبلغ المتبقي</div>
        <div style={{ fontSize: 11.5, color: "#8A8071", marginBottom: 6 }}>استخدم {"{name}"} و{"{orderNo}"} و{"{balance}"} (المتبقي) و{"{shop}"}.</div>
        <Field label=""><textarea rows={2} value={values.balanceMessageTemplate ?? WA_NEW_DEFAULTS.balanceMessageTemplate} onChange={(e) => setValues({ ...values, balanceMessageTemplate: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} /></Field>

        <div style={{ fontWeight: 700, margin: "16px 0 10px" }}>ثيم ألوان النظام</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
          {Object.entries(PALETTES).map(([key, p]) => (
            <div key={key} onClick={() => setValues({ ...values, appTheme: key })} style={{ cursor: "pointer", border: (values.appTheme || "classic") === key ? `2px solid ${p.brass}` : `1px solid ${THEME.border}`, borderRadius: 8, padding: 10, width: 140, textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 4, marginBottom: 6 }}>
                <span style={{ width: 18, height: 18, borderRadius: "50%", background: p.ink }} />
                <span style={{ width: 18, height: 18, borderRadius: "50%", background: p.brass }} />
                <span style={{ width: 18, height: 18, borderRadius: "50%", background: p.teal }} />
              </div>
              <div style={{ fontSize: 12.5 }}>{p.label}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: "#8A8071", marginBottom: 6 }}>يغيّر الشكل العام للنظام كامل (الشريط الجانبي والألوان الأساسية) بعد الحفظ.</div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
          <Btn variant="brass" onClick={save}>حفظ البيانات</Btn>
          {saved && <span style={{ color: THEME.teal, fontSize: 13 }}>تم الحفظ ✓</span>}
        </div>
      </Panel>
      <PrintTemplatesPanel data={data} update={update} />
      {isAdmin && <ListsPanel data={data} update={update} />}
      {isAdmin && <FreedNumbersPanel data={data} update={update} />}
      {backupApi && <BackupPanel backupApi={backupApi} currentUser={currentUser} />}
    </div>
  );
}

// ---------- Backups (automatic daily + manual + restore) ----------
const BACKUP_KIND_LABEL = { auto: "تلقائية يومية", manual: "يدوية", prerestore: "قبل استرجاع" };
function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function BackupPanel({ backupApi, currentUser }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const cloudOk = !!(typeof window !== "undefined" && window.cloudBackups);
  const refresh = async () => {
    if (!cloudOk) { setRows([]); return; }
    try { setRows(await backupApi.list()); setError(""); }
    catch (e) { setRows([]); setError(e?.message || String(e)); }
  };
  useEffect(() => { refresh(); }, []);
  const kindOf = (r) => r.meta?.kind || (r.id.startsWith("backup-auto") ? "auto" : r.id.startsWith("backup-prerestore") ? "prerestore" : "manual");
  const createNow = async () => {
    setBusy("create");
    try { await backupApi.create("manual", currentUser); await refresh(); }
    catch (e) { setError(e?.message || String(e)); }
    setBusy("");
  };
  const restoreFrom = async (snap, label) => {
    const c = snap?.orders ? `${(snap.orders || []).length} طلب، ${(snap.customers || []).length} عميل، ${(snap.vouchers || []).length} سند` : "";
    if (!window.confirm(`استرجاع النسخة: ${label}\n${c}\n\nسيتم استبدال كل بيانات المحل الحالية بهذه النسخة (مع حفظ نسخة من الوضع الحالي قبل الاسترجاع، وأرقام الفواتير والسندات لن ترجع للخلف). متابعة؟`)) return;
    setBusy("restore");
    try {
      if (cloudOk) { try { await backupApi.create("prerestore", currentUser); } catch (e) { if (!window.confirm("تعذّر حفظ نسخة من الوضع الحالي قبل الاسترجاع. المتابعة بدونها؟")) { setBusy(""); return; } } }
      await backupApi.restore(snap);
    } catch (e) { setError(e?.message || String(e)); setBusy(""); }
  };
  const restoreCloud = async (r) => {
    setBusy(r.id);
    try { const payload = await backupApi.get(r.id); setBusy(""); await restoreFrom(payload.snapshot || payload, new Date(r.meta?.createdAt || r.updated_at).toLocaleString("ar-SA")); }
    catch (e) { setError(e?.message || String(e)); setBusy(""); }
  };
  const downloadCloud = async (r) => {
    setBusy(r.id);
    try { const payload = await backupApi.get(r.id); downloadJson(`${r.id}.json`, payload); } catch (e) { setError(e?.message || String(e)); }
    setBusy("");
  };
  const removeCloud = async (r) => {
    if (!window.confirm("حذف هذه النسخة الاحتياطية نهائيًا؟")) return;
    setBusy(r.id);
    try { await backupApi.remove(r.id); await refresh(); } catch (e) { setError(e?.message || String(e)); }
    setBusy("");
  };
  const downloadNow = () => { const snap = backupApi.current(); if (snap) downloadJson(`tailor-shop-backup-${todayStr()}.json`, { meta: { kind: "manual", createdAt: new Date().toISOString(), by: currentUser }, snapshot: snap }); };
  const pickFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { const obj = JSON.parse(reader.result); const snap = obj.snapshot || obj; if (!snap || !Array.isArray(snap.orders) || !Array.isArray(snap.customers)) { alert("الملف ليس نسخة احتياطية صالحة لهذا البرنامج"); return; } restoreFrom(snap, `ملف ${file.name}`); }
      catch (err) { alert("تعذّر قراءة الملف: " + err.message); }
    };
    reader.readAsText(file); e.target.value = "";
  };
  const newestAuto = (rows || []).find((r) => kindOf(r) === "auto");
  const ageDays = newestAuto ? (Date.now() - new Date(newestAuto.meta?.createdAt || newestAuto.updated_at).getTime()) / 86400000 : null;
  return (
    <Panel style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>النسخ الاحتياطي والاسترجاع</div>
      <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 12 }}>
        تؤخذ نسخة تلقائية مرة كل يوم عند فتح البرنامج (نحتفظ بآخر 7)، ويمكنك أخذ نسخة يدوية (آخر 5) أو تنزيل نسخة على جهازك. الاسترجاع يحفظ أولًا نسخة من الوضع الحالي.
      </div>
      {!cloudOk && <div style={{ background: "#FFF4E0", border: "1px solid #E8C98A", padding: 10, borderRadius: 6, fontSize: 13, marginBottom: 10 }}>النسخ السحابية غير متاحة في هذا الإصدار من الاتصال. استخدم التنزيل والرفع من ملف.</div>}
      {error && <div style={{ background: "#FCEBEB", border: "1px solid #E5A5A5", padding: 10, borderRadius: 6, fontSize: 13, marginBottom: 10 }}>تعذّر الوصول لنسخ السحابة: {error}<div style={{ marginTop: 4 }}>إن كان الخطأ صلاحيات، نفّذ ما في ملف <b>SUPABASE_BACKUP_SETUP.md</b> مرة واحدة في Supabase. وفي الأثناء يمكنك استخدام «تنزيل نسخة الآن».</div></div>}
      {cloudOk && !error && rows && (ageDays === null || ageDays > 2) && <div style={{ background: "#FFF4E0", border: "1px solid #E8C98A", padding: 10, borderRadius: 6, fontSize: 13, marginBottom: 10 }}>{ageDays === null ? "لا توجد نسخة تلقائية بعد." : "آخر نسخة تلقائية قبل أكثر من يومين."} تُؤخذ تلقائيًا عند فتح البرنامج؛ يمكنك أخذ نسخة يدوية الآن.</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {cloudOk && <Btn variant="brass" onClick={createNow} disabled={!!busy}>{busy === "create" ? "جارٍ الحفظ…" : "نسخة احتياطية الآن"}</Btn>}
        <Btn variant="ghost" onClick={downloadNow}>تنزيل نسخة على جهازي</Btn>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", border: `1px solid ${THEME.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 14, background: "#fff" }}><Upload size={14} />استرجاع من ملف<input type="file" accept=".json,application/json" onChange={pickFile} style={{ display: "none" }} /></label>
      </div>
      {cloudOk && (rows === null ? <div style={{ fontSize: 13 }}>جارٍ التحميل…</div> : rows.length === 0 ? <EmptyState text="لا توجد نسخ محفوظة في السحابة بعد" /> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#EFE7D6" }}><th style={{ padding: 8, textAlign: "right" }}>التاريخ</th><th style={{ padding: 8, textAlign: "right" }}>النوع</th><th style={{ padding: 8, textAlign: "right" }}>المحتوى</th><th style={{ padding: 8 }}></th></tr></thead>
          <tbody>
            {rows.map((r) => { const m = r.meta || {}; const c = m.counts || {}; return (
              <tr key={r.id} style={{ borderTop: `1px solid ${THEME.border}` }}>
                <td style={{ padding: 8 }}>{new Date(m.createdAt || r.updated_at).toLocaleString("ar-SA")}</td>
                <td style={{ padding: 8 }}><Badge color={kindOf(r) === "auto" ? THEME.teal : THEME.brass}>{BACKUP_KIND_LABEL[kindOf(r)]}</Badge>{m.by ? <span style={{ fontSize: 11.5, color: "#8A8071" }}> {m.by}</span> : null}</td>
                <td style={{ padding: 8, fontSize: 12 }}>{c.orders ?? "—"} طلب · {c.customers ?? "—"} عميل · {c.vouchers ?? "—"} سند</td>
                <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                  <Btn small variant="ghost" disabled={!!busy} onClick={() => restoreCloud(r)}>استرجاع</Btn>{" "}
                  <Btn small variant="ghost" disabled={!!busy} onClick={() => downloadCloud(r)}>تنزيل</Btn>{" "}
                  <Btn small variant="danger" disabled={!!busy} onClick={() => removeCloud(r)}>حذف</Btn>
                </td>
              </tr>); })}
          </tbody>
        </table>
      ))}
    </Panel>
  );
}

// ---------- Reports ----------
function ReportsView({ data }) {
  const topCustomers = [...data.customers].map((c) => ({ ...c, count: data.orders.filter((o) => o.customerId === c.id && !o.cancelled).length, spend: data.orders.filter((o) => o.customerId === c.id && !o.cancelled).reduce((s, o) => s + (Number(o.price) || 0), 0) })).sort((a, b) => b.spend - a.spend).slice(0, 5);
  const roleCounts = {}; data.employees.forEach((e) => { roleCounts[e.role] = (roleCounts[e.role] || 0) + 1; });

  // Last 12 months of order volume — helps spot seasonal peaks (Ramadan/Eid) year over year.
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("ar-SA", { month: "short", year: "2-digit" }) });
  }
  const seasonalData = months.map((m) => {
    const monthOrders = data.orders.filter((o) => !o.cancelled && (o.createdAt || "").startsWith(m.key));
    return { name: m.label, الطلبات: monthOrders.length, "المبيعات (ر.س)": monthOrders.reduce((s, o) => s + (Number(o.price) || 0), 0) };
  });

  return (
    <div>
      <h2 style={{ fontFamily: "Amiri, serif", fontSize: 28, color: THEME.ink, marginTop: 0 }}>التقارير</h2>
      <FinanceCharts data={data} />
      <Panel style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>الاتجاه الموسمي — آخر 12 شهر</div>
        <div style={{ fontSize: 11.5, color: "#8A8071", marginBottom: 10 }}>يساعدك تتوقع فترات الذروة (رمضان، العيد) وتستعد لها بموظفين ومخزون أكثر مسبقًا.</div>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={seasonalData}>
              <CartesianGrid strokeDasharray="3 3" stroke={THEME.border} />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar dataKey="الطلبات" fill={THEME.brass} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <PnLReport data={data} />
      <EmployeePerformance data={data} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <Panel><div style={{ fontWeight: 700, marginBottom: 10 }}>أفضل 5 عملاء (حسب الإنفاق)</div>{topCustomers.length === 0 ? <EmptyState text="لا توجد بيانات" /> : topCustomers.map((c) => <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px dashed ${THEME.border}`, fontSize: 13.5 }}><span>{c.name}</span><span>{c.spend.toLocaleString()} ر.س — {c.count} طلب</span></div>)}</Panel>
        <Panel><div style={{ fontWeight: 700, marginBottom: 10 }}>الموظفون حسب الدور</div>{Object.keys(roleCounts).length === 0 ? <EmptyState text="لا توجد بيانات" /> : Object.entries(roleCounts).map(([role, count]) => <div key={role} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px dashed ${THEME.border}`, fontSize: 13.5 }}><span>{role}</span><span>{count}</span></div>)}</Panel>
      </div>
    </div>
  );
}

// ---------- Public order tracking (no login required) ----------
function TrackOrderPage({ data, orderNo }) {
  const order = data.orders.find((o) => String(o.orderNo) === String(orderNo));
  const stageIdx = order ? data.orderStages.indexOf(order.stage) : -1;
  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: THEME.parchment, fontFamily: "Tajawal, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&family=Amiri:wght@700&display=swap');`}</style>
      <div style={{ width: 420, maxWidth: "100%", background: THEME.panel, border: `1px solid ${THEME.border}`, borderTop: `3px solid ${THEME.brass}`, borderRadius: 10, padding: 26 }}>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          {data.shopSettings?.logo && <img src={data.shopSettings.logo} alt="" style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />}
          <div style={{ fontFamily: "Amiri, serif", fontSize: 22, color: THEME.ink }}>{data.shopSettings?.name || "مشغل الخياطة"}</div>
          <div style={{ fontSize: 12.5, color: "#7A7061" }}>تتبع حالة الطلب</div>
        </div>
        {!order ? (
          <div style={{ textAlign: "center", color: THEME.red, padding: 20 }}>لم يتم العثور على طلب بهذا الرقم.</div>
        ) : (
          <>
            <div style={{ textAlign: "center", fontWeight: 700, fontSize: 17, marginBottom: 4, color: THEME.brass }}>طلب #{order.orderNo}</div>
            {order.cancelled ? (
              <div style={{ textAlign: "center", color: THEME.red, fontWeight: 700, padding: "10px 0" }}>هذا الطلب مُلغى</div>
            ) : (
              <>
                <div style={{ textAlign: "center", fontSize: 13, color: "#7A7061", marginBottom: 18 }}>موعد التسليم المتوقع: {order.deliveryDate || "غير محدد"}</div>
                <div>
                  {data.orderStages.map((s, i) => (
                    <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: i <= stageIdx ? THEME.teal : "#EFE7D6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {i <= stageIdx && <Check size={13} color="#fff" />}
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: i === stageIdx ? 700 : 400, color: i <= stageIdx ? THEME.ink : "#B9AF9C" }}>{s}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LoginScreen({ data, update, onLogin }) {
  const [mode, setMode] = useState("login"); // login | forgot | reset
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [foundUser, setFoundUser] = useState(null);

  const submitLogin = async () => {
    const user = data.users.find((u) => u.username === username.trim());
    if (!user) { setError("اسم المستخدم أو كلمة المرور غير صحيحة"); return; }
    if (user.lockedUntil && Date.now() < user.lockedUntil) {
      const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      setError(`تم قفل الحساب مؤقتًا بسبب محاولات فاشلة متكررة — حاول بعد ${mins} دقيقة تقريبًا.`);
      return;
    }
    const ok = await verifyPassword(password, user.password);
    if (ok) {
      setError("");
      let patch = { users: data.users.map((u) => u.id === user.id ? { ...u, failedAttempts: 0, lockedUntil: null } : u) };
      if (!looksHashed(user.password)) {
        const hash = await hashPassword(password);
        patch = { users: patch.users.map((u) => u.id === user.id ? { ...u, password: hash } : u) };
      }
      update(patch);
      onLogin(user.id);
    } else {
      const attempts = (user.failedAttempts || 0) + 1;
      const lockedUntil = attempts >= 5 ? Date.now() + 5 * 60000 : null;
      update({ users: data.users.map((u) => u.id === user.id ? { ...u, failedAttempts: lockedUntil ? 0 : attempts, lockedUntil } : u) });
      setError(lockedUntil ? "محاولات فاشلة كثيرة — تم قفل الحساب 5 دقائق." : "اسم المستخدم أو كلمة المرور غير صحيحة");
    }
  };
  const submitForgot = () => {
    const user = data.users.find((u) => u.username === username.trim() && (u.phone || "").trim() && (u.phone || "").trim() === phone.trim());
    if (user) { setFoundUser(user); setError(""); setMode("reset"); }
    else setError("لا يوجد مستخدم بهذا الاسم ورقم الجوال معًا — تأكد من تسجيل رقم الجوال مسبقًا من قسم المستخدمين");
  };
  const submitReset = async () => {
    if (newPassword.trim().length < 4) { setError("كلمة المرور قصيرة جدًا — 4 أحرف على الأقل"); return; }
    const hash = await hashPassword(newPassword.trim());
    const users = data.users.map((u) => u.id === foundUser.id ? { ...u, password: hash, failedAttempts: 0, lockedUntil: null } : u);
    update({ users });
    onLogin(foundUser.id);
  };

  return (
    <div dir="rtl" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: THEME.parchment, fontFamily: "Tajawal, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&family=Amiri:wght@700&display=swap');`}</style>
      <div style={{ width: 360, maxWidth: "90vw", background: THEME.panel, border: `1px solid ${THEME.border}`, borderTop: `3px solid ${THEME.brass}`, borderRadius: 10, padding: 28 }}>
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          {data.shopSettings?.logo && <img src={data.shopSettings.logo} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />}
          <div style={{ fontFamily: "Amiri, serif", fontSize: 24, color: THEME.ink }}>{data.shopSettings?.name || "مشغل الخياطة"}</div>
        </div>
        <div style={{ textAlign: "center", fontSize: 12.5, color: "#7A7061", marginBottom: 22 }}>نظام الإدارة الشامل</div>

        {mode === "login" && (
          <>
            <Field label="اسم المستخدم"><TextInput value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
            <Field label="كلمة المرور"><TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitLogin()} /></Field>
            {error && <div style={{ color: THEME.red, fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <Btn variant="brass" onClick={submitLogin} style={{ width: "100%", justifyContent: "center" }}>دخول</Btn>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <span style={{ fontSize: 13, color: THEME.brass, cursor: "pointer" }} onClick={() => { setMode("forgot"); setError(""); }}>نسيت كلمة المرور؟</span>
            </div>
          </>
        )}

        {mode === "forgot" && (
          <>
            <div style={{ fontSize: 12.5, color: "#7A7061", marginBottom: 12 }}>أدخل اسم المستخدم ورقم الجوال المسجّل على حسابك لاستعادة الدخول.</div>
            <Field label="اسم المستخدم"><TextInput value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
            <Field label="رقم الجوال المسجّل"><TextInput value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            {error && <div style={{ color: THEME.red, fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <Btn variant="brass" onClick={submitForgot} style={{ width: "100%", justifyContent: "center" }}>تحقّق</Btn>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <span style={{ fontSize: 13, color: THEME.teal, cursor: "pointer" }} onClick={() => { setMode("login"); setError(""); }}>رجوع لتسجيل الدخول</span>
            </div>
          </>
        )}

        {mode === "reset" && foundUser && (
          <>
            <div style={{ fontSize: 13, color: THEME.teal, marginBottom: 12 }}>تم التحقق — عيّن كلمة مرور جديدة لحساب {foundUser.name}</div>
            <Field label="كلمة المرور الجديدة"><TextInput type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></Field>
            {error && <div style={{ color: THEME.red, fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <Btn variant="brass" onClick={submitReset} style={{ width: "100%", justifyContent: "center" }}>حفظ كلمة المرور والدخول</Btn>
          </>
        )}

        <div style={{ marginTop: 18, fontSize: 11, color: "#8A8071", textAlign: "center" }}>
          ملاحظة: بيانات الدخول محفوظة داخل تخزين هذا النظام فقط، وليست بديلاً عن نظام مصادقة مركزي حقيقي لبيانات حسّاسة جدًا.
        </div>
      </div>
    </div>
  );
}

// ---------- App shell ----------
const NAV = [
  { id: "dashboard", label: "لوحة التحكم", icon: LayoutDashboard },
  { id: "customers", label: "إدارة العملاء", icon: Users },
  { id: "orders", label: "إدارة الطلبات", icon: ShoppingBag },
  { id: "courier", label: "شاشة المراسل", icon: ScanLine },
  { id: "appointments", label: "المواعيد", icon: CalendarClock },
  { id: "designs", label: "دليل التصاميم", icon: Shirt },
  { id: "invoices", label: "الفواتير", icon: Receipt },
  { id: "employees", label: "الموظفون", icon: Briefcase },
  { id: "suppliers", label: "المشتريات والموردون", icon: Truck },
  { id: "inventory", label: "المخزون", icon: Package },
  { id: "returns", label: "المرتجعات والتعديلات", icon: RotateCcw },
  { id: "finance", label: "الإدارة المالية", icon: Wallet },
  { id: "users", label: "المستخدمون والنظام", icon: ShieldCheck },
  { id: "settings", label: "بيانات المحل", icon: Store },
  { id: "reports", label: "التقارير", icon: BarChart3 },
];

export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [sessionUserId, setSessionUserId] = useState(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [hasPendingSync, setHasPendingSync] = useState(false);
  const [pwModal, setPwModal] = useState(null);
  const dataForSyncRef = useRef(null);
  const latestRef = useRef(null);   // newest local state (updates are applied to this, never to a stale render)
  const baseRef = useRef(null);     // last state known to be in the cloud (merge base)
  const saveChain = useRef(Promise.resolve());
  const savingRef = useRef(0);

  // Serialised, merge-safe save (see mergeData). Every call saves whatever latestRef holds when its turn comes.
  const persist = () => {
    savingRef.current += 1;
    saveChain.current = saveChain.current.then(async () => {
      try {
        if (typeof navigator !== "undefined" && !navigator.onLine) { setHasPendingSync(true); return; }
        let cloud = null;
        try { const r = await window.storage.get(STORAGE_KEY); cloud = JSON.parse(r.value); } catch (e) { cloud = null; }
        let merged = latestRef.current, notes = [];
        if (cloud && baseRef.current) {
          const dd = dedupeNumbers(mergeData(baseRef.current, latestRef.current, cloud), cloud);
          merged = normalizeCounters(dd.data); notes = dd.notes;
        }
        latestRef.current = merged; dataForSyncRef.current = merged; setData(merged);
        await window.storage.set(STORAGE_KEY, JSON.stringify(merged), false);
        baseRef.current = merged; setHasPendingSync(false);
        if (notes.length) alert("تنبيه: كان جهاز آخر قد استخدم نفس الرقم في نفس اللحظة، فتم ترقيم المستند الجديد برقم تالٍ:\n" + notes.join("\n"));
      } catch (e) {
        if (typeof navigator !== "undefined" && !navigator.onLine) { setHasPendingSync(true); return; }
        alert("⚠ فشل حفظ آخر تغيير بشكل دائم!\nتفاصيل الخطأ: " + (e?.message || String(e)) + "\nالتغيير ظاهر لك الآن مؤقتًا لكن قد يختفي عند إعادة تحميل الصفحة.");
      } finally { savingRef.current -= 1; }
    });
    return saveChain.current;
  };

  React.useEffect(() => {
    const goOnline = () => { setIsOnline(true); if (latestRef.current) persist(); };
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY); const parsed = JSON.parse(res.value);
        baseRef.current = JSON.parse(res.value);
        if (!parsed.journalEntries) parsed.journalEntries = [];
        if (!parsed.appointments) parsed.appointments = [];
        if (!parsed.shopSettings) parsed.shopSettings = seedData().shopSettings;
        else {
          const seedSettings = seedData().shopSettings;
          if (!parsed.shopSettings.readyMessageTemplate) parsed.shopSettings.readyMessageTemplate = seedSettings.readyMessageTemplate;
          if (!parsed.shopSettings.thankYouMessageTemplate) parsed.shopSettings.thankYouMessageTemplate = seedSettings.thankYouMessageTemplate;
          if (!parsed.shopSettings.reminderMessageTemplate) parsed.shopSettings.reminderMessageTemplate = seedSettings.reminderMessageTemplate;
          if (parsed.shopSettings.reviewLink === undefined) parsed.shopSettings.reviewLink = "";
        }
        if (!parsed.fabricThresholds) parsed.fabricThresholds = {};
        parsed.freedCustomerCodes = [];
        if (!parsed.embroideryTypes) parsed.embroideryTypes = seedData().embroideryTypes;
        else if (parsed.embroideryTypes.length && typeof parsed.embroideryTypes[0] === "string") parsed.embroideryTypes = parsed.embroideryTypes.map((n) => ({ id: uid("emb"), name: n }));
        if (!parsed.counters) parsed.counters = { customer: 1000, order: 1000, group: 1000 };
        else if (parsed.counters.group === undefined) parsed.counters.group = 1000;
        if (!parsed.orderGroups) parsed.orderGroups = [];
        if (!parsed.auditLog) parsed.auditLog = [];
        if (parsed.customers) { let c = parsed.counters.customer; parsed.customers = parsed.customers.map((cu) => cu.code ? cu : (c += 1, { ...cu, code: c })); parsed.counters.customer = c; }
        if (parsed.orders) { let o = parsed.counters.order; parsed.orders = parsed.orders.map((ord) => ord.orderNo ? ord : (o += 1, { ...ord, orderNo: o })); parsed.counters.order = o; }
        if (parsed.counters.purchase === undefined) parsed.counters.purchase = 1000;
        if (parsed.purchases) { let p = parsed.counters.purchase; parsed.purchases = parsed.purchases.map((pur) => pur.purchaseNo ? pur : (p += 1, { ...pur, purchaseNo: p })); parsed.counters.purchase = p; }
        if (!parsed.employeeLedger) parsed.employeeLedger = [];
        parsed.shopSettings = { ...WA_NEW_DEFAULTS, ...(parsed.shopSettings || {}) };
        if (!parsed.freedNumbers) parsed.freedNumbers = {};
        if (!parsed.returns) parsed.returns = [];
        if (!parsed.closedPeriods) parsed.closedPeriods = [];
        parsed.users = (parsed.users || []).map((u) => u.permissions && !u.permissions.returns ? { ...u, permissions: { ...u.permissions, returns: u.role === "مدير عام" ? { view: true, edit: true } : { ...(u.permissions.orders || { view: false, edit: false }) } } } : u);
        if (!parsed.stockAdjustments) parsed.stockAdjustments = [];
        if (!parsed.consumptionRules) parsed.consumptionRules = [];
        if (!parsed.inventoryItems) {
          // first run: build the catalog from what was already purchased (fabric alert thresholds carry over)
          const seen = new Map();
          (parsed.purchases || []).forEach((pu) => { const k = normName(pu.item); if (k && Number(pu.qty) > 0 && !seen.has(k)) seen.set(k, { id: uid("inv"), name: String(pu.item).trim(), category: pu.category || "أخرى", unit: pu.unit || "", minQty: Number(parsed.fabricThresholds?.[pu.item]) || 0 }); });
          parsed.inventoryItems = [...seen.values()];
        }
        parsed.users = (parsed.users || []).map((u) => u.permissions && !u.permissions.inventory ? { ...u, permissions: { ...u.permissions, inventory: u.role === "مدير عام" ? { view: true, edit: true } : { ...(u.permissions.suppliers || { view: false, edit: false }) } } } : u);
        if (!parsed.printSettings) parsed.printSettings = { defaults: { invoice: ["classic", "modern", "minimal", "elegant"].includes(parsed.invoiceTheme) ? parsed.invoiceTheme : "classic" }, customTemplates: [] };
        else { parsed.printSettings.defaults = parsed.printSettings.defaults || {}; parsed.printSettings.customTemplates = parsed.printSettings.customTemplates || []; }
        if (!parsed.vouchers) parsed.vouchers = [];
        if (parsed.counters.voucher === undefined) parsed.counters.voucher = 1000;
        if (parsed.counters.journal === undefined) parsed.counters.journal = 1000;
        if (parsed.counters.empEntry === undefined) parsed.counters.empEntry = 5000;
        { let vn = parsed.counters.voucher; parsed.vouchers = parsed.vouchers.map((v) => v.voucherNo ? v : (vn += 1, { ...v, voucherNo: vn })); parsed.counters.voucher = vn; }
        { let jn = parsed.counters.journal; parsed.journalEntries = parsed.journalEntries.map((j) => j.journalNo ? j : (jn += 1, { ...j, journalNo: jn })); parsed.counters.journal = jn; }
        if (parsed.users) parsed.users = parsed.users.map((u) => u.permissions && u.permissions.settings ? u : { ...u, permissions: { ...u.permissions, settings: u.role === "مدير عام" ? { view: true, edit: true } : { view: false, edit: false } } });
        const loaded = normalizeCounters(parsed);
        latestRef.current = loaded; dataForSyncRef.current = loaded;
        setData(loaded);
      }
      catch (e) { const seed = seedData(); latestRef.current = seed; setData(seed); }
      try { const s = await window.storage.get(SESSION_KEY); const parsed = JSON.parse(s.value); setSessionUserId(parsed.userId || null); }
      catch (e) { setSessionUserId(null); }
      setSessionLoaded(true);
    })();
  }, []);

  const update = (patch) => {
    const next = normalizeCounters({ ...(latestRef.current || data), ...patch });
    latestRef.current = next; dataForSyncRef.current = next;
    setData(next);
    return persist();
  };

  const handleLogin = (userId) => {
    setSessionUserId(userId);
    window.storage.set(SESSION_KEY, JSON.stringify({ userId }), false).catch(() => {});
    const prev = latestRef.current;
    if (prev) {
      const now = new Date().toLocaleString("ar-SA");
      const next = { ...prev, users: prev.users.map((u) => u.id === userId ? { ...u, loginCount: (u.loginCount || 0) + 1, lastLogin: now, lastSeen: new Date().toISOString() } : u) };
      latestRef.current = next; dataForSyncRef.current = next; setData(next);
      persist();
    }
  };
  const handleLogout = () => {
    setSessionUserId(null);
    window.storage.set(SESSION_KEY, JSON.stringify({ userId: null }), false).catch(() => {});
  };

  // Heartbeat: marks the current user as "online" while the app stays open.
  React.useEffect(() => {
    if (!sessionUserId) return;
    const beat = () => {
      const prev = latestRef.current; if (!prev) return;
      const next = { ...prev, users: prev.users.map((u) => u.id === sessionUserId ? { ...u, lastSeen: new Date().toISOString() } : u) };
      latestRef.current = next; dataForSyncRef.current = next; setData(next);
      persist();
    };
    const interval = setInterval(beat, 60000);
    return () => clearInterval(interval);
  }, [sessionUserId]);

  // Periodically pull the shared data fresh from the cloud so multiple people
  // using the system at the same time see each other's changes, instead of
  // only finding out on a full page reload.
  React.useEffect(() => {
    if (!sessionUserId) return;
    const interval = setInterval(async () => {
      if (hasPendingSync || savingRef.current > 0) return;
      try {
        const res = await window.storage.get(STORAGE_KEY);
        const cloud = JSON.parse(res.value);
        if (savingRef.current > 0 || !latestRef.current) return;
        if (baseRef.current && deepEq(cloud, baseRef.current)) return;
        const merged = normalizeCounters(mergeData(baseRef.current, latestRef.current, cloud));
        baseRef.current = cloud;
        if (!deepEq(merged, latestRef.current)) { latestRef.current = merged; dataForSyncRef.current = merged; setData(merged); }
      } catch (e) { /* ignore transient errors */ }
    }, 25000);
    return () => clearInterval(interval);
  }, [sessionUserId, hasPendingSync]);

  // ---- Backups (cloud copies live in extra rows of the same Supabase table; see main.jsx) ----
  const BACKUP_LIMITS = { auto: 7, manual: 5, prerestore: 3 };
  const backupApi = {
    current: () => latestRef.current,
    async create(kind = "manual", by = "") {
      const snap = latestRef.current; if (!snap) throw new Error("لا توجد بيانات للنسخ");
      if (!window.cloudBackups) throw new Error("النسخ السحابية غير متاحة");
      const id = kind === "auto" ? `backup-auto-${todayStr()}` : `backup-${kind}-${Date.now()}`;
      const count = (k) => (snap[k] || []).length;
      const meta = { kind, by, createdAt: new Date().toISOString(), counts: { orders: count("orders"), customers: count("customers"), vouchers: count("vouchers"), employees: count("employees"), suppliers: count("suppliers"), purchases: count("purchases") } };
      await window.cloudBackups.put(id, { meta, snapshot: snap });
      try { await backupApi.prune(); } catch (e) { /* pruning is best-effort */ }
      return id;
    },
    list: () => window.cloudBackups.list(),
    get: (id) => window.cloudBackups.get(id),
    remove: (id) => window.cloudBackups.remove(id),
    async prune() {
      const rows = await window.cloudBackups.list(); const seen = {};
      for (const r of rows) {
        const kind = r.meta?.kind || (r.id.startsWith("backup-auto") ? "auto" : r.id.startsWith("backup-prerestore") ? "prerestore" : "manual");
        seen[kind] = (seen[kind] || 0) + 1;
        if (seen[kind] > (BACKUP_LIMITS[kind] || 5)) await window.cloudBackups.remove(r.id);
      }
    },
    // Replaces the shop data with a snapshot. Counters never go backwards, so numbers already issued are not reused.
    async restore(snap) {
      const cur = latestRef.current || {};
      const counters = { ...(snap.counters || {}) };
      Object.keys(cur.counters || {}).forEach((k) => { counters[k] = Math.max(Number(counters[k]) || 0, Number(cur.counters[k]) || 0); });
      const next = normalizeCounters({ ...snap, counters });
      latestRef.current = next; dataForSyncRef.current = next; baseRef.current = null; setData(next);
      await persist();
      // persist() sets baseRef only after a successful cloud write — never reload (and lose the restore) if it failed.
      if (!baseRef.current) throw new Error("تعذّر حفظ البيانات المسترجَعة في السحابة. لم يتم الاسترجاع، تحقق من الاتصال وأعد المحاولة.");
      window.location.reload();
    },
  };
  React.useEffect(() => {
    if (!sessionUserId) return;
    let stopped = false;
    const run = async () => {
      try {
        if (stopped || !window.cloudBackups || !latestRef.current || (typeof navigator !== "undefined" && !navigator.onLine)) return;
        const rows = await window.cloudBackups.list();
        if (rows.some((r) => r.id === `backup-auto-${todayStr()}`)) return;
        await backupApi.create("auto", "تلقائي");
      } catch (e) { /* shown in Settings → النسخ الاحتياطي */ }
    };
    const t = setTimeout(run, 20000); const i = setInterval(run, 3600000);
    return () => { stopped = true; clearTimeout(t); clearInterval(i); };
  }, [sessionUserId]);

  if (!data || !sessionLoaded) return <div style={{ padding: 40, fontFamily: "Tajawal, sans-serif" }}>جارِ التحميل...</div>;
  applyTheme(data.shopSettings?.appTheme);

  const trackOrderNo = new URLSearchParams(window.location.search).get("track");
  if (trackOrderNo) return <TrackOrderPage data={data} orderNo={trackOrderNo} />;

  const activeUser = data.users.find((u) => u.id === sessionUserId);
  if (!activeUser) return <LoginScreen data={data} update={update} onLogin={handleLogin} />;

  const isAdmin = activeUser.role === "مدير عام";   // the system admin has every permission on every screen, always
  const visibleTabs = NAV.filter((n) => isAdmin || activeUser.permissions?.[n.id]?.view);
  const effectiveTab = visibleTabs.some((v) => v.id === tab) ? tab : (visibleTabs[0]?.id || "dashboard");
  const canEdit = isAdmin || !!activeUser.permissions?.[effectiveTab]?.edit;

  const allowedBranches = userBranchScope(data, activeUser);
  const sdata = { ...(allowedBranches ? scopeData(data, allowedBranches) : data), _isAdmin: isAdmin };
  const supdate = allowedBranches ? (patch) => update(mergeScopedPatch(latestRef.current || data, allowedBranches, patch)) : update;
  const views = {
    dashboard: <Dashboard data={sdata} update={supdate} canEdit={canEdit} />,
    customers: <CustomersView data={sdata} update={supdate} canEdit={canEdit} currentUser={activeUser.name} />,
    orders: <OrdersView data={sdata} update={supdate} canEdit={canEdit} currentUser={activeUser.name} currentUserRole={activeUser.role} />,
    courier: <CourierView data={sdata} update={supdate} canEdit={canEdit} />,
    appointments: <AppointmentsView data={sdata} update={supdate} canEdit={canEdit} />,
    designs: <DesignsView data={data} update={update} canEdit={canEdit} />,
    invoices: <InvoicesView data={sdata} update={supdate} />,
    employees: <EmployeesView data={sdata} update={supdate} canEdit={canEdit} currentUser={activeUser.name} />,
    suppliers: <SuppliersView data={sdata} update={supdate} canEdit={canEdit} />,
    inventory: <InventoryView data={sdata} update={supdate} canEdit={canEdit} currentUser={activeUser.name} />,
    returns: <ReturnsView data={sdata} update={supdate} canEdit={canEdit} currentUser={activeUser.name} />,
    finance: <FinanceView data={sdata} update={supdate} canEdit={canEdit} currentUser={activeUser.name} />,
    users: <UsersView data={data} update={update} canEdit={canEdit} currentUser={activeUser.name} isAdmin={isAdmin} />,
    settings: <ShopSettingsView data={data} update={update} canEdit={canEdit} backupApi={backupApi} currentUser={activeUser.name} isAdmin={isAdmin} />,
    reports: <ReportsView data={sdata} />,
  };

  return (
    <div className="app-root" dir="rtl" style={{ fontFamily: "Tajawal, sans-serif", background: THEME.parchment, minHeight: "100vh", color: THEME.ink }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&family=Amiri:wght@400;700&family=Cairo:wght@400;600;700&display=swap'); * { box-sizing: border-box; }
        @page { size: A4; margin: 0; }
        @media print {
          html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body * { visibility: hidden; }
          .printable, .printable * { visibility: visible; }
          .app-root { height: 0 !important; min-height: 0 !important; overflow: hidden !important; }
          .modal-overlay, .modal-box, .print-stage { position: static !important; overflow: visible !important; padding: 0 !important; background: none !important; border: none !important; max-width: none !important; }
          .printable { position: absolute !important; top: 0; right: 0; left: 0; width: 210mm !important; margin: 0 !important; box-shadow: none !important; overflow: visible !important; }
          .no-print { display: none !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
        }
      `}</style>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <div style={{ width: 240, background: THEME.ink, color: THEME.parchment, padding: "22px 14px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, paddingRight: 6 }}>
            {data.shopSettings?.logo && <img src={data.shopSettings.logo} alt="" style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 6 }} />}
            <div style={{ fontFamily: "Amiri, serif", fontSize: 20, lineHeight: 1.2 }}>{data.shopSettings?.name || "مشغل الخياطة"}</div>
          </div>
          <div style={{ fontSize: 11.5, color: "#B9AF9C", marginBottom: 18, paddingRight: 6 }}>نظام الإدارة الشامل</div>
          {visibleTabs.map((n) => (
            <div key={n.id} onClick={() => setTab(n.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 7, cursor: "pointer", marginBottom: 4, background: effectiveTab === n.id ? THEME.brass : "transparent", color: effectiveTab === n.id ? "#fff" : "#D8CFBC", fontSize: 14 }}>
              <n.icon size={17} />{n.label}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: "20px 32px", overflowX: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14, alignItems: "center", gap: 12 }}>
            {!isOnline ? (
              <span style={{ fontSize: 12, background: `${THEME.red}1a`, color: THEME.red, padding: "4px 10px", borderRadius: 20 }}>🔴 غير متصل بالإنترنت — التغييرات محفوظة مؤقتًا وستُزامن تلقائيًا عند عودة الاتصال</span>
            ) : hasPendingSync ? (
              <span style={{ fontSize: 12, background: "#C9A2271a", color: "#8A6D1F", padding: "4px 10px", borderRadius: 20 }}>🟡 جاري مزامنة تغييرات معلّقة...</span>
            ) : null}
            <span style={{ fontSize: 12.5, color: "#7A7061" }}>مسجّل الدخول: <b>{activeUser.name}</b> ({activeUser.role}){allowedBranches ? ` — ${sdata.branches.map((b) => b.name).join("، ")}` : " — كل الفروع"}</span>
            <Btn small variant="ghost" onClick={() => setPwModal({ current: "", next: "", error: "" })}>تغيير كلمة المرور</Btn>
            <Btn small variant="ghost" onClick={handleLogout}>تسجيل الخروج</Btn>
          </div>
          {pwModal && (
            <Modal title="تغيير كلمة المرور" onClose={() => setPwModal(null)}>
              <Field label="كلمة المرور الحالية"><TextInput type="password" value={pwModal.current} onChange={(e) => setPwModal({ ...pwModal, current: e.target.value })} /></Field>
              <Field label="كلمة المرور الجديدة"><TextInput type="password" value={pwModal.next} onChange={(e) => setPwModal({ ...pwModal, next: e.target.value })} /></Field>
              {pwModal.error && <div style={{ color: THEME.red, fontSize: 13, marginBottom: 10 }}>{pwModal.error}</div>}
              <Btn variant="brass" onClick={async () => {
                const ok = await verifyPassword(pwModal.current, activeUser.password);
                if (!ok) { setPwModal({ ...pwModal, error: "كلمة المرور الحالية غير صحيحة" }); return; }
                if (pwModal.next.trim().length < 4) { setPwModal({ ...pwModal, error: "كلمة المرور الجديدة قصيرة جدًا — 4 أحرف على الأقل" }); return; }
                const hash = await hashPassword(pwModal.next.trim());
                update({ users: data.users.map((u) => u.id === activeUser.id ? { ...u, password: hash } : u) });
                setPwModal(null);
                alert("تم تغيير كلمة المرور بنجاح.");
              }}>حفظ</Btn>
            </Modal>
          )}
          {views[effectiveTab]}
        </div>
      </div>
    </div>
  );
}
