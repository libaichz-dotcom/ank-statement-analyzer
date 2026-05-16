# 银行流水分析系统

一个功能完整的银行流水解析 Web 产品，支持账单上传、智能解析、统计报告生成和查询。

## ✨ 功能特性

- 📤 **银行账单上传** - 支持拖拽上传，兼容 PDF、CSV、Excel 格式
- 🤖 **智能解析** - 自动识别交易类型（收入/支出），智能分类
- 📊 **报告生成** - 收入/支出/负债/风险多维度统计分析
- 🔍 **报告查询** - 历史报告管理，交易明细查看
- 💯 **风险评估** - 0-100分风险评分，基于负债比例和支出稳定性

## 🚀 快速开始

### 本地运行

```bash
# 克隆仓库
git clone https://github.com/libaichz-dotcom/ank-statement-analyzer.git
cd ank-statement-analyzer

# 安装依赖
npm install

# 启动服务器
node server.js
```

访问 http://localhost:3000 即可使用。

### 在线体验

[点击访问在线版本](https://ank-statement-analyzer.up.railway.app) （部署后可用）

## 📁 项目结构

```
bank-statement-analyzer/
├── server.js          # 后端服务器 (Express)
├── package.json       # 项目依赖
├── public/
│   ├── index.html     # 主页面
│   ├── css/style.css  # 样式文件
│   └── js/main.js     # 前端逻辑
└── README.md          # 项目说明
```

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 前端 | HTML5 + CSS3 + JavaScript |
| 数据库 | SQLite |
| 文件上传 | Multer |
| 文件解析 | PDF-parse, XLSX, CSV-parser |

## 📋 支持的文件格式

- **CSV** - 逗号分隔值文件
- **Excel** - .xlsx, .xls 格式
- **PDF** - PDF 银行流水单

## 📊 报告功能

- 💰 收入统计（按类别：工资、奖金、投资、转账等）
- 💸 支出统计（按类别：餐饮、购物、交通、住房等）
- 🏦 负债计算（支出 > 收入部分）
- ⚠️ 风险评分（综合负债比例、支出波动、交易频率）

## 📄 License

MIT
