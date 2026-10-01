# 🎯 تحليل شامل: مزامنة البيانات + إدارة الفواتير المتقدمة

**تاريخ التحليل:** 1 أكتوبر 2026  
**الحالة:** جاهز للنقاش مع الفريق  
**المستوى:** متقدم جداً

---

## 🎨 نظرة عامة على المتطلبات الجديدة

### الطلب 1️⃣: مزامنة البيانات (اليمين ↔️ اليسار)
```
المقصود:
  بيانات العميل على اليسار
  ↕️ مزامنة حية (Real-time)
  بيانات الطلبات على اليمين
  
النتيجة المتوقعة:
  عند تحديث بيانات العميل → تُحدث الطلبات فوراً
  عند إضافة طلب جديد → يظهر تحت العميل تلقائياً
```

### الطلب 2️⃣: حذف الفواتير بصلاحيات محددة
```
من لديه الصلاحية:
  ✅ مدير عام فقط (المالك)
  ❌ محاسب
  ❌ موظف استقبال
  ❌ مدير فرع

نوع الحذف:
  🔴 حذف نهائي كامل (Hard Delete)
  ❌ بدون إمكانية استرجاع
  📝 مع تسجيل في سجل التدقيق

التأثير:
  • تحديث الإحصائيات تلقائياً
  • تحديث رصيد العملاء
  • إزالة من التقارير
```

### الطلب 3️⃣: تخصيص القوالب (Templates)
```
ما الذي يمكن تعديله:
  ✅ الألوان (background, text, borders)
  ✅ الخطوط (font-family, size)
  ✅ التخطيط (layout, spacing)
  ✅ الشعار والبيانات
  ✅ الرسالة في التذييل
  ✅ العملات والوحدات

من يستطيع:
  ✅ مدير عام فقط
  ❌ الآخرون (view only)

العدد:
  💾 حفظ عدة قوالب
  🔄 التبديل بينها سريع
  📋 تطبيق على جميع الفواتير
```

---

## 🔍 تحليل المشاكل الحالية

### المشكلة 1: عدم المزامنة
```javascript
// الكود الحالي (مشكلة):
const [customers, setCustomers] = useState([]);
const [orders, setOrders] = useState([]);

// عند تحديث عميل:
setCustomers([...]);
// ❌ الطلبات لا تُحدث تلقائياً
// ❌ المستخدم قد لا يرى التغيير

// ❌ يحتاج refresh يدوي
```

**التأثير:**
- بيانات متناقضة
- التباس في الواجهة
- أخطاء تدخل البيانات

---

### المشكلة 2: عدم القدرة على حذف الفواتير
```javascript
// الكود الحالي:
// ❌ لا توجد دالة حذف للفواتير
// ❌ بدون صلاحيات
// ❌ بدون تسجيل تدقيق
```

**النتيجة:**
- فواتير خاطئة لا يمكن إزالتها
- تكديس البيانات
- عدم القدرة على تصحيح الأخطاء

---

### المشكلة 3: قوالب ثابتة بدون تخصيص
```javascript
// الكود الحالي:
const invoiceTheme = "classic"; // ثابت فقط

// ❌ لا يمكن تغيير التصميم
// ❌ لا يمكن تخصيص الألوان
// ❌ لا يمكن إضافة شعار
// ❌ لا يمكن تعديل الرسائل
```

**التأثير:**
- فواتير موحدة بدون تمييز
- صعوبة إضافة متطلبات الضرائب
- عدم الاحترافية

---

## ✅ الحل المقترح

### الحل 1️⃣: مزامنة البيانات (Real-time Sync)

#### البنية المعمارية:
```
┌─────────────────────────────────────┐
│     Data Store (Supabase)           │
│  customers, orders, invoices        │
└─────────────────────────────────────┘
           ↑           ↓
     Realtime Updates
           ↑           ↓
┌──────────┴──────────────────────────┐
│   React Components (UI)             │
├─────────────────────────────────────┤
│ Left Panel: Customers               │ ↔️ Real-time
│ Right Panel: Orders/Invoices        │ Sync
└─────────────────────────────────────┘
```

#### الأكواد الموصى بها:

**Hook للمزامنة:**
```javascript
// src/hooks/useRealtimeSync.js
import { useEffect } from 'react';
import { supabase } from '../services/supabase';

export function useRealtimeSync(table, onDataChange) {
  useEffect(() => {
    // الاشتراك في التحديثات الحية
    const subscription = supabase
      .from(table)
      .on('*', payload => {
        console.log('تحديث حي:', payload);
        onDataChange(payload);
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [table, onDataChange]);
}

// الاستخدام:
const useCustomersWithSync = () => {
  const [customers, setCustomers] = useState([]);

  useRealtimeSync('customers', (payload) => {
    switch (payload.eventType) {
      case 'INSERT':
        setCustomers([...customers, payload.new]);
        break;
      case 'UPDATE':
        setCustomers(
          customers.map(c => c.id === payload.new.id ? payload.new : c)
        );
        break;
      case 'DELETE':
        setCustomers(customers.filter(c => c.id !== payload.old.id));
        break;
    }
  });

  return customers;
};
```

**خدمة المزامنة:**
```javascript
// src/services/syncService.js
import { supabase } from './supabase';

// تحديث بيانات العميل ومزامنة الطلبات
export async function updateCustomerAndSync(customerId, updates) {
  try {
    // 1. تحديث العميل
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', customerId)
      .select();

    if (customerError) throw customerError;

    // 2. جلب جميع الطلبات المرتبطة
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_id', customerId);

    if (ordersError) throw ordersError;

    // 3. تسجيل في التدقيق
    await logAuditTrail('customers', customerId, 'update_with_sync', {
      updates,
      affectedOrders: orders.length,
    });

    return {
      success: true,
      customer: customerData[0],
      syncedOrders: orders,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// إضافة طلب جديد ومزامنة العميل
export async function createOrderAndSync(orderData) {
  try {
    // 1. إنشاء الطلب
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([orderData])
      .select();

    if (orderError) throw orderError;

    // 2. تحديث عدد الطلبات للعميل
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .update({
        total_orders: orderData.total_orders + 1,
        total_spent: (orderData.total_spent || 0) + (orderData.total_price || 0),
      })
      .eq('id', orderData.customer_id)
      .select();

    if (customerError) throw customerError;

    // 3. تسجيل في التدقيق
    await logAuditTrail('orders', order[0].id, 'create_with_sync', {
      customerId: orderData.customer_id,
      affectedCustomer: customer[0],
    });

    return {
      success: true,
      order: order[0],
      updatedCustomer: customer[0],
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

---

### الحل 2️⃣: حذف الفواتير (Hard Delete)

#### سياسة الحذف:
```
من يستطيع؟
  ✅ مدير عام (المالك فقط)
  ❌ مديرو الفروع
  ❌ المحاسبون
  ❌ موظفو الاستقبال

متى يُحذف؟
  • فاتورة خاطئة أو مكررة
  • طلب ملغي بالكامل
  • عملية اختبار
  • تصحيح بيانات

التحذيرات:
  ⚠️ حذف نهائي لا يمكن التراجع عنه
  ⚠️ سيؤثر على التقارير والإحصائيات
  ⚠️ سيُسجل في audit trail
  ⚠️ قد يؤثر على الضريبة
```

#### الأكواد:
```javascript
// src/services/invoiceService.js
import { supabase } from './supabase';

// حذف فاتورة (Hard Delete)
export async function hardDeleteInvoice(invoiceId, userId, userRole) {
  try {
    // 1. التحقق من الصلاحيات
    if (userRole !== 'مدير عام') {
      return {
        success: false,
        error: 'فقط مدير النظام يمكنه حذف الفواتير',
      };
    }

    // 2. جلب بيانات الفاتورة قبل الحذف (للتدقيق)
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('*, orders(*)')
      .eq('id', invoiceId)
      .single();

    if (fetchError) throw fetchError;

    // 3. التحقق من الحالة (لا تحذف فواتير مدفوعة)
    if (invoice.status === 'مدفوعة' && invoice.paid_amount > 0) {
      return {
        success: false,
        error: 'لا يمكن حذف فواتير مدفوعة جزئياً أو كلياً. تواصل مع المحاسب أولاً.',
        warningLevel: 'high',
      };
    }

    // 4. إزالة الفاتورة من الطلب
    if (invoice.order_id) {
      await supabase
        .from('orders')
        .update({ invoice_id: null })
        .eq('id', invoice.order_id);
    }

    // 5. حذف الفاتورة (Hard Delete)
    const { error: deleteError } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId);

    if (deleteError) throw deleteError;

    // 6. تسجيل في سجل التدقيق المفصل
    await supabase
      .from('audit_log')
      .insert([{
        user_id: userId,
        action: 'HARD_DELETE_INVOICE',
        table_name: 'invoices',
        record_id: invoiceId,
        changes: {
          deleted_invoice: invoice,
          reason: 'حذف نهائي بواسطة مدير النظام',
          timestamp: new Date().toISOString(),
        },
      }]);

    // 7. إرسال تنبيه للمحاسب
    await notifyAccountant(
      `تم حذف فاتورة #${invoice.invoice_number} بواسطة ${userId}. المبلغ: ${invoice.total_amount}`
    );

    return {
      success: true,
      message: 'تم حذف الفاتورة بنجاح',
      deletedInvoice: {
        id: invoice.id,
        number: invoice.invoice_number,
        amount: invoice.total_amount,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// حذف عملية كاملة (طلب + فاتورة + كل شيء)
export async function hardDeleteOperation(orderId, userId, userRole) {
  try {
    // 1. التحقق من الصلاحيات
    if (userRole !== 'مدير عام') {
      return { success: false, error: 'لا توجد صلاحيات' };
    }

    // 2. جلب الطلب والفاتورة
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, invoices(*), order_details(*)')
      .eq('id', orderId)
      .single();

    if (orderError) throw orderError;

    // 3. حذف التفاصيل
    if (order.order_details && order.order_details.length > 0) {
      await supabase
        .from('order_details')
        .delete()
        .in('id', order.order_details.map(d => d.id));
    }

    // 4. حذف الفاتورة
    if (order.invoices && order.invoices.length > 0) {
      await supabase
        .from('invoices')
        .delete()
        .in('id', order.invoices.map(i => i.id));
    }

    // 5. حذف الطلب
    await supabase
      .from('orders')
      .delete()
      .eq('id', orderId);

    // 6. تحديث إحصائيات العميل
    await supabase
      .from('customers')
      .update({
        total_orders: Math.max(0, (order.total_orders || 1) - 1),
        total_spent: Math.max(0, (order.total_spent || 0) - (order.total_price || 0)),
      })
      .eq('id', order.customer_id);

    // 7. تسجيل التدقيق
    await supabase.from('audit_log').insert([{
      user_id: userId,
      action: 'HARD_DELETE_OPERATION',
      table_name: 'orders',
      record_id: orderId,
      changes: {
        deleted_order: order,
        deleted_invoices_count: order.invoices?.length || 0,
        deleted_details_count: order.order_details?.length || 0,
      },
    }]);

    return {
      success: true,
      message: 'تم حذف العملية بالكامل',
      deletedData: {
        orderId,
        invoicesCount: order.invoices?.length || 0,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// تنبيه للمحاسب
async function notifyAccountant(message) {
  // يمكن إرسال WhatsApp أو بريد إلكتروني
  console.log('📢 تنبيه المحاسب:', message);
}
```

---

### الحل 3️⃣: تخصيص قوالب الفواتير (Template Manager)

#### هيكل قالب الفاتورة:
```javascript
// النموذج:
{
  id: "template-1",
  name: "قالب الأساس",
  isDefault: true,
  
  // ألوان
  colors: {
    primary: "#211D19",        // اللون الأساسي
    secondary: "#A9752E",       // اللون الثانوي
    text: "#211D19",           // لون النصوص
    background: "#F4EFE3",     // لون الخلفية
    accent: "#2E5A54",         // لون التمييز
    border: "#E4DBC5",         // لون الحدود
  },
  
  // الخطوط
  fonts: {
    body: "Arial, sans-serif",
    heading: "Georgia, serif",
    size: {
      title: 20,
      heading: 14,
      body: 12,
      footer: 10,
    },
  },
  
  // التخطيط
  layout: {
    headerHeight: 80,
    footerHeight: 40,
    margin: 20,
    padding: 15,
    columnSpacing: 10,
  },
  
  // البيانات
  data: {
    logo: "base64-image-data",
    shopName: "مشغل الخياطة الرجالية",
    shopAddress: "الرياض - شارع النيل",
    shopPhone: "+966501234567",
    shopEmail: "info@tailor.com",
    taxNumber: "1234567890",
  },
  
  // الرسائل
  messages: {
    footer: "شكراً لتعاملك معنا",
    thankYou: "شكراً على ثقتك بنا",
    paymentTerms: "الدفع عند الاستلام",
  },
  
  // الإعدادات المتقدمة
  settings: {
    showQR: true,
    showBarcode: true,
    showTaxBreakdown: true,
    showTimeline: true,
    paperSize: "A4",
    orientation: "portrait",
  },
}
```

#### خدمة إدارة القوالب:
```javascript
// src/services/invoiceTemplateService.js
import { supabase } from './supabase';

// إنشاء قالب جديد
export async function createInvoiceTemplate(templateData, userId, userRole) {
  try {
    // التحقق من الصلاحيات
    if (userRole !== 'مدير عام') {
      return { success: false, error: 'لا توجد صلاحيات' };
    }

    const { data, error } = await supabase
      .from('invoice_templates')
      .insert([{
        ...templateData,
        created_by: userId,
        created_at: new Date(),
      }])
      .select();

    if (error) throw error;

    return { success: true, data: data[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// تحديث قالب
export async function updateInvoiceTemplate(templateId, updates, userId, userRole) {
  try {
    if (userRole !== 'مدير عام') {
      return { success: false, error: 'لا توجد صلاحيات' };
    }

    const { data, error } = await supabase
      .from('invoice_templates')
      .update({
        ...updates,
        updated_by: userId,
        updated_at: new Date(),
      })
      .eq('id', templateId)
      .select();

    if (error) throw error;

    // تسجيل التدقيق
    await supabase.from('audit_log').insert([{
      user_id: userId,
      action: 'UPDATE_TEMPLATE',
      table_name: 'invoice_templates',
      record_id: templateId,
      changes: updates,
    }]);

    return { success: true, data: data[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// حذف قالب
export async function deleteInvoiceTemplate(templateId, userId, userRole) {
  try {
    if (userRole !== 'مدير عام') {
      return { success: false, error: 'لا توجد صلاحيات' };
    }

    // تحقق من عدم استخدام القالب
    const { data: invoices, error: checkError } = await supabase
      .from('invoices')
      .select('count')
      .eq('template_id', templateId);

    if (checkError) throw checkError;

    if (invoices[0].count > 0) {
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

// جلب القالب الافتراضي
export async function getDefaultTemplate() {
  try {
    const { data, error } = await supabase
      .from('invoice_templates')
      .select('*')
      .eq('isDefault', true)
      .single();

    if (error) throw error;
    return { success: true, data };
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
```

#### مكون محرر القالب (UI):
```javascript
// src/components/InvoiceTemplateEditor.jsx
import React, { useState } from 'react';
import { createInvoiceTemplate, updateInvoiceTemplate } from '../services/invoiceTemplateService';

export function InvoiceTemplateEditor({ template, onSave, userRole }) {
  const [formData, setFormData] = useState(template || {
    name: '',
    colors: { primary: '#211D19', secondary: '#A9752E' },
    fonts: { body: 'Arial', heading: 'Georgia' },
    data: { shopName: '', shopPhone: '' },
    messages: { footer: '' },
  });

  const [preview, setPreview] = useState(false);

  const handleColorChange = (colorKey, value) => {
    setFormData({
      ...formData,
      colors: { ...formData.colors, [colorKey]: value },
    });
  };

  const handleFontChange = (fontKey, value) => {
    setFormData({
      ...formData,
      fonts: { ...formData.fonts, [fontKey]: value },
    });
  };

  const handleDataChange = (field, value) => {
    setFormData({
      ...formData,
      data: { ...formData.data, [field]: value },
    });
  };

  const handleSave = async () => {
    if (userRole !== 'مدير عام') {
      alert('لا توجد صلاحيات');
      return;
    }

    const result = template?.id
      ? await updateInvoiceTemplate(template.id, formData)
      : await createInvoiceTemplate(formData);

    if (result.success) {
      alert('✅ تم حفظ القالب بنجاح');
      onSave(result.data);
    } else {
      alert('❌ خطأ: ' + result.error);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 20, height: '100vh' }}>
      {/* محرر */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <h2>محرر قالب الفاتورة</h2>

        {/* الألوان */}
        <fieldset style={{ marginBottom: 20, padding: 15, border: '1px solid #ddd' }}>
          <legend>🎨 الألوان</legend>
          {Object.entries(formData.colors || {}).map(([key, value]) => (
            <div key={key} style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ width: 120 }}>{key}:</label>
              <input
                type="color"
                value={value}
                onChange={(e) => handleColorChange(key, e.target.value)}
                style={{ width: 50, height: 50, cursor: 'pointer' }}
              />
              <input
                type="text"
                value={value}
                onChange={(e) => handleColorChange(key, e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          ))}
        </fieldset>

        {/* الخطوط */}
        <fieldset style={{ marginBottom: 20, padding: 15, border: '1px solid #ddd' }}>
          <legend>📝 الخطوط</legend>
          <div style={{ marginBottom: 10 }}>
            <label>خط النص:</label>
            <input
              value={formData.fonts?.body || ''}
              onChange={(e) => handleFontChange('body', e.target.value)}
              placeholder="Arial, sans-serif"
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label>خط العناوين:</label>
            <input
              value={formData.fonts?.heading || ''}
              onChange={(e) => handleFontChange('heading', e.target.value)}
              placeholder="Georgia, serif"
            />
          </div>
        </fieldset>

        {/* بيانات المتجر */}
        <fieldset style={{ marginBottom: 20, padding: 15, border: '1px solid #ddd' }}>
          <legend>🏪 بيانات المتجر</legend>
          <div style={{ marginBottom: 10 }}>
            <label>اسم المتجر:</label>
            <input
              value={formData.data?.shopName || ''}
              onChange={(e) => handleDataChange('shopName', e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label>الهاتف:</label>
            <input
              value={formData.data?.shopPhone || ''}
              onChange={(e) => handleDataChange('shopPhone', e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label>البريد الإلكتروني:</label>
            <input
              value={formData.data?.shopEmail || ''}
              onChange={(e) => handleDataChange('shopEmail', e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </fieldset>

        {/* الرسائل */}
        <fieldset style={{ marginBottom: 20, padding: 15, border: '1px solid #ddd' }}>
          <legend>💬 الرسائل</legend>
          <div style={{ marginBottom: 10 }}>
            <label>رسالة التذييل:</label>
            <textarea
              value={formData.messages?.footer || ''}
              onChange={(e) => {
                setFormData({
                  ...formData,
                  messages: { ...formData.messages, footer: e.target.value },
                });
              }}
              style={{ width: '100%', minHeight: 80 }}
            />
          </div>
        </fieldset>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setPreview(!preview)} style={{ padding: '10px 20px' }}>
            👁️ معاينة
          </button>
          <button onClick={handleSave} style={{ padding: '10px 20px', background: '#211D19', color: 'white' }}>
            💾 حفظ
          </button>
        </div>
      </div>

      {/* معاينة */}
      {preview && (
        <div style={{ flex: 1, overflow: 'auto', padding: 20, background: '#f5f5f5' }}>
          <div
            style={{
              background: formData.colors?.background || 'white',
              color: formData.colors?.text || 'black',
              border: `2px solid ${formData.colors?.border || '#ccc'}`,
              padding: '40px',
              borderRadius: '8px',
              fontFamily: formData.fonts?.body || 'Arial',
            }}
          >
            <h1 style={{ fontFamily: formData.fonts?.heading }}>
              فاتورة
            </h1>
            <div style={{ marginTop: 20 }}>
              <h3>{formData.data?.shopName}</h3>
              <p>☎️ {formData.data?.shopPhone}</p>
              <p>📧 {formData.data?.shopEmail}</p>
            </div>

            {/* محتوى الفاتورة */}
            <div style={{ marginTop: 30, borderTop: `2px solid ${formData.colors?.border}`, paddingTop: 20 }}>
              <p>رقم الفاتورة: #1001</p>
              <p>التاريخ: 1/10/2026</p>
            </div>

            {/* التذييل */}
            <div
              style={{
                marginTop: 30,
                paddingTop: 20,
                borderTop: `1px solid ${formData.colors?.border}`,
                textAlign: 'center',
                fontSize: '12px',
              }}
            >
              {formData.messages?.footer}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 📋 جدول المقارنة: الحل الحالي vs المقترح

| الميزة | الحالي ❌ | المقترح ✅ |
|--------|---------|----------|
| **المزامنة** | بدون (manual) | Real-time تلقائي |
| **حذف الفواتير** | غير ممكن | مدير عام فقط |
| **تخصيص القوالب** | ثابت | كامل (ألوان، خطوط، نصوص) |
| **تسجيل التدقيق** | بسيط | مفصل جداً |
| **سهولة الاستخدام** | معقدة | سهلة جداً |
| **الأداء** | متوسط | عالي جداً |

---

## 🎯 الفوائد المتوقعة

### 1. للمدير/المالك:
```
✅ تحكم كامل بتصميم الفواتير
✅ حذف الأخطاء بسهولة
✅ متابعة دقيقة من خلال audit trail
✅ احترافية أعلى في العروض
```

### 2. للموظفين:
```
✅ بيانات محدثة فوراً
✅ بدون حاجة refresh يدوي
✅ واجهة أوضح
✅ تجربة أسهل
```

### 3. للعملاء:
```
✅ فواتير احترافية
✅ شعور بالثقة والاستقرار
✅ تجربة أفضل
```

---

## 🛠️ الخطة التقنية

### المرحلة 1️⃣: المزامنة (1 أسبوع)
```
□ إعداد Supabase realtime
□ كتابة hook المزامنة
□ اختبار المزامنة الثنائية
□ نشر والاختبار
```

### المرحلة 2️⃣: حذف الفواتير (3 أيام)
```
□ إضافة أزرار الحذف
□ التحقق من الصلاحيات
□ تسجيل التدقيق
□ تنبيهات الحذف
□ اختبار شامل
```

### المرحلة 3️⃣: تخصيص القوالب (1-2 أسبوع)
```
□ إنشاء جدول templates
□ كتابة خدمة إدارة القوالب
□ بناء محرر القالب (UI)
□ معاينة الفاتورة
□ تطبيق القالب على الفواتير
□ اختبار شامل
```

**الإجمالي: 2-3 أسابيع**

---

## 📊 المخاطر والحلول

| المخاطر | الاحتمالية | الحل |
|--------|-----------|------|
| فقدان بيانات عند حذف | عالية | نسخ احتياطية + تسجيل كامل |
| تأخر المزامنة | متوسطة | استخدام Supabase realtime |
| أخطاء التخصيص | منخفضة | معاينة فورية + اختبار |
| مشاكل الصلاحيات | منخفضة | تحقق backend + frontend |

---

## ✅ المتطلبات الفنية

### قاعدة البيانات:
```sql
-- جدول القوالب
CREATE TABLE invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  colors JSONB,
  fonts JSONB,
  layout JSONB,
  data JSONB,
  messages JSONB,
  settings JSONB,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- تحديث جدول الفواتير
ALTER TABLE invoices ADD COLUMN template_id UUID REFERENCES invoice_templates(id);

-- تحديث audit log
ALTER TABLE audit_log ADD COLUMN soft_delete BOOLEAN DEFAULT FALSE;
ALTER TABLE audit_log ADD COLUMN delete_reason TEXT;
```

### React Hooks المطلوبة:
```
✅ useRealtimeSync
✅ useInvoiceTemplates
✅ usePermissions
✅ useAuditLog
```

---

## 💡 توصيات إضافية

### 1. الأمان:
```
⚠️ تحقق من الصلاحيات على backend (ليس frontend فقط)
⚠️ قيّد حذف الفواتير المدفوعة
⚠️ احفظ نسخة من الفاتورة قبل الحذف
⚠️ أرسل تنبيهات عند حذف
```

### 2. الأداء:
```
⚠️ استخدم caching للقوالس
⚠️ lazy load معاينات الفواتير
⚠️ optimize queries
⚠️ استخدم pagination للفواتير
```

### 3. UX:
```
⚠️ رسائل تحذير واضحة قبل الحذف
⚠️ معاينة فورية للتغييرات
⚠️ undo سريع (ليس hard delete)
⚠️ شرح المتطلبات للمستخدم
```

---

## 🎓 ملاحظات مهمة

### تحديات محتملة:
1. **التعقيد:** 3 ميزات = تطوير أطول
2. **الاختبار:** بحاجة اختبارات شاملة
3. **الأداء:** المزامنة قد تبطئ التطبيق
4. **الأمان:** يحتاج تحكم دقيق بالصلاحيات

### أفضل الممارسات:
1. ابدأ بـ MVP (Minimum Viable Product)
2. اختبر كل ميزة على حدة
3. اطلب تعليقات المستخدمين
4. حسّن بناء على التعليقات

---

**هذا التحليل جاهز للنقاش مع الفريق! 🚀**
