'use strict';
const $ = id => document.getElementById(id);
const state = { course: null, task: 'concept', drafts: {}, records: [], ai: null, busy: false, result: null, sessions: {}, document: null, draftCourse: null };
let toastTimer;
const courses = new Map(), documents = new Map();
function apiFetch(route, options) {
  const base = window.LAB_API_ORIGIN;
  if (typeof base !== 'string') throw new Error('线上后端尚未配置，请使用本地版或稍后再试。');
  return fetch(base + '/api/index?route=' + route, options);
}
function el(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function error(text) { $('error').textContent = text; $('error').hidden = !text; }
function card() { return state.course.cards.find(c => c.id === state.task); }
function getAnswers() {
  if (card()?.mode === 'open') return {};
  if (state.task === 'concept') { const input = document.querySelector('input[name="choice"]:checked'); return { choice: input ? Number(input.value) : null }; }
  const keys = state.task === 'derive' ? ['derivative', 'solution', 'curvature'] : ['x', 'loss'];
  return Object.fromEntries(keys.map(k => [k, $('field-' + k).value]));
}
function saveDraft() { state.drafts[state.task] = { answers: getAnswers(), explanation: $('explanation').value }; }
function latestRecord(task) { return [...state.records].reverse().find(r => r.task === task); }
function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll('#answer-form button, #answer-form input, #answer-form textarea, .journey button, #sample, #clear-session, #followup-submit, #course-select, #import-open, #import-start, #course-file, #range-start, #range-end, #range-to-end, #range-all, #generate-course, #activate-course, #forget-material').forEach(n => n.disabled = busy);
  $('check').textContent = busy ? '正在处理…' : (state.course?.generated ? '仅保存回答' : '核验我的回答 →');
  $('ai-check').textContent = busy ? '请稍候…' : (state.course?.generated ? '提交并由 AI 诊断 →' : 'AI 诊断与追问');
  $('answer-form').setAttribute('aria-busy', String(busy));
}
function switchTask(task) {
  if (state.busy || !state.course) return;
  if ($('answer-fields').children.length) saveDraft();
  state.task = task; error('');
  const c = card(), draft = state.drafts[task] || { answers: {}, explanation: '' };
  document.querySelectorAll('[data-task]').forEach(n => { const active = n.dataset.task === task; n.classList.toggle('active', active); if (active) n.setAttribute('aria-current', 'step'); else n.removeAttribute('aria-current'); });
  $('task-name').textContent = c.name; $('goal').textContent = c.goal; $('task-kind').textContent = c.kind; $('question').textContent = c.question;
  const fields = $('answer-fields'); fields.replaceChildren();
  if (c.mode === 'open') {
    fields.append(el('p', '先修知识：' + (c.prerequisites.join('、') || '以所选原文为基础') + '。请在下方写下结论、理由和中间步骤。', 'open-response-note'));
  } else if (task === 'concept') {
    const group = el('fieldset', undefined, 'choice-group');
    const legend = el('legend', '选择最准确的解释', 'sr-only'); group.append(legend);
    c.choices.forEach((choice, i) => { const label = el('label', undefined, 'choice'); const input = el('input'); input.type = 'radio'; input.name = 'choice'; input.value = String(i); input.checked = draft.answers.choice === i; label.append(input, el('span', choice)); group.append(label); });
    fields.append(group);
  } else {
    fields.append(el('div', '公式用 x、lam（或 λ）、*、/、^ 和括号输入。例如 2*(x-2)。仅填表达式，不填等号。', 'formula-intro'));
    const definitions = task === 'derive' ? [['derivative', '一阶导数', 'L′(x)', '填写对 x 的导数'], ['solution', '驻点解', 'x*', '填写含 lam 的表达式'], ['curvature', '二阶导数', 'L″(x)', '填写对 x 的二阶导数']] : [['x', '最优参数', 'x*', '填写一个数或分数'], ['loss', '最小损失', 'L(x*)', '填写一个数或分数']];
    definitions.forEach(([key, name, notation, placeholder]) => { const row = el('div', undefined, 'formula-field'); const label = el('label', name); label.htmlFor = 'field-' + key; label.append(el('small', notation)); const input = el('input'); input.id = 'field-' + key; input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 220; input.placeholder = placeholder; input.value = draft.answers[key] || ''; row.append(label, input); fields.append(row); });
  }
  $('explanation').value = draft.explanation;
  $('explanation').maxLength = c.mode === 'open' ? 8000 : 4000;
  $('explanation-hint').textContent = c.mode === 'open' ? '必填；可输入公式和推理步骤' : '可选；AI 诊断时必填';
  $('evidence-text').textContent = c.evidence;
  $('source-list').replaceChildren();
  c.source_ids.forEach(id => { const s = state.course.sources.find(s => s.id === id); const div = el('div', undefined, 'source'); const link = el(s.url ? 'a' : 'button', s.section + ' · ' + s.title + ' ↗'); if (s.url) { link.href = s.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; } else { link.type = 'button'; link.className = 'text-button'; link.onclick = () => locateSource(s.unit_id); } div.append(link, el('p', s.section + '。' + s.note)); $('source-list').append(div); });
  $('evidence').open = false;
  const record = latestRecord(task); state.result = record || null;
  if (record) renderFeedback(record.result, record); else { $('feedback').replaceChildren(); $('feedback').hidden = true; }
}
function updateProgress() {
  const practiced = new Set(state.records.map(r => r.task));
  $('progress').max = state.course.cards.length; $('progress').value = practiced.size; $('progress').textContent = `${practiced.size} / ${state.course.cards.length}`; $('progress-text').textContent = `${practiced.size} / ${state.course.cards.length}`;
  state.course.cards.forEach(c => $('dot-' + c.id).classList.toggle('done', practiced.has(c.id)));
}
function note(text) { return el('p', text, 'feedback-note'); }
function renderFeedback(result, record) {
  const container = $('feedback'); container.hidden = false; container.replaceChildren();
  container.append(el('h3', '上次提交：' + result.status + (result.total ? ` · ${result.verified}/${result.total} 项` : '')));
  result.checks.forEach(c => { const row = el('div', undefined, 'check-item ' + c.status); const symbol = c.status === 'correct' ? '✓' : c.status === 'pending' ? '·' : '!'; const text = el('div'); text.append(el('strong', c.label), el('p', c.message)); row.append(el('span', symbol, 'check-symbol'), text); container.append(row); });
  if (result.ai_error) container.append(el('p', result.ai_error, 'error'));
  if (result.ai) {
    if (state.ai) $('mode-label').textContent = 'AI 已连接 · ' + result.ai.model;
    const section = el('section', undefined, 'ai-feedback'); section.append(el('h4', 'AI 辅助诊断 · ' + result.ai.status), el('p', result.ai.summary));
    result.ai.issues.forEach(issue => { const div = el('div', undefined, 'ai-issue'); div.append(el('blockquote', '你的原句：「' + issue.student_quote + '」'), el('p', issue.reason), el('blockquote', '原文/案例依据：「' + issue.evidence_quote + '」')); section.append(div); });
    section.append(el('p', result.ai.citation_check + ' 模型：' + result.ai.model, 'micro')); container.append(section);
  } else container.append(note(result.explanation_status + ' 以下追问按题目与核验结果预设，不是大模型生成。'));
  const question = result.ai ? result.ai.followup : result.followup;
  const follow = el('div', undefined, 'followup'); follow.append(el('b', '再想一步'), el('span', question)); container.append(follow);
  const followArea = el('div', undefined, 'followup-answer');
  const label = el('label', state.course.generated ? '回答这次追问（由 AI 辅助分析）' : '回答这次追问（由 AI 分析；原公式仍保留原核验结果）'); label.htmlFor = 'followup-text';
  const input = el('textarea'); input.id = 'followup-text'; input.maxLength = 4000; input.rows = 2; input.placeholder = '写下你的进一步解释…';
  const button = el('button', '提交追问回答', 'button outline'); button.id = 'followup-submit'; button.type = 'button'; button.onclick = () => submitFollowup(record, question, input.value);
  followArea.append(label, input, button); container.append(followArea);
  const actions = el('div', undefined, 'next-actions');
  const revise = el('button', '修改上面的回答 ↑', 'button quiet'); revise.type = 'button'; revise.onclick = () => { $('answer-form').scrollIntoView({ block: 'center', behavior: 'smooth' }); (document.querySelector('#answer-fields input') || $('explanation')).focus({ preventScroll: true }); };
  const index = state.course.cards.findIndex(c => c.id === state.task); const next = el('button', index < state.course.cards.length - 1 ? '进入下一学习环节 →' : '查看本次学习报告 ↗', 'button quiet'); next.type = 'button'; next.onclick = () => { if (index < state.course.cards.length - 1) switchTask(state.course.cards[index + 1].id); else openReport(); }; actions.append(revise, next); container.append(actions);
  container.append(note(state.course.generated ? 'AI 诊断属于辅助意见；引文可定位不等于推理成立。数学证明与公式识别请对照原课件复核。' : '计算核验通过仅说明这些式子或选项成立，不能替代完整推理与长期掌握的判断。'));
}
async function request(payload, ai) {
  const response = await apiFetch(ai ? 'diagnose' : 'check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, course_id: state.course.id, ...(state.course.generated ? { study_card: card() } : {}), ...(ai ? { ai: state.ai } : {}) }), signal: AbortSignal.timeout(110000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败'); return data;
}
async function submit(ai) {
  if (state.busy) return;
  error(''); if (ai && !state.ai) { openSettings(); return; }
  const payload = { task: state.task, answers: getAnswers(), explanation: $('explanation').value };
  if (!state.course.generated && state.task === 'concept' && payload.answers.choice === null) return error('请先选择一个选项。');
  if (ai && !payload.explanation.trim()) return error('请先写下自己的解释，AI 才能诊断你的思路。');
  saveDraft(); setBusy(true);
  try { const result = await request(payload, ai); const record = { ...payload, time: new Date().toISOString(), kind: '初答或修正', result }; state.records.push(record); state.result = record; renderFeedback(result, record); updateProgress(); }
  catch (e) { error(e.name === 'TimeoutError' ? '请求超时，请稍后重试。' : (e.message === 'Failed to fetch' ? '无法连接线上服务，请检查网络并稍后重试。' : e.message)); }
  finally { setBusy(false); }
}
async function submitFollowup(original, question, text) {
  if (state.busy) return;
  if (!state.ai) { toast('继续对话需要连接 AI；计算练习的预设追问可先自行思考。'); openSettings(); return; }
  if (!text.trim()) return toast('请先写下对追问的回答。');
  const payload = { task: original.task, answers: original.answers, explanation: text, followup_question: question, history: state.records.filter(r => r.task === original.task).slice(-2).map(r => ({ question: r.followup_question || card().question, answer: r.explanation.slice(0, 2500), feedback: (r.result.ai?.summary || '').slice(0, 1000) })) };
  setBusy(true); error('');
  try { const result = await request(payload, true); const record = { ...payload, time: new Date().toISOString(), kind: '追问回答', result }; state.records.push(record); state.result = record; renderFeedback(result, record); updateProgress(); }
  catch (e) { error('追问未完成：' + e.message); }
  finally { setBusy(false); }
}
function openReport() {
  const body = $('report-body'); body.replaceChildren();
  if (!state.records.length) body.append(el('p', '还没有提交记录。先选择一个知识点，试着回答一次。'));
  state.course.cards.forEach(c => {
    const records = state.records.filter(r => r.task === c.id); if (!records.length) return;
    const latest = records[records.length - 1], div = el('article', undefined, 'report-card');
    div.append(el('h3', c.name + ' · ' + c.kind), el('p', `练习 ${records.length} 次 · 最近一次 ${latest.result.status}` + (latest.result.total ? `（${latest.result.verified}/${latest.result.total} 项）` : '')));
    const issues = latest.result.checks.filter(x => x.status !== 'correct');
    div.append(el('p', !latest.result.total ? '开放题尚无确定性核验，需结合原文与 AI 反馈复核。' : issues.length ? '待处理：' + issues.map(x => x.label).join('、') : '本次计算或选项已核验；解释与迁移能力仍需结合后续回答观察。'));
    div.append(el('p', latest.result.ai ? 'AI 反馈：' + latest.result.ai.summary : '文字解释尚未由模型判定。'));
    const details = el('details'); details.append(el('summary', '查看每次回答与变化')); records.forEach((r, i) => { details.append(el('pre', `第 ${i + 1} 次 · ${r.kind}\n${r.followup_question ? '追问：' + r.followup_question + '\n' : ''}${JSON.stringify(r.answers, null, 2)}\n解释：${r.explanation || '未填写'}\n${r.result.checks.map(x => x.label + '：' + x.message).join('\n')}`)); }); div.append(details); body.append(div);
  });
  $('export').disabled = !state.records.length; $('report').showModal();
}
function exportReport() {
  const lines = ['# 理解实验室 · 本次学习报告', '', '课程：' + state.course.title, '范围：' + state.course.scope, '导出时间：' + new Date().toLocaleString('zh-CN'), '', '计算核验与 AI 辅助诊断分开记录；此报告不证明长期掌握。刷新页面不保留记录。', ''];
  state.course.cards.forEach(c => {
    const records = state.records.filter(r => r.task === c.id); if (!records.length) return;
    lines.push('## ' + c.name + ' · ' + c.kind, '', '目标：' + c.goal, '');
    records.forEach((r, i) => {
      lines.push(`### 第 ${i + 1} 次 · ${r.kind}`, '', '时间：' + r.time, r.followup_question ? '追问：' + r.followup_question : '题目：' + c.question, '', '回答：', '```json', JSON.stringify(r.answers, null, 2), '```', '解释：' + (r.explanation || '未填写'), '', '结果：' + r.result.status);
      r.result.checks.forEach(x => lines.push('- ' + x.label + ' [' + x.status + ']：' + x.message));
      if (r.result.ai) { const a = r.result.ai; lines.push('', 'AI 状态：' + a.status, 'AI 反馈：' + a.summary, '模型：' + a.model, a.citation_check); a.issues.forEach(issue => lines.push('学生原句：' + issue.student_quote, '诊断：' + issue.reason, '案例依据：' + issue.evidence_quote)); }
      else lines.push('文字解释：未获得 AI 诊断。');
      if (r.result.ai_error) lines.push('AI 请求未完成：' + r.result.ai_error);
      lines.push('', '下一步追问：' + (r.result.ai ? r.result.ai.followup : r.result.followup), '');
    });
    lines.push((state.course.generated ? '上传原文依据：' : '案例推导依据（自编）：') + c.evidence, '');
  });
  lines.push('## 参考来源', ''); state.course.sources.forEach(s => lines.push('- ' + s.id + ' ' + s.title + '，' + s.section + (s.url ? '：' + s.url : '（上传材料原文）')));
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/markdown;charset=utf-8' })); const a = el('a'); a.href = url; a.download = '理解实验室-学习报告.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); toast('学习报告已导出；不含 API Key。');
}
function loadSample() {
  if (state.busy) return;
  if (state.task === 'concept') { document.querySelector('input[name="choice"][value="0"]').checked = true; $('explanation').value = '惩罚越强，模型越简单，所以训练误差和测试误差都会一直下降。'; }
  else if (state.task === 'derive') { $('field-derivative').value = '2*(x-2)+lam'; $('field-solution').value = '2-lam/2'; $('field-curvature').value = '2'; $('explanation').value = '我把 λ 当常数，所以 λ*x^2 求导后只剩 λ。找到导数为零的点就一定是全局最小值。'; }
  else { $('field-x').value = '1'; $('field-loss').value = '2'; $('explanation').value = '最优参数是 1，所以我只计算惩罚项 2*x^2，得到最小损失 2。'; }
  error(''); toast('已载入特意构造的错误示例；点击核验，观察反馈。');
}
function drawPlot() {
  const canvas = $('plot'), rect = canvas.getBoundingClientRect(); if (!rect.width) return;
  const ratio = window.devicePixelRatio || 1; canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); const w = rect.width, h = rect.height;
  const lam = Number($('lambda').value), optimum = 2/(1+lam), minimum = 4*lam/(1+lam);
  $('lambda-out').textContent = lam.toFixed(1); $('optimum').textContent = optimum.toFixed(3); $('minimum').textContent = minimum.toFixed(3);
  $('plot-description').textContent = `λ = ${lam.toFixed(1)} 时，x* = ${optimum.toFixed(3)}，最小目标值为 ${minimum.toFixed(3)}。`;
  const left = 40, top = 17, right = w-15, bottom = h-30, ymax = Math.ceil(Math.max(12, 1+9*lam)*1.1), xmin = -1, xmax = 3;
  const px = x => left+(x-xmin)/(xmax-xmin)*(right-left), py = y => bottom-y/ymax*(bottom-top);
  ctx.clearRect(0,0,w,h); ctx.font = '10px system-ui'; ctx.lineWidth = 1;
  for(let i=0;i<=4;i++){ const y=ymax*i/4;ctx.strokeStyle='#dfe5d8';ctx.beginPath();ctx.moveTo(left,py(y));ctx.lineTo(right,py(y));ctx.stroke();ctx.fillStyle='#7d8978';ctx.textAlign='right';ctx.fillText(y.toFixed(0),left-9,py(y)+3); }
  for(let x=-1;x<=3;x++){ctx.fillStyle='#7d8978';ctx.textAlign='center';ctx.fillText(String(x),px(x),bottom+18);}
  ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  function curve(fn,color,width){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();for(let i=0;i<=300;i++){const x=xmin+(xmax-xmin)*i/300;const y=py(fn(x));if(i)ctx.lineTo(px(x),y);else ctx.moveTo(px(x),y);}ctx.stroke();}
  curve(x=>(x-2)**2,'#a5af9a',1.8);curve(x=>(x-2)**2+lam*x*x,'#386b50',2.5);
  ctx.strokeStyle='#7f9d68';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(px(optimum),bottom);ctx.lineTo(px(optimum),py(minimum));ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(px(optimum),py(minimum),5,0,Math.PI*2);ctx.fillStyle='#386b50';ctx.fill();ctx.restore();
  ctx.fillStyle='#386b50';ctx.textAlign='center';ctx.fillText('x* = '+optimum.toFixed(2),px(optimum),Math.max(top+10,py(minimum)-12));ctx.fillStyle='#7d8978';ctx.textAlign='right';ctx.fillText('x',right,bottom+28);
}
function updatePrivacy() {
  if (!state.ai) $('mode-label').textContent = state.course?.generated ? '课件学习 · 待连接 AI' : '计算练习模式';
  $('privacy-note').textContent = state.course?.generated ? '仅保存回答在当前页面内存中；AI 诊断会发送本题、依据、评价标准与回答，不进行通用符号证明。请在关闭页面前导出学习报告。' : '计算核验由线上服务处理；文字解释暂不自动判定。点击 AI 诊断才会将本题和回答交给模型。记录只在当前页面保留，请及时导出。';
}
function openSettings() { if ($('import-dialog').open) $('import-dialog').close(); $('settings').showModal(); }
async function activateCourse(course) {
  if (state.course) {
    saveDraft();
    state.sessions[state.course.id] = { drafts: state.drafts, records: state.records, task: state.task, document_id: state.course.document_id };
  }
  state.course = course;
  const session = state.sessions[course.id] || { drafts: {}, records: [], task: course.cards[0].id };
  state.drafts = session.drafts; state.records = session.records;
  $('answer-fields').replaceChildren();
  const generated = !!course.generated;
  $('course-title').textContent = course.title;
  $('course-caption').textContent = generated ? '你的课件 · AI 生成的学习草稿' : '内置示例 · 约 10 分钟';
  $('course-assumptions').textContent = generated ? course.summary : 'x ∈ ℝ，λ ≥ 0 且固定';
  $('course-equation').textContent = generated ? '概念理解 → 推理分析 → 应用迁移' : 'L(x) = (x − 2)² + λx²';
  $('course-count').textContent = course.cards.length + ' 个学习环节';
  $('course-check-type').textContent = generated ? 'AI 辅助判断' : '逐步核验';
  document.querySelector('.hero-card').classList.toggle('generated', generated);
  document.querySelector('#evidence > summary').textContent = generated ? '查看课件原文与来源 ＋' : '查看案例推导与参考来源 ＋';
  document.querySelector('.badge').textContent = generated ? '上传材料 · 原文可定位' : '自编案例 · 依据可展开';
  document.querySelector('#evidence > div > .micro').textContent = generated ? '以下为提取文字中的原句；引文存在性已检查。题目、评价标准和 AI 判断仍需复核。' : '推导文字为本项目自编，并非书籍逐字引文。来源链接用于回查理论背景。';
  $('sample').hidden = generated; $('demo-explore').hidden = generated;
  const journey = document.querySelector('.journey'); journey.replaceChildren(); journey.classList.toggle('generated', generated);
  course.cards.forEach((c, i) => {
    const button = el('button'); button.type = 'button'; button.dataset.task = c.id;
    const div = el('div'); div.append(el('strong', c.name), el('span', c.kind));
    const dot = el('span', undefined, 'step-dot'); dot.id = 'dot-' + c.id;
    button.append(el('small', String(i + 1).padStart(2, '0')), div, dot); button.onclick = () => switchTask(c.id); journey.append(button);
  });
  setBusy(false); switchTask(session.task); updateProgress(); updatePrivacy(); $('course-select').value = course.id;
  if (!generated) drawPlot();
}
async function refreshLibrary() {
  $('course-select').replaceChildren();
  for (const c of courses.values()) {
    const option = el('option', c.id === 'demo' ? '内置示例：正则化与最优化' : c.title);
    option.value = c.id; $('course-select').append(option);
  }
  $('course-select').value = state.course.id;
}
function importError(message = '') { $('import-error').textContent = message; $('import-error').hidden = !message; }
async function importRequest(path, data) {
  const response = await apiFetch(path.split('/').pop(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(110000) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求失败。'); return result;
}
function previewUnit() {
  const unit = state.document?.units.find(u => u.id === $('unit-select').value);
  $('unit-preview').textContent = unit?.text || '该位置没有可提取的文字。';
}
function renderMaterial(document, range) {
  state.document = document; state.draftCourse = null;
  $('material-panel').hidden = false; $('draft-panel').hidden = true;
  $('material-name').textContent = document.filename;
  $('material-meta').textContent = `${document.format} · ${document.positions} 页/块 · ${document.characters} 个文字字符 · ${document.notes_count} 个演讲者备注单元`;
  $('material-warnings').replaceChildren(...document.warnings.map(w => el('li', w)));
  $('extraction-notes').open = document.warnings.length > 1 || !document.characters;
  $('unit-select').replaceChildren();
  document.units.forEach(u => { const option = el('option', u.label); option.value = u.id; $('unit-select').append(option); });
  $('range-start').max = $('range-end').max = document.positions;
  $('range-start').value = range ? range[0] : 1; $('range-end').value = range ? range[1] : Math.min(document.positions, 20);
  $('range-to-end').textContent = `结束页设为尾页（${document.positions}）`;
  previewUnit(); rangeSummary();
}
function selectToEnd(all) {
  if (state.busy || !state.document) return;
  if (all) $('range-start').value = 1;
  $('range-end').value = state.document.positions;
  rangeSummary();
}
function rangeSummary() {
  if (!state.document) return;
  const start = Number($('range-start').value), end = Number($('range-end').value);
  const units = state.document.units.filter(u => start <= u.position && u.position <= end && u.text);
  const chars = units.reduce((n, u) => n + u.text.length, 0);
  $('range-summary').textContent = `当前选择：${units.length} 个正文/备注单元，${chars} 个文字字符。` + (units.length > 80 || chars > 60000 ? ' 超过单次上限，请缩小范围。' : '');
  $('draft-panel').hidden = true; state.draftCourse = null;
}
async function uploadMaterial() {
  if (state.busy) return;
  const file = $('course-file').files[0]; if (!file) return;
  if (file.size > 4 * 1024 * 1024) return importError('线上单个文件不能超过 4 MB；大文件请拆分或使用本地版。');
  if (documents.size >= 6) return importError('当前页面已有 6 份材料，请移除不用的材料后重试。');
  importError(); setBusy(true); $('import-status').textContent = '正在上传至解析服务并提取文字与定位信息…';
  try {
    const response = await apiFetch('upload', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name) }, body: file, signal: AbortSignal.timeout(110000) });
    const document = await response.json(); if (!response.ok) throw new Error(document.error || '导入失败。');
    documents.set(document.id, document); renderMaterial(document); $('import-status').textContent = '提取完成。请检查原文，尤其是公式、图片页与备注。';
  } catch (e) { importError(e.message); $('import-status').textContent = '导入未完成，已有材料不受影响。'; }
  finally { setBusy(false); $('course-file').value = ''; }
}
async function generatePath() {
  if (state.busy || !state.document) return;
  if (!state.ai) { toast('生成学习路径需要连接模型。设置完成后，再点击生成。'); openSettings(); return; }
  if (courses.size >= 19) return importError('当前页面学习路径较多，请移除不用的材料后重试。');
  importError(); setBusy(true); $('import-status').textContent = 'AI 正在组织知识点与三个学习环节，并核对引文位置；通常需要几十秒…';
  $('draft-panel').hidden = true; state.draftCourse = null;
  try {
    const start = Number($('range-start').value), end = Number($('range-end').value);
    const units = state.document.units.filter(u => start <= u.position && u.position <= end && u.text);
    if (units.length > 80 || units.reduce((n,u) => n + u.text.length, 0) > 60000) throw new Error('每次最多 80 单元、6 万文字字符，请缩小范围。');
    const selectedDocument = { id: state.document.id, filename: state.document.filename, positions: state.document.positions, units, warnings: state.document.warnings.slice(0, 15) };
    const course = await importRequest('/api/generate', { document: selectedDocument, start: Number($('range-start').value), end: Number($('range-end').value), ai: state.ai });
    courses.set(course.id, course); state.draftCourse = course; $('draft-summary').textContent = course.title + '：' + course.summary;
    $('draft-cards').replaceChildren();
    course.cards.forEach(c => {
      const details = el('details', undefined, 'draft-card');
      details.append(el('summary', c.name + ' · ' + c.kind), el('p', '目标：' + c.goal), el('p', '先修：' + (c.prerequisites.join('、') || '以原文为基础')), el('p', c.question), el('blockquote', c.evidence));
      $('draft-cards').append(details);
    });
    $('draft-panel').hidden = false; $('import-status').textContent = '草稿已生成，引文已在所选原文中定位。请核对题目，再开始学习。';
    await refreshLibrary();
  } catch (e) { importError(e.name === 'TimeoutError' ? '生成超时，请稍后重试或缩小范围。' : e.message); $('import-status').textContent = '没有生成可使用的学习路径。原文仍可预览。'; }
  finally { setBusy(false); }
}
async function locateSource(unitId) {
  if (state.busy) return;
  importError();
  try {
    if (state.document?.id !== state.course.document_id) {
      const document = documents.get(state.course.document_id);
      if (!document) throw new Error('材料已从当前页面移除，请重新导入。');
      renderMaterial(document, state.course.range);
    }
    $('unit-select').value = unitId; previewUnit(); $('import-status').textContent = '已定位题目引用的提取原文；请同时对照原课件核对公式排版。';
    $('import-dialog').showModal();
  } catch (e) { error(e.message); }
}
async function forgetMaterial() {
  if (state.busy || !state.document || !confirm('移除此材料及其所有生成课程？关联的页面内学习记录也将移除，请先导出。')) return;
  setBusy(true); importError();
  try {
    const id = state.document.id;
    documents.delete(id);
    for (const [cid, course] of courses) if (course.document_id === id) courses.delete(cid);
    if (state.course.document_id === id) {
      await activateCourse(courses.get('demo'));
    }
    Object.keys(state.sessions).forEach(cid => { if (state.sessions[cid].document_id === id) delete state.sessions[cid]; }); state.document = null; state.draftCourse = null;
    $('material-panel').hidden = $('draft-panel').hidden = true;
    $('import-status').textContent = '材料及关联课程已从当前页面内存中移除。'; await refreshLibrary();
  } catch (e) { importError(e.message); }
  finally { setBusy(false); }
}

function configureEvents() {
  $('import-open').onclick = $('import-start').onclick = () => $('import-dialog').showModal();
  $('import-close').onclick = () => $('import-dialog').close();
  $('course-file').onchange = uploadMaterial;
  $('unit-select').onchange = previewUnit;
  $('range-start').oninput = $('range-end').oninput = rangeSummary;
  $('range-to-end').onclick = () => selectToEnd(false);
  $('range-all').onclick = () => selectToEnd(true);
  $('generate-course').onclick = generatePath;
  $('activate-course').onclick = async () => { if (!state.draftCourse || state.busy) return; const course = state.draftCourse; $('import-dialog').close(); await activateCourse(course); try { await refreshLibrary(); } catch (e) { toast(e.message); } };
  $('forget-material').onclick = forgetMaterial;
  $('course-select').onchange = async () => { if (state.busy) return; const id = $('course-select').value; setBusy(true); try { const data = courses.get(id); if (!data) throw new Error('课程已移除。'); await activateCourse(data); } catch (e) { error(e.message); $('course-select').value = state.course.id; } finally { setBusy(false); } }; 
  document.querySelectorAll('[data-task]').forEach(n => n.onclick = () => switchTask(n.dataset.task));
  $('answer-form').onsubmit = e => { e.preventDefault(); submit(false); }; $('ai-check').onclick = () => submit(true); $('sample').onclick = loadSample;
  $('settings-open').onclick = openSettings; $('settings-close').onclick = () => $('settings').close();
  $('provider').onchange = () => $('model').value = $('provider').value === 'deepseek' ? 'deepseek-chat' : 'gpt-4.1-mini';
  $('settings-form').onsubmit = e => { e.preventDefault(); if ($('api-key').value.trim().length < 10) { toast('请填写有效的 API Key。'); return; } state.ai = { provider: $('provider').value, model: $('model').value.trim(), key: $('api-key').value.trim() }; $('api-key').value = ''; $('mode-label').textContent = 'AI 已配置 · 待请求验证'; updatePrivacy(); $('settings').close(); if (state.document) $('import-dialog').showModal(); toast('设置已保存到当前页面内存，首次请求将验证连接。'); };
  $('disconnect').onclick = () => { state.ai = null; $('api-key').value = ''; $('mode-label').textContent = '计算练习模式'; updatePrivacy(); $('settings').close(); toast('已清除内存中的连接密钥。'); };
  $('report-open').onclick = openReport; $('report-close').onclick = () => $('report').close(); $('export').onclick = exportReport;
  $('clear-session').onclick = () => { if (state.busy) return; if (!confirm('清空本次回答和学习记录？已导出的文件不受影响。')) return; state.records=[];state.drafts={};$('answer-fields').replaceChildren();switchTask(state.task);updateProgress();toast('本次学习记录已清空。'); };
  $('lambda').oninput = drawPlot; window.addEventListener('resize', drawPlot);
}
async function init() {
  configureEvents(); drawPlot();
  try {
    const response = await fetch('./course.json'); if (!response.ok) throw new Error();
    const course = await response.json(); courses.set('demo', course);
    await activateCourse(course); await refreshLibrary();
  } catch {
    $('task-name').textContent = '课程暂时无法加载';
    $('question').textContent = '请检查网络并刷新页面。'; error('无法加载课程，请稍后重试。');
  }
}
init();
