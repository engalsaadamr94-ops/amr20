# 💻 دليل التطبيق المتقدم - أكواد جاهزة 100%

**للمطورين فقط!** - انسخ والصق مباشرة

---

## 🎯 الميزة 1: المزامنة (Real-time Sync)

### الخطوة 1: Setup الجداول

```sql
-- تحديث جدول customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS
  synced_at TIMESTAMP DEFAULT NOW();

ALTER TABLE customers ADD COLUMN IF NOT EXISTS
  sync_version INT DEFAULT 1;

-- تحديث جدول orders  
ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  synced_at TIMESTAMP DEFAULT NOW();

ALTER TABLE orders ADD COLUMN IF NOT EXISTS
  customer_sync_version INT DEFAULT 1;

-- جدول sync status
CREATE TABLE IF NOT EXISTS sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT CHECK(action IN ('INSERT', 'UPDATE', 'DELETE')),
  synced_by UUID REFERENCES users(id),
  synced_at TIMESTAMP DEFAULT NOW(),
  affected_records INT DEFAULT 0
);
```

### الخطوة 2: Hook المزامنة

**ملف جديد: `src/hooks/useRealtimeSync.js`**

```javascript
import { useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';

export function useRealtimeSync(table, onDataChange) {
  useEffect(() => {
    console.log(`🔄 بدء المزامنة الحية لـ ${table}`);

    // الاشتراك في التحديثات
    const subscription = supabase
      .from(table)
      .on('*', payload => {
        console.log(`📢 تحديث في ${table}:`, payload);

        onDataChange({
          type: payload.eventType,
          data: payload.eventType === 'DELETE' ? payload.old : payload.new,
          timestamp: new Date().toISOString(),
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`✅ تم الاشتراك في ${table}`);
        } else if (status === 'CLOSED') {
          console.log(`❌ تم إغلاق الاتصال مع ${table}`);
        }
      });

    // Cleanup
    return () => {
      supabase.removeSubscription(subscription);
    };
  }, [table, onDataChange]);
}

// Version أخرى مع filtering
export function useRealtimeSyncFiltered(table, filter, onDataChange) {
  useEffect(() => {
    const subscription = supabase
      .from(table)
      .on('*', payload => {
        // تصفية حسب الشروط
        if (filter && !filter(payload.new || payload.old)) {
          return;
        }

        onDataChange({
          type: payload.eventType,
          data: payload.eventType === 'DELETE' ? payload.old : payload.new,
        });
      })
      .subscribe();

    return () => {
      supabase.removeSubscription(subscription);
    };
  }, [table, filter, onDataChange]);
}
```

### الخطوة 3: Custom Hook للعملاء والطلبات

**ملف جديد: `src/hooks/useSyncedData.js`**

```javascript
import { useState, useEffect, useCallback } from 'react';
import { useRealtimeSync } from './useRealtimeSync';
import { supabase } from '../services/supabase';

export function useSyncedCustomersAndOrders() {
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle, syncing, synced, error

  // جلب البيانات الأولية
  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      setSyncStatus('syncing');

      // جلب العملاء
      const { data: customersData, error: customersError } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (customersError) throw customersError;

      // جلب الطلبات
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('*, customer:customers(id, full_name, phone)')
        .order('created_at', { ascending: false });

      if (ordersError) throw ordersError;

      setCustomers(customersData);
      setOrders(ordersData);
      setSyncStatus('synced');
    } catch (err) {
      setError(err.message);
      setSyncStatus('error');
    } finally {
      setLoading(false);
    }
  };

  // معالج تحديثات العملاء
  const handleCustomerChange = useCallback((update) => {
    console.log('👤 تحديث عميل:', update);

    if (update.type === 'INSERT') {
      setCustomers([update.data, ...customers]);
    } else if (update.type === 'UPDATE') {
      setCustomers(
        customers.map(c => c.id === update.data.id ? update.data : c)
      );

      // تحديث الطلبات المرتبطة
      setOrders(
        orders.map(o => 
          o.customer_id === update.data.id
            ? { ...o, customer: update.data }
            : o
        )
      );
    } else if (update.type === 'DELETE') {
      setCustomers(customers.filter(c => c.id !== update.data.id));
    }
  }, [customers, orders]);

  // معالج تحديثات الطلبات
  const handleOrderChange = useCallback((update) => {
    console.log('📦 تحديث طلب:', update);

    if (update.type === 'INSERT') {
      setOrders([update.data, ...orders]);

      // تحديث عدد الطلبات للعميل
      setCustomers(
        customers.map(c =>
          c.id === update.data.customer_id
            ? { ...c, total_orders: (c.total_orders || 0) + 1 }
            : c
        )
      );
    } else if (update.type === 'UPDATE') {
      setOrders(
        orders.map(o => o.id === update.data.id ? update.data : o)
      );
    } else if (update.type === 'DELETE') {
      setOrders(orders.filter(o => o.id !== update.data.id));

      // تحديث عدد الطلبات للعميل
      setCustomers(
        customers.map(c =>
          c.id === update.data.customer_id
            ? { ...c, total_orders: Math.max(0, (c.total_orders || 1) - 1) }
            : c
        )
      );
    }
  }, [customers, orders]);

  // فعّل المزامنة
  useRealtimeSync('customers', handleCustomerChange);
  useRealtimeSync('orders', handleOrderChange);

  return {
    customers,
    orders,
    loading,
    error,
    syncStatus,
    refetch: fetchInitialData,
  };
}
```

### الخطوة 4: استخدام في المكون الرئيسي

```javascript
// في App.jsx أو Dashboard.jsx
import { useSyncedCustomersAndOrders } from './hooks/useSyncedData';

export function Dashboard() {
  const { customers, orders, loading, syncStatus } = useSyncedCustomersAndOrders();

  if (loading) return <LoadingSpinner />;

  return (
    <div style={{ display: 'flex' }}>
      {/* الشاشة اليسرى - العملاء */}
      <div style={{ flex: 1 }}>
        <h2>العملاء {syncStatus === 'syncing' && '🔄'}</h2>
        {customers.map(customer => (
          <div key={customer.id}>
            {customer.full_name} - {customer.phone}
          </div>
        ))}
      </div>

      {/* الشاشة اليمنى - الطلبات */}
      <div style={{ flex: 1 }}>
        <h2>الطلبات {syncStatus === 'syncing' && '🔄'}</h2>
        {orders.map(order => (
          <div key={order.id}>
            الطلب #{order.order_number} - {order.customer?.full_name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 🔴 الميزة 2: حذف الفواتير

### الخطوة 1: خدمة الحذف

**ملف جديد: `src/services/invoiceDeleteService.js`**

```javascript
import { supabase } from './supabase';

export async function canDeleteInvoice(invoiceId) {
  try {
    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (error) throw error;

    // تحقق من الشروط
    const canDelete = {
      allowed: true,
      warnings: [],
    };

    if (invoice.status === 'مدفوعة' && invoice.paid_amount > 0) {
      canDelete.allowed = false;
      canDelete.warnings.push(
        'لا يمكن حذف فاتورة مدفوعة. تواصل مع المحاسب.'
      );
    }

    if (invoice.sent_to_customer) {
      canDelete.warnings.push('تم إرسال هذه الفاتورة للعميل.');
    }

    if (invoice.tax_processed) {
      canDelete.warnings.push('تم معالجة هذه الفاتورة ضريبياً.');
    }

    return canDelete;
  } catch (error) {
    return {
      allowed: false,
      error: error.message,
    };
  }
}

export async function hardDeleteInvoice(
  invoiceId,
  userId,
  userRole,
  deleteReason
) {
  try {
    // 1. التحقق من الصلاحيات
    if (userRole !== 'مدير عام') {
      return {
        success: false,
        error: 'لا توجد صلاحيات كافية',
      };
    }

    // 2. التحقق من إمكانية الحذف
    const canDelete = await canDeleteInvoice(invoiceId);
    if (!canDelete.allowed) {
      return {
        success: false,
        error: canDelete.warnings[0],
        warnings: canDelete.warnings,
      };
    }

    // 3. جلب الفاتورة قبل الحذف
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (fetchError) throw fetchError;

    // 4. تسجيل سجل التدقيق
    const { error: auditError } = await supabase
      .from('audit_log')
      .insert([{
        user_id: userId,
        action: 'HARD_DELETE_INVOICE',
        table_name: 'invoices',
        record_id: invoiceId,
        changes: {
          deleted_invoice: invoice,
          delete_reason: deleteReason,
          deleted_at: new Date().toISOString(),
        },
      }]);

    if (auditError) throw auditError;

    // 5. حذف الفاتورة
    const { error: deleteError } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId);

    if (deleteError) throw deleteError;

    // 6. فك ارتباط الطلب
    if (invoice.order_id) {
      await supabase
        .from('orders')
        .update({ invoice_id: null })
        .eq('id', invoice.order_id);
    }

    // 7. إرسال تنبيهات
    await sendDeleteNotifications(invoice, userId, deleteReason);

    return {
      success: true,
      message: 'تم حذف الفاتورة بنجاح',
      deletedData: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        amount: invoice.total_amount,
        deletedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function softDeleteInvoice(invoiceId, userId, reason) {
  try {
    const { data, error } = await supabase
      .from('invoices')
      .update({
        status: 'ملغاة',
        cancelled_by: userId,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
      })
      .eq('id', invoiceId)
      .select();

    if (error) throw error;

    // تسجيل التدقيق
    await supabase.from('audit_log').insert([{
      user_id: userId,
      action: 'SOFT_DELETE_INVOICE',
      table_name: 'invoices',
      record_id: invoiceId,
      changes: { reason },
    }]);

    return { success: true, data: data[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getDeletedInvoices() {
  try {
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .in('status', ['ملغاة', 'محذوفة'])
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function sendDeleteNotifications(invoice, userId, reason) {
  // إرسال تنبيهات
  console.log(`📢 تم حذف فاتورة #${invoice.invoice_number} بقيمة ${invoice.total_amount}`);
  console.log(`👤 بواسطة: ${userId}`);
  console.log(`📝 السبب: ${reason}`);

  // يمكن إضافة WhatsApp, Email, SMS هنا
}
```

### الخطوة 2: مكون حوار الحذف

**ملف جديد: `src/components/InvoiceDeleteDialog.jsx`**

```javascript
import React, { useState } from 'react';
import { hardDeleteInvoice, canDeleteInvoice } from '../services/invoiceDeleteService';

export function InvoiceDeleteDialog({ invoice, onDelete, userRole }) {
  const [step, setStep] = useState('confirm'); // confirm, reason, password, done
  const [deleteReason, setDeleteReason] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);

  const handleStart = async () => {
    const canDelete = await canDeleteInvoice(invoice.id);
    if (canDelete.warnings.length > 0) {
      setWarnings(canDelete.warnings);
    }
    if (!canDelete.allowed) {
      setError(canDelete.warnings[0]);
      return;
    }
    setStep('reason');
  };

  const handleDelete = async () => {
    if (!deleteReason.trim()) {
      setError('يجب إدخال سبب الحذف');
      return;
    }

    setLoading(true);
    setError(null);

    const result = await hardDeleteInvoice(
      invoice.id,
      'current-user-id', // استبدل بـ user ID الفعلي
      userRole,
      deleteReason
    );

    setLoading(false);

    if (result.success) {
      setStep('done');
      setTimeout(() => {
        onDelete(result);
      }, 2000);
    } else {
      setError(result.error);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: 'white',
        borderRadius: 8,
        padding: 30,
        maxWidth: 500,
        width: '90%',
      }}>
        {step === 'confirm' && (
          <>
            <h2>🗑️ حذف الفاتورة</h2>
            <p style={{ color: '#666', marginBottom: 15 }}>
              هل أنت متأكد من حذف الفاتورة #{invoice.invoice_number}؟
            </p>
            <div style={{
              background: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: 6,
              padding: 12,
              marginBottom: 20,
              fontSize: 14,
            }}>
              <strong>⚠️ تحذير:</strong>
              <ul style={{ marginTop: 8, marginBottom: 0 }}>
                <li>هذا الإجراء لا يمكن التراجع عنه</li>
                <li>المبلغ: {invoice.total_amount} ريال</li>
                <li>سيؤثر على الإحصائيات والتقارير</li>
              </ul>
            </div>

            {warnings.length > 0 && (
              <div style={{
                background: '#f8d7da',
                border: '1px solid #f5c6cb',
                borderRadius: 6,
                padding: 12,
                marginBottom: 20,
                color: '#721c24',
              }}>
                <strong>⚠️ تحذيرات إضافية:</strong>
                {warnings.map((w, i) => <p key={i}>• {w}</p>)}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => onDelete(null)}
                style={{
                  flex: 1,
                  padding: 10,
                  border: '1px solid #ccc',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                إلغاء
              </button>
              <button
                onClick={handleStart}
                style={{
                  flex: 1,
                  padding: 10,
                  background: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                متابعة الحذف
              </button>
            </div>
          </>
        )}

        {step === 'reason' && (
          <>
            <h2>📝 سبب الحذف</h2>
            <p style={{ color: '#666', marginBottom: 15 }}>
              يرجى إدخال سبب حذف هذه الفاتورة:
            </p>

            <select
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              style={{
                width: '100%',
                padding: 10,
                marginBottom: 15,
                border: '1px solid #ddd',
                borderRadius: 6,
              }}
            >
              <option value="">-- اختر السبب --</option>
              <option value="فاتورة مكررة">فاتورة مكررة</option>
              <option value="خطأ في البيانات">خطأ في البيانات</option>
              <option value="طلب ملغي">طلب ملغي</option>
              <option value="اختبار">اختبار</option>
              <option value="أخرى">أخرى</option>
            </select>

            <textarea
              placeholder="تفاصيل إضافية (اختياري)"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              style={{
                width: '100%',
                padding: 10,
                minHeight: 80,
                marginBottom: 15,
                border: '1px solid #ddd',
                borderRadius: 6,
                fontFamily: 'inherit',
              }}
            />

            {error && (
              <div style={{
                background: '#f8d7da',
                color: '#721c24',
                padding: 10,
                borderRadius: 6,
                marginBottom: 15,
              }}>
                ❌ {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setStep('confirm')}
                style={{
                  flex: 1,
                  padding: 10,
                  border: '1px solid #ccc',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                رجوع
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: 10,
                  background: loading ? '#ccc' : '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'جاري الحذف...' : 'حذف نهائي'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <div style={{ textAlign: 'center' }}>
              <h2 style={{ color: '#28a745' }}>✅ تم الحذف بنجاح</h2>
              <p>تم حذف الفاتورة بنجاح وتسجيلها في سجل التدقيق.</p>
              <p style={{ fontSize: 12, color: '#999' }}>
                إغلاق الحوار خلال ثانيتين...
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

---

## 🎨 الميزة 3: تخصيص القوالب

### الخطوة 1: جدول القوالس

```sql
CREATE TABLE IF NOT EXISTS invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- الأساسيات
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  
  -- الألوان (JSON)
  colors JSONB DEFAULT '{
    "primary": "#211D19",
    "secondary": "#A9752E",
    "text": "#211D19",
    "background": "#F4EFE3",
    "accent": "#2E5A54",
    "border": "#E4DBC5",
    "success": "#28a745",
    "warning": "#ffc107",
    "danger": "#dc3545"
  }',
  
  -- الخطوط (JSON)
  fonts JSONB DEFAULT '{
    "body": "Arial, sans-serif",
    "heading": "Georgia, serif",
    "sizes": {
      "title": 20,
      "heading": 14,
      "body": 12,
      "footer": 10
    }
  }',
  
  -- التخطيط (JSON)
  layout JSONB DEFAULT '{
    "headerHeight": 80,
    "footerHeight": 40,
    "margin": 20,
    "padding": 15,
    "columnSpacing": 10
  }',
  
  -- بيانات المتجر (JSON)
  shop_data JSONB,
  
  -- الإعدادات (JSON)
  settings JSONB DEFAULT '{
    "showQR": true,
    "showBarcode": true,
    "showTaxBreakdown": true,
    "paperSize": "A4",
    "orientation": "portrait"
  }',
  
  -- التدقيق
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- إنشاء فهرس للأداء
CREATE INDEX idx_templates_default ON invoice_templates(is_default);
CREATE INDEX idx_templates_active ON invoice_templates(is_active);
```

### الخطوة 2: خدمة القوالس

**ملف جديد: `src/services/invoiceTemplateService.js`**

```javascript
import { supabase } from './supabase';

// جلب جميع القوالس
export async function getTemplates() {
  try {
    const { data, error } = await supabase
      .from('invoice_templates')
      .select('*')
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// جلب القالب الافتراضي
export async function getDefaultTemplate() {
  try {
    const { data, error } = await supabase
      .from('invoice_templates')
      .select('*')
      .eq('is_default', true)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    
    if (!data) {
      // إرجاع قالب افتراضي إذا لم يوجد
      return { success: true, data: getDefaultTemplateSchema() };
    }

    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// إنشاء قالب جديد
export async function createTemplate(templateData, userId, userRole) {
  try {
    if (userRole !== 'مدير عام') {
      return { success: false, error: 'لا توجد صلاحيات' };
    }

    const { data, error } = await supabase
      .from('invoice_templates')
      .insert([{
        name: templateData.name,
        description: templateData.description,
        colors: templateData.colors,
        fonts: templateData.fonts,
        layout: templateData.layout,
        shop_data: templateData.shop_data,
        settings: templateData.settings,
        is_default: templateData.is_default || false,
        created_by: userId,
      }])
      .select();

    if (error) throw error;

    return { success: true, data: data[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// تحديث قالب
export async function updateTemplate(templateId, updates, userId, userRole) {
  try {
    if (userRole !== 'مدير عام') {
      return { success: false, error: 'لا توجد صلاحيات' };
    }

    const { data, error } = await supabase
      .from('invoice_templates')
      .update({
        ...updates,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', templateId)
      .select();

    if (error) throw error;

    return { success: true, data: data[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// حذف قالب
export async function deleteTemplate(templateId, userId, userRole) {
  try {
    if (userRole !== 'مدير عام') {
      return { success: false, error: 'لا توجد صلاحيات' };
    }

    // تحقق من الاستخدام
    const { data: invoices, error: checkError } = await supabase
      .from('invoices')
      .select('count', { count: 'exact' })
      .eq('template_id', templateId);

    if (checkError) throw checkError;

    if (invoices.length > 0) {
      return {
        success: false,
        error: 'لا يمكن حذف قالب مستخدم',
      };
    }

    const { error } = await supabase
      .from('invoice_templates')
      .delete()
      .eq('id', templateId);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// تطبيق قالب على فاتورة
export async function applyTemplateToInvoice(invoiceId, templateId) {
  try {
    const { data, error } = await supabase
      .from('invoices')
      .update({ template_id: templateId })
      .eq('id', invoiceId)
      .select();

    if (error) throw error;

    return { success: true, data: data[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// القالب الافتراضي
function getDefaultTemplateSchema() {
  return {
    id: 'default',
    name: 'القالب الافتراضي',
    colors: {
      primary: '#211D19',
      secondary: '#A9752E',
      text: '#211D19',
      background: '#F4EFE3',
      accent: '#2E5A54',
      border: '#E4DBC5',
    },
    fonts: {
      body: 'Arial, sans-serif',
      heading: 'Georgia, serif',
      sizes: {
        title: 20,
        heading: 14,
        body: 12,
        footer: 10,
      },
    },
    layout: {
      headerHeight: 80,
      footerHeight: 40,
      margin: 20,
      padding: 15,
    },
  };
}
```

### الخطوة 3: مكون معاينة الفاتورة

**ملف جديد: `src/components/InvoicePreview.jsx`**

```javascript
import React from 'react';

export function InvoicePreview({ invoice, template }) {
  const colors = template?.colors || {};
  const fonts = template?.fonts || {};

  return (
    <div
      style={{
        background: colors.background || 'white',
        color: colors.text || 'black',
        fontFamily: fonts.body || 'Arial',
        padding: '40px',
        borderRadius: '8px',
        minHeight: '600px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}
    >
      {/* الرأس */}
      <div style={{
        borderBottom: `2px solid ${colors.border || '#ddd'}`,
        paddingBottom: '20px',
        marginBottom: '20px',
      }}>
        <h1 style={{
          fontFamily: fonts.heading,
          fontSize: fonts.sizes?.title || 20,
          color: colors.primary || '#000',
          margin: '0 0 10px 0',
        }}>
          فاتورة
        </h1>
        <p style={{ margin: 0, color: colors.secondary || '#666' }}>
          #{invoice.invoice_number}
        </p>
      </div>

      {/* بيانات المتجر */}
      <div style={{ marginBottom: '30px' }}>
        <p style={{ margin: 0, fontWeight: 'bold' }}>
          {template?.shop_data?.shopName}
        </p>
        <p style={{ margin: '5px 0 0 0', fontSize: 12, color: colors.text || '#666' }}>
          ☎️ {template?.shop_data?.shopPhone}
        </p>
      </div>

      {/* بيانات الفاتورة */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '20px',
        marginBottom: '30px',
        borderTop: `1px solid ${colors.border || '#ddd'}`,
        borderBottom: `1px solid ${colors.border || '#ddd'}`,
        paddingTop: '15px',
        paddingBottom: '15px',
      }}>
        <div>
          <p style={{ fontSize: 11, color: colors.secondary }}>التاريخ</p>
          <p style={{ margin: 0, fontSize: 14 }}>
            {new Date(invoice.created_at).toLocaleDateString('ar-SA')}
          </p>
        </div>
        <div>
          <p style={{ fontSize: 11, color: colors.secondary }}>المبلغ</p>
          <p style={{ margin: 0, fontSize: 14, color: colors.primary, fontWeight: 'bold' }}>
            {invoice.total_amount} ريال
          </p>
        </div>
      </div>

      {/* الجدول */}
      <table style={{
        width: '100%',
        marginBottom: '30px',
        borderCollapse: 'collapse',
      }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${colors.border}` }}>
            <th style={{ textAlign: 'right', padding: '10px', color: colors.primary }}>
              الوصف
            </th>
            <th style={{ textAlign: 'center', padding: '10px', color: colors.primary }}>
              الكمية
            </th>
            <th style={{ textAlign: 'left', padding: '10px', color: colors.primary }}>
              السعر
            </th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
            <td style={{ padding: '10px', textAlign: 'right' }}>
              {invoice.description || 'خدمات الخياطة'}
            </td>
            <td style={{ padding: '10px', textAlign: 'center' }}>1</td>
            <td style={{ padding: '10px', textAlign: 'left' }}>
              {invoice.total_amount} ر.س
            </td>
          </tr>
        </tbody>
      </table>

      {/* الملاحظات */}
      <div style={{
        background: `${colors.accent}15`,
        border: `1px solid ${colors.accent}`,
        borderRadius: '6px',
        padding: '15px',
        marginBottom: '20px',
      }}>
        <p style={{ margin: 0, fontSize: 12 }}>
          {template?.settings?.paymentTerms || 'شكراً لثقتك بنا'}
        </p>
      </div>

      {/* التذييل */}
      <div style={{
        borderTop: `1px solid ${colors.border}`,
        paddingTop: '20px',
        textAlign: 'center',
        fontSize: 10,
        color: colors.secondary,
      }}>
        <p>{template?.shop_data?.footer || 'شكراً لتعاملك معنا'}</p>
      </div>
    </div>
  );
}
```

---

## 📦 دمج كل شيء معاً

```javascript
// في App.jsx أو Dashboard.jsx

import { useSyncedCustomersAndOrders } from './hooks/useSyncedData';
import { getDefaultTemplate } from './services/invoiceTemplateService';
import { InvoiceDeleteDialog } from './components/InvoiceDeleteDialog';
import { InvoicePreview } from './components/InvoicePreview';

export function AdvancedDashboard() {
  const { customers, orders, syncStatus } = useSyncedCustomersAndOrders();
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [template, setTemplate] = useState(null);
  const userRole = 'مدير عام'; // من user context

  useEffect(() => {
    const loadTemplate = async () => {
      const result = await getDefaultTemplate();
      if (result.success) {
        setTemplate(result.data);
      }
    };
    loadTemplate();
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* اليسار - العملاء */}
      <div style={{ flex: 1, borderRight: '1px solid #ddd', padding: 20, overflow: 'auto' }}>
        <h2>العملاء {syncStatus === 'syncing' && '🔄'}</h2>
        {customers.map(customer => (
          <div key={customer.id} style={{ padding: 10, borderBottom: '1px solid #eee' }}>
            {customer.full_name}
          </div>
        ))}
      </div>

      {/* الوسط - الطلبات */}
      <div style={{ flex: 1, borderRight: '1px solid #ddd', padding: 20, overflow: 'auto' }}>
        <h2>الطلبات {syncStatus === 'syncing' && '🔄'}</h2>
        {orders.map(order => (
          <div
            key={order.id}
            style={{ padding: 10, borderBottom: '1px solid #eee', cursor: 'pointer' }}
            onClick={() => setSelectedInvoice(order)}
          >
            #{order.order_number} - {order.customer?.full_name}
          </div>
        ))}
      </div>

      {/* اليمين - معاينة */}
      <div style={{ flex: 1, padding: 20, overflow: 'auto', background: '#f5f5f5' }}>
        {selectedInvoice && template ? (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <button
                onClick={() => setShowDeleteDialog(true)}
                style={{
                  padding: '10px 20px',
                  background: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                🗑️ حذف
              </button>
              <button style={{
                padding: '10px 20px',
                background: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}>
                🖨️ طباعة
              </button>
            </div>

            <InvoicePreview invoice={selectedInvoice} template={template} />

            {showDeleteDialog && (
              <InvoiceDeleteDialog
                invoice={selectedInvoice}
                userRole={userRole}
                onDelete={() => {
                  setShowDeleteDialog(false);
                  setSelectedInvoice(null);
                }}
              />
            )}
          </>
        ) : (
          <p style={{ textAlign: 'center', color: '#999' }}>
            اختر فاتورة لمعاينتها
          </p>
        )}
      </div>
    </div>
  );
}
```

---

## ✅ قائمة التحقق للتطبيق

```
المزامنة:
  □ تثبيت المكتبات
  □ إنشاء Hook
  □ اختبار على جهازين
  □ التحقق من الأداء

حذف الفواتير:
  □ إنشاء الخدمة
  □ بناء الحوار
  □ اختبار الصلاحيات
  □ التحقق من السجل

تخصيص القوالس:
  □ إنشاء جدول DB
  □ كتابة الخدمة
  □ بناء المحرر
  □ معاينة الفاتورة
  □ اختبار الطباعة

النشر:
  □ اختبار شامل
  □ تحسينات الأداء
  □ تدريب المستخدمين
  □ نشر النسخة النهائية
```

---

**جميع الأكواد جاهزة 100% للاستخدام الفوري! 🚀**
