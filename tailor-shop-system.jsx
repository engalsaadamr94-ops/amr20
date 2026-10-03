import React, { useState, useRef, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, CartesianGrid } from "recharts";
import JsBarcode from "jsbarcode";
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from "html5-qrcode";
import {
  LayoutDashboard, Users, ShoppingBag, Shirt, Receipt, Briefcase,
  Truck, Wallet, ShieldCheck, BarChart3, Plus, Trash2, Pencil,
  Printer, X, Search, Package, Building2, Star, ChevronLeft, ScanLine, Upload, CalendarClock, Store
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
function buildVoucher(counters, fields, createdBy) {
  const { no, counters: c } = nextCounter(counters, "voucher");
  return { voucher: { id: uid("v"), voucherNo: no, createdAt: new Date().toISOString(), createdBy: createdBy || "", ...fields }, counters: c };
}
const PAYMENT_ACCOUNT_MAP = { "نقدي": "cash", "شبكة": "network", "تحويل بنكي": "bank" };
const ROLE_STAGE_MAP = { "قصّاص": "القص", "خياط": "الخياطة", "كاوي": "الكي", "زرّار": "تركيب الأزرار" };
const STAGE_ROLE_MAP = Object.fromEntries(Object.entries(ROLE_STAGE_MAP).map(([role, stage]) => [stage, role]));

const ALL_MODULES = ["dashboard", "customers", "orders", "courier", "appointments", "designs", "invoices", "employees", "suppliers", "finance", "users", "settings", "reports"];
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
  freedCustomerCodes: [],
  orderGroups: [],
  auditLog: [],
  shopSettings: { name: "مشغل الخياطة الرجالية", legalName: "", logo: "", phone: "", whatsapp: "", address: "", city: "", crNumber: "", taxNumber: "", website: "", bankName: "", iban: "", invoiceFooter: "", appTheme: "classic", readyMessageTemplate: "مرحبًا {name}، طلبك رقم #{orderNo} جاهز للاستلام من {shop}. بانتظارك! 🙏\nتقدر تتابع حالة طلبك من هنا: {trackLink}", thankYouMessageTemplate: "شكرًا لك {name} على ثقتك بنا! يسعدنا تقييم تجربتك: {reviewLink}", reminderMessageTemplate: "تذكير: عندك موعد بـ{shop} بتاريخ {date} الساعة {time}. بانتظارك! 🙏", reviewLink: "" },
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
function Btn({ children, onClick, variant = "primary", small, type = "button", style, className }) {
  const styles = {
    primary: { background: THEME.ink, color: THEME.parchment },
    ghost: { background: "transparent", color: THEME.ink, border: `1px solid ${THEME.border}` },
    danger: { background: "transparent", color: THEME.red, border: `1px solid ${THEME.red}55` },
    brass: { background: THEME.brass, color: "#fff" },
  };
  return <button type={type} className={className} onClick={onClick} style={{ ...styles[variant], border: styles[variant].border || "none", borderRadius: 7, padding: small ? "6px 10px" : "9px 16px", fontSize: small ? 13 : 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", ...style }}>{children}</button>;
}
function Panel({ children, style }) { return <div style={{ background: THEME.panel, border: `1px solid ${THEME.border}`, borderTop: `3px solid ${THEME.brass}`, borderRadius: 8, padding: 20, ...style }}>{children}</div>; }
function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#1a1712bb", zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: THEME.panel, borderRadius: 10, width: "100%", maxWidth: wide ? 820 : 460, padding: 24, border: `1px solid ${THEME.border}` }}>
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
  const trackLink = `${window.location.origin}${window.location.pathname}?track=${order.orderNo || order.id.slice(-6)}`;
  const message = fillTemplate(data.shopSettings?.[templateField], { name: custName, orderNo: order.orderNo || order.id.slice(-6), shop: data.shopSettings?.name || "", trackLink, reviewLink: data.shopSettings?.reviewLink || "" });
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

function RecordPrintModal({ data, title, refLabel, refNo, rows, attachment, onClose, partyTitle, partyRows, signatures }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="printable" style={{ border: `2px solid ${THEME.brass}`, borderRadius: 8, padding: 18 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 10 }}>
            {data.shopSettings?.logo && <img src={data.shopSettings.logo} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: `1px solid ${THEME.border}` }} />}
            <div>
              <div style={{ fontFamily: "Amiri, serif", fontSize: 18 }}>{data.shopSettings?.name || "المحل"}</div>
              {data.shopSettings?.phone && <div style={{ fontSize: 11, color: "#7A7061" }}>{data.shopSettings.phone}{data.shopSettings?.city ? ` — ${data.shopSettings.city}` : ""}</div>}
              {(data.shopSettings?.crNumber || data.shopSettings?.taxNumber) && <div style={{ fontSize: 10.5, color: "#8A8071" }}>{data.shopSettings.crNumber && `س.ت: ${data.shopSettings.crNumber}`}{data.shopSettings.crNumber && data.shopSettings.taxNumber && " — "}{data.shopSettings.taxNumber && `ض.ق.م: ${data.shopSettings.taxNumber}`}</div>}
            </div>
          </div>
          <div style={{ textAlign: "center" }}><BarcodeSVG value={refNo} height={34} width={1.4} /></div>
        </div>
        <div style={{ fontWeight: 700, margin: "10px 0 8px", color: THEME.brass }}>{refLabel} #{refNo}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, fontSize: 13.5 }}>
          {rows.map((r, i) => <div key={i}>{r.label}: <b>{r.value}</b></div>)}
        </div>
        {partyRows && partyRows.length > 0 && (
          <div style={{ marginTop: 12, border: `1px solid ${THEME.border}`, borderRadius: 6, padding: "10px 12px", background: `${THEME.brass}0d` }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: THEME.teal, fontSize: 13.5 }}>{partyTitle}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, fontSize: 13.5 }}>
              {partyRows.map((r, i) => <div key={i}>{r.label}: <b>{r.value}</b></div>)}
            </div>
          </div>
        )}
        {attachment?.dataUrl && (
          <div style={{ marginTop: 12, borderTop: `1px dashed ${THEME.border}`, paddingTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>المرفق</div>
            {attachment.type?.startsWith("image/") ? <img src={attachment.dataUrl} alt="" style={{ maxWidth: "100%", borderRadius: 6, border: `1px solid ${THEME.border}` }} /> : <a href={attachment.dataUrl} download={attachment.name} style={{ color: THEME.teal, fontSize: 13 }}>تنزيل المرفق: {attachment.name}</a>}
          </div>
        )}
        {data.shopSettings?.bankName && (
          <div style={{ marginTop: 10, fontSize: 11, color: "#7A7061", borderTop: `1px dashed ${THEME.border}`, paddingTop: 8 }}>
            تحويل بنكي: {data.shopSettings.bankName}{data.shopSettings.iban ? ` — آيبان: ${data.shopSettings.iban}` : ""}
          </div>
        )}
        {signatures && signatures.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${signatures.length}, 1fr)`, gap: 16, marginTop: 26, fontSize: 12.5, color: "#5C5344" }}>
            {signatures.map((sg) => <div key={sg} style={{ textAlign: "center" }}><div style={{ borderBottom: "1px solid #8A8071", height: 28, marginBottom: 4 }}></div>{sg}</div>)}
          </div>
        )}
      </div>
      <Btn className="no-print" variant="brass" small onClick={() => window.print && window.print()} style={{ marginTop: 12 }}><Printer size={14} />طباعة</Btn>
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
      partyTitle={isReceipt ? "بيانات الدافع (المقبوض منه)" : "بيانات المستلم (المصروف له)"}
      partyRows={partyRows.length ? partyRows : [{ label: isReceipt ? "المقبوض منه" : "المستلم", value: "غير محدد" }]}
      signatures={isReceipt ? ["توقيع الدافع", "توقيع المحاسب / أمين الصندوق"] : ["توقيع المستلم", "توقيع المحاسب / أمين الصندوق"]}
      rows={[
        { label: "الحساب", value: data.financeAccounts.find((a) => a.id === voucher.accountId)?.name || "—" },
        { label: "الفرع", value: data.branches.find((b) => b.id === voucher.branch)?.name || "—" },
        { label: "التصنيف", value: voucher.category || "—" },
        { label: "المبلغ", value: `${fmtNum(voucher.amount)} ر.س` },
        { label: "البيان", value: voucher.description || "—" },
        { label: "التاريخ", value: `${voucher.date || "—"}${created ? " — " + created : ""}` },
        ...(voucher.createdBy ? [{ label: "أنشأه", value: voucher.createdBy }] : []),
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

// ---------- Shared statement viewer (customers / suppliers / employees) ----------
// Rows are { key, no, noLabel, date, desc, kind, inc, dec, branch | weights, ... }.
// balance = opening + Σinc − Σdec. `weights` ({branchId: 0..1}) lets one row (e.g. a salary shared
// between branches) be split when the statement is filtered to a single branch.
function StatementView({ data, title, partyLines, rows, opening = 0, labels, onClose, renderAction }) {
  const [mode, setMode] = useState("detail");
  const [branch, setBranch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
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
  const open = branch ? 0 : (Number(opening) || 0);
  let run = open;
  const withRun = base.map((r) => { run += r.inc - r.dec; return { ...r, running: round2(run) }; });
  const carried = from ? (withRun.filter((r) => (r.date || "") < from).slice(-1)[0]?.running ?? open) : open;
  const shown = withRun.filter(inRange);
  const totalInc = sum(shown, "inc"), totalDec = sum(shown, "dec");
  const closing = round2(carried + totalInc - totalDec);
  const byKind = {}; shown.forEach((r) => { const k = r.kind || "أخرى"; byKind[k] = byKind[k] || { count: 0, inc: 0, dec: 0 }; byKind[k].count += 1; byKind[k].inc += r.inc; byKind[k].dec += r.dec; });
  const showBranchTable = !branch && data.branches.length > 1;
  const th = { padding: "8px 10px", textAlign: "right" };
  const td = { padding: "6px 10px" };
  const rowBranchLabel = (r) => r.weights ? (Object.keys(r.weights).filter((id) => r.weights[id] > 0).map(bName).join("، ")) : bName(r.branch || defaultBranch);
  const filterText = `${branch ? `الفرع: ${bName(branch)}` : "كل الفروع"}${(from || to) ? ` — الفترة: ${from || "…"} إلى ${to || "…"}` : ""}`;
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="no-print" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) auto", gap: 8, alignItems: "end", marginBottom: 8 }}>
        <Field label="نوع الكشف"><SelectInput options={[{ value: "detail", label: "تفصيلي" }, { value: "summary", label: "إجمالي" }]} value={mode} onChange={(e) => setMode(e.target.value)} /></Field>
        <Field label="الفرع"><SelectInput options={[{ value: "", label: "كل الفروع" }, ...data.branches.map((b) => ({ value: b.id, label: b.name }))]} value={branch} onChange={(e) => setBranch(e.target.value)} /></Field>
        <Field label="من تاريخ"><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="إلى تاريخ"><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {(from || to || branch) && <Btn small variant="ghost" onClick={() => { setFrom(""); setTo(""); setBranch(""); }} style={{ marginBottom: 12 }}>مسح</Btn>}
      </div>
      <div className="printable">
        <div style={{ fontFamily: "Amiri, serif", fontSize: 18 }}>{data.shopSettings?.name || ""}</div>
        <div style={{ fontWeight: 700, margin: "2px 0 6px", color: THEME.brass }}>{title} — {mode === "detail" ? "كشف تفصيلي" : "كشف إجمالي"}</div>
        <div style={{ fontSize: 13, marginBottom: 4 }}>{(partyLines || []).filter(Boolean).join(" — ")}</div>
        <div style={{ fontSize: 12.5, color: "#5C5344", marginBottom: 8 }}>{filterText}</div>
        {branch && Number(opening) !== 0 && <div style={{ fontSize: 11.5, color: "#8A8071", marginBottom: 6 }}>الرصيد الافتتاحي ({fmtNum(opening)}) غير منسوب لفرع، لذلك يظهر فقط في كشف «كل الفروع».</div>}
        <div style={{ fontSize: 13, marginBottom: 8 }}>{from ? "الرصيد المُرحَّل" : "الرصيد الافتتاحي"}: <b>{fmtNum(carried)} ر.س</b></div>

        {mode === "detail" ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr style={{ background: "#EFE7D6" }}><th style={th}>الرقم</th><th style={th}>التاريخ</th>{!branch && <th style={th}>الفرع</th>}<th style={th}>البيان</th><th style={th}>{L.inc}</th><th style={th}>{L.dec}</th><th style={th}>الرصيد</th>{renderAction && <th className="no-print"></th>}</tr></thead>
            <tbody>
              {shown.length === 0 ? <tr><td colSpan={8} style={{ padding: 14, textAlign: "center", color: "#8A8071" }}>لا توجد حركات</td></tr> : shown.map((r) => (
                <tr key={r.key} style={{ borderTop: `1px solid ${THEME.border}` }}>
                  <td style={{ ...td, fontWeight: 700, color: THEME.brass, whiteSpace: "nowrap" }}>{r.noLabel ? `${r.noLabel} ` : ""}{r.no || "—"}</td>
                  <td style={td}>{r.date || "—"}</td>
                  {!branch && <td style={{ ...td, fontSize: 12 }}>{rowBranchLabel(r)}</td>}
                  <td style={td}>{r.desc}{r.partial ? ` (حصة الفرع ${fmtNum(r.partial * 100)}%)` : ""}</td>
                  <td style={td}>{r.inc ? fmtNum(r.inc) : "—"}</td>
                  <td style={td}>{r.dec ? fmtNum(r.dec) : "—"}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmtNum(r.running)}</td>
                  {renderAction && <td className="no-print" style={{ padding: "6px 6px", whiteSpace: "nowrap" }}>{renderAction(r)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            <div style={{ fontWeight: 700, margin: "6px 0", fontSize: 13 }}>إجمالي حسب نوع الحركة</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr style={{ background: "#EFE7D6" }}><th style={th}>النوع</th><th style={th}>العدد</th><th style={th}>{L.inc}</th><th style={th}>{L.dec}</th></tr></thead>
              <tbody>
                {Object.keys(byKind).length === 0 ? <tr><td colSpan={4} style={{ padding: 14, textAlign: "center", color: "#8A8071" }}>لا توجد حركات</td></tr> : Object.entries(byKind).map(([k, v]) => (
                  <tr key={k} style={{ borderTop: `1px solid ${THEME.border}` }}><td style={{ ...td, fontWeight: 600 }}>{k}</td><td style={td}>{v.count}</td><td style={td}>{v.inc ? fmtNum(v.inc) : "—"}</td><td style={td}>{v.dec ? fmtNum(v.dec) : "—"}</td></tr>
                ))}
                <tr style={{ borderTop: `2px solid ${THEME.brass}`, fontWeight: 700 }}><td style={td}>الإجمالي</td><td style={td}>{shown.length}</td><td style={td}>{fmtNum(totalInc)}</td><td style={td}>{fmtNum(totalDec)}</td></tr>
              </tbody>
            </table>
            {showBranchTable && (
              <>
                <div style={{ fontWeight: 700, margin: "14px 0 6px", fontSize: 13 }}>إجمالي حسب الفرع</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead><tr style={{ background: "#EFE7D6" }}><th style={th}>الفرع</th><th style={th}>{L.inc}</th><th style={th}>{L.dec}</th><th style={th}>الصافي</th></tr></thead>
                  <tbody>
                    {data.branches.map((b) => { const rs = forBranch(b.id).filter(inRange); const i = sum(rs, "inc"), d = sum(rs, "dec"); return (
                      <tr key={b.id} style={{ borderTop: `1px solid ${THEME.border}` }}><td style={{ ...td, fontWeight: 600 }}>{b.name}</td><td style={td}>{i ? fmtNum(i) : "—"}</td><td style={td}>{d ? fmtNum(d) : "—"}</td><td style={{ ...td, fontWeight: 700 }}>{fmtNum(i - d)}</td></tr>); })}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
        <div style={{ marginTop: 12, fontSize: 15, fontWeight: 700, color: closing > 0 ? THEME.red : THEME.teal }}>
          {L.balanceText ? L.balanceText(closing) : `الرصيد: ${fmtNum(closing)} ر.س`}
        </div>
      </div>
      <Btn className="no-print" variant="brass" small onClick={() => window.print && window.print()} style={{ marginTop: 12 }}><Printer size={14} />طباعة الكشف</Btn>
    </Modal>
  );
}

// ---------- Dashboard ----------
function Dashboard({ data }) {
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
  const stockMap = {}; data.purchases.filter((p) => p.category === "قماش").forEach((p) => { stockMap[p.item] = (stockMap[p.item] || 0) + Number(p.qty || 0); });
  const usedMap = {}; data.orders.forEach((o) => { if (o.fabricType) usedMap[o.fabricType] = (usedMap[o.fabricType] || 0) + Number(o.fabricUsed || 0); });
  const lowStockItems = Object.keys(stockMap).filter((item) => { const threshold = Number(data.fabricThresholds?.[item] || 0); const remaining = stockMap[item] - (usedMap[item] || 0); return threshold > 0 && remaining <= threshold; });
  const today = new Date().toISOString().slice(0, 10);
  const todaysAppointments = (data.appointments || []).filter((a) => a.date === today && a.status !== "ملغى");

  return (
    <div>
      <h2 style={{ fontFamily: "Amiri, serif", fontSize: 28, color: THEME.ink, marginTop: 0 }}>لوحة التحكم</h2>
      {(lowStockItems.length > 0 || todaysAppointments.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: lowStockItems.length && todaysAppointments.length ? "1fr 1fr" : "1fr", gap: 14, marginBottom: 20 }}>
          {lowStockItems.length > 0 && (
            <div style={{ background: `${THEME.red}12`, border: `1px solid ${THEME.red}`, borderRadius: 8, padding: 12, fontSize: 13.5 }}>
              <b style={{ color: THEME.red }}>⚠ مخزون قماش منخفض:</b> {lowStockItems.join("، ")}
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
  const rows = [
    ...orders.map((o) => ({ key: o.id, no: o.orderNo, noLabel: "طلب", date: o.createdAt, createdAt: "", desc: `${o.orderType || "طلب"}${Number(o.discount) > 0 ? ` (بعد خصم ${fmtNum(o.discount)})` : ""}`, kind: "طلبات", inc: Math.max(0, (Number(o.price) || 0) - (Number(o.discount) || 0)), dec: 0, branch: o.branch || def })),
    ...data.vouchers.filter((v) => v.type === "قبض" && v.orderId && ids.has(v.orderId)).map((v) => ({ key: v.id, no: v.voucherNo, noLabel: "سند", isVoucher: true, voucher: v, date: v.date, createdAt: v.createdAt || "", desc: v.description || "دفعة", kind: v.category || "دفعة", inc: 0, dec: Number(v.amount) || 0, branch: v.branch || data.orders.find((o) => o.id === v.orderId)?.branch || def })),
  ].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || "").localeCompare(b.createdAt || ""));
  return rows;
}
function CustomersView({ data, update, canEdit, currentUser }) {
  const [modal, setModal] = useState(null);
  const [statementFor, setStatementFor] = useState(null);
  const [printingVoucher, setPrintingVoucher] = useState(null);
  const save = (values) => {
    const list = [...data.customers];
    if (modal.mode === "add") {
      const freed = [...(data.freedCustomerCodes || [])].sort((a, b) => a - b);
      if (freed.length > 0) {
        const reusedCode = freed.shift();
        list.push({ id: uid("cust"), rating: 5, code: reusedCode, ...values });
        update({ customers: list, freedCustomerCodes: freed });
      } else {
        const nextCode = (data.counters?.customer || 1000) + 1;
        list.push({ id: uid("cust"), rating: 5, code: nextCode, ...values });
        update({ customers: list, counters: { ...data.counters, customer: nextCode } });
      }
    } else {
      const i = list.findIndex((c) => c.id === values.id); list[i] = values;
      update({ customers: list });
    }
    setModal(null);
  };
  const fields = [
    { key: "name", label: "اسم العميل" }, { key: "phone", label: "رقم الجوال" },
    { key: "familyGroup", label: "اسم العائلة / ملاحظة (لربط الأبناء)" }, { key: "preferredFabric", label: "تفضيل القماش" },
    { key: "notes", label: "ملاحظات", type: "textarea" },
  ];
  return (
    <>
      <CrudSection icon={Users} title="إدارة العملاء" addLabel="عميل جديد" columns={["الكود", "الاسم", "الجوال", "عدد الطلبات", "نقاط الولاء", "التقييم", "المتبقي عليه", ""]} items={data.customers} searchKeys={["name", "phone", "code"]}
        onAdd={canEdit ? () => setModal({ mode: "add", values: {} }) : undefined}
        onEdit={canEdit ? (it) => setModal({ mode: "edit", values: it }) : undefined}
        onDelete={canEdit ? (it) => update({ customers: data.customers.filter((c) => c.id !== it.id), freedCustomerCodes: [...(data.freedCustomerCodes || []), it.code].filter((v, i, arr) => v !== undefined && arr.indexOf(v) === i), auditLog: [...(data.auditLog || []), logEntry(currentUser, "حذف عميل", it.name)] }) : undefined}
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
      const nextNo = (data.counters?.order || 1000) + 1;
      order = { ...orderInput, orderNo: nextNo };
      patch.counters = { ...data.counters, order: nextNo };
      if (order.groupId === "__new__") {
        const nextGroupNo = (patch.counters.group || data.counters?.group || 1000) + 1;
        const group = { id: uid("grp"), groupNo: nextGroupNo, customerId: order.customerId, createdAt: new Date().toISOString().slice(0, 10) };
        patch.orderGroups = [...data.orderGroups, group];
        patch.counters = { ...patch.counters, group: nextGroupNo };
        order = { ...order, groupId: group.id };
      }
      list.push(order);
    } else {
      list[i] = order;
    }
    patch.orders = list;
    if (isNew && Number(order.deposit) > 0) {
      const accountId = PAYMENT_ACCOUNT_MAP[order.paymentMethod];
      if (accountId) {
        const bv = buildVoucher(patch.counters || data.counters, { type: "قبض", accountId, branch: order.branch, category: "عربون", amount: Number(order.deposit), description: `عربون طلب #${order.orderNo} — ${custName(order.customerId)}`, date: todayStr(), orderId: order.id, partyType: "عميل", partyId: order.customerId }, currentUser);
        patch.vouchers = [...data.vouchers, bv.voucher];
        patch.counters = bv.counters;
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
    const accountId = PAYMENT_ACCOUNT_MAP[method];
    if (!accountId) { alert("طريقة الدفع هذه (تقسيط) تحتاج ربط مزوّد خارجي فعلي ولا يمكن تسجيلها في الصندوق مباشرة الآن"); return; }
    const bv = buildVoucher(data.counters, { type: "قبض", accountId, branch: order.branch, category: "دفعة على الحساب", amount: amt, description: `دفعة لطلب #${order.orderNo || order.id.slice(-6)} — ${custName(order.customerId)}`, date: todayStr(), orderId: order.id, partyType: "عميل", partyId: order.customerId }, currentUser);
    const vouchers = [...data.vouchers, bv.voucher];
    const financeAccounts = data.financeAccounts.map((a) => a.id === accountId ? { ...a, balance: (Number(a.balance) || 0) + amt } : a);
    const updatedOrder = { ...order, deposit: (Number(order.deposit) || 0) + amt };
    const orders = data.orders.map((o) => o.id === order.id ? updatedOrder : o);
    update({ orders, vouchers, financeAccounts, counters: bv.counters });
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
  const permanentlyDeleteOrder = (order) => {
    if (!window.confirm(`تحذير: هذا حذف نهائي لا يمكن التراجع عنه للطلب #${order.orderNo || order.id.slice(-6)} — سيختفي بالكامل من كل السجلات والتقارير.\nهل أنت متأكد تمامًا؟`)) return;
    if (!window.confirm("تأكيد أخير: اضغط موافق فقط إذا كنت متأكدًا 100%.")) return;
    const linked = data.vouchers.filter((v) => v.orderId === order.id);
    const financeAccounts = data.financeAccounts.map((a) => {
      const sum = linked.filter((v) => v.accountId === a.id).reduce((s, v) => s + (Number(v.amount) || 0), 0);
      return sum ? { ...a, balance: (Number(a.balance) || 0) - sum } : a;
    });
    const vouchers = data.vouchers.filter((v) => v.orderId !== order.id);
    const orders = data.orders.filter((o) => o.id !== order.id);
    const auditLog = [...(data.auditLog || []), logEntry(currentUser, "حذف نهائي لطلب (مدير النظام)", `طلب #${order.orderNo || order.id.slice(-6)} — ${custName(order.customerId)}`)];
    update({ orders, vouchers, financeAccounts, auditLog, employeeLedger: (data.employeeLedger || []).filter((l) => l.orderId !== order.id) });
    setDetail(null);
  };

  return (
    <>
      <CrudSection icon={ShoppingBag} title="إدارة الطلبات" addLabel="طلب جديد" columns={["الرقم", "العميل", "النوع", "الطلبية", "الفرع", "التسليم", "المرحلة", "الموقع"]} items={data.orders} searchKeys={["orderNo"]}
        onAdd={canEdit ? () => data.customers.length ? setModal({ ...emptyOrder(data) }) : alert("أضف عميلاً أولاً من قسم إدارة العملاء") : undefined}
        onEdit={canEdit ? (it) => setModal(it) : undefined}
        onDelete={canEdit ? (it) => {
          if (it.cancelled) { alert("هذا الطلب ملغى بالفعل."); return; }
          if (!window.confirm(`سيتم إلغاء الطلب #${it.orderNo || it.id.slice(-6)} مع الاحتفاظ بسجله (لا يُحذف نهائيًا). متابعة؟`)) return;
          const linked = data.vouchers.filter((v) => v.orderId === it.id);
          const financeAccounts = data.financeAccounts.map((a) => {
            const sum = linked.filter((v) => v.accountId === a.id).reduce((s, v) => s + (Number(v.amount) || 0), 0);
            return sum ? { ...a, balance: (Number(a.balance) || 0) - sum } : a;
          });
          const vouchers = data.vouchers.filter((v) => v.orderId !== it.id);
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
            {isSystemAdmin && <Btn small variant="danger" onClick={() => permanentlyDeleteOrder(detail)}>🗑 حذف نهائي (مدير النظام فقط)</Btn>}
            <BarcodeSVG value={detail.orderNo} height={34} width={1.4} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>المقاسات</div>
              {data.measurementFields.map((m) => <div key={m.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "5px 0", borderBottom: `1px dashed ${THEME.border}` }}><span>{m.label}</span><span>{detail.measurements[m.key] || "—"}</span></div>)}
              <div style={{ fontWeight: 700, margin: "12px 0 6px" }}>القماش</div>
              <div style={{ fontSize: 13.5 }}>النوع: {detail.fabricType || "—"} — الكمية: {detail.fabricUsed || 0} متر</div>
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
                const linked = data.vouchers.filter((v) => v.orderId === detail.id);
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
    const updated = { ...order, ...assignmentPatch, stage: nextStage, stageLog: [...(order.stageLog || []), { stage: nextStage, at: new Date().toLocaleString("ar-SA"), note: logNote, courier: courier || undefined }] };
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
        <Field label="ثيم الفاتورة"><SelectInput options={[{ value: "classic", label: "كلاسيكي" }, { value: "modern", label: "عصري (شريط علوي)" }, { value: "minimal", label: "مبسّط" }, { value: "elegant", label: "أنيق (إطار مزدوج)" }]} value={data.invoiceTheme} onChange={(e) => update({ invoiceTheme: e.target.value })} /></Field>
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
      {printingGroup && (() => {
        const members = data.orders.filter((o) => o.groupId === printingGroup.id);
        const totalPrice = members.reduce((s, o) => s + (Number(o.price) || 0), 0);
        const totalDeposit = members.reduce((s, o) => s + (Number(o.deposit) || 0), 0);
        return (
          <RecordPrintModal data={data} title={`فاتورة الطلبية #${printingGroup.groupNo}`} refLabel="طلبية" refNo={printingGroup.groupNo} onClose={() => setPrintingGroup(null)}
            rows={[
              { label: "العميل", value: custName(printingGroup.customerId) },
              ...members.map((o) => ({ label: `طلب #${o.orderNo} — ${o.orderType}`, value: `${o.price || 0} ر.س` })),
              { label: "الإجمالي", value: `${totalPrice} ر.س` },
              { label: "العربون المدفوع", value: `${totalDeposit} ر.س` },
              { label: "المتبقي", value: `${totalPrice - totalDeposit} ر.س` },
            ]} />
        );
      })()}
      {printing && (() => {
        const theme = data.invoiceTheme || "classic";
        const accent = theme === "elegant" ? "#B8860B" : theme === "minimal" ? "#333333" : theme === "modern" ? THEME.teal : THEME.brass;
        const headingFont = theme === "minimal" ? "Tajawal, sans-serif" : "Amiri, serif";
        const outerStyle = theme === "elegant"
          ? { border: `1px solid ${accent}`, borderRadius: 4, padding: 6 }
          : theme === "minimal"
          ? { border: "none", padding: 0 }
          : theme === "modern"
          ? { border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 0, overflow: "hidden" }
          : { border: `2px solid ${accent}`, borderRadius: 8, padding: 18 };
        const Header = (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: theme === "modern" ? "16px 18px" : theme === "elegant" ? "14px 16px" : 0, background: theme === "modern" ? accent : "transparent", color: theme === "modern" ? "#fff" : "inherit" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              {data.shopSettings?.logo && <img src={data.shopSettings.logo} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: theme === "modern" ? "1px solid rgba(255,255,255,0.5)" : `1px solid ${THEME.border}` }} />}
              <div>
                <div style={{ fontFamily: headingFont, fontSize: 20 }}>{data.shopSettings?.name || "مشغل الخياطة الرجالية"}</div>
                {data.shopSettings?.phone && <div style={{ fontSize: 11.5, opacity: 0.85 }}>{data.shopSettings.phone}{data.shopSettings.city ? ` — ${data.shopSettings.city}` : ""}</div>}
                {(data.shopSettings?.crNumber || data.shopSettings?.taxNumber) && <div style={{ fontSize: 11, opacity: 0.75 }}>{data.shopSettings.crNumber && `س.ت: ${data.shopSettings.crNumber}`}{data.shopSettings.crNumber && data.shopSettings.taxNumber && " — "}{data.shopSettings.taxNumber && `ض.ق.م: ${data.shopSettings.taxNumber}`}</div>}
              </div>
            </div>
            {printing.kind === "customer" && theme !== "minimal" && <div style={{ textAlign: "center" }}><FakeQR seed={printing.order.id} /><div style={{ fontSize: 9, opacity: 0.7, marginTop: 4, maxWidth: 90 }}>رمز تجريبي — يتطلب حل معتمد من هيئة الزكاة والضريبة</div></div>}
          </div>
        );
        const Body = (
          <div style={{ padding: theme === "modern" ? "16px 18px" : theme === "elegant" ? "10px 16px 16px" : 0 }}>
            {theme === "elegant" && <div style={{ height: 1, background: accent, margin: "0 0 12px", opacity: 0.5 }} />}
            <div style={{ fontSize: 15, fontWeight: 700, margin: theme === "modern" ? "0 0 8px" : "10px 0 6px", color: accent, textAlign: theme === "elegant" ? "center" : "right" }}>رقم الطلب: #{printing.order.orderNo || printing.order.id.slice(-6)}</div>
            <div style={{ fontSize: 13.5 }}>العميل: {custName(printing.order.customerId)}</div>
            <div style={{ fontSize: 13.5 }}>نوع الخياطة: {printing.order.orderType}</div>
            <div style={{ fontSize: 13.5, marginBottom: 8 }}>موعد التسليم: {printing.order.deliveryDate || "—"}</div>

            <div style={{ textAlign: "center", margin: "10px 0" }}><BarcodeSVG value={printing.order.orderNo} /></div>

            {printing.kind === "tailor" && (
              <div style={{ marginTop: 10, fontSize: 13.5 }}>
                القماش: {printing.order.fabricType || "—"} — {printing.order.fabricUsed || 0} متر
                {printing.order.embroideryType && printing.order.embroideryType !== "بدون" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <DesignThumb item={data.embroideryTypes?.find((t) => t.name === printing.order.embroideryType)} size={28} />
                    <span>التطريز: {printing.order.embroideryType}{printing.order.embroideryNotes ? ` — ${printing.order.embroideryNotes}` : ""}</span>
                  </div>
                )}
              </div>
            )}

            <div style={{ fontWeight: 700, margin: "10px 0 6px", color: theme === "minimal" ? "#555" : "inherit", letterSpacing: theme === "minimal" ? 0.5 : 0 }}>المقاسات</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 13 }}>
              {data.measurementFields.map((m) => <div key={m.key}>{m.label}: {printing.order.measurements[m.key] || "—"}</div>)}
            </div>
            <div style={{ fontWeight: 700, margin: "10px 0 6px", color: theme === "minimal" ? "#555" : "inherit" }}>التصاميم</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {data.designCategories.map((c) => { const item = c.items.find((i) => i.id === printing.order.designs[c.id]); return item ? <div key={c.id} style={{ textAlign: "center" }}><DesignThumb item={item} size={32} /><div style={{ fontSize: 10 }}>{item.name}</div></div> : null; })}
            </div>
            {printing.kind === "customer" && (
              <div style={{ marginTop: 12, borderTop: `1px dashed ${THEME.border}`, paddingTop: 10, fontSize: 14 }}>
                <div>السعر الإجمالي: {printing.order.price || 0} ر.س</div>
                <div>العربون المدفوع: {printing.order.deposit || 0} ر.س</div>
                <div style={{ fontWeight: 700, color: accent }}>المتبقي: {(Number(printing.order.price) || 0) - (Number(printing.order.deposit) || 0)} ر.س</div>
                <div>طريقة الدفع: {printing.order.paymentMethod}</div>
                {printing.order.paymentMethod?.includes("تقسيط") && <div style={{ fontSize: 11.5, color: "#8A8071", marginTop: 4 }}>هذا الخيار يتطلب ربط حساب تاجر فعلي مع المزوّد لإتمام العملية.</div>}
                {data.shopSettings?.bankName && <div style={{ fontSize: 11, color: "#7A7061", marginTop: 6 }}>تحويل بنكي: {data.shopSettings.bankName}{data.shopSettings.iban ? ` — ${data.shopSettings.iban}` : ""}</div>}
                {data.shopSettings?.invoiceFooter && <div style={{ marginTop: 10, fontSize: 12, color: "#7A7061", borderTop: `1px dashed ${THEME.border}`, paddingTop: 8 }}>{data.shopSettings.invoiceFooter}</div>}
              </div>
            )}
          </div>
        );
        return (
          <Modal title={printing.kind === "customer" ? "فاتورة العميل" : "بطاقة الخياط (بدون أسعار)"} onClose={() => setPrinting(null)}>
            <div className="printable" style={outerStyle}>
              {theme === "elegant" ? <div style={{ border: `1px solid ${accent}`, borderRadius: 3 }}>{Header}{Body}</div> : <>{Header}{Body}</>}
            </div>
            <Btn className="no-print" variant="brass" small onClick={() => window.print && window.print()} style={{ marginTop: 12 }}><Printer size={14} />طباعة</Btn>
          </Modal>
        );
      })()}
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
    ...data.vouchers.filter((v) => v.employeeId === e.id).map((v) => {
      const amt = Number(v.amount) || 0, out = v.type === "صرف";
      return { key: v.id, no: v.voucherNo, noLabel: "سند", isVoucher: true, voucher: v, date: v.date, createdAt: v.createdAt || "", desc: (out ? (v.category || "دفعة") : "مبلغ مقبوض من الموظف") + (v.description ? ` — ${v.description}` : ""), kind: out ? (v.category === "سلفة موظف" ? "سلفة" : "دفعة") : "قبض", inc: out ? 0 : amt, dec: out ? amt : 0, branch: v.branch || ebr[0] || def };
    }),
  ].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || "").localeCompare(b.createdAt || ""));
  let running = Number(e.openingBalance) || 0;
  const withRunning = rows.map((r) => { running += r.inc - r.dec; return { ...r, running: round2(running) }; });
  return { rows: withRunning, balance: round2(running) };
}
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
      if (Math.abs(total - 100) > 0.01) { alert(`مجموع نسب الفروع يجب أن يساوي 100% (الحالي ${fmtNum(total)}%)`); return; }
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
    const isAdvance = values.kind === "سلفة موظف";
    const bv = buildVoucher(data.counters, { type: "صرف", accountId: values.accountId, branch: values.branch || empBranches(data, employee)[0], category: isAdvance ? "سلفة موظف" : "رواتب", amount: amt, description: values.note || (isAdvance ? `سلفة للموظف ${employee.name}` : `صرف مستحقات الموظف ${employee.name}`), date: values.date || todayStr(), partyType: "موظف", partyId: employee.id, employeeId: employee.id, partyName: employee.name, partyPhone: employee.phone || "" }, currentUser);
    const financeAccounts = data.financeAccounts.map((a) => a.id === values.accountId ? { ...a, balance: (Number(a.balance) || 0) - amt } : a);
    update({ vouchers: [...data.vouchers, bv.voucher], financeAccounts, counters: bv.counters });
    setPayModal(null);
    setPrintingVoucher(bv.voucher);
  };

  const saveAdjustment = () => {
    const { employee, values } = adjModal;
    const amt = Number(values.amount);
    if (!amt || amt <= 0) { alert("أدخل مبلغًا صحيحًا"); return; }
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
  const computeProfit = (month, branchId) => {
    const inMonth = (d) => String(d || "").slice(0, 7) === month;
    const sumBy = (arr, f) => round2(arr.reduce((t, x) => t + (Number(f(x)) || 0), 0));
    const revenue = sumBy(data.orders.filter((o) => !o.cancelled && o.branch === branchId && inMonth(o.createdAt)), (o) => Math.max(0, (Number(o.price) || 0) - (Number(o.discount) || 0)));
    const purchases = sumBy(data.purchases.filter((x) => (x.branch || defaultBranch) === branchId && inMonth(x.date)), (x) => x.cost);
    const expenses = sumBy(data.vouchers.filter((v) => v.type === "صرف" && (v.branch || defaultBranch) === branchId && inMonth(v.date) && !v.employeeId && !v.supplierId), (v) => v.amount);
    const wages = round2((data.employeeLedger || []).filter((l) => ["راتب", "قطعة", "نسبة", "مكافأة"].includes(l.kind) && (l.month ? l.month === month : inMonth(l.date))).reduce((t, l) => {
      const emp = data.employees.find((e) => e.id === l.employeeId);
      const ord = l.orderId ? data.orders.find((o) => o.id === l.orderId) : null;
      const w = ord ? ((ord.branch || defaultBranch) === branchId ? 1 : 0) : (emp ? empBranchWeight(data, emp, branchId) : (defaultBranch === branchId ? 1 : 0));
      return t + (Number(l.credit) || 0) * w;
    }, 0));
    return { revenue, purchases, expenses, wages, profit: round2(revenue - purchases - expenses - wages) };
  };
  const profitBranches = () => data.branches.filter((br) => data.employees.some((e) => empBranches(data, e).includes(br.id) && Number(e.profitSharePercent) > 0));
  const profitDone = (empId, month, branchId) => (data.employeeLedger || []).some((l) => l.employeeId === empId && l.kind === "أرباح" && l.month === month && (!l.branchId || l.branchId === branchId));
  const calcProfits = (month) => { const o = {}; profitBranches().forEach((br) => { o[br.id] = computeProfit(month, br.id).profit; }); return o; };
  const openProfit = () => { const month = todayStr().slice(0, 7); setProfitModal({ month, profits: calcProfits(month), include: {} }); };
  const saveProfit = () => {
    const { month, profits, include } = profitModal;
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
              : (canEdit && <button onClick={() => removeEntry(r)} title="حذف القيد" style={{ background: "none", border: "none", cursor: "pointer", color: THEME.red }}><Trash2 size={14} /></button>)} />
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
  const categories = ["قماش", "أزرار", "خيوط", "بطانة", "أخرى"];
  const pFields = [
    { key: "supplierId", label: "المورد", type: "select", options: data.suppliers.map((s) => ({ value: s.id, label: s.name })) },
    { key: "branch", label: "الفرع (لحساب أرباح الفرع)", type: "select", options: data.branches.map((b) => ({ value: b.id, label: b.name })) },
    { key: "category", label: "التصنيف", type: "select", options: categories.map((c) => ({ value: c, label: c })) },
    { key: "item", label: "الصنف" }, { key: "qty", label: "الكمية", type: "number" },
    { key: "unit", label: "الوحدة (متر، قطعة...)" }, { key: "cost", label: "التكلفة (ر.س)", type: "number" },
    { key: "date", label: "التاريخ", type: "date" },
  ];
  const savePurchase = (values) => {
    const list = [...data.purchases];
    if (pModal.mode === "add") {
      const nextNo = (data.counters?.purchase || 1000) + 1;
      list.push({ id: uid("pur"), purchaseNo: nextNo, ...values });
      update({ purchases: list, counters: { ...data.counters, purchase: nextNo } });
    } else {
      const i = list.findIndex((p) => p.id === values.id); list[i] = values;
      update({ purchases: list });
    }
    setPModal(null);
  };

  const supplierBalance = (s) => {
    const purchased = data.purchases.filter((p) => p.supplierId === s.id).reduce((sum, p) => sum + (Number(p.cost) || 0), 0);
    const paid = data.vouchers.filter((v) => v.type === "صرف" && v.supplierId === s.id).reduce((sum, v) => sum + (Number(v.amount) || 0), 0);
    return (Number(s.openingBalance) || 0) + purchased - paid;
  };
  const payFields = [
    { key: "accountId", label: "الحساب", type: "select", options: data.financeAccounts.map((a) => ({ value: a.id, label: a.name })) },
    { key: "amount", label: "المبلغ (ر.س)", type: "number" }, { key: "date", label: "التاريخ", type: "date" },
  ];
  const savePayment = () => {
    const amt = Number(payModal.values.amount);
    if (!amt || amt <= 0) { alert("أدخل مبلغًا صحيحًا"); return; }
    const bv = buildVoucher(data.counters, { type: "صرف", accountId: payModal.values.accountId, branch: data.branches[0]?.id, category: "دفعة لمورد", amount: amt, description: `دفعة للمورد ${payModal.supplier.name}`, date: payModal.values.date || todayStr(), supplierId: payModal.supplier.id, partyType: "مورد", partyId: payModal.supplier.id });
    const vouchers = [...data.vouchers, bv.voucher];
    const financeAccounts = data.financeAccounts.map((a) => a.id === payModal.values.accountId ? { ...a, balance: (Number(a.balance) || 0) - amt } : a);
    update({ vouchers, financeAccounts, counters: bv.counters });
    setPayModal(null);
  };

  const stockMap = {}; data.purchases.filter((p) => p.category === "قماش").forEach((p) => { stockMap[p.item] = (stockMap[p.item] || 0) + Number(p.qty || 0); });
  const usedMap = {}; data.orders.forEach((o) => { if (o.fabricType) usedMap[o.fabricType] = (usedMap[o.fabricType] || 0) + Number(o.fabricUsed || 0); });
  const stockRows = Object.keys(stockMap).map((item) => ({ item, purchased: stockMap[item], used: usedMap[item] || 0, remaining: stockMap[item] - (usedMap[item] || 0) }));

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
      <Panel style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>مخزون الأقمشة الحالي</div>
        {stockRows.length === 0 ? <EmptyState text="سجّل مشتريات قماش لعرض المخزون" /> : stockRows.map((r) => {
          const threshold = Number(data.fabricThresholds?.[r.item] || 0);
          const isLow = threshold > 0 && r.remaining <= threshold;
          return (
            <div key={r.item} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px dashed ${THEME.border}`, fontSize: 13.5, background: isLow ? `${THEME.red}0f` : "transparent" }}>
              <span>{r.item} {isLow && <Badge color={THEME.red}>منخفض ⚠</Badge>}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                مُشترى: {r.purchased} م — مستخدم: {r.used} م — <b style={{ color: isLow ? THEME.red : "inherit" }}>المتبقي: {r.remaining} م</b>
                {canEdit && (
                  <span style={{ fontSize: 11.5, color: "#8A8071", display: "flex", alignItems: "center", gap: 4 }}>
                    حد التنبيه:
                    <input type="number" defaultValue={data.fabricThresholds?.[r.item] || ""} onBlur={(e) => update({ fabricThresholds: { ...(data.fabricThresholds || {}), [r.item]: e.target.value } })} style={{ width: 55, padding: "3px 5px", border: `1px solid ${THEME.border}`, borderRadius: 4 }} />
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </Panel>

      <CrudSection icon={Truck} title="سجل المشتريات" addLabel="عملية شراء" columns={["الرقم", "المورد", "التصنيف", "الصنف", "الكمية", "التكلفة", "التاريخ", "مرفق"]} items={data.purchases} searchKeys={["item", "purchaseNo"]}
        onAdd={canEdit ? () => data.suppliers.length ? setPModal({ mode: "add", values: { category: categories[0], supplierId: data.suppliers[0]?.id || "", branch: data.branches[0]?.id || "", date: todayStr() } }) : alert("أضف موردًا أولاً") : undefined}
        onEdit={canEdit ? (it) => setPModal({ mode: "edit", values: it }) : undefined}
        onDelete={canEdit ? (it) => update({ purchases: data.purchases.filter((p) => p.id !== it.id) }) : undefined}
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
          ...data.vouchers.filter((v) => v.type === "صرف" && v.supplierId === sp.id).map((v) => ({ key: v.id, no: v.voucherNo, noLabel: "سند", date: v.date, createdAt: v.createdAt || "", desc: v.description || "دفعة مسدّدة", kind: "سداد", inc: 0, dec: Number(v.amount) || 0, branch: v.branch || def })),
        ].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || "").localeCompare(b.createdAt || ""));
        return (
          <StatementView data={data} title={`كشف حساب المورد — ${sp.name}`} onClose={() => setStatementFor(null)}
            partyLines={[sp.materialType, sp.phone]} rows={rows} opening={sp.openingBalance}
            labels={{ inc: "مدين (مشتريات)", dec: "دائن (سداد)", balanceText: (b) => `الرصيد المستحق للمورد: ${fmtNum(b)} ر.س` }} />
        );
      })()}
      {printingPurchase && (
        <RecordPrintModal data={data} title="سند شراء" refLabel="عملية شراء" refNo={printingPurchase.purchaseNo || printingPurchase.id.slice(-6)} attachment={printingPurchase.attachment} onClose={() => setPrintingPurchase(null)}
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
  const collectedFor = (orderId) => data.vouchers.filter((v) => v.orderId === orderId).reduce((s, v) => s + (Number(v.amount) || 0), 0);

  const perBranch = data.branches.map((b) => {
    const income = data.vouchers.filter((v) => v.type === "قبض" && v.branch === b.id).reduce((s, v) => s + (Number(v.amount) || 0), 0);
    const expense = data.vouchers.filter((v) => v.type === "صرف" && v.branch === b.id).reduce((s, v) => s + (Number(v.amount) || 0), 0);
    const remaining = data.orders.filter((o) => o.branch === b.id && !o.cancelled).reduce((s, o) => { const rem = (Number(o.price) || 0) - collectedFor(o.id); return s + (rem > 0 ? rem : 0); }, 0);
    return { name: b.name, الوارد: income, المصروف: expense, المتبقي: remaining };
  });

  const totalIncome = data.vouchers.filter((v) => v.type === "قبض").reduce((s, v) => s + (Number(v.amount) || 0), 0);
  const totalDeposits = data.vouchers.filter((v) => v.type === "قبض" && v.category === "عربون").reduce((s, v) => s + (Number(v.amount) || 0), 0);
  const totalExpense = data.vouchers.filter((v) => v.type === "صرف").reduce((s, v) => s + (Number(v.amount) || 0), 0);
  const totalRemaining = data.orders.reduce((s, o) => { const rem = (Number(o.price) || 0) - collectedFor(o.id); return s + (rem > 0 ? rem : 0); }, 0);
  const totalInvoiced = data.orders.reduce((s, o) => s + (Number(o.price) || 0), 0);
  const collectionRate = totalInvoiced > 0 ? Math.round((totalIncome / totalInvoiced) * 100) : 0;

  const compositionMap = {};
  data.vouchers.filter((v) => v.type === "قبض").forEach((v) => { const c = v.category || "أخرى"; compositionMap[c] = (compositionMap[c] || 0) + (Number(v.amount) || 0); });
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
  const [vModal, setVModal] = useState(null);
  const [jModal, setJModal] = useState(null);
  const [printingVoucher, setPrintingVoucher] = useState(null);
  const [printingJournal, setPrintingJournal] = useState(null);
  const expenseCategories = ["إيجار", "رواتب", "فواتير خدمات", "صيانة", "أخرى"];
  const incomeCategories = ["عربون", "دفعة على الحساب", "أخرى"];
  const vFields = [
    { key: "type", label: "نوع السند", type: "select", options: [{ value: "قبض", label: "سند قبض" }, { value: "صرف", label: "سند صرف" }] },
    { key: "accountId", label: "الحساب", type: "select", options: data.financeAccounts.map((a) => ({ value: a.id, label: a.name })) },
    { key: "branch", label: "الفرع", type: "select", options: data.branches.map((b) => ({ value: b.id, label: b.name })) },
    { key: "amount", label: "المبلغ (ر.س)", type: "number" }, { key: "description", label: "البيان" }, { key: "date", label: "التاريخ", type: "date" },
  ];
  const saveVoucher = (values) => {
    if (!Number(values.amount) || Number(values.amount) <= 0) { alert("أدخل مبلغًا صحيحًا"); return; }
    const extra = {};
    if (values.partyType === "موظف" && values.partyId) extra.employeeId = values.partyId;
    if (values.partyType === "مورد" && values.partyId) extra.supplierId = values.partyId;
    const bv = buildVoucher(data.counters, { ...values, ...extra, date: values.date || todayStr() }, currentUser);
    const vouchers = [...data.vouchers, bv.voucher];
    const accounts = data.financeAccounts.map((a) => a.id === values.accountId ? { ...a, balance: (Number(a.balance) || 0) + (values.type === "قبض" ? Number(values.amount) : -Number(values.amount)) } : a);
    update({ vouchers, financeAccounts: accounts, counters: bv.counters }); setVModal(null);
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
  const filteredVouchers = data.vouchers.filter((v) => inRange(v.date));
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 20 }}>
        {data.financeAccounts.map((a) => <Panel key={a.id}><div style={{ fontSize: 13, color: "#7A7061" }}>{a.name}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{a.balance.toLocaleString()} ر.س</div></Panel>)}
      </div>
      <Panel style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>الأرباح والخسائر حسب الفرع {(dateFrom || dateTo) && <span style={{ fontSize: 11.5, color: THEME.teal, fontWeight: 400 }}>(بالمدى المحدد)</span>}</div>
        {data.branches.map((b) => {
          const rev = revenueByBranch.find((r) => r.name === b.name)?.total || 0;
          const exp = expensesByBranch.find((r) => r.name === b.name)?.total || 0;
          return <div key={b.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px dashed ${THEME.border}`, fontSize: 13.5 }}><span>{b.name}</span><span>إيراد: {rev.toLocaleString()} — مصروف: {exp.toLocaleString()} — <b>صافي: {(rev - exp).toLocaleString()} ر.س</b></span></div>;
        })}
        <div style={{ marginTop: 10, fontSize: 12.5, color: "#7A7061" }}>خيارات الدفع تابي وتمارا متاحة عند الفوترة؛ تفعيلها الفعلي يتطلب ربط API مع حساب تاجر معتمد لدى كل مزوّد.</div>
      </Panel>

      <CrudSection icon={Wallet} title="السندات (قبض / صرف)" addLabel="سند جديد" columns={["الرقم", "النوع", "الطرف", "الحساب", "التصنيف", "المبلغ", "البيان", "التاريخ", "طباعة"]} items={data.vouchers} searchKeys={["description", "voucherNo", "partyName"]}
        onAdd={canEdit ? () => setVModal({ mode: "add", values: { type: "قبض", accountId: data.financeAccounts[0]?.id, branch: data.branches[0]?.id, category: incomeCategories[2], date: todayStr() } }) : undefined}
        renderRow={(it) => {
          const pr = voucherPartyInfo(data, it);
          return (<><td style={{ padding: "10px 14px", fontWeight: 700, color: THEME.brass }}>{it.voucherNo || "—"}</td><td style={{ padding: "10px 14px" }}><Badge color={it.type === "قبض" ? THEME.teal : THEME.red}>{it.type}</Badge></td><td style={{ padding: "10px 14px", fontSize: 13 }}>{pr.find((r) => r.label === "الاسم")?.value || "—"}</td><td style={{ padding: "10px 14px" }}>{data.financeAccounts.find((a) => a.id === it.accountId)?.name}</td><td style={{ padding: "10px 14px" }}>{it.category || "—"}</td><td style={{ padding: "10px 14px" }}>{fmtNum(it.amount)} ر.س</td><td style={{ padding: "10px 14px" }}>{it.description}</td><td style={{ padding: "10px 14px" }}>{it.date}</td><td style={{ padding: "10px 14px" }}><Btn small variant="ghost" onClick={() => setPrintingVoucher(it)}><Printer size={13} /></Btn></td></>);
        }} />

      <div style={{ height: 20 }} />
      <CrudSection icon={Wallet} title="قيود التحويل بين الحسابات" addLabel="قيد جديد" columns={["الرقم", "من", "إلى", "المبلغ", "البيان", "التاريخ", "طباعة"]} items={data.journalEntries} searchKeys={["description", "journalNo"]}
        onAdd={canEdit ? () => setJModal({ mode: "add", values: { fromAccount: data.financeAccounts[0]?.id, toAccount: data.financeAccounts[1]?.id || data.financeAccounts[0]?.id } }) : undefined}
        renderRow={(it) => (<><td style={{ padding: "10px 14px", fontWeight: 700, color: THEME.brass }}>{it.journalNo || "—"}</td><td style={{ padding: "10px 14px" }}>{data.financeAccounts.find((a) => a.id === it.fromAccount)?.name}</td><td style={{ padding: "10px 14px" }}>{data.financeAccounts.find((a) => a.id === it.toAccount)?.name}</td><td style={{ padding: "10px 14px" }}>{it.amount} ر.س</td><td style={{ padding: "10px 14px" }}>{it.description}</td><td style={{ padding: "10px 14px" }}>{it.date}</td><td style={{ padding: "10px 14px" }}><Btn small variant="ghost" onClick={() => setPrintingJournal(it)}><Printer size={13} /></Btn></td></>)} />

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
        <RecordPrintModal data={data} title="قيد تحويل" refLabel="قيد تحويل" refNo={printingJournal.journalNo || printingJournal.id.slice(-6)} attachment={printingJournal.attachment} onClose={() => setPrintingJournal(null)}
          rows={[
            { label: "من حساب", value: data.financeAccounts.find((a) => a.id === printingJournal.fromAccount)?.name || "—" },
            { label: "إلى حساب", value: data.financeAccounts.find((a) => a.id === printingJournal.toAccount)?.name || "—" },
            { label: "المبلغ", value: `${printingJournal.amount || 0} ر.س` },
            { label: "البيان", value: printingJournal.description || "—" },
            { label: "التاريخ", value: printingJournal.date || "—" },
          ]} />
      )}
    </div>
  );
}

// ---------- Users / System admin ----------
function UsersView({ data, update, canEdit, currentUser }) {
  const [modal, setModal] = useState(null);
  const [branchName, setBranchName] = useState("");
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
  const moduleLabels = { dashboard: "لوحة التحكم", customers: "العملاء", orders: "الطلبات", courier: "شاشة المراسل", appointments: "المواعيد", designs: "دليل التصاميم", invoices: "الفواتير", employees: "الموظفون", suppliers: "المشتريات", finance: "المالية", users: "المستخدمون", settings: "بيانات المحل", reports: "التقارير" };

  return (
    <div>
      <Panel style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>الفروع</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>{data.branches.map((b) => <Badge key={b.id} color={THEME.teal}>{b.name}</Badge>)}</div>
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

function ShopSettingsView({ data, update, canEdit }) {
  const [values, setValues] = useState(data.shopSettings || {});
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const backupFileRef = useRef(null);

  const onLogoFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => { const compressed = await compressImageDataUrl(reader.result, 240, 0.8); setValues((v) => ({ ...v, logo: compressed })); };
    reader.readAsDataURL(file);
  };
  const save = () => { update({ shopSettings: values }); setSaved(true); setTimeout(() => setSaved(false), 2000); };

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
            {values.logo && <span style={{ marginRight: 10, fontSize: 12.5, color: THEME.red, cursor: "pointer" }} onClick={() => setValues({ ...values, logo: "" })}>إزالة الشعار</span>}
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
    </div>
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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

  React.useEffect(() => {
    const goOnline = async () => {
      setIsOnline(true);
      if (dataForSyncRef.current) {
        try { await window.storage.set(STORAGE_KEY, JSON.stringify(dataForSyncRef.current), false); setHasPendingSync(false); }
        catch (e) { /* still failing — stays pending, will retry on next reconnect or next edit */ }
      }
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY); const parsed = JSON.parse(res.value);
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
        if (!parsed.freedCustomerCodes) parsed.freedCustomerCodes = [];
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
        if (!parsed.vouchers) parsed.vouchers = [];
        if (parsed.counters.voucher === undefined) parsed.counters.voucher = 1000;
        if (parsed.counters.journal === undefined) parsed.counters.journal = 1000;
        if (parsed.counters.empEntry === undefined) parsed.counters.empEntry = 5000;
        { let vn = parsed.counters.voucher; parsed.vouchers = parsed.vouchers.map((v) => v.voucherNo ? v : (vn += 1, { ...v, voucherNo: vn })); parsed.counters.voucher = vn; }
        { let jn = parsed.counters.journal; parsed.journalEntries = parsed.journalEntries.map((j) => j.journalNo ? j : (jn += 1, { ...j, journalNo: jn })); parsed.counters.journal = jn; }
        if (parsed.users) parsed.users = parsed.users.map((u) => u.permissions && u.permissions.settings ? u : { ...u, permissions: { ...u.permissions, settings: u.role === "مدير عام" ? { view: true, edit: true } : { view: false, edit: false } } });
        setData(parsed);
      }
      catch (e) { setData(seedData()); }
      try { const s = await window.storage.get(SESSION_KEY); const parsed = JSON.parse(s.value); setSessionUserId(parsed.userId || null); }
      catch (e) { setSessionUserId(null); }
      setSessionLoaded(true);
    })();
  }, []);

  const update = async (patch) => {
    const next = { ...data, ...patch };
    setData(next);
    dataForSyncRef.current = next;
    if (typeof navigator !== "undefined" && !navigator.onLine) { setHasPendingSync(true); return; }
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(next), false); setHasPendingSync(false); }
    catch (e) {
      if (typeof navigator !== "undefined" && !navigator.onLine) { setHasPendingSync(true); return; }
      alert("⚠ فشل حفظ آخر تغيير بشكل دائم!\nتفاصيل الخطأ: " + (e?.message || String(e)) + "\nالتغيير ظاهر لك الآن مؤقتًا لكن قد يختفي عند إعادة تحميل الصفحة.");
    }
  };

  const handleLogin = (userId) => {
    setSessionUserId(userId);
    window.storage.set(SESSION_KEY, JSON.stringify({ userId }), false).catch(() => {});
    setData((prev) => {
      if (!prev) return prev;
      const now = new Date().toLocaleString("ar-SA");
      const next = { ...prev, users: prev.users.map((u) => u.id === userId ? { ...u, loginCount: (u.loginCount || 0) + 1, lastLogin: now, lastSeen: new Date().toISOString() } : u) };
      dataForSyncRef.current = next;
      window.storage.set(STORAGE_KEY, JSON.stringify(next), false).catch(() => {});
      return next;
    });
  };
  const handleLogout = () => {
    setSessionUserId(null);
    window.storage.set(SESSION_KEY, JSON.stringify({ userId: null }), false).catch(() => {});
  };

  // Heartbeat: marks the current user as "online" while the app stays open.
  React.useEffect(() => {
    if (!sessionUserId) return;
    const beat = () => {
      setData((prev) => {
        if (!prev) return prev;
        const next = { ...prev, users: prev.users.map((u) => u.id === sessionUserId ? { ...u, lastSeen: new Date().toISOString() } : u) };
        dataForSyncRef.current = next;
        window.storage.set(STORAGE_KEY, JSON.stringify(next), false).catch(() => {});
        return next;
      });
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
      if (hasPendingSync) return;
      try {
        const res = await window.storage.get(STORAGE_KEY);
        const fresh = JSON.parse(res.value);
        setData((prev) => (prev && JSON.stringify(prev) === res.value) ? prev : fresh);
      } catch (e) { /* ignore transient errors */ }
    }, 25000);
    return () => clearInterval(interval);
  }, [sessionUserId, hasPendingSync]);

  if (!data || !sessionLoaded) return <div style={{ padding: 40, fontFamily: "Tajawal, sans-serif" }}>جارِ التحميل...</div>;
  applyTheme(data.shopSettings?.appTheme);

  const trackOrderNo = new URLSearchParams(window.location.search).get("track");
  if (trackOrderNo) return <TrackOrderPage data={data} orderNo={trackOrderNo} />;

  const activeUser = data.users.find((u) => u.id === sessionUserId);
  if (!activeUser) return <LoginScreen data={data} update={update} onLogin={handleLogin} />;

  const visibleTabs = NAV.filter((n) => activeUser.permissions?.[n.id]?.view);
  const effectiveTab = visibleTabs.some((v) => v.id === tab) ? tab : (visibleTabs[0]?.id || "dashboard");
  const canEdit = !!activeUser.permissions?.[effectiveTab]?.edit;

  const views = {
    dashboard: <Dashboard data={data} />,
    customers: <CustomersView data={data} update={update} canEdit={canEdit} currentUser={activeUser.name} />,
    orders: <OrdersView data={data} update={update} canEdit={canEdit} currentUser={activeUser.name} currentUserRole={activeUser.role} />,
    courier: <CourierView data={data} update={update} canEdit={canEdit} />,
    appointments: <AppointmentsView data={data} update={update} canEdit={canEdit} />,
    designs: <DesignsView data={data} update={update} canEdit={canEdit} />,
    invoices: <InvoicesView data={data} update={update} />,
    employees: <EmployeesView data={data} update={update} canEdit={canEdit} currentUser={activeUser.name} />,
    suppliers: <SuppliersView data={data} update={update} canEdit={canEdit} />,
    finance: <FinanceView data={data} update={update} canEdit={canEdit} currentUser={activeUser.name} />,
    users: <UsersView data={data} update={update} canEdit={canEdit} currentUser={activeUser.name} />,
    settings: <ShopSettingsView data={data} update={update} canEdit={canEdit} />,
    reports: <ReportsView data={data} />,
  };

  return (
    <div dir="rtl" style={{ fontFamily: "Tajawal, sans-serif", background: THEME.parchment, minHeight: "100vh", color: THEME.ink }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&family=Amiri:wght@400;700&display=swap'); * { box-sizing: border-box; }
        @media print {
          body * { visibility: hidden; }
          .printable, .printable * { visibility: visible; }
          .printable { position: absolute; top: 0; right: 0; left: 0; width: 100%; }
          .no-print { display: none !important; }
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
            <span style={{ fontSize: 12.5, color: "#7A7061" }}>مسجّل الدخول: <b>{activeUser.name}</b> ({activeUser.role})</span>
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
