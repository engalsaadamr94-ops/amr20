import React, { useState, useEffect } from 'react';

/**
 * تطبيق كشف حساب الموظفين - متكامل وجاهز للاستخدام الفوري
 * 
 * ✅ إدارة الموظفين
 * ✅ تسجيل المعاملات فوراً
 * ✅ سندات الصرف
 * ✅ كشف حساب شهري
 * ✅ تقارير وإحصائيات
 * 
 * طريقة الاستخدام:
 * 1. انسخ هذا الكود في ملف جديد: EmployeeAccountApp.jsx
 * 2. ركب npm packages: recharts
 * 3. استخدمه في مشروعك React
 */

const EmployeeAccountApp = () => {
  // ============= STATE =============

  const [employees, setEmployees] = useState([
    {
      id: 1,
      name: 'أحمد محمد',
      engNo: 'E-001',
      type: 'salary',
      salary: 3000,
      piecePrice: 0,
      percentage: 0,
      balance: 1500,
      status: 'active'
    },
    {
      id: 2,
      name: 'علي حسن',
      engNo: 'E-002',
      type: 'piece',
      salary: 0,
      piecePrice: 50,
      percentage: 0,
      balance: 800,
      status: 'active'
    },
    {
      id: 3,
      name: 'محمود علي',
      engNo: 'E-003',
      type: 'percentage',
      salary: 0,
      piecePrice: 0,
      percentage: 5,
      balance: 1200,
      status: 'active'
    }
  ]);

  const [transactions, setTransactions] = useState([
    {
      id: 1,
      empId: 1,
      type: 'salary',
      amount: 3000,
      desc: 'راتب شهري - سبتمبر',
      date: new Date().toLocaleDateString('ar-SA')
    }
  ]);

  const [slips, setSlips] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedEmp, setSelectedEmp] = useState(employees[0]);

  // ============= الدوال =============

  // إضافة معاملة
  const addTransaction = (empId, type, amount, desc) => {
    const newTrans = {
      id: transactions.length + 1,
      empId,
      type,
      amount,
      desc,
      date: new Date().toLocaleDateString('ar-SA')
    };

    setTransactions([...transactions, newTrans]);

    // تحديث الرصيد
    setEmployees(employees.map(emp =>
      emp.id === empId 
        ? { ...emp, balance: emp.balance + amount }
        : emp
    ));
  };

  // إضافة قطع
  const addPieces = (empId, count, desc) => {
    const emp = employees.find(e => e.id === empId);
    const amount = count * emp.piecePrice;
    addTransaction(empId, 'piece', amount, `${count} قطع - ${desc}`);
  };

  // إضافة نسبة
  const addPercentage = (empId, orderAmount, orderNo) => {
    const emp = employees.find(e => e.id === empId);
    const amount = (orderAmount * emp.percentage) / 100;
    addTransaction(empId, 'percentage', amount, `نسبة من الطلب #${orderNo}`);
  };

  // إضافة راتب
  const addSalary = (empId) => {
    const emp = employees.find(e => e.id === empId);
    addTransaction(empId, 'salary', emp.salary, 'راتب شهري');
  };

  // طلب صرف
  const requestWithdrawal = (empId, amount, reason) => {
    const emp = employees.find(e => e.id === empId);
    if (emp.balance < amount) {
      alert(`رصيد غير كافي! الرصيد: ${emp.balance} ريال`);
      return;
    }

    const newSlip = {
      id: slips.length + 1,
      empId,
      amount,
      reason,
      date: new Date().toLocaleDateString('ar-SA'),
      status: 'pending'
    };

    setSlips([...slips, newSlip]);
    alert('تم إرسال الطلب للموافقة');
  };

  // موافقة على صرف
  const approveSlip = (slipId) => {
    const slip = slips.find(s => s.id === slipId);
    addTransaction(slip.empId, 'withdrawal', -slip.amount, `سند صرف #${slipId}`);
    
    setSlips(slips.map(s =>
      s.id === slipId ? { ...s, status: 'approved' } : s
    ));
  };

  // حساب الإحصائيات
  const getStats = () => {
    const total = employees.reduce((sum, e) => sum + e.balance, 0);
    const avg = Math.round(total / employees.length);
    const max = Math.max(...employees.map(e => e.balance));
    const min = Math.min(...employees.map(e => e.balance));
    return { total, avg, max, min };
  };

  // كشف الحساب
  const getStatement = (empId) => {
    const emps = transactions.filter(t => t.empId === empId);
    const inflows = emps.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const outflows = emps.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return { inflows, outflows, transactions: emps };
  };

  const stats = getStats();
  const stmt = getStatement(selectedEmp.id);

  // ============= RENDER =============

  return (
    <div style={{ direction: 'rtl' }} className="bg-gradient-to-b from-gray-50 to-gray-100 min-h-screen p-4">
      <div className="max-w-7xl mx-auto">
        
        {/* الرأس */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg p-6 mb-6 shadow-xl">
          <h1 className="text-4xl font-bold text-right">💼 نظام كشف حساب الموظفين</h1>
          <p className="text-right text-blue-100 mt-2">إدارة شاملة وفورية لحسابات الموظفين</p>
        </div>

        {/* التبويبات */}
        <div className="flex gap-2 mb-6 justify-end flex-wrap">
          {['dashboard', 'transaction', 'statement', 'withdrawals'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 rounded-lg font-bold transition-all ${
                activeTab === tab
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-white text-gray-800 hover:bg-gray-100 shadow'
              }`}
            >
              {tab === 'dashboard' && '📊 لوحة التحكم'}
              {tab === 'transaction' && '➕ إضافة معاملة'}
              {tab === 'statement' && '📄 كشف الحساب'}
              {tab === 'withdrawals' && '💰 سندات صرف'}
            </button>
          ))}
        </div>

        {/* ============ لوحة التحكم ============ */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            
            {/* البطاقات */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { label: 'إجمالي الأرصدة', value: stats.total, color: 'from-blue-500 to-blue-600' },
                { label: 'متوسط الرصيد', value: stats.avg, color: 'from-green-500 to-green-600' },
                { label: 'أعلى رصيد', value: stats.max, color: 'from-purple-500 to-purple-600' },
                { label: 'أقل رصيد', value: stats.min, color: 'from-orange-500 to-orange-600' }
              ].map((card, i) => (
                <div key={i} className={`bg-gradient-to-br ${card.color} text-white p-6 rounded-lg shadow-lg`}>
                  <p className="text-sm opacity-90 text-right">{card.label}</p>
                  <h3 className="text-3xl font-bold text-right mt-2">{card.value.toLocaleString('ar-SA')} ريال</h3>
                </div>
              ))}
            </div>

            {/* جدول الموظفين */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold mb-4 text-right">📋 قائمة الموظفين</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-gradient-to-r from-gray-100 to-gray-200 border-b-2">
                    <tr>
                      <th className="p-3">الاسم</th>
                      <th className="p-3">الرقم</th>
                      <th className="p-3">النوع</th>
                      <th className="p-3">الرصيد</th>
                      <th className="p-3">الحالة</th>
                      <th className="p-3">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(emp => (
                      <tr key={emp.id} className="border-b hover:bg-blue-50 transition-colors">
                        <td className="p-3 font-semibold">{emp.name}</td>
                        <td className="p-3">{emp.engNo}</td>
                        <td className="p-3">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                            emp.type === 'salary' ? 'bg-blue-100 text-blue-800' :
                            emp.type === 'piece' ? 'bg-green-100 text-green-800' :
                            'bg-orange-100 text-orange-800'
                          }`}>
                            {emp.type === 'salary' ? 'راتب' : emp.type === 'piece' ? 'قطعة' : 'نسبة'}
                          </span>
                        </td>
                        <td className="p-3 font-bold text-blue-600">{emp.balance.toLocaleString('ar-SA')} ريال</td>
                        <td className="p-3">
                          <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-bold">نشط</span>
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => setSelectedEmp(emp)}
                            className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold transition-colors"
                          >
                            عرض
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ============ إضافة معاملة ============ */}
        {activeTab === 'transaction' && (
          <div className="space-y-6">
            
            {/* اختيار الموظف */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <label className="block text-right mb-3 font-bold text-lg">👤 اختر الموظف:</label>
              <select
                onChange={(e) => setSelectedEmp(employees.find(emp => emp.id === parseInt(e.target.value)))}
                value={selectedEmp.id}
                className="w-full p-3 border-2 border-gray-300 rounded-lg text-right font-semibold"
              >
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} - {emp.engNo}
                  </option>
                ))}
              </select>
            </div>

            {/* حسب النوع */}
            {selectedEmp.type === 'piece' && (
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg shadow-lg p-6 border-2 border-green-200">
                <h3 className="text-2xl font-bold mb-4 text-right">🔧 إضافة قطع</h3>
                <p className="text-right text-gray-700 mb-4">سعر القطعة: <span className="font-bold text-green-600">{selectedEmp.piecePrice} ريال</span></p>
                
                <div className="space-y-4">
                  <input
                    type="number"
                    id="pieceCount"
                    placeholder="عدد القطع (مثال: 10)"
                    className="w-full p-3 border-2 border-green-300 rounded-lg text-right bg-white"
                  />
                  <input
                    type="text"
                    id="pieceDesc"
                    placeholder="الوصف (مثال: بنطلون رجالي)"
                    className="w-full p-3 border-2 border-green-300 rounded-lg text-right bg-white"
                  />
                  <button
                    onClick={() => {
                      const count = parseInt(document.getElementById('pieceCount').value);
                      const desc = document.getElementById('pieceDesc').value;
                      if (count > 0 && desc) {
                        addPieces(selectedEmp.id, count, desc);
                        const total = count * selectedEmp.piecePrice;
                        document.getElementById('pieceCount').value = '';
                        document.getElementById('pieceDesc').value = '';
                        alert(`✅ تم إضافة ${count} قطع = ${total} ريال`);
                      }
                    }}
                    className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-3 rounded-lg transition-all"
                  >
                    ✅ إضافة القطع
                  </button>
                </div>
              </div>
            )}

            {selectedEmp.type === 'percentage' && (
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg shadow-lg p-6 border-2 border-orange-200">
                <h3 className="text-2xl font-bold mb-4 text-right">📊 إضافة نسبة</h3>
                <p className="text-right text-gray-700 mb-4">النسبة: <span className="font-bold text-orange-600">{selectedEmp.percentage}%</span></p>
                
                <div className="space-y-4">
                  <input
                    type="number"
                    id="orderAmount"
                    placeholder="مبلغ الطلب (مثال: 200)"
                    className="w-full p-3 border-2 border-orange-300 rounded-lg text-right bg-white"
                  />
                  <input
                    type="text"
                    id="orderNo"
                    placeholder="رقم الطلب (مثال: 5001)"
                    className="w-full p-3 border-2 border-orange-300 rounded-lg text-right bg-white"
                  />
                  <button
                    onClick={() => {
                      const amount = parseFloat(document.getElementById('orderAmount').value);
                      const orderNo = document.getElementById('orderNo').value;
                      if (amount > 0 && orderNo) {
                        addPercentage(selectedEmp.id, amount, orderNo);
                        const percentAmount = (amount * selectedEmp.percentage) / 100;
                        document.getElementById('orderAmount').value = '';
                        document.getElementById('orderNo').value = '';
                        alert(`✅ تم إضافة نسبة ${percentAmount} ريال`);
                      }
                    }}
                    className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold py-3 rounded-lg transition-all"
                  >
                    ✅ إضافة النسبة
                  </button>
                </div>
              </div>
            )}

            {selectedEmp.type === 'salary' && (
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg shadow-lg p-6 border-2 border-purple-200">
                <h3 className="text-2xl font-bold mb-4 text-right">💵 الراتب الشهري</h3>
                <p className="text-right text-gray-700 mb-4">الراتب: <span className="font-bold text-purple-600">{selectedEmp.salary.toLocaleString('ar-SA')} ريال</span></p>
                
                <button
                  onClick={() => {
                    addSalary(selectedEmp.id);
                    alert(`✅ تم إضافة الراتب: ${selectedEmp.salary} ريال`);
                  }}
                  className="w-full bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white font-bold py-3 rounded-lg transition-all"
                >
                  ✅ إضافة الراتب الشهري
                </button>
              </div>
            )}
          </div>
        )}

        {/* ============ كشف الحساب ============ */}
        {activeTab === 'statement' && (
          <div className="bg-white rounded-lg shadow-2xl p-8">
            <div className="text-center mb-8 pb-8 border-b-4 border-gray-200">
              <h2 className="text-3xl font-bold">📄 كشف حساب شهري</h2>
              <p className="text-xl text-gray-600 mt-2">{selectedEmp.name}</p>
              <p className="text-gray-600">{selectedEmp.engNo}</p>
            </div>

            {/* الملخص */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-blue-50 p-4 rounded-lg text-center border-2 border-blue-200">
                <p className="text-sm text-gray-600 mb-2">الدخول</p>
                <p className="text-2xl font-bold text-green-600">+{stmt.inflows.toLocaleString('ar-SA')}</p>
              </div>
              <div className="bg-red-50 p-4 rounded-lg text-center border-2 border-red-200">
                <p className="text-sm text-gray-600 mb-2">الخروج</p>
                <p className="text-2xl font-bold text-red-600">-{stmt.outflows.toLocaleString('ar-SA')}</p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg text-center border-2 border-purple-200">
                <p className="text-sm text-gray-600 mb-2">الرصيد النهائي</p>
                <p className="text-2xl font-bold text-purple-600">{selectedEmp.balance.toLocaleString('ar-SA')}</p>
              </div>
              <div className="bg-yellow-50 p-4 rounded-lg text-center border-2 border-yellow-200">
                <p className="text-sm text-gray-600 mb-2">عدد العمليات</p>
                <p className="text-2xl font-bold text-yellow-600">{stmt.transactions.length}</p>
              </div>
            </div>

            {/* جدول المعاملات */}
            {stmt.transactions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-gray-100 border-b-2 border-gray-400">
                    <tr>
                      <th className="p-3">التاريخ</th>
                      <th className="p-3">النوع</th>
                      <th className="p-3">الوصف</th>
                      <th className="p-3">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stmt.transactions.map(trans => (
                      <tr key={trans.id} className="border-b hover:bg-gray-50">
                        <td className="p-3">{trans.date}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                            trans.type === 'salary' ? 'bg-blue-100 text-blue-800' :
                            trans.type === 'piece' ? 'bg-green-100 text-green-800' :
                            trans.type === 'percentage' ? 'bg-orange-100 text-orange-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {trans.type === 'salary' ? 'راتب' :
                             trans.type === 'piece' ? 'قطعة' :
                             trans.type === 'percentage' ? 'نسبة' : 'صرف'}
                          </span>
                        </td>
                        <td className="p-3">{trans.desc}</td>
                        <td className={`p-3 font-bold ${trans.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {trans.amount > 0 ? '+' : ''}{trans.amount.toLocaleString('ar-SA')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-center text-gray-500 py-8">لا توجد معاملات للموظف</p>
            )}

            <div className="mt-8 text-center">
              <button
                onClick={() => window.print()}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-bold transition-all"
              >
                🖨️ طباعة الكشف
              </button>
            </div>
          </div>
        )}

        {/* ============ سندات الصرف ============ */}
        {activeTab === 'withdrawals' && (
          <div className="space-y-6">
            
            {/* طلب جديد */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-2xl font-bold mb-6 text-right">💰 طلب صرف جديد</h3>

              <div className="space-y-4">
                <select
                  onChange={(e) => setSelectedEmp(employees.find(emp => emp.id === parseInt(e.target.value)))}
                  value={selectedEmp.id}
                  className="w-full p-3 border-2 border-gray-300 rounded-lg text-right"
                >
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} (الرصيد: {emp.balance} ريال)
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  id="slipAmount"
                  placeholder="المبلغ المطلوب (ريال)"
                  className="w-full p-3 border-2 border-gray-300 rounded-lg text-right"
                />

                <select
                  id="slipReason"
                  className="w-full p-3 border-2 border-gray-300 rounded-lg text-right"
                >
                  <option value="مصاريف شخصية">مصاريف شخصية</option>
                  <option value="سلفة">سلفة</option>
                  <option value="صرف جزئي">صرف جزئي</option>
                </select>

                <button
                  onClick={() => {
                    const amount = parseFloat(document.getElementById('slipAmount').value);
                    const reason = document.getElementById('slipReason').value;
                    if (amount > 0) {
                      requestWithdrawal(selectedEmp.id, amount, reason);
                      document.getElementById('slipAmount').value = '';
                    }
                  }}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-lg transition-all"
                >
                  📤 إرسال الطلب
                </button>
              </div>
            </div>

            {/* قائمة السندات */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-2xl font-bold mb-6 text-right">📋 سندات الصرف</h3>
              
              {slips.length === 0 ? (
                <p className="text-center text-gray-500 py-8">لا توجد سندات حتى الآن</p>
              ) : (
                <div className="space-y-4">
                  {slips.map(slip => {
                    const emp = employees.find(e => e.id === slip.empId);
                    return (
                      <div
                        key={slip.id}
                        className={`p-4 rounded-lg border-2 ${
                          slip.status === 'pending'
                            ? 'border-yellow-300 bg-yellow-50'
                            : 'border-green-300 bg-green-50'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="text-right flex-1">
                            <p className="font-bold">{emp.name} - {emp.engNo}</p>
                            <p className="text-sm text-gray-600">المبلغ: {slip.amount.toLocaleString('ar-SA')} ريال</p>
                            <p className="text-sm text-gray-600">السبب: {slip.reason}</p>
                            <p className="text-sm text-gray-600">التاريخ: {slip.date}</p>
                          </div>
                          {slip.status === 'pending' && (
                            <button
                              onClick={() => approveSlip(slip.id)}
                              className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded text-sm font-bold ml-3"
                            >
                              ✅ موافقة
                            </button>
                          )}
                          <span
                            className={`px-3 py-2 rounded text-sm font-bold ${
                              slip.status === 'pending'
                                ? 'bg-yellow-200 text-yellow-800'
                                : 'bg-green-200 text-green-800'
                            }`}
                          >
                            {slip.status === 'pending' ? '⏳ قيد الانتظار' : '✅ موافق'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmployeeAccountApp;
