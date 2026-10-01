# 🔧 دليل التطبيق التقني - نظام إدارة متجر الخياطة

## المرحلة 1: ربط قاعدة البيانات (Supabase)

### الخطوة 1: إعداد Supabase

```bash
# 1. اذهب إلى https://supabase.com
# 2. أنشئ مشروع جديد (اختر المنطقة القريبة: UAE أو Middle East)
# 3. انسخ مفاتيح الوصول من Settings > API
```

### الخطوة 2: إضافة Supabase للمشروع

```bash
cd tailor-shop-app
npm install @supabase/supabase-js
```

### الخطوة 3: إنشاء ملف الإعدادات

**ملف جديد: `src/services/supabase.js`**

```javascript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

// دالة للتحقق من الاتصال
export async function testConnection() {
  try {
    const { data, error } = await supabase.from('users').select('count');
    if (error) throw error;
    console.log('✅ اتصال ناجح مع Supabase');
    return true;
  } catch (error) {
    console.error('❌ فشل الاتصال:', error);
    return false;
  }
}
```

### الخطوة 4: إنشاء ملف متغيرات البيئة

**ملف جديد: `.env.local`**

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### الخطوة 5: إنشاء الجداول في Supabase

اذهب إلى **SQL Editor** في Supabase وقم بتشغيل:

```sql
-- جدول المستخدمين
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  full_name TEXT,
  role TEXT CHECK(role IN ('مدير عام', 'مدير فرع', 'محاسب', 'موظف استقبال')),
  branch_id UUID REFERENCES branches(id),
  phone TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول العملاء
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  whatsapp TEXT,
  address TEXT,
  city TEXT,
  preferred_contact TEXT,
  total_orders INT DEFAULT 0,
  total_spent DECIMAL(10, 2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول الطلبات
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_type TEXT,
  total_price DECIMAL(10, 2),
  paid_amount DECIMAL(10, 2) DEFAULT 0,
  status TEXT CHECK(status IN ('تم الاستلام', 'القص', 'الخياطة', 'الكي', 'تركيب الأزرار', 'جاهز للتسليم', 'تم التسليم')),
  due_date DATE,
  delivery_date DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول التفاصيل (المقاسات والتصاميم)
CREATE TABLE order_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  quantity INT,
  measurements JSONB,
  design_specs JSONB,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- جدول سجل التدقيق
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action TEXT,
  table_name TEXT,
  record_id TEXT,
  changes JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- جدول الموظفين
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  hire_date DATE,
  salary DECIMAL(10, 2),
  branch_id UUID REFERENCES branches(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- جدول الحسابات المالية
CREATE TABLE finance_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT CHECK(type IN ('نقدي', 'بنك', 'شبكة')),
  balance DECIMAL(15, 2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول الفروع
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  manager_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- تفعيل Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- سياسة الأمان: كل مستخدم يرى بيانات فرعه فقط
CREATE POLICY "Users see their branch data" ON customers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND (users.role = 'مدير عام' OR TRUE) -- مدير عام يرى الكل
    )
  );
```

---

## المرحلة 2: خدمات قاعدة البيانات

**ملف جديد: `src/services/customerService.js`**

```javascript
import { supabase } from './supabase';

// إضافة عميل جديد
export async function addCustomer(customerData) {
  try {
    const { data, error } = await supabase
      .from('customers')
      .insert([
        {
          code: `CUST-${Date.now()}`,
          full_name: customerData.name,
          phone: customerData.phone,
          whatsapp: customerData.whatsapp,
          address: customerData.address,
          city: customerData.city,
          notes: customerData.notes,
        }
      ])
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// جلب جميع العملاء
export async function getCustomers() {
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// تحديث عميل
export async function updateCustomer(customerId, updates) {
  try {
    const { data, error } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', customerId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// حذف عميل
export async function deleteCustomer(customerId) {
  try {
    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', customerId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// البحث عن عميل
export async function searchCustomers(query) {
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`);

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

**ملف جديد: `src/services/orderService.js`**

```javascript
import { supabase } from './supabase';

// إضافة طلب جديد
export async function createOrder(orderData) {
  try {
    const { data, error } = await supabase
      .from('orders')
      .insert([
        {
          order_number: `ORD-${Date.now()}`,
          customer_id: orderData.customerId,
          order_type: orderData.type,
          total_price: orderData.totalPrice,
          status: 'تم الاستلام',
          due_date: orderData.dueDate,
          created_by: orderData.userId,
        }
      ])
      .select();

    if (error) throw error;

    // إضافة تفاصيل الطلب
    if (orderData.details) {
      await supabase
        .from('order_details')
        .insert([
          {
            order_id: data[0].id,
            quantity: orderData.details.quantity,
            measurements: orderData.details.measurements,
            design_specs: orderData.details.design,
            notes: orderData.details.notes,
          }
        ]);
    }

    // تسجيل في سجل التدقيق
    await logAuditTrail('orders', data[0].id, 'create', orderData.userId);

    return { success: true, data: data[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// تحديث حالة الطلب
export async function updateOrderStatus(orderId, newStatus, userId) {
  try {
    const { data, error } = await supabase
      .from('orders')
      .update({ status: newStatus, updated_at: new Date() })
      .eq('id', orderId)
      .select();

    if (error) throw error;

    // تسجيل في سجل التدقيق
    await logAuditTrail('orders', orderId, `status_change_to_${newStatus}`, userId);

    return { success: true, data: data[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// جلب الطلبات بتصفية
export async function getOrders(filters = {}) {
  try {
    let query = supabase
      .from('orders')
      .select(`
        *,
        customer:customers(*),
        details:order_details(*),
        created_by_user:users(full_name)
      `);

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.customerId) {
      query = query.eq('customer_id', filters.customerId);
    }
    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }
    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// سجل التدقيق
export async function logAuditTrail(tableName, recordId, action, userId) {
  try {
    await supabase
      .from('audit_log')
      .insert([
        {
          table_name: tableName,
          record_id: recordId,
          action,
          user_id: userId,
          changes: {},
        }
      ]);
  } catch (error) {
    console.error('خطأ في تسجيل التدقيق:', error);
  }
}
```

---

## المرحلة 3: نظام المصادقة (Authentication)

**ملف جديد: `src/services/authService.js`**

```javascript
import { supabase } from './supabase';

// تسجيل دخول آمن
export async function signInUser(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    // جلب بيانات المستخدم من جدول users
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (userError) throw userError;

    return {
      success: true,
      session: data.session,
      user: userData,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// إنشاء حساب جديد (للمدير فقط)
export async function createUser(email, password, userData) {
  try {
    // إنشاء حساب المصادقة
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) throw authError;

    // إضافة بيانات المستخدم
    const { data: userRecord, error: userError } = await supabase
      .from('users')
      .insert([
        {
          id: authData.user.id,
          email,
          full_name: userData.name,
          role: userData.role,
          branch_id: userData.branchId,
          phone: userData.phone,
        }
      ])
      .select();

    if (userError) throw userError;

    return { success: true, data: userRecord[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// تسجيل الخروج
export async function signOutUser() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// الحصول على الجلسة الحالية
export async function getCurrentSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return { success: true, session };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// التحقق من كلمة المرور (اختياري)
export async function changePassword(oldPassword, newPassword) {
  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// إعادة تعيين كلمة المرور
export async function resetPassword(email) {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

---

## المرحلة 4: React Hooks للحالة

**ملف جديد: `src/hooks/useCustomers.js`**

```javascript
import { useState, useEffect } from 'react';
import { getCustomers, addCustomer, updateCustomer, deleteCustomer } from '../services/customerService';

export function useCustomers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // جلب العملاء عند التحميل
  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    setLoading(true);
    const result = await getCustomers();
    if (result.success) {
      setCustomers(result.data);
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  const addNewCustomer = async (customerData) => {
    const result = await addCustomer(customerData);
    if (result.success) {
      setCustomers([result.data, ...customers]);
      return result;
    } else {
      setError(result.error);
      return result;
    }
  };

  const updateCustomerData = async (customerId, updates) => {
    const result = await updateCustomer(customerId, updates);
    if (result.success) {
      setCustomers(customers.map(c => c.id === customerId ? result.data : c));
      return result;
    } else {
      setError(result.error);
      return result;
    }
  };

  const deleteCustomerData = async (customerId) => {
    const result = await deleteCustomer(customerId);
    if (result.success) {
      setCustomers(customers.filter(c => c.id !== customerId));
      return result;
    } else {
      setError(result.error);
      return result;
    }
  };

  return {
    customers,
    loading,
    error,
    fetchCustomers,
    addNewCustomer,
    updateCustomerData,
    deleteCustomerData,
  };
}
```

---

## المرحلة 5: مكون معالجة الأخطاء

**ملف جديد: `src/components/ErrorBoundary.jsx`**

```javascript
import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('خطأ في التطبيق:', error, errorInfo);
    // يمكنك هنا إرسال الخطأ إلى خدمة تتبع الأخطاء (مثل Sentry)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40,
          textAlign: 'center',
          background: '#fff3cd',
          border: '2px solid #ffc107',
          borderRadius: 8,
          margin: 20,
        }}>
          <h2 style={{ color: '#856404' }}>⚠️ حدث خطأ</h2>
          <p style={{ color: '#856404', marginBottom: 20 }}>
            {this.state.error?.message || 'حدث خطأ غير متوقع'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              background: '#ffc107',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 'bold',
            }}
          >
            إعادة تحميل الصفحة
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

---

## المرحلة 6: تحديث App.jsx الرئيسي

**تعديل في `src/App.jsx` - بداية الملف:**

```javascript
import React, { useState, useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { getCurrentSession } from './services/authService';
import { testConnection } from './services/supabase';

// استبدل الجزء العلوي من الكود بهذا:

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbConnected, setDbConnected] = useState(false);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    // التحقق من الاتصال بقاعدة البيانات
    const connected = await testConnection();
    setDbConnected(connected);

    // التحقق من جلسة المستخدم
    const sessionResult = await getCurrentSession();
    if (sessionResult.success && sessionResult.session) {
      setUser(sessionResult.session.user);
    }

    setLoading(false);
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#F4EFE3',
      }}>
        <div style={{ textAlign: 'center' }}>
          <h2>جاري التحميل...</h2>
          <p>{dbConnected ? '✅ قاعدة البيانات متصلة' : '⏳ جاري الاتصال...'}</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {/* باقي الكود */}
    </ErrorBoundary>
  );
}

export default App;
```

---

## خطوات النشر النهائية

### 1. اختبار محليًا
```bash
npm install
npm run dev
# افتح http://localhost:5173
```

### 2. بناء المشروع
```bash
npm run build
# يتم إنشاء مجلد dist بالملفات المضغوطة
```

### 3. النشر على Vercel
```bash
npm install -g vercel
vercel --prod
```

### 4. إضافة متغيرات البيئة على Vercel
- اذهب إلى Project Settings
- أضف المتغيرات:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

---

## اختبار سريع للتحقق من النجاح

```javascript
// اختبر هذا في Console عند الدخول:
import { getCustomers } from './services/customerService';

const testFetch = async () => {
  const result = await getCustomers();
  console.log('البيانات:', result);
};

testFetch();
```

---

**ملاحظة:** هذا الدليل يوفر أساسًا قويًا. استمر في التحسينات حسب احتياجات الفريق!
