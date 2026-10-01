# 💻 أكواد جاهزة 100% - نظام كشف حساب الموظفين

**للمطورين:** نسخ والصق مباشرة في مشروعك!

---

## 🎯 الميزة 1: إدارة المعاملات

### الخطوة 1: خدمة المعاملات

**ملف جديد: `src/services/employeeAccountService.js`**

```javascript
import { supabase } from './supabase';

// إضافة معاملة جديدة (دخول)
export async function addInflow(transactionData, userId) {
  try {
    const {
      employee_id,
      transaction_type,
      amount,
      description,
      reference_id,
      reference_type,
      piece_count,
      percentage,
      order_amount,
    } = transactionData;

    // 1. احسب الرصيد الحالي
    const { data: employee, error: fetchError } = await supabase
      .from('employees')
      .select('current_balance')
      .eq('id', employee_id)
      .single();

    if (fetchError) throw fetchError;

    const balance_before = employee.current_balance || 0;
    const balance_after = balance_before + amount;

    // 2. أضف المعاملة
    const { data: transaction, error: insertError } = await supabase
      .from('employee_transactions')
      .insert([{
        employee_id,
        transaction_type,
        amount,
        description,
        reference_id,
        reference_type,
        piece_count: piece_count || 0,
        percentage,
        order_amount,
        status: 'CREDITED',
        created_by: userId,
        balance_before,
        balance_after,
      }])
      .select();

    if (insertError) throw insertError;

    // 3. حدّث رصيد الموظف
    const { error: updateError } = await supabase
      .from('employees')
      .update({
        current_balance: balance_after,
        last_balance_update: new Date().toISOString(),
      })
      .eq('id', employee_id);

    if (updateError) throw updateError;

    // 4. سجل في audit log
    await logAuditTrail(
      'ADD_INFLOW',
      employee_id,
      {
        amount,
        type: transaction_type,
        newBalance: balance_after,
      }
    );

    return {
      success: true,
      data: transaction[0],
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// إضافة معاملة جديدة (خروج/صرف)
export async function addWithdrawal(
  employeeId,
  amount,
  withdrawalSlipId,
  userId
) {
  try {
    // 1. احسب الرصيد الحالي
    const { data: employee, error: fetchError } = await supabase
      .from('employees')
      .select('current_balance')
      .eq('id', employeeId)
      .single();

    if (fetchError) throw fetchError;

    const balance_before = employee.current_balance || 0;
    const balance_after = balance_before - amount;

    // تحقق من الرصيد الكافي
    if (balance_after < 0) {
      return {
        success: false,
        error: 'رصيد الموظف غير كافي',
        required: amount,
        available: balance_before,
      };
    }

    // 2. أضف المعاملة
    const { data: transaction, error: insertError } = await supabase
      .from('employee_transactions')
      .insert([{
        employee_id: employeeId,
        transaction_type: 'WITHDRAWAL',
        amount: -amount, // سالب للخروج
        description: `سند صرف #${withdrawalSlipId}`,
        reference_id: withdrawalSlipId,
        reference_type: 'WITHDRAWAL',
        status: 'CREDITED',
        created_by: userId,
        balance_before,
        balance_after,
      }])
      .select();

    if (insertError) throw insertError;

    // 3. حدّث رصيد الموظف
    const { error: updateError } = await supabase
      .from('employees')
      .update({
        current_balance: balance_after,
        last_balance_update: new Date().toISOString(),
      })
      .eq('id', employeeId);

    if (updateError) throw updateError;

    // 4. حدّث سند الصرف
    await supabase
      .from('withdrawal_slips')
      .update({
        status: 'PAID',
        paid_by: userId,
        paid_at: new Date().toISOString(),
      })
      .eq('id', withdrawalSlipId);

    return {
      success: true,
      message: 'تم الصرف بنجاح',
      newBalance: balance_after,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// جلب معاملات الموظف
export async function getEmployeeTransactions(
  employeeId,
  startDate,
  endDate,
  limit = 50
) {
  try {
    const { data, error } = await supabase
      .from('employee_transactions')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return {
      success: true,
      data,
      count: data.length,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// جلب الرصيد الحالي
export async function getEmployeeBalance(employeeId) {
  try {
    const { data, error } = await supabase
      .from('employees')
      .select('id, full_name, current_balance, payment_method, last_balance_update')
      .eq('id', employeeId)
      .single();

    if (error) throw error;

    return {
      success: true,
      data: {
        employeeId: data.id,
        name: data.full_name,
        balance: data.current_balance,
        paymentMethod: data.payment_method,
        lastUpdate: data.last_balance_update,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// حساب الراتب الشهري (مهمة دورية)
export async function processMonthlySalaries(month, year, userId) {
  try {
    // 1. احصل على جميع الموظفين براتب شهري
    const { data: employees, error: fetchError } = await supabase
      .from('employees')
      .select('id, full_name, monthly_salary, current_balance')
      .eq('payment_method', 'MONTHLY')
      .eq('account_status', 'ACTIVE')
      .gt('monthly_salary', 0);

    if (fetchError) throw fetchError;

    let processedCount = 0;
    let failedCount = 0;

    // 2. أضف راتب لكل موظف
    for (const employee of employees) {
      try {
        const balance_before = employee.current_balance || 0;
        const balance_after = balance_before + employee.monthly_salary;

        // أضف المعاملة
        await supabase
          .from('employee_transactions')
          .insert([{
            employee_id: employee.id,
            transaction_type: 'MONTHLY_SALARY',
            amount: employee.monthly_salary,
            description: `راتب شهري - ${month}/${year}`,
            reference_id: `SALARY-${month}-${year}`,
            reference_type: 'SALARY',
            status: 'CREDITED',
            created_by: userId,
            balance_before,
            balance_after,
          }]);

        // حدّث الرصيد
        await supabase
          .from('employees')
          .update({
            current_balance: balance_after,
            last_balance_update: new Date().toISOString(),
          })
          .eq('id', employee.id);

        processedCount++;
      } catch (err) {
        console.error(`فشل في معالجة راتب ${employee.full_name}:`, err);
        failedCount++;
      }
    }

    return {
      success: true,
      message: `تمت معالجة ${processedCount} راتب بنجاح`,
      processed: processedCount,
      failed: failedCount,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// سجل التدقيق
async function logAuditTrail(action, employeeId, details) {
  try {
    await supabase
      .from('audit_log')
      .insert([{
        user_id: 'current-user-id',
        action,
        table_name: 'employees',
        record_id: employeeId,
        changes: details,
      }]);
  } catch (error) {
    console.error('فشل التسجيل:', error);
  }
}
```

---

## 🎯 الميزة 2: سندات الصرف

### الخطوة 1: خدمة السندات

**ملف جديد: `src/services/withdrawalSlipService.js`**

```javascript
import { supabase } from './supabase';

// إنشاء سند صرف جديد
export async function createWithdrawalSlip(slipData, userId) {
  try {
    const { employeeId, amount, purpose, description } = slipData;

    // تحقق من الرصيد
    const { data: employee, error: fetchError } = await supabase
      .from('employees')
      .select('current_balance')
      .eq('id', employeeId)
      .single();

    if (fetchError) throw fetchError;

    if (employee.current_balance < amount) {
      return {
        success: false,
        error: 'الرصيد غير كافي',
        available: employee.current_balance,
        required: amount,
        shortfall: amount - employee.current_balance,
      };
    }

    // أنشئ السند
    const { data: slip, error: insertError } = await supabase
      .from('withdrawal_slips')
      .insert([{
        slip_number: `WD-${Date.now()}`,
        employee_id: employeeId,
        amount,
        purpose,
        description,
        status: 'REQUESTED',
        requested_by: userId,
      }])
      .select();

    if (insertError) throw insertError;

    return {
      success: true,
      data: slip[0],
      message: 'تم إرسال الطلب للموافقة',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// موافقة على سند صرف
export async function approveWithdrawalSlip(slipId, userId) {
  try {
    const { data: slip, error: fetchError } = await supabase
      .from('withdrawal_slips')
      .select('*')
      .eq('id', slipId)
      .single();

    if (fetchError) throw fetchError;

    if (slip.status !== 'REQUESTED') {
      return {
        success: false,
        error: 'السند في حالة غير صحيحة للموافقة',
        currentStatus: slip.status,
      };
    }

    // حدّث حالة السند
    const { error: updateError } = await supabase
      .from('withdrawal_slips')
      .update({
        status: 'APPROVED',
        approved_by: userId,
        approved_at: new Date().toISOString(),
      })
      .eq('id', slipId);

    if (updateError) throw updateError;

    // قم بالصرف فوراً
    const { success: withdrawSuccess } = await addWithdrawal(
      slip.employee_id,
      slip.amount,
      slipId,
      userId
    );

    if (!withdrawSuccess) {
      throw new Error('فشل في تنفيذ الصرف');
    }

    return {
      success: true,
      message: 'تم الموافقة والصرف بنجاح',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// رفض سند صرف
export async function rejectWithdrawalSlip(slipId, reason, userId) {
  try {
    const { error } = await supabase
      .from('withdrawal_slips')
      .update({
        status: 'REJECTED',
        rejection_reason: reason,
        approved_by: userId,
        approved_at: new Date().toISOString(),
      })
      .eq('id', slipId);

    if (error) throw error;

    return {
      success: true,
      message: 'تم رفض الطلب',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// جلب السندات المعلقة
export async function getPendingWithdrawals() {
  try {
    const { data, error } = await supabase
      .from('withdrawal_slips')
      .select(`
        *,
        employee:employees(full_name)
      `)
      .eq('status', 'REQUESTED')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return {
      success: true,
      data,
      count: data.length,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

---

## 🎯 الميزة 3: كشف الحساب

### الخطوة 1: خدمة كشف الحساب

**ملف جديد: `src/services/accountStatementService.js`**

```javascript
import { supabase } from './supabase';

// إنشاء كشف حساب شهري
export async function generateMonthlyStatement(employeeId, month, year) {
  try {
    // 1. احصل على بيانات الموظف
    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .single();

    if (employeeError) throw employeeError;

    // 2. احصل على جميع المعاملات للشهر
    const startDate = new Date(year, month - 1, 1).toISOString();
    const endDate = new Date(year, month, 0).toISOString();

    const { data: transactions, error: transError } = await supabase
      .from('employee_transactions')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: true });

    if (transError) throw transError;

    // 3. احسب الملخصات
    let totalInflows = 0;
    let totalOutflows = 0;
    let salaryAmount = 0;
    let piecePayments = 0;
    let percentagePayments = 0;
    let withdrawals = 0;
    let bonuses = 0;
    let totalPieces = 0;

    transactions.forEach(trans => {
      if (trans.amount > 0) {
        totalInflows += trans.amount;

        if (trans.transaction_type === 'MONTHLY_SALARY') {
          salaryAmount += trans.amount;
        } else if (trans.transaction_type === 'PIECE_PAYMENT') {
          piecePayments += trans.amount;
          totalPieces += trans.piece_count;
        } else if (trans.transaction_type === 'PERCENTAGE_PAYMENT') {
          percentagePayments += trans.amount;
        } else if (trans.transaction_type === 'BONUS') {
          bonuses += trans.amount;
        }
      } else {
        totalOutflows += Math.abs(trans.amount);
        if (trans.transaction_type === 'WITHDRAWAL') {
          withdrawals += Math.abs(trans.amount);
        }
      }
    });

    // 4. احسب الأرصدة
    const opening_balance = employee.opening_balance || 0;
    const closing_balance = opening_balance + totalInflows - totalOutflows;

    // 5. أنشئ السجل
    const { data: statement, error: insertError } = await supabase
      .from('employee_account_statements')
      .insert([{
        employee_id: employeeId,
        statement_month: month,
        statement_year: year,
        opening_balance,
        total_inflows: totalInflows,
        total_outflows: totalOutflows,
        closing_balance,
        salary_amount: salaryAmount,
        piece_payments: piecePayments,
        percentage_payments: percentagePayments,
        withdrawals,
        bonuses,
        total_pieces: totalPieces,
        total_transactions: transactions.length,
        generated_at: new Date().toISOString(),
      }])
      .select();

    if (insertError) throw insertError;

    return {
      success: true,
      data: {
        statement: statement[0],
        transactions,
        employee: {
          name: employee.full_name,
          engineeringNumber: employee.engineering_number,
          paymentMethod: employee.payment_method,
        },
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// جلب كشف حساب
export async function getAccountStatement(employeeId, month, year) {
  try {
    const { data: statement, error: stmtError } = await supabase
      .from('employee_account_statements')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('statement_month', month)
      .eq('statement_year', year)
      .single();

    if (stmtError && stmtError.code !== 'PGRST116') throw stmtError;

    if (!statement) {
      // أنشئ كشف جديد إذا لم يكن موجود
      return await generateMonthlyStatement(employeeId, month, year);
    }

    const { data: transactions, error: transError } = await supabase
      .from('employee_transactions')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('created_at', `${year}-${String(month).padStart(2, '0')}-01`)
      .order('created_at', { ascending: true });

    if (transError) throw transError;

    return {
      success: true,
      data: {
        statement,
        transactions,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// طباعة كشف الحساب (HTML)
export function formatStatementForPrint(statement, transactions, employee) {
  const monthNames = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];

  const month = monthNames[statement.statement_month - 1];

  return `
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>كشف حساب</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          direction: rtl;
          margin: 20px;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .header h1 {
          margin: 0;
          font-size: 24px;
        }
        .employee-info {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin-bottom: 30px;
          border-bottom: 2px solid #333;
          padding-bottom: 15px;
        }
        .employee-info p {
          margin: 5px 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        table th {
          background-color: #f0f0f0;
          border: 1px solid #ddd;
          padding: 10px;
          text-align: right;
        }
        table td {
          border: 1px solid #ddd;
          padding: 10px;
          text-align: right;
        }
        .summary {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin: 30px 0;
        }
        .summary-box {
          border: 1px solid #ddd;
          padding: 15px;
          border-radius: 5px;
        }
        .summary-box h3 {
          margin-top: 0;
          border-bottom: 1px solid #ddd;
          padding-bottom: 10px;
        }
        .amount {
          font-weight: bold;
          font-size: 16px;
        }
        .signatures {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 20px;
          margin-top: 50px;
        }
        .signature {
          text-align: center;
          border-top: 2px solid #333;
          padding-top: 10px;
          margin-top: 40px;
        }
        @media print {
          body {
            margin: 0;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>كشف حساب شهري</h1>
        <p>${month} ${statement.statement_year}</p>
      </div>

      <div class="employee-info">
        <div>
          <p><strong>الاسم:</strong> ${employee.name}</p>
          <p><strong>الرقم الهندسي:</strong> ${employee.engineeringNumber}</p>
        </div>
        <div>
          <p><strong>طريقة الدفع:</strong> ${employee.paymentMethod}</p>
          <p><strong>التاريخ:</strong> ${new Date().toLocaleDateString('ar-SA')}</p>
        </div>
      </div>

      <div class="summary">
        <div class="summary-box">
          <h3>الأرصدة</h3>
          <p>رصيد أول الشهر: <span class="amount">${statement.opening_balance} ريال</span></p>
          <p>رصيد نهاية الشهر: <span class="amount">${statement.closing_balance} ريال</span></p>
        </div>
        <div class="summary-box">
          <h3>الملخص المالي</h3>
          <p>إجمالي الدخول: <span class="amount">+${statement.total_inflows} ريال</span></p>
          <p>إجمالي الخروج: <span class="amount">-${statement.total_outflows} ريال</span></p>
        </div>
      </div>

      <h3>تفاصيل المعاملات:</h3>
      <table>
        <thead>
          <tr>
            <th>التاريخ</th>
            <th>النوع</th>
            <th>الوصف</th>
            <th>المبلغ</th>
            <th>الرصيد</th>
          </tr>
        </thead>
        <tbody>
          ${transactions.map(trans => `
            <tr>
              <td>${new Date(trans.created_at).toLocaleDateString('ar-SA')}</td>
              <td>${trans.transaction_type}</td>
              <td>${trans.description}</td>
              <td>${trans.amount > 0 ? '+' : ''}${trans.amount} ريال</td>
              <td>${trans.balance_after} ريال</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="signatures">
        <div class="signature">
          <p>المحاسب</p>
          <p>_____________</p>
        </div>
        <div class="signature">
          <p>المدير</p>
          <p>_____________</p>
        </div>
        <div class="signature">
          <p>الموظف</p>
          <p>_____________</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// دالة للطباعة
export function printStatement(html) {
  const printWindow = window.open('', '', 'width=900,height=600');
  printWindow.document.write(html);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.print();
  }, 250);
}
```

---

## 🎨 الميزة 4: المكونات (Components)

### مكون عرض الرصيد

**ملف جديد: `src/components/EmployeeBalance.jsx`**

```javascript
import React, { useState, useEffect } from 'react';
import { getEmployeeBalance, getEmployeeTransactions } from '../services/employeeAccountService';

export function EmployeeBalance({ employeeId }) {
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [employeeId]);

  const loadData = async () => {
    setLoading(true);

    // احصل على الرصيد
    const balanceResult = await getEmployeeBalance(employeeId);
    if (balanceResult.success) {
      setBalance(balanceResult.data);
    }

    // احصل على المعاملات الأخيرة
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const transResult = await getEmployeeTransactions(
      employeeId,
      startOfMonth.toISOString(),
      today.toISOString(),
      10
    );

    if (transResult.success) {
      setTransactions(transResult.data);
    }

    setLoading(false);
  };

  if (loading) return <div>جاري التحميل...</div>;
  if (!balance) return <div>فشل في تحميل البيانات</div>;

  return (
    <div style={{ padding: '20px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
      <h2>حسابي الشخصي</h2>

      {/* بطاقة الرصيد */}
      <div
        style={{
          background: '#211D19',
          color: 'white',
          padding: '20px',
          borderRadius: '8px',
          marginBottom: '20px',
          textAlign: 'center',
        }}
      >
        <p style={{ margin: '0 0 10px 0', fontSize: '14px', opacity: 0.8 }}>
          رصيدي الحالي
        </p>
        <h1 style={{ margin: 0, fontSize: '36px' }}>
          {balance.balance.toLocaleString('ar-SA')} ريال
        </h1>
        <p style={{ margin: '10px 0 0 0', fontSize: '12px' }}>
          آخر تحديث: {new Date(balance.lastUpdate).toLocaleDateString('ar-SA')}
        </p>
      </div>

      {/* معلومات الراتب */}
      <div style={{ background: 'white', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
        <h3>طريقة الدفع: {balance.paymentMethod}</h3>
        <p style={{ margin: 0, color: '#666' }}>
          تحديثات فورية لكل عملية
        </p>
      </div>

      {/* المعاملات الأخيرة */}
      <div style={{ background: 'white', padding: '15px', borderRadius: '8px' }}>
        <h3>المعاملات الأخيرة</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee' }}>
              <th style={{ textAlign: 'right', padding: '10px' }}>التاريخ</th>
              <th style={{ textAlign: 'right', padding: '10px' }}>النوع</th>
              <th style={{ textAlign: 'right', padding: '10px' }}>المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(trans => (
              <tr key={trans.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '10px' }}>
                  {new Date(trans.created_at).toLocaleDateString('ar-SA')}
                </td>
                <td style={{ padding: '10px' }}>{trans.description}</td>
                <td style={{
                  padding: '10px',
                  color: trans.amount > 0 ? 'green' : 'red',
                  fontWeight: 'bold'
                }}>
                  {trans.amount > 0 ? '+' : ''}{trans.amount} ريال
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

## 📊 SQL Queries جاهزة

### استعلام الأداء

```sql
-- تحديث الأرصدة (reconciliation يومي)
UPDATE employees
SET current_balance = (
  SELECT COALESCE(SUM(amount), 0)
  FROM employee_transactions
  WHERE employee_id = employees.id
  AND status = 'CREDITED'
)
WHERE account_status = 'ACTIVE';

-- تقرير الأرصدة السالبة
SELECT 
  id,
  full_name,
  current_balance,
  payment_method
FROM employees
WHERE current_balance < 0
AND account_status = 'ACTIVE'
ORDER BY current_balance;

-- إجمالي المستحق للموظفين
SELECT 
  SUM(current_balance) as total_owed
FROM employees
WHERE account_status = 'ACTIVE';
```

---

**جميع الأكواد جاهزة للاستخدام الفوري! 🚀**
