const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// 内存存储（Serverless 兼容）
const reports = new Map();
const transactionsMap = new Map();
let reportIdCounter = 1;

// 配置文件上传（内存存储）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.csv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 PDF、CSV、Excel 文件'));
    }
  }
});

// 文件上传接口
app.post('/api/upload', upload.single('statement'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    const originalName = req.file.originalname;
    const reportId = reportIdCounter++;

    // 创建报告记录
    const report = {
      id: reportId,
      filename: originalName,
      upload_time: new Date().toISOString(),
      total_income: 0,
      total_expense: 0,
      total_debt: 0,
      risk_score: 0,
      transaction_count: 0,
      status: 'processing'
    };
    reports.set(reportId, report);

    // 处理文件
    try {
      const ext = path.extname(originalName).toLowerCase();
      let transactions = [];

      if (ext === '.csv') {
        transactions = parseCSVBuffer(req.file.buffer);
      } else if (ext === '.xlsx' || ext === '.xls') {
        transactions = parseExcelBuffer(req.file.buffer);
      } else if (ext === '.pdf') {
        transactions = await parsePDFBuffer(req.file.buffer);
      }

      // 分析交易数据
      const analysis = analyzeTransactions(transactions);

      // 保存交易记录
      transactions.forEach(t => {
        t.report_id = reportId;
      });
      transactionsMap.set(reportId, transactions);

      // 更新报告统计
      report.total_income = analysis.totalIncome;
      report.total_expense = analysis.totalExpense;
      report.total_debt = analysis.totalDebt;
      report.risk_score = analysis.riskScore;
      report.transaction_count = transactions.length;
      report.status = 'completed';

      res.json({
        success: true,
        message: '分析完成',
        reportId: reportId,
        report
      });

    } catch (err) {
      console.error('文件处理失败:', err);
      report.status = 'failed';
      res.status(500).json({ error: '文件解析失败: ' + err.message });
    }

  } catch (error) {
    console.error('上传失败:', error);
    res.status(500).json({ error: '上传失败: ' + error.message });
  }
});

// 解析 CSV（从 Buffer）
function parseCSVBuffer(buffer) {
  const results = [];
  const text = buffer.toString('utf-8');
  const lines = text.split('\n');

  if (lines.length < 2) return results;

  // 解析表头
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());

  // 找到关键列索引
  const dateIdx = headers.findIndex(h => ['date', '日期', '交易时间'].includes(h));
  const descIdx = headers.findIndex(h => ['description', '描述', '备注', '摘要', 'description'].includes(h));
  const amtIdx = headers.findIndex(h => ['amount', '金额', '交易金额', '收支金额'].includes(h));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
    if (values.length < 3) continue;

    const amount = parseFloat(values[amtIdx >= 0 ? amtIdx : 2]) || 0;
    const description = values[descIdx >= 0 ? descIdx : 1] || '';
    const date = values[dateIdx >= 0 ? dateIdx : 0] || '';

    const transaction = { date, description, amount: Math.abs(amount), type: '', category: '' };

    if (amount > 0) {
      transaction.type = 'income';
      transaction.category = categorizeIncome(description);
    } else {
      transaction.type = 'expense';
      transaction.category = categorizeExpense(description);
    }

    results.push(transaction);
  }

  return results;
}

// 解析 Excel（从 Buffer）
function parseExcelBuffer(buffer) {
  const xlsx = require('xlsx');
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet);

  return data.map(row => {
    const amount = parseFloat(row.amount || row.Amount || row.金额 || row['交易金额'] || 0);
    const transaction = {
      date: row.date || row.Date || row.日期 || row['交易时间'] || '',
      description: row.description || row.Description || row.描述 || row.备注 || row['摘要'] || '',
      amount: Math.abs(amount),
      type: amount > 0 ? 'income' : 'expense',
      category: ''
    };

    transaction.category = transaction.type === 'income'
      ? categorizeIncome(transaction.description)
      : categorizeExpense(transaction.description);

    return transaction;
  });
}

// 解析 PDF（从 Buffer）
async function parsePDFBuffer(buffer) {
  try {
    const pdf = require('pdf-parse');
    const data = await pdf(buffer);
    const text = data.text;
    const transactions = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const match = line.match(/(\d{4}[-/]\d{2}[-/]\d{2})\s+(.+?)\s+([\d,]+\.?\d*)/);
      if (match) {
        const amount = parseFloat(match[3].replace(',', ''));
        transactions.push({
          date: match[1],
          description: match[2].trim(),
          amount: Math.abs(amount),
          type: amount > 0 ? 'income' : 'expense',
          category: ''
        });
      }
    }

    return transactions;
  } catch (e) {
    console.error('PDF解析失败:', e);
    return [];
  }
}

// 收入分类
function categorizeIncome(description) {
  const d = (description || '').toLowerCase();
  const categories = [
    { name: '工资', kw: ['工资', '薪资', '薪水', 'salary', '代发'] },
    { name: '奖金', kw: ['奖金', 'bonus', '年终奖', '绩效'] },
    { name: '投资', kw: ['股票', '基金', '理财', '分红', '利息', '收益'] },
    { name: '转账', kw: ['转账', '汇款', '转入', '收款'] },
  ];
  for (const c of categories) {
    if (c.kw.some(k => d.includes(k))) return c.name;
  }
  return '其他收入';
}

// 支出分类
function categorizeExpense(description) {
  const d = (description || '').toLowerCase();
  const categories = [
    { name: '餐饮', kw: ['餐饮', '餐厅', '外卖', '咖啡', '茶', '美团', '饿了么'] },
    { name: '购物', kw: ['淘宝', '京东', '天猫', '购物', '拼多多', '超市'] },
    { name: '交通', kw: ['地铁', '公交', '出租车', '加油', '停车', '滴滴', '高德'] },
    { name: '住房', kw: ['房租', '水电', '物业', '房贷', '燃气'] },
    { name: '娱乐', kw: ['电影', '游戏', '旅游', 'ktv', '视频', '音乐'] },
    { name: '医疗', kw: ['医院', '药店', '诊所', '体检', '药房'] },
    { name: '教育', kw: ['学费', '培训', '书籍', '课程', '教育'] },
    { name: '转账', kw: ['转账', '汇款', '转出', '还款'] },
  ];
  for (const c of categories) {
    if (c.kw.some(k => d.includes(k))) return c.name;
  }
  return '其他支出';
}

// 分析交易数据
function analyzeTransactions(transactions) {
  const income = transactions.filter(t => t.type === 'income');
  const expense = transactions.filter(t => t.type === 'expense');

  const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = expense.reduce((sum, t) => sum + t.amount, 0);
  const totalDebt = Math.max(0, totalExpense - totalIncome);

  let riskScore = 0;
  if (totalIncome > 0) {
    riskScore += Math.min(40, (totalDebt / totalIncome) * 100);
  }
  const expenses = expense.map(t => t.amount);
  if (expenses.length > 1) {
    const avg = totalExpense / expenses.length;
    const variance = expenses.reduce((sum, e) => sum + Math.pow(e - avg, 2), 0) / expenses.length;
    riskScore += Math.min(30, (Math.sqrt(variance) / avg) * 50);
  }
  if (transactions.length > 100) {
    riskScore += Math.min(30, (transactions.length - 100) / 10);
  }

  return { totalIncome, totalExpense, totalDebt, riskScore: Math.min(100, Math.round(riskScore)) };
}

// 获取报告列表
app.get('/api/reports', (req, res) => {
  const list = Array.from(reports.values()).sort((a, b) =>
    new Date(b.upload_time) - new Date(a.upload_time)
  );
  res.json(list);
});

// 获取报告详情
app.get('/api/reports/:id', (req, res) => {
  const reportId = parseInt(req.params.id);
  const report = reports.get(reportId);

  if (!report) {
    return res.status(404).json({ error: '报告不存在' });
  }

  const transactions = transactionsMap.get(reportId) || [];

  const incomeByCategory = {};
  const expenseByCategory = {};

  transactions.forEach(t => {
    if (t.type === 'income') {
      incomeByCategory[t.category] = (incomeByCategory[t.category] || 0) + t.amount;
    } else {
      expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
    }
  });

  res.json({
    report,
    transactions,
    statistics: { incomeByCategory, expenseByCategory }
  });
});

// 删除报告
app.delete('/api/reports/:id', (req, res) => {
  const reportId = parseInt(req.params.id);
  transactionsMap.delete(reportId);
  reports.delete(reportId);
  res.json({ success: true, message: '删除成功' });
});

// 导出给 Vercel
module.exports = app;
