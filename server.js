const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const app = express();
const PORT = 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 创建上传目录
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
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

// 初始化数据库
const db = new sqlite3.Database('./bank_statements.db', (err) => {
  if (err) {
    console.error('数据库连接失败:', err);
  } else {
    console.log('数据库连接成功');
    initDatabase();
  }
});

// 创建数据库表
function initDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      upload_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      total_income REAL DEFAULT 0,
      total_expense REAL DEFAULT 0,
      total_debt REAL DEFAULT 0,
      risk_score INTEGER DEFAULT 0,
      transaction_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'processing'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER,
      date TEXT,
      description TEXT,
      amount REAL,
      type TEXT,
      category TEXT,
      FOREIGN KEY (report_id) REFERENCES reports(id)
    )
  `);
}

// 文件上传接口
app.post('/api/upload', upload.single('statement'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    const filename = req.file.filename;
    const originalName = req.file.originalname;

    // 创建报告记录
    db.run(
      'INSERT INTO reports (filename, status) VALUES (?, ?)',
      [originalName, 'processing'],
      function(err) {
        if (err) {
          return res.status(500).json({ error: '数据库错误' });
        }

        const reportId = this.lastID;
        
        // 异步处理文件
        processFile(req.file.path, reportId).then(() => {
          db.run('UPDATE reports SET status = ? WHERE id = ?', ['completed', reportId]);
        }).catch(err => {
          console.error('文件处理失败:', err);
          db.run('UPDATE reports SET status = ? WHERE id = ?', ['failed', reportId]);
        });

        res.json({
          success: true,
          message: '文件上传成功，正在处理...',
          reportId: reportId
        });
      }
    );
  } catch (error) {
    console.error('上传失败:', error);
    res.status(500).json({ error: '上传失败' });
  }
});

// 文件处理函数
async function processFile(filePath, reportId) {
  const ext = path.extname(filePath).toLowerCase();
  
  let transactions = [];
  
  try {
    if (ext === '.csv') {
      transactions = await parseCSV(filePath);
    } else if (ext === '.xlsx' || ext === '.xls') {
      transactions = await parseExcel(filePath);
    } else if (ext === '.pdf') {
      transactions = await parsePDF(filePath);
    }

    // 分析交易数据
    const analysis = analyzeTransactions(transactions);
    
    // 保存交易记录
    const stmt = db.prepare(`
      INSERT INTO transactions (report_id, date, description, amount, type, category)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    transactions.forEach(t => {
      stmt.run(reportId, t.date, t.description, t.amount, t.type, t.category);
    });

    stmt.finalize();

    // 更新报告统计
    db.run(`
      UPDATE reports 
      SET total_income = ?, total_expense = ?, total_debt = ?, 
          risk_score = ?, transaction_count = ?, status = ?
      WHERE id = ?
    `, [
      analysis.totalIncome,
      analysis.totalExpense,
      analysis.totalDebt,
      analysis.riskScore,
      transactions.length,
      'completed',
      reportId
    ]);

  } catch (error) {
    console.error('文件解析失败:', error);
    throw error;
  }
}

// 解析 CSV 文件
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = require('fs').createReadStream(filePath);
    const csv = require('csv-parser');

    stream.pipe(csv())
      .on('data', (row) => {
        const transaction = {
          date: row.date || row.Date || row.日期 || '',
          description: row.description || row.Description || row.描述 || row.备注 || '',
          amount: parseFloat(row.amount || row.Amount || row.金额 || 0),
          type: 'unknown',
          category: '未分类'
        };

        // 判断交易类型
        if (transaction.amount > 0) {
          transaction.type = 'income';
          transaction.category = categorizeIncome(transaction.description);
        } else {
          transaction.type = 'expense';
          transaction.amount = Math.abs(transaction.amount);
          transaction.category = categorizeExpense(transaction.description);
        }

        results.push(transaction);
      })
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

// 解析 Excel 文件
function parseExcel(filePath) {
  const xlsx = require('xlsx');
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet);

  return data.map(row => {
    const amount = parseFloat(row.amount || row.Amount || row.金额 || 0);
    const transaction = {
      date: row.date || row.Date || row.日期 || '',
      description: row.description || row.Description || row.描述 || row.备注 || '',
      amount: Math.abs(amount),
      type: amount > 0 ? 'income' : 'expense',
      category: '未分类'
    };

    if (transaction.type === 'income') {
      transaction.category = categorizeIncome(transaction.description);
    } else {
      transaction.category = categorizeExpense(transaction.description);
    }

    return transaction;
  });
}

// 解析 PDF 文件（简化版）
async function parsePDF(filePath) {
  const pdf = require('pdf-parse');
  const fs = require('fs');
  const dataBuffer = fs.readFileSync(filePath);
  
  const data = await pdf(dataBuffer);
  const text = data.text;
  
  // 简单的文本解析逻辑（实际应用中需要更复杂的PDF解析）
  const transactions = [];
  const lines = text.split('\n');
  
  lines.forEach(line => {
    // 简单匹配：日期 + 描述 + 金额
    const match = line.match(/(\d{4}[-/]\d{2}[-/]\d{2})\s+(.+?)\s+([\d,]+\.?\d*)/);
    if (match) {
      const amount = parseFloat(match[3].replace(',', ''));
      transactions.push({
        date: match[1],
        description: match[2].trim(),
        amount: Math.abs(amount),
        type: amount > 0 ? 'income' : 'expense',
        category: '未分类'
      });
    }
  });

  return transactions;
}

// 收入分类
function categorizeIncome(description) {
  const categories = {
    '工资': ['工资', '薪资', '薪水', 'salary'],
    '奖金': ['奖金', 'bonus', '年终奖'],
    '投资': ['股票', '基金', '理财', '分红', '利息'],
    '转账': ['转账', '汇款', '转入'],
    '其他收入': []
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(kw => description.includes(kw))) {
      return category;
    }
  }
  return '其他收入';
}

// 支出分类
function categorizeExpense(description) {
  const categories = {
    '餐饮': ['餐饮', '餐厅', '外卖', '咖啡', '茶'],
    '购物': ['淘宝', '京东', '天猫', '购物', '买'],
    '交通': ['地铁', '公交', '出租车', '加油', '停车'],
    '住房': ['房租', '水电', '物业', '房贷'],
    '娱乐': ['电影', '游戏', '旅游', 'KTV'],
    '医疗': ['医院', '药店', '诊所', '体检'],
    '教育': ['学费', '培训', '书籍', '课程'],
    '转账': ['转账', '汇款', '转出', '还款'],
    '其他支出': []
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(kw => description.includes(kw))) {
      return category;
    }
  }
  return '其他支出';
}

// 分析交易数据
function analyzeTransactions(transactions) {
  const income = transactions.filter(t => t.type === 'income');
  const expense = transactions.filter(t => t.type === 'expense');
  
  const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = expense.reduce((sum, t) => sum + t.amount, 0);
  
  // 计算负债（假设支出大于收入的部分为负债）
  const totalDebt = Math.max(0, totalExpense - totalIncome);
  
  // 风险评分（0-100，分数越高风险越大）
  let riskScore = 0;
  
  // 负债比例
  if (totalIncome > 0) {
    const debtRatio = totalDebt / totalIncome;
    riskScore += Math.min(40, debtRatio * 100);
  }
  
  // 支出稳定性（波动大的支出风险高）
  const expenses = expense.map(t => t.amount);
  if (expenses.length > 1) {
    const avgExpense = totalExpense / expenses.length;
    const variance = expenses.reduce((sum, e) => sum + Math.pow(e - avgExpense, 2), 0) / expenses.length;
    const stdDev = Math.sqrt(variance);
    riskScore += Math.min(30, (stdDev / avgExpense) * 50);
  }
  
  // 交易频率（过于频繁的交易可能风险高）
  if (transactions.length > 100) {
    riskScore += Math.min(30, (transactions.length - 100) / 10);
  }
  
  riskScore = Math.min(100, Math.round(riskScore));
  
  return {
    totalIncome,
    totalExpense,
    totalDebt,
    riskScore
  };
}

// 获取报告列表
app.get('/api/reports', (req, res) => {
  db.all(`
    SELECT * FROM reports 
    ORDER BY upload_time DESC
  `, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: '数据库错误' });
    }
    res.json(rows);
  });
});

// 获取报告详情
app.get('/api/reports/:id', (req, res) => {
  const reportId = req.params.id;
  
  db.get('SELECT * FROM reports WHERE id = ?', [reportId], (err, report) => {
    if (err || !report) {
      return res.status(404).json({ error: '报告不存在' });
    }
    
    db.all('SELECT * FROM transactions WHERE report_id = ?', [reportId], (err, transactions) => {
      if (err) {
        return res.status(500).json({ error: '数据库错误' });
      }
      
      // 统计分类
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
        statistics: {
          incomeByCategory,
          expenseByCategory
        }
      });
    });
  });
});

// 删除报告
app.delete('/api/reports/:id', (req, res) => {
  const reportId = req.params.id;
  
  db.run('DELETE FROM transactions WHERE report_id = ?', [reportId], (err) => {
    if (err) {
      return res.status(500).json({ error: '删除失败' });
    }
    
    db.run('DELETE FROM reports WHERE id = ?', [reportId], (err) => {
      if (err) {
        return res.status(500).json({ error: '删除失败' });
      }
      res.json({ success: true, message: '删除成功' });
    });
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`上传目录: ${uploadDir}`);
});
