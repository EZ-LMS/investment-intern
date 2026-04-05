import type { DashboardData, IndustryReport, KolTopic, Company, CredibilityResult, RawContent } from '../types.js';

export function generateDashboard(data: DashboardData): string {
  const dateStr = new Date(data.generatedAt).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  const modeLabel = data.mode === 'structural'
    ? '<span class="badge badge-structural">供給面結構性機會</span>'
    : '<span class="badge badge-kol">KOL 討論主題彙整</span>';

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Investment Intern — 每日投資報告</title>
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #22263a;
    --border: #2e3349;
    --text: #e8eaf0;
    --text-muted: #8b90a8;
    --accent: #6c8cff;
    --accent2: #40d9a0;
    --warn: #ffb347;
    --danger: #ff6b6b;
    --conservative: #40d9a0;
    --optimistic: #ff6b6b;
    --accurate: #6c8cff;
    --unknown: #8b90a8;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; }
  .container { max-width: 1100px; margin: 0 auto; padding: 2rem 1rem; }

  /* Header */
  .header { border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; margin-bottom: 2rem; }
  .header h1 { font-size: 1.6rem; font-weight: 700; color: var(--text); letter-spacing: -0.02em; }
  .header h1 span { color: var(--accent); }
  .meta { margin-top: 0.5rem; color: var(--text-muted); font-size: 0.85rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .badge { font-size: 0.75rem; padding: 0.25rem 0.75rem; border-radius: 999px; font-weight: 600; letter-spacing: 0.03em; }
  .badge-structural { background: #1a3a4a; color: var(--accent2); border: 1px solid var(--accent2); }
  .badge-kol { background: #2a2040; color: var(--accent); border: 1px solid var(--accent); }

  /* Sections */
  .section { margin-bottom: 2.5rem; }
  .section-title { font-size: 1.1rem; font-weight: 700; color: var(--text); margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }
  .section-title::before { content: ''; width: 3px; height: 1.1rem; background: var(--accent); border-radius: 2px; }

  /* Industry card */
  .industry-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1rem; }
  .industry-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
  .industry-name { font-size: 1.15rem; font-weight: 700; color: var(--text); }
  .confidence { font-size: 0.8rem; color: var(--text-muted); }
  .confidence-bar { display: inline-flex; gap: 2px; margin-left: 6px; }
  .confidence-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); }
  .confidence-dot.filled { background: var(--accent2); }
  .industry-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; margin-top: 0.75rem; }
  .meta-item label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); display: block; margin-bottom: 2px; }
  .meta-item p { font-size: 0.9rem; color: var(--text); }
  .time-badge { display: inline-block; background: #1e2a1e; color: var(--accent2); border: 1px solid var(--accent2); border-radius: 6px; padding: 2px 10px; font-size: 0.85rem; font-weight: 600; }
  .evidence { font-size: 0.85rem; color: var(--text-muted); border-left: 2px solid var(--border); padding-left: 0.75rem; margin-top: 0.75rem; font-style: italic; }

  /* Company cards */
  .companies-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; }
  .company-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; position: relative; }
  .company-card.tw { border-top: 2px solid #ff9f43; }
  .company-card.us { border-top: 2px solid var(--accent); }
  .market-badge { font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; position: absolute; top: 1rem; right: 1rem; }
  .market-badge.tw { background: #3a2010; color: #ff9f43; }
  .market-badge.us { background: #10203a; color: var(--accent); }
  .company-ticker { font-size: 0.85rem; color: var(--text-muted); font-family: monospace; }
  .company-name { font-size: 1.05rem; font-weight: 700; margin: 2px 0 8px; }
  .company-rows { display: flex; flex-direction: column; gap: 5px; }
  .company-row { display: flex; justify-content: space-between; font-size: 0.82rem; }
  .company-row .label { color: var(--text-muted); }
  .company-row .value { color: var(--text); text-align: right; }
  .warn-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 0.72rem; background: #3a2b00; color: var(--warn); border: 1px solid var(--warn); border-radius: 4px; padding: 2px 8px; margin-top: 8px; }
  .financials { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); display: flex; gap: 0.75rem; flex-wrap: wrap; }
  .fin-item { font-size: 0.75rem; }
  .fin-item .fin-label { color: var(--text-muted); }
  .company-sources { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
  .source-link { font-size: 0.7rem; color: var(--accent); text-decoration: none; border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; }
  .source-link:hover { background: var(--surface2); }

  /* Credibility */
  .credibility-list { display: flex; flex-direction: column; gap: 0.75rem; }
  .cred-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.25rem; }
  .cred-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; }
  .cred-company { font-weight: 600; font-size: 0.95rem; }
  .cred-type { font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
  .cred-type.conservative { background: #0d2e1e; color: var(--conservative); border: 1px solid var(--conservative); }
  .cred-type.optimistic { background: #2e0d0d; color: var(--optimistic); border: 1px solid var(--optimistic); }
  .cred-type.accurate { background: #0d1a3a; color: var(--accurate); border: 1px solid var(--accurate); }
  .cred-type.unknown { background: var(--surface2); color: var(--unknown); border: 1px solid var(--border); }
  .cred-body { margin-top: 0.75rem; display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .cred-item label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); display: block; margin-bottom: 3px; }
  .cred-item p { font-size: 0.82rem; color: var(--text); }
  .cred-guidance { grid-column: 1 / -1; }

  /* KOL Topics */
  .kol-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
  .kol-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.1rem; }
  .kol-topic { font-size: 1rem; font-weight: 700; margin-bottom: 6px; }
  .kol-summary { font-size: 0.83rem; color: var(--text-muted); margin-bottom: 8px; }
  .kol-companies { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
  .kol-company-tag { font-size: 0.72rem; background: var(--surface2); color: var(--accent); border-radius: 4px; padding: 2px 8px; }
  .kol-sources { display: flex; flex-wrap: wrap; gap: 4px; }

  /* Sources */
  .sources-list { display: flex; flex-direction: column; gap: 0.4rem; }
  .source-item { display: flex; align-items: baseline; gap: 0.5rem; font-size: 0.82rem; }
  .source-media { font-size: 0.7rem; color: var(--text-muted); background: var(--surface2); padding: 1px 6px; border-radius: 3px; white-space: nowrap; }
  .source-item a { color: var(--accent); text-decoration: none; word-break: break-all; }
  .source-item a:hover { text-decoration: underline; }

  /* Divider */
  .industry-divider { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

  /* Feedback */
  .feedback-section { margin-top: 3rem; border-top: 1px solid var(--border); padding-top: 2rem; }
  .feedback-section .section-title { margin-bottom: 0.4rem; }
  .feedback-desc { font-size: 0.82rem; color: var(--text-muted); margin-bottom: 1rem; }
  .feedback-textarea { width: 100%; min-height: 120px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.88rem; font-family: inherit; padding: 0.8rem 1rem; resize: vertical; outline: none; transition: border-color .2s; }
  .feedback-textarea:focus { border-color: var(--accent); }
  .feedback-actions { display: flex; gap: 0.75rem; margin-top: 0.75rem; flex-wrap: wrap; align-items: center; }
  .btn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 1.2rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; cursor: pointer; border: none; transition: opacity .15s; }
  .btn:hover { opacity: 0.85; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-voice { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
  .btn-voice.recording { background: var(--danger); color: #fff; border-color: var(--danger); }
  .feedback-status { font-size: 0.78rem; color: var(--text-muted); }
  .feedback-note { margin-top: 0.75rem; font-size: 0.75rem; color: var(--text-muted); background: var(--surface); border-left: 3px solid var(--accent); padding: 0.5rem 0.75rem; border-radius: 0 4px 4px 0; }

  @media (max-width: 600px) {
    .cred-body { grid-template-columns: 1fr; }
    .industry-meta { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>Investment <span>Intern</span></h1>
    <div class="meta">
      <span>📅 ${dateStr}</span>
      ${modeLabel}
    </div>
  </div>

  ${data.mode === 'structural' ? renderStructural(data) : renderKolSummary(data)}

  ${renderSources(data.rawSources)}

  ${renderFeedback()}

</div>
</body>
</html>`;
}

function renderStructural(data: DashboardData): string {
  return data.reports.map((report, i) => `
    <div class="section">
      ${i > 0 ? '<hr class="industry-divider">' : ''}
      ${renderIndustryCard(report.industry)}
      <div class="section-title" style="margin-top:1.5rem;">推薦股票</div>
      <div class="companies-grid">
        ${report.companies.map(renderCompanyCard).join('')}
      </div>
      <div class="section-title" style="margin-top:1.5rem;">管理層評鑑</div>
      <div class="credibility-list">
        ${report.credibility.map(renderCredCard).join('')}
      </div>
    </div>
  `).join('');
}

function renderIndustryCard(ind: import('../types.js').Industry): string {
  const dots = Array.from({ length: 10 }, (_, i) =>
    `<span class="confidence-dot${i < ind.confidenceScore ? ' filled' : ''}"></span>`
  ).join('');

  return `
    <div class="section-title">產業機會</div>
    <div class="industry-card">
      <div class="industry-header">
        <div class="industry-name">${escHtml(ind.industry)}</div>
        <div class="confidence">信心 ${ind.confidenceScore}/10 <span class="confidence-bar">${dots}</span></div>
      </div>
      <div class="industry-meta">
        <div class="meta-item">
          <label>供給限制原因</label>
          <p>${escHtml(ind.supplyConstraintReason)}</p>
        </div>
        <div class="meta-item">
          <label>產能追上所需時間</label>
          <p><span class="time-badge">約 ${ind.timeToMarketYears} 年</span></p>
        </div>
      </div>
      <div class="evidence">${escHtml(ind.structuralDemandEvidence)}</div>
    </div>`;
}

function renderCompanyCard(c: Company): string {
  const marketClass = c.market === 'TW' ? 'tw' : 'us';
  const marketLabel = c.market === 'TW' ? '台股' : '美股';
  const ticker = c.market === 'TW' ? `${c.ticker}` : c.ticker;

  const sources = c.sources.slice(0, 3).map((url, i) =>
    `<a class="source-link" href="${escHtml(url)}" target="_blank" rel="noopener">來源${i + 1}</a>`
  ).join('');

  return `
    <div class="company-card ${marketClass}">
      <span class="market-badge ${marketClass}">${marketLabel}</span>
      <div class="company-ticker">${escHtml(ticker)}</div>
      <div class="company-name">${escHtml(c.name)}</div>
      <div class="company-rows">
        <div class="company-row"><span class="label">主題產品</span><span class="value">${escHtml(c.themeProduct)}</span></div>
        <div class="company-row"><span class="label">主題產品佔總營收</span><span class="value">${escHtml(c.themeRevenuePercent)}</span></div>
        <div class="company-row"><span class="label">產業市佔率</span><span class="value">${escHtml(c.marketShare)}</span></div>
      </div>
      ${c.lowRevenueWarning ? '<div class="warn-badge">⚠️ 主題產品佔比偏低</div>' : ''}
      ${renderFinancials(c)}
      ${sources ? `<div class="company-sources">${sources}</div>` : ''}
    </div>`;
}

function renderFinancials(c: Company): string {
  const items = [
    c.financials.pe ? `<div class="fin-item"><span class="fin-label">本益比 </span>${escHtml(c.financials.pe)}</div>` : '',
    c.financials.eps ? `<div class="fin-item"><span class="fin-label">EPS </span>${escHtml(c.financials.eps)}</div>` : '',
    c.financials.epsForward ? `<div class="fin-item"><span class="fin-label">預期EPS </span>${escHtml(c.financials.epsForward)}</div>` : '',
  ].filter(Boolean).join('');
  return items ? `<div class="financials">${items}</div>` : '';
}

function renderCredCard(cr: CredibilityResult): string {
  const typeLabels: Record<string, string> = {
    conservative: '保守型 (Sandbagging)',
    optimistic: '樂觀型 (Overpromising)',
    accurate: '準確型',
    unknown: '資料不足',
  };
  const sourceLink = cr.sourceUrl
    ? `<a class="source-link" href="${escHtml(cr.sourceUrl)}" target="_blank" rel="noopener">來源</a>`
    : '';

  return `
    <div class="cred-card">
      <div class="cred-header">
        <span class="cred-company">${escHtml(cr.market === 'TW' ? cr.ticker + ' ' : '')}${escHtml(cr.name)}</span>
        <span class="cred-type ${cr.credibilityType}">${typeLabels[cr.credibilityType] ?? cr.credibilityType}</span>
      </div>
      <div class="cred-body">
        <div class="cred-item">
          <label>上季 Guidance</label>
          <p>${escHtml(cr.previousGuidance)}</p>
        </div>
        <div class="cred-item">
          <label>本季實際</label>
          <p>${escHtml(cr.actualResult)}</p>
        </div>
        <div class="cred-item cred-guidance">
          <label>最新前瞻展望</label>
          <p>${escHtml(cr.latestGuidance)} ${sourceLink}</p>
        </div>
      </div>
    </div>`;
}

function renderKolSummary(data: DashboardData): string {
  if (data.kolTopics.length === 0) {
    return `<div class="section"><p style="color:var(--text-muted);">本期無明顯討論主題。</p></div>`;
  }
  return `
    <div class="section">
      <div class="section-title">KOL 討論主題彙整</div>
      <div class="kol-grid">
        ${data.kolTopics.map(renderKolCard).join('')}
      </div>
    </div>`;
}

function renderKolCard(t: KolTopic): string {
  const tags = t.mentionedCompanies.map((c) =>
    `<span class="kol-company-tag">${escHtml(c)}</span>`
  ).join('');

  const sources = t.sourceUrls.slice(0, 2).map((url, i) =>
    `<a class="source-link" href="${escHtml(url)}" target="_blank" rel="noopener">來源${i + 1}</a>`
  ).join('');

  return `
    <div class="kol-card">
      <div class="kol-topic">${escHtml(t.topic)}</div>
      <div class="kol-summary">${escHtml(t.summary)}</div>
      ${tags ? `<div class="kol-companies">${tags}</div>` : ''}
      ${sources ? `<div class="kol-sources">${sources}</div>` : ''}
    </div>`;
}

function renderSources(rawSources: RawContent[]): string {
  if (rawSources.length === 0) return '';
  const items = rawSources.slice(0, 20).map((s) => `
    <div class="source-item">
      <span class="source-media">${escHtml(s.mediaType)}</span>
      <span style="color:var(--text-muted);">${escHtml(s.source)}</span>
      <a href="${escHtml(s.url)}" target="_blank" rel="noopener">${escHtml(s.url.slice(0, 80))}${s.url.length > 80 ? '…' : ''}</a>
    </div>`).join('');

  return `
    <div class="section">
      <div class="section-title">原始資料來源</div>
      <div class="sources-list">${items}</div>
    </div>`;
}

function renderFeedback(): string {
  return `
  <div class="feedback-section">
    <div class="section-title">💬 用戶回饋</div>
    <p class="feedback-desc">有任何想法、補充資訊、或對產業 / 公司的看法？可以用文字或語音輸入，送出後會建立一個 GitHub Issue 供下次分析參考。</p>
    <textarea id="feedback-text" class="feedback-textarea" placeholder="例如：我認為 XX 產業目前被低估，原因是…&#10;或：建議追蹤 XX 公司的法說會，他們最近提到…&#10;或：這個產業的上游供應商還有 XX，可以加入追蹤清單…"></textarea>
    <div class="feedback-actions">
      <button class="btn btn-voice" id="voice-btn" onclick="toggleVoice()" title="語音輸入（按下開始，再按停止）">
        🎤 語音輸入
      </button>
      <button class="btn btn-primary" onclick="submitFeedback()">
        📨 送出回饋
      </button>
      <span class="feedback-status" id="feedback-status"></span>
    </div>
    <p class="feedback-note">
      ℹ️ 送出後會在新分頁開啟 GitHub Issue 頁面，確認內容後點「Submit new issue」完成送出。
      系統會在下次分析時自動讀取 Open Issues 作為補充資訊來源。
    </p>
  </div>

  <script>
  // ── Voice input (simple: press → speak → auto-stop → text fills in) ──────
  function toggleVoice() {
    const btn = document.getElementById('voice-btn');
    const status = document.getElementById('feedback-status');
    const textarea = document.getElementById('feedback-text');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      status.textContent = '⚠️ 您的瀏覽器不支援語音輸入（請使用 Chrome 或 Edge）';
      return;
    }

    btn.disabled = true;
    btn.textContent = '🔴 聆聽中…';
    status.textContent = '請說話，說完後自動結束';

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      textarea.value = textarea.value
        ? textarea.value + '\\n' + transcript
        : transcript;
    };

    recognition.onend = () => {
      btn.disabled = false;
      btn.textContent = '🎤 語音輸入';
      status.textContent = '✅ 語音轉文字完成';
      setTimeout(() => { status.textContent = ''; }, 3000);
    };

    recognition.onerror = (e) => {
      btn.disabled = false;
      btn.textContent = '🎤 語音輸入';
      const msg = e.error === 'not-allowed'
        ? '請允許麥克風權限後再試'
        : e.error === 'no-speech'
        ? '沒有偵測到聲音，請再試一次'
        : '錯誤：' + e.error;
      status.textContent = '❌ ' + msg;
      setTimeout(() => { status.textContent = ''; }, 5000);
    };

    recognition.start();
  }

  // ── Submit feedback as GitHub Issue ─────────────────────────────────────
  function submitFeedback() {
    const text = document.getElementById('feedback-text').value.trim();
    const status = document.getElementById('feedback-status');

    if (!text) {
      status.textContent = '⚠️ 請先輸入回饋內容';
      setTimeout(() => { status.textContent = ''; }, 3000);
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const title = encodeURIComponent('用戶回饋 ' + today);
    const body = encodeURIComponent(
      '## 用戶回饋\n\n' + text +
      '\n\n---\n_由 Investment Intern Dashboard 自動產生 @ ' + new Date().toLocaleString('zh-TW') + '_'
    );
    const labels = encodeURIComponent('user-feedback');

    const url = 'https://github.com/EZ-LMS/investment-intern/issues/new?title=' + title + '&body=' + body + '&labels=' + labels;
    window.open(url, '_blank');
  }
  </script>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
