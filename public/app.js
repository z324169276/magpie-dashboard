const state = {
  period: 'today',
  usage: null,
  quotas: null,
  timer: null,
  loading: false,
};

const $ = (sel) => document.querySelector(sel);

const money = (v) => {
  const n = Number(v) || 0;
  if (n === 0) return '$0.00';
  if (n < 0.0001) return '$' + n.toFixed(6);
  if (n < 0.01) return '$' + n.toFixed(4);
  if (n < 1000) return '$' + n.toFixed(2);
  return '$' + Math.round(n).toLocaleString('en-US');
};

const num = (v) => Number(v || 0).toLocaleString('en-US');

const tokens = (v) => {
  const n = Number(v) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
};

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ms = (v) => (Number(v) > 0 ? Math.round(Number(v)) + ' ms' : '—');

function setStatus(kind, text) {
  const el = $('#status');
  el.classList.remove('ok', 'bad');
  if (kind) el.classList.add(kind);
  el.querySelector('.status-text').textContent = text;
}

function showBanner(message) {
  const el = $('#banner');
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function renderKpis(u) {
  const totals = u;
  const cards = [
    { label: '总花费', value: money(totals.cost), foot: (totals.unpriced ? num(totals.unpriced) + ' 次无法定价' : '全部调用可定价'), cls: 'accent' },
    { label: '调用次数', value: num(totals.calls), foot: totals.errors ? num(totals.errors) + ' 次失败' : '无失败', cls: totals.errors ? 'warn' : '' },
    { label: '输入 Token', value: tokens(totals.input), foot: '缓存读取 ' + tokens(totals.cache_read) },
    { label: '输出 Token', value: tokens(totals.output), foot: totals.reasoning ? '含推理 ' + tokens(totals.reasoning) : '无推理 Token' },
    { label: '缓存写入', value: tokens(totals.cache_write), foot: totals.cache_unknown ? '未知 ' + num(totals.cache_unknown) : '按厂商计费' },
    { label: '流量', value: tokens((totals.up_bytes || 0) + (totals.down_bytes || 0)) + 'B', foot: '上行 ' + tokens(totals.up_bytes || 0) + 'B' },
  ];

  $('#kpis').innerHTML = cards
    .map(
      (c) => `<article class="kpi ${c.cls}">
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
        <div class="foot">${escapeHtml(c.foot)}</div>
      </article>`,
    )
    .join('');
}

/** 通用柱状图：series 每项含 label 与若干数值列 */
function barChart(el, points, columns, { stacked = false, format = money } = {}) {
  const width = 600;
  const height = 168;
  const padBottom = 20;
  const padTop = 8;
  const plotH = height - padBottom - padTop;

  if (!points.length) {
    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}"><text class="empty-label" x="${width / 2}" y="${height / 2}" text-anchor="middle">该区间没有调用</text></svg>`;
    return;
  }

  const valueOf = (p) => (stacked ? columns.reduce((s, c) => s + (Number(p[c.key]) || 0), 0) : Number(p[columns[0].key]) || 0);
  const max = Math.max(...points.map(valueOf), 0);
  if (max <= 0) {
    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}"><text class="empty-label" x="${width / 2}" y="${height / 2}" text-anchor="middle">该区间没有调用</text></svg>`;
    return;
  }

  const slot = width / points.length;
  const barW = Math.max(Math.min(slot * 0.55, 46), 4);
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));

  let bars = '';
  points.forEach((p, i) => {
    const x = slot * i + (slot - barW) / 2;
    let y = padTop + plotH;

    if (stacked) {
      columns.forEach((c) => {
        const v = Number(p[c.key]) || 0;
        if (v <= 0) return;
        const h = Math.max((v / max) * plotH, v > 0 ? 1.5 : 0);
        y -= h;
        const title = `${p.label} · ${c.name}: ${format(v)}`;
        bars += `<rect class="bar ${c.cls || ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${escapeHtml(title)}</title></rect>`;
      });
    } else {
      const v = Number(p[columns[0].key]) || 0;
      const h = Math.max((v / max) * plotH, v > 0 ? 2 : 0);
      const title = `${p.label} · ${columns[0].name}: ${format(v)}`;
      bars += `<rect class="bar" x="${x.toFixed(1)}" y="${(padTop + plotH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${escapeHtml(title)}</title></rect>`;
    }

    if (i % labelEvery === 0) {
      bars += `<text class="tick" x="${(x + barW / 2).toFixed(1)}" y="${height - 5}" text-anchor="middle">${escapeHtml(p.label)}</text>`;
    }
  });

  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    <line class="axis" x1="0" y1="${padTop + plotH}" x2="${width}" y2="${padTop + plotH}" />
    ${bars}
  </svg>`;
}

function breakdownRows(items, formatter, emptyText = '暂无数据') {
  if (!items || !items.length) return `<p class="empty">${escapeHtml(emptyText)}</p>`;
  const totalCost = items.reduce((s, it) => s + (Number(it.cost) || 0), 0);
  const maxCost = Math.max(...items.map((it) => Number(it.cost) || 0), 0);

  const rows = items
    .slice()
    .sort((a, b) => (Number(b.cost) || 0) - (Number(a.cost) || 0) || (b.calls || 0) - (a.calls || 0))
    .map((it) => {
      const cost = Number(it.cost) || 0;
      const pct = maxCost > 0 ? (cost / maxCost) * 100 : 0;
      const sharePct = totalCost > 0 ? ((cost / totalCost) * 100).toFixed(1) + '%' : '—';
      return `<tr>
        <td class="name" title="${escapeHtml(it.id || it.name)}">${formatter(it)}</td>
        <td>${num(it.calls)}</td>
        <td>${tokens(it.input)}</td>
        <td>${tokens(it.output)}</td>
        <td>${money(cost)}</td>
        <td><span class="share">${sharePct}<span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span></span></td>
      </tr>`;
    })
    .join('');

  return `<table>
    <thead><tr><th>名称</th><th>调用</th><th>输入</th><th>输出</th><th>花费</th><th>占比</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderModelRank(models) {
  const items = (models || [])
    .slice()
    .sort((a, b) => (Number(b.cost) || 0) - (Number(a.cost) || 0) || (b.calls || 0) - (a.calls || 0));

  const el = $('#modelRank');
  if (!items.length) {
    el.innerHTML = '<p class="empty">该区间没有模型调用</p>';
    $('#modelHint').textContent = '';
    return;
  }

  const total = items.reduce((s, it) => s + (Number(it.cost) || 0), 0);
  const max = Math.max(...items.map((it) => Number(it.cost) || 0), 0);

  el.innerHTML = items
    .map((it, i) => {
      const cost = Number(it.cost) || 0;
      const width = max > 0 ? (cost / max) * 100 : 0;
      const share = total > 0 ? ((cost / total) * 100).toFixed(1) + '%' : '—';
      const name = it.name || it.model || it.id;
      const provider = it.sub || it.provider || '';
      const tok = (Number(it.input) || 0) + (Number(it.output) || 0);
      return `<div class="rank-row">
        <span class="rank-no">${i + 1}</span>
        <div class="rank-main">
          <div class="rank-top">
            <span class="mono">${escapeHtml(name)}</span>
            <span class="rank-cost">${money(cost)}<em>${share}</em></span>
          </div>
          <div class="rank-bar"><i style="width:${width.toFixed(1)}%"></i></div>
          <div class="rank-foot">
            <span>${escapeHtml(provider)}</span>
            <span>${num(it.calls)} 次 · ${tokens(tok)} tok</span>
          </div>
        </div>
      </div>`;
    })
    .join('');

  $('#modelHint').textContent = `${items.length} 个模型 · 合计 ${money(total)}`;
}

function renderBreakdowns(u) {
  $('#agentTable').innerHTML = breakdownRows(u.agents, (it) => escapeHtml(it.name || it.id), '该区间没有 Agent 调用');
  $('#agentHint').textContent = (u.agents || []).length ? `${(u.agents || []).length} 个 Agent` : '';

  $('#accountTable').innerHTML = breakdownRows(
    u.accounts,
    (it) => `${escapeHtml(it.name || it.id)}${it.provider ? ` <span class="badge">${escapeHtml(it.provider)}</span>` : ''}`,
    '仅订阅账号会出现在这里，API Key 供应商按 Key 记账',
  );
  $('#accountHint').textContent = (u.accounts || []).length ? `${(u.accounts || []).length} 个账号` : '';
}

function renderPerf(u) {
  const timed = Number(u.timed) || 0;
  const ttft = timed > 0 ? (Number(u.ttft_ms) || 0) / timed : 0;
  const decodeOut = Number(u.decode_out) || 0;
  const decodeMs = Number(u.decode_ms) || 0;
  const speed = decodeMs > 0 ? (decodeOut / decodeMs) * 1000 : 0;
  const reads = Number(u.cache_read) || 0;
  const input = Number(u.input) || 0;
  const hit = input + reads > 0 ? ((reads / (input + reads)) * 100).toFixed(1) + '%' : '—';

  const items = [
    { label: '平均首 Token 延迟', value: ms(ttft) },
    { label: '平均解码速度', value: speed > 0 ? speed.toFixed(1) + ' tok/s' : '—' },
    { label: '缓存命中率', value: hit },
    { label: '失败 / 无法定价', value: `${num(u.errors)} / ${num(u.unpriced)}` },
  ];

  $('#perf').innerHTML = items
    .map((it) => `<div class="item"><div class="label">${it.label}</div><div class="value">${escapeHtml(it.value)}</div></div>`)
    .join('');
}

function renderQuotas(payload) {
  const data = (payload && payload.data) || [];
  const list = $('#quotaList');

  if (!data.length) {
    list.innerHTML = '<p class="empty">没有可读取的额度信息</p>';
    $('#quotaHint').textContent = '';
    return;
  }

  list.innerHTML = data
    .map((q) => {
      const badges = [
        q.plan ? `<span class="badge">${escapeHtml(q.plan)}</span>` : '',
        q.kind === 'balance' ? '<span class="badge">余额</span>' : '',
      ].join('');

      const windows = (q.windows || [])
        .map((w) => {
          const used = Number(w.used) || 0;
          const remaining = Number(w.remaining);
          const total = used + (Number.isFinite(remaining) ? remaining : 0);
          const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
          const cls = pct >= 95 ? 'full' : pct >= 75 ? 'hot' : '';
          const right = Number.isFinite(remaining) ? `剩 ${remaining}${w.display ? ' · ' + escapeHtml(w.display) : ''}` : w.display ? escapeHtml(w.display) : '';
          const reset = w.resetsAt ? ' · 重置于 ' + (w.resetsAt || '').slice(0, 10) : '';
          return `<div class="quota-window">
            <div class="row"><span>${escapeHtml(w.name)}</span><span>${right}${reset}</span></div>
            <div class="progress"><i class="${cls}" style="width:${pct.toFixed(1)}%"></i></div>
          </div>`;
        })
        .join('');

      const balance = q.balance ? `<div class="balance">${escapeHtml(q.balance)}</div>` : '';

      return `<div class="quota">
        <div class="quota-head">
          <div>
            <div class="quota-name">${escapeHtml(q.name || q.provider)}${badges}</div>
            <div class="quota-meta">${escapeHtml(q.user || q.provider)}</div>
          </div>
          <div class="quota-meta">${q.readAt ? escapeHtml(q.readAt.slice(11, 16)) : ''}</div>
        </div>
        ${balance}${windows || (q.kind === 'balance' ? '' : '<p class="empty">暂无额度窗口</p>')}
      </div>`;
    })
    .join('');

  $('#quotaHint').textContent = `${data.length} 个供应商`;
}

function render() {
  const u = state.usage;
  if (!u) return;

  renderKpis(u);
  barChart($('#costChart'), u.series || [], [{ key: 'cost', name: '花费' }], { format: money });
  barChart(
    $('#tokenChart'),
    u.series || [],
    [
      { key: 'input', name: '输入', cls: 'bar-in' },
      { key: 'output', name: '输出', cls: 'bar-out' },
      { key: 'cache_read', name: '缓存读取', cls: 'bar-cache' },
    ],
    { stacked: true, format: tokens },
  );

  const periodCost = Number(u.cost) || 0;
  $('#costHint').textContent = `合计 ${money(periodCost)} · 按${u.bucket === 'hour' ? '小时' : u.bucket === 'week' ? '周' : '天'}聚合`;

  renderModelRank(u.models);
  renderBreakdowns(u);
  renderPerf(u);
  renderQuotas(state.quotas);
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  $('#refresh').disabled = true;
  setStatus(null, '读取中…');

  try {
    const [usageRes, quotaRes] = await Promise.all([
      fetch(`/api/usage?period=${state.period}`, { cache: 'no-store' }),
      fetch('/api/quotas', { cache: 'no-store' }),
    ]);

    const usage = await usageRes.json();
    if (!usageRes.ok) throw new Error(usage.error || '读取用量失败');

    state.usage = usage;
    state.quotas = quotaRes.ok ? await quotaRes.json() : null;

    if (!quotaRes.ok) {
      showBanner('用量读取正常，但额度读取失败：' + ((await quotaRes.clone().json().catch(() => ({}))).error || quotaRes.status));
    } else {
      showBanner('');
    }

    render();
    setStatus('ok', '已连接');
    $('#updated').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  } catch (err) {
    setStatus('bad', '不可用');
    showBanner(err.message);
    if (!state.usage) {
      $('#kpis').innerHTML = '';
      renderQuotas(null);
    }
  } finally {
    state.loading = false;
    $('#refresh').disabled = false;
  }
}

function schedule() {
  if (state.timer) clearInterval(state.timer);
  if ($('#autoRefresh').checked) {
    state.timer = setInterval(load, 60000);
  }
}

$('#periodTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab || tab.classList.contains('active')) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
  state.period = tab.dataset.period;
  load();
});

$('#refresh').addEventListener('click', load);
$('#autoRefresh').addEventListener('change', schedule);

$('#export').addEventListener('click', async () => {
  const btn = $('#export');
  btn.disabled = true;
  btn.textContent = '导出中…';

  try {
    const res = await fetch(`/api/export?period=${state.period}`, { cache: 'no-store' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `导出失败（${res.status}）`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `magpie-usage-${state.period}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showBanner('导出失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '导出 CSV';
  }
});

/** 用网关 hello 信息替换页头的地址占位，确认连的是哪个 Magpie */
async function loadGatewayInfo() {
  try {
    const res = await fetch('/api/hello', { cache: 'no-store' });
    if (!res.ok) return;
    const hello = await res.json();
    const name = hello.name || hello.app || 'Magpie';
    const version = hello.version || hello.ver || '';
    const addr = hello.addr || '';
    $('#gateway').textContent = [name, version, addr].filter(Boolean).join(' · ');
  } catch {
    /* 网关不在线时保持占位文本 */
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});

schedule();
loadGatewayInfo();
load();
