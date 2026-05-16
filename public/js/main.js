// 主页面逻辑
let currentReportId = null;

// 页面加载时获取报告列表
document.addEventListener('DOMContentLoaded', () => {
  loadReports();
  setupUploadArea();
});

// 设置上传区域
function setupUploadArea() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');

  // 点击上传区域触发文件选择
  uploadArea.addEventListener('click', (e) => {
    if (e.target !== fileInput) {
      fileInput.click();
    }
  });

  // 文件选择变化
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      uploadFile(e.target.files[0]);
    }
  });

  // 拖拽上传
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#764ba2';
    uploadArea.style.background = '#e9ecef';
  });

  uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#667eea';
    uploadArea.style.background = '#f8f9fa';
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#667eea';
    uploadArea.style.background = '#f8f9fa';

    if (e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });
}

// 上传文件
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('statement', file);

  // 显示进度
  document.getElementById('uploadProgress').style.display = 'block';

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (result.success) {
      alert('文件上传成功！报告ID: ' + result.reportId);
      loadReports();
      
      // 轮询检查处理状态
      checkReportStatus(result.reportId);
    } else {
      alert('上传失败: ' + (result.error || '未知错误'));
    }
  } catch (error) {
    alert('上传失败: ' + error.message);
  } finally {
    document.getElementById('uploadProgress').style.display = 'none';
    document.getElementById('fileInput').value = '';
  }
}

// 检查报告处理状态
async function checkReportStatus(reportId) {
  const interval = setInterval(async () => {
    try {
      const response = await fetch(`/api/reports/${reportId}`);
      const data = await response.json();

      if (data.report.status === 'completed' || data.report.status === 'failed') {
        clearInterval(interval);
        loadReports();
        
        if (data.report.status === 'completed') {
          alert('报告处理完成！');
        } else {
          alert('报告处理失败，请检查文件格式');
        }
      }
    } catch (error) {
      console.error('检查状态失败:', error);
      clearInterval(interval);
    }
  }, 2000); // 每2秒检查一次

  // 30秒后停止轮询
  setTimeout(() => clearInterval(interval), 30000);
}

// 加载报告列表
async function loadReports() {
  try {
    const response = await fetch('/api/reports');
    const reports = await response.json();

    const reportsList = document.getElementById('reportsList');

    if (reports.length === 0) {
      reportsList.innerHTML = '<p class="empty-text">暂无报告，请先上传银行流水</p>';
      return;
    }

    reportsList.innerHTML = reports.map(report => createReportCard(report)).join('');
  } catch (error) {
    console.error('加载报告失败:', error);
    alert('加载报告失败: ' + error.message);
  }
}

// 创建报告卡片
function createReportCard(report) {
  const statusClass = `status-${report.status}`;
  const statusText = {
    'processing': '处理中',
    'completed': '已完成',
    'failed': '失败'
  }[report.status] || report.status;

  const uploadTime = new Date(report.upload_time).toLocaleString('zh-CN');

  return `
    <div class="report-card">
      <div class="report-header">
        <div class="report-filename">${report.filename}</div>
        <div class="report-status ${statusClass}">${statusText}</div>
      </div>
      <div class="report-time">上传时间: ${uploadTime}</div>
      ${report.status === 'completed' ? `
        <div class="report-stats">
          <div class="stat-item">
            <span class="stat-label">收入</span>
            <span class="stat-value income">¥${report.total_income.toFixed(2)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">支出</span>
            <span class="stat-value expense">¥${report.total_expense.toFixed(2)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">负债</span>
            <span class="stat-value debt">¥${report.total_debt.toFixed(2)}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">风险评分</span>
            <span class="stat-value ${getRiskClass(report.risk_score)}">${report.risk_score}/100</span>
          </div>
        </div>
      ` : ''}
      <div class="report-actions">
        ${report.status === 'completed' ? `
          <button class="btn btn-primary btn-small" onclick="viewReport(${report.id})">
            <i class="fas fa-eye"></i> 查看报告
          </button>
        ` : ''}
        <button class="btn btn-danger btn-small" onclick="deleteReport(${report.id})">
          <i class="fas fa-trash"></i> 删除
        </button>
      </div>
    </div>
  `;
}

// 获取风险等级样式
function getRiskClass(riskScore) {
  if (riskScore < 30) return 'risk-low';
  if (riskScore < 70) return 'risk-medium';
  return 'risk-high';
}

// 查看报告详情
async function viewReport(reportId) {
  try {
    const response = await fetch(`/api/reports/${reportId}`);
    const data = await response.json();

    currentReportId = reportId;
    displayReportDetail(data);
    
    document.getElementById('reportModal').style.display = 'flex';
  } catch (error) {
    alert('加载报告详情失败: ' + error.message);
  }
}

// 显示报告详情
function displayReportDetail(data) {
  const { report, transactions, statistics } = data;
  
  const detailDiv = document.getElementById('reportDetail');
  
  // 风险等级
  const riskLevel = report.risk_score < 30 ? '低风险' : 
                    report.risk_score < 70 ? '中风险' : '高风险';
  const riskClass = getRiskClass(report.risk_score);
  
  // 生成交易表格HTML
  const transactionsTable = transactions.slice(0, 50).map(t => `
    <tr>
      <td>${t.date}</td>
      <td>${t.description}</td>
      <td><span class="badge badge-${t.type}">${t.type === 'income' ? '收入' : '支出'}</span></td>
      <td><span class="category-tag">${t.category}</span></td>
      <td style="text-align: right; font-weight: 600;" class="${t.type === 'income' ? 'income' : 'expense'}">
        ${t.type === 'income' ? '+' : '-'}¥${t.amount.toFixed(2)}
      </td>
    </tr>
  `).join('');

  detailDiv.innerHTML = `
    <div class="report-summary">
      <div class="summary-card">
        <h4>总收入</h4>
        <div class="amount">¥${report.total_income.toFixed(2)}</div>
      </div>
      <div class="summary-card">
        <h4>总支出</h4>
        <div class="amount">¥${report.total_expense.toFixed(2)}</div>
      </div>
      <div class="summary-card">
        <h4>负债</h4>
        <div class="amount">¥${report.total_debt.toFixed(2)}</div>
      </div>
      <div class="summary-card">
        <h4>风险评分</h4>
        <div class="amount ${riskClass}">${report.risk_score}/100 (${riskLevel})</div>
        <div class="risk-indicator">
          <div class="risk-bar">
            <div class="risk-fill ${riskClass}" style="width: ${report.risk_score}%"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="chart-section">
      <h4>收入分类统计</h4>
      ${Object.entries(statistics.incomeByCategory).map(([category, amount]) => `
        <div style="margin: 10px 0;">
          <span>${category}</span>
          <span style="float: right; font-weight: 600;" class="income">¥${amount.toFixed(2)}</span>
        </div>
      `).join('') || '<p style="color: #999;">暂无收入数据</p>'}
    </div>

    <div class="chart-section">
      <h4>支出分类统计</h4>
      ${Object.entries(statistics.expenseByCategory).map(([category, amount]) => `
        <div style="margin: 10px 0;">
          <span>${category}</span>
          <span style="float: right; font-weight: 600;" class="expense">¥${amount.toFixed(2)}</span>
        </div>
      `).join('') || '<p style="color: #999;">暂无支出数据</p>'}
    </div>

    <div class="chart-section">
      <h4>交易明细 (最近50笔)</h4>
      <table class="transactions-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>描述</th>
            <th>类型</th>
            <th>分类</th>
            <th style="text-align: right;">金额</th>
          </tr>
        </thead>
        <tbody>
          ${transactionsTable || '<tr><td colspan="5" style="text-align: center; color: #999;">暂无交易数据</td></tr>'}
        </tbody>
      </table>
      ${transactions.length > 50 ? `<p style="text-align: center; color: #999; margin-top: 20px;">仅显示前50笔，共${transactions.length}笔交易</p>` : ''}
    </div>
  `;
}

// 删除报告
async function deleteReport(reportId) {
  if (!confirm('确定要删除此报告吗？')) {
    return;
  }

  try {
    const response = await fetch(`/api/reports/${reportId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      alert('删除成功');
      loadReports();
    } else {
      alert('删除失败: ' + (result.error || '未知错误'));
    }
  } catch (error) {
    alert('删除失败: ' + error.message);
  }
}

// 关闭弹窗
function closeModal() {
  document.getElementById('reportModal').style.display = 'none';
  currentReportId = null;
}

// 点击弹窗外部关闭
window.addEventListener('click', (e) => {
  const modal = document.getElementById('reportModal');
  if (e.target === modal) {
    closeModal();
  }
});
