import React from "react";
import ReactDOM from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import App from "./App.jsx";

// ---- Supabase connection (shared cloud storage for the shop's data) ----
const SUPABASE_URL = "https://xenqxvsretwtguaooosq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhlbnF4dnNyZXR3dGd1YW9vb3NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNzQ1NDIsImV4cCI6MjEwNDk1MDU0Mn0._1t09OYhkqOq5DQp03EnbrC7RQkmiTtjbg1elFOMmmo";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// This is the exact key App.jsx uses for the shop's business data (customers,
// orders, finance, ...). That single key is routed to the shared Supabase row
// below, so every device/browser signed in sees the same data. The login
// session key is intentionally NOT routed to the cloud — each device keeps
// its own sign-in, only the shop data itself is shared.
const CLOUD_DATA_KEY = "tailor-shop-data-v2";
const CLOUD_ROW_ID = "main";

const PREFIX = "tailor-shop-storage:";

window.storage = {
  async get(key) {
    if (key === CLOUD_DATA_KEY) {
      const { data, error } = await supabase.from("shop_data").select("data").eq("id", CLOUD_ROW_ID).single();
      if (error || !data || !data.data || Object.keys(data.data).length === 0) throw new Error("Key not found: " + key);
      return { key, value: JSON.stringify(data.data), shared: true };
    }
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) throw new Error("Key not found: " + key);
    return { key, value: raw, shared: false };
  },
  async set(key, value) {
    if (key === CLOUD_DATA_KEY) {
      const parsed = JSON.parse(value);
      const { error } = await supabase.from("shop_data").upsert({ id: CLOUD_ROW_ID, data: parsed, updated_at: new Date().toISOString() });
      if (error) throw error;
      return { key, value, shared: true };
    }
    localStorage.setItem(PREFIX + key, value);
    return { key, value, shared: false };
  },
  async delete(key) {
    if (key === CLOUD_DATA_KEY) {
      const { error } = await supabase.from("shop_data").update({ data: {} }).eq("id", CLOUD_ROW_ID);
      if (error) throw error;
      return { key, deleted: true, shared: true };
    }
    localStorage.removeItem(PREFIX + key);
    return { key, deleted: true, shared: false };
  },
  async list(prefix = "") {
    const keys = Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX + prefix))
      .map((k) => k.slice(PREFIX.length));
    return { keys, prefix, shared: false };
  },
};

// ---- One-time migration: if this browser already has locally-saved shop data
// (from before the cloud connection existed) and the cloud is still empty,
// offer to upload it once so nothing already entered gets lost. ----
async function migrateLocalDataIfNeeded() {
  const oldRaw = localStorage.getItem(PREFIX + CLOUD_DATA_KEY);
  if (!oldRaw) return;
  try {
    const { data: existing } = await supabase.from("shop_data").select("data").eq("id", CLOUD_ROW_ID).single();
    const cloudEmpty = !existing || !existing.data || Object.keys(existing.data).length === 0;
    if (!cloudEmpty) return;
    const proceed = window.confirm("تم العثور على بيانات محفوظة بهذا الجهاز من قبل. هل تريد رفعها الآن لقاعدة البيانات السحابية المشتركة ليراها كل الأجهزة؟");
    if (!proceed) return;
    const parsed = JSON.parse(oldRaw);
    const { error } = await supabase.from("shop_data").upsert({ id: CLOUD_ROW_ID, data: parsed, updated_at: new Date().toISOString() });
    if (error) { alert("تعذّر رفع البيانات: " + error.message); return; }
    alert("تم رفع بياناتك بنجاح! سيتم تحميلها الآن من كل مكان.");
  } catch (e) {
    // Table might not exist yet, or a network hiccup — the app still falls
    // back to a fresh state gracefully, so we don't block startup here.
  }
}

migrateLocalDataIfNeeded().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
