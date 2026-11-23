/**
 * CONFIGURAÇÕES GERAIS
 * O catálogo de exames e os resultados ficam cifrados em secrets.js
 * (gerado por tools/build-secrets.mjs) e só são abertos com a senha.
 */
const CONFIG = {
    initialMoney: 52800,
    money: 52800,
    examDelay: 8000 // 8 segundos de processamento
};

let EXAMS_DB = [];
let HIGHLIGHT_TERMS = [];
let sessionPassword = null;
let displayedMoney = CONFIG.initialMoney;
let moneyAnimationId = null;

/**
 * CRIPTOGRAFIA (PBKDF2 + AES-GCM)
 */
function b64ToBytes(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function decryptSecret(secret, box) {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: b64ToBytes(SECRETS.salt), iterations: SECRETS.iterations, hash: "SHA-256" },
        material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(box.iv) }, key, b64ToBytes(box.data));
    return new TextDecoder().decode(plain);
}

/**
 * ESTADO DO CASO (salvo no navegador)
 * Pedidos guardam só o id do exame, o gene digitado e os horários;
 * os resultados são refeitos a partir do catálogo cifrado após o login.
 */
let state = null;
let pendingSangerExamId = null;
const pendingTimers = {};

function storageKey() {
    return `desafio-cg2:${SECRETS.salt}`;
}

function newState() {
    return { startedAt: Date.now(), money: CONFIG.initialMoney, orders: [], conclusion: null };
}

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey()));
        if (saved && Array.isArray(saved.orders) && typeof saved.money === "number") return saved;
    } catch (err) { /* armazenamento indisponível ou corrompido */ }
    return newState();
}

function saveState() {
    try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch (err) { /* ignora */ }
}

function findOrder(examId) {
    return state.orders.find(o => o.id === examId);
}

function isReady(order) {
    return Date.now() >= order.readyAt;
}

document.addEventListener("DOMContentLoaded", () => {
    updateMoneyDisplay(CONFIG.initialMoney, false);

    document.getElementById("password-button").addEventListener("click", tryLogin);
    document.getElementById("password-input").addEventListener("keypress", (e) => {
        if (e.key === "Enter") tryLogin();
    });

    const geneInput = document.getElementById("sanger-gene-input");
    geneInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") confirmSangerRequest();
    });
    geneInput.addEventListener("input", () => setSangerError(""));
    ["student-name", "hypothesis-input"].forEach(id =>
        document.getElementById(id).addEventListener("input", () => setConcludeError("")));
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (pendingSangerExamId) closeSangerModal();
        if (document.getElementById("conclude-modal").style.display === "flex") closeConcludeModal();
    });
    document.getElementById("conclude-modal").addEventListener("click", (e) => {
        if (e.target.id === "conclude-modal") closeConcludeModal();
    });
    document.getElementById("sanger-modal").addEventListener("click", (e) => {
        if (e.target.id === "sanger-modal") closeSangerModal();
    });

    const summary = document.getElementById("case-summary");
    try { summary.open = localStorage.getItem("desafio-cg2:resumo-aberto") === "1"; } catch (err) { /* ignora */ }
    summary.addEventListener("toggle", () => {
        try { localStorage.setItem("desafio-cg2:resumo-aberto", summary.open ? "1" : "0"); } catch (err) { /* ignora */ }
    });

    setInterval(updateCountdowns, 500);
});

async function tryLogin() {
    const input = document.getElementById("password-input").value;
    const errorMsg = document.getElementById("login-error");
    const button = document.getElementById("password-button");

    if (!window.crypto || !crypto.subtle) {
        errorMsg.innerText = "Abra o site por HTTPS para acessar o desafio.";
        errorMsg.style.display = "block";
        return;
    }

    button.disabled = true;
    try {
        const data = JSON.parse(await decryptSecret(input, SECRETS));
        EXAMS_DB = data.exams;
        HIGHLIGHT_TERMS = (data.highlightTerms || []).map(t => t.toUpperCase());
        sessionPassword = input;
        document.getElementById("password-container").style.display = "none";
        document.getElementById("game-container").style.display = "flex";
        startCase(loadState());
    } catch (err) {
        errorMsg.style.display = "block";
        setTimeout(() => errorMsg.style.display = "none", 2000);
    } finally {
        button.disabled = false;
    }
}

function startCase(savedState) {
    Object.values(pendingTimers).forEach(clearTimeout);
    Object.keys(pendingTimers).forEach(k => delete pendingTimers[k]);

    state = savedState;
    state.orders = state.orders.filter(o => EXAMS_DB.some(e => e.id === o.id));
    updateMoneyDisplay(state.money, false);
    updateTimestamp();

    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = "";
    [...state.orders].sort((a, b) => a.orderedAt - b.orderedAt).forEach(order => {
        renderResultCard(order, false);
        if (!isReady(order)) scheduleCompletion(order);
    });
    updateEmptyState();
    initExamCategories();
    updateConclusionUi();

    if (state.orders.length > 0) {
        showToast(`Progresso restaurado: ${state.orders.length} exame(s) solicitado(s).`);
    }
    saveState();
}

function resetCase() {
    if (!confirm("Reiniciar o caso? O orçamento volta ao valor inicial e todos os exames e resultados serão apagados.")) return;
    startCase(newState());
    switchTab("caso");
    document.getElementById("notification-badge").style.display = "none";
    showToast("Caso reiniciado.");
}

function switchTab(tabId) {
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.getElementById(`tab-${tabId}`).classList.add("active");

    const btnMap = { 'caso': 0, 'exames': 1, 'resultados': 2 };
    document.querySelectorAll(".tab-btn")[btnMap[tabId]].classList.add("active");

    // O resumo do caso aparece nas abas em que o histórico não está visível
    document.getElementById("case-summary").style.display = tabId === "caso" ? "none" : "block";

    if (tabId === 'resultados') {
        const badge = document.getElementById("notification-badge");
        if (badge) badge.style.display = "none";
    }
}

function updateMoneyDisplay(newValue, animate = true) {
    const element = document.getElementById("total-money");
    // O saldo real muda na hora; a animação é só visual.
    CONFIG.money = newValue;
    if (moneyAnimationId) cancelAnimationFrame(moneyAnimationId);

    if (!animate) {
        displayedMoney = newValue;
        element.innerText = formatCurrency(newValue);
        return;
    }
    const startValue = displayedMoney;
    const duration = 1000;
    const startTime = performance.now();

    function update(currentTime) {
        const progress = Math.min(Math.max((currentTime - startTime) / duration, 0), 1);
        displayedMoney = startValue + (newValue - startValue) * progress;
        element.innerText = formatCurrency(displayedMoney);
        moneyAnimationId = progress < 1 ? requestAnimationFrame(update) : null;
    }
    moneyAnimationId = requestAnimationFrame(update);
}

function formatCurrency(val) {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * INDICADOR DE PROCESSAMENTO
 * A barra é animada por CSS a partir dos horários do pedido, então continua
 * do ponto certo mesmo após trocar de categoria ou recarregar a página.
 */
function progressHtml(order) {
    const total = Math.max(order.readyAt - order.orderedAt, 1);
    const elapsed = Math.min(Date.now() - order.orderedAt, total);
    return `
        <div class="progress" role="progressbar" aria-label="Processando exame">
            <div class="progress-fill" style="animation-duration:${total}ms; animation-delay:-${elapsed}ms"></div>
        </div>
        <span class="progress-label" data-ready-at="${order.readyAt}">${countdownText(order.readyAt)}</span>`;
}

function countdownText(readyAt) {
    const seconds = Math.max(Math.ceil((readyAt - Date.now()) / 1000), 0);
    return seconds > 0 ? `Em análise… resultado em ${seconds}s` : "Finalizando…";
}

function updateCountdowns() {
    document.querySelectorAll("[data-ready-at]").forEach(el => {
        el.textContent = countdownText(Number(el.dataset.readyAt));
    });
}

function initExamCategories() {
    const categories = [...new Set(EXAMS_DB.map(e => e.category))];
    const container = document.getElementById("categories-list");
    container.innerHTML = "";

    categories.forEach((cat, index) => {
        const btn = document.createElement("button");
        btn.className = "category-btn";
        btn.innerText = cat;
        btn.onclick = () => showExamsByCategory(cat, btn);
        container.appendChild(btn);

        if (index === 0) showExamsByCategory(cat, btn);
    });
}

function currentCategory() {
    const active = document.querySelector(".category-btn.active");
    return active ? active.innerText : null;
}

function showExamsByCategory(category, btnElement) {
    if (btnElement) {
        document.querySelectorAll(".category-btn").forEach(b => b.classList.remove("active"));
        btnElement.classList.add("active");
    }

    document.getElementById("selected-category-title").innerText = category;
    const container = document.getElementById("exams-grid");
    container.innerHTML = "";

    EXAMS_DB.filter(e => e.category === category).forEach(exam => {
        const order = findOrder(exam.id);
        const div = document.createElement("div");
        div.className = "exam-card";
        div.id = `exam-card-${exam.id}`;

        let action;
        if (!order && state.conclusion) {
            action = `<button class="exam-btn" disabled>Caso concluído</button>`;
        } else if (!order) {
            action = `<button class="exam-btn" onclick="buyExam('${exam.id}')">Solicitar Exame</button>`;
        } else if (!isReady(order)) {
            action = `<div class="exam-status">${progressHtml(order)}</div>`;
        } else {
            action = `<button class="exam-btn done" onclick="openResult('${exam.id}')">✓ Ver resultado</button>`;
        }

        div.innerHTML = `
            <div>
                <div class="exam-header"><span>${exam.label}</span></div>
                <span class="exam-cost">${formatCurrency(exam.cost)}</span>
            </div>
            ${action}`;
        container.appendChild(div);
    });
}

function refreshExamCard(examId) {
    const exam = EXAMS_DB.find(e => e.id === examId);
    if (exam && exam.category === currentCategory()) showExamsByCategory(exam.category);
}

function openResult(examId) {
    switchTab("resultados");
    const card = document.getElementById(`result-${examId}`);
    if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "start" });
        card.classList.remove("flash");
        void card.offsetWidth;
        card.classList.add("flash");
    }
}

function buyExam(examId) {
    if (findOrder(examId)) return;
    if (state.conclusion) {
        showToast("O caso já foi concluído. Reinicie o caso para solicitar novos exames.", "error");
        return;
    }
    const exam = EXAMS_DB.find(e => e.id === examId);
    if (CONFIG.money < exam.cost) {
        showToast("Saldo insuficiente!", "error");
        return;
    }
    if (exam.type === 'input_gene') {
        pendingSangerExamId = examId;
        openSangerModal(exam);
        return;
    }
    executePurchase(exam, null);
}

/**
 * MODAL DO SANGER
 */
function openSangerModal(exam) {
    document.getElementById("sanger-patient").innerText = exam.label;
    document.getElementById("sanger-cost").innerText = formatCurrency(exam.cost);
    const input = document.getElementById('sanger-gene-input');
    input.value = "";
    setSangerError("");
    document.getElementById('sanger-modal').style.display = "flex";
    setTimeout(() => input.focus(), 50);
}

function closeSangerModal() {
    document.getElementById('sanger-modal').style.display = "none";
    pendingSangerExamId = null;
}

function setSangerError(message) {
    const el = document.getElementById("sanger-error");
    el.innerText = message;
    el.style.display = message ? "block" : "none";
    document.getElementById("sanger-gene-input").classList.toggle("invalid", !!message);
}

function confirmSangerRequest() {
    if (!pendingSangerExamId) return;
    const geneInput = document.getElementById('sanger-gene-input').value.trim().toUpperCase();
    if (!geneInput) {
        setSangerError("Digite o símbolo do gene (ex.: SPAST).");
        document.getElementById('sanger-gene-input').focus();
        return;
    }
    if (!/^[A-Z0-9-]{2,15}$/.test(geneInput)) {
        setSangerError("Use apenas o símbolo oficial do gene: letras, números ou hífen, sem espaços.");
        document.getElementById('sanger-gene-input').focus();
        return;
    }
    const exam = EXAMS_DB.find(e => e.id === pendingSangerExamId);
    closeSangerModal();
    executePurchase(exam, geneInput);
}

/**
 * PEDIDOS E RESULTADOS
 */
function executePurchase(exam, userGeneInput) {
    const now = Date.now();
    const order = { id: exam.id, gene: userGeneInput, orderedAt: now, readyAt: now + CONFIG.examDelay };
    state.orders.push(order);
    state.money -= exam.cost;
    saveState();

    updateMoneyDisplay(state.money);
    refreshExamCard(exam.id);
    renderResultCard(order, true);
    updateEmptyState();
    scheduleCompletion(order);
    showToast(`${exam.category} · ${exam.label}: em análise.`);
}

function scheduleCompletion(order) {
    pendingTimers[order.id] = setTimeout(() => {
        delete pendingTimers[order.id];
        const exam = EXAMS_DB.find(e => e.id === order.id);
        fillResultCard(order);
        refreshExamCard(order.id);
        showToast(`Resultado liberado: ${exam.category} · ${exam.label}`, "success");
        if (!document.getElementById("tab-resultados").classList.contains("active")) {
            document.getElementById("notification-badge").style.display = "block";
        }
    }, Math.max(order.readyAt - Date.now(), 0));
}

function updateEmptyState() {
    const resultsDiv = document.getElementById("results");
    const empty = resultsDiv.querySelector(".empty-state");
    if (state.orders.length === 0 && !empty) {
        resultsDiv.innerHTML = `<div class="empty-state"><p>Nenhum exame solicitado.</p></div>`;
    } else if (state.orders.length > 0 && empty) {
        empty.remove();
    }
}

function renderResultCard(order, animate) {
    const exam = EXAMS_DB.find(e => e.id === order.id);
    const card = document.createElement("div");
    card.className = "result-flashcard" + (animate ? "" : " no-anim");
    card.id = `result-${exam.id}`;
    card.innerHTML = `
        <div class="result-header"><span>🔬 ${exam.label}</span><span class="result-time"></span></div>
        <div class="result-body"></div>`;
    document.getElementById("results").prepend(card);

    if (isReady(order)) {
        fillResultCard(order);
    } else {
        card.classList.add("pending");
        card.querySelector(".result-time").innerText = "em análise";
        card.querySelector(".result-body").innerHTML = progressHtml(order);
    }
}

async function fillResultCard(order) {
    const exam = EXAMS_DB.find(e => e.id === order.id);
    const card = document.getElementById(`result-${exam.id}`);
    if (!card) return;
    card.classList.remove("pending");
    card.querySelector(".result-time").innerText = new Date(order.readyAt).toLocaleTimeString('pt-BR');
    const body = card.querySelector(".result-body");

    if (exam.type === "input_gene") {
        body.innerHTML = await resolveSangerResult(exam, order.gene);
    } else if (exam.type === "csv_filter") {
        body.innerHTML = `<div id="csv-container-${exam.id}"><p>Carregando dados do sequenciamento...</p></div>`;
        const downloadBtnHtml = `
            <div style="margin-bottom: 15px; margin-top: 10px;">
                <a href="${exam.filename}" download="${exam.filename}" class="download-btn">📥 Baixar Arquivo Completo (.csv)</a>
            </div>`;
        fetch(exam.filename)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.text();
            })
            .then(text => {
                document.getElementById(`csv-container-${exam.id}`).innerHTML = downloadBtnHtml + generateHtmlFromCSV(exam.resultTitle, text);
            })
            .catch(err => {
                document.getElementById(`csv-container-${exam.id}`).innerHTML = `<p style="color:red">Erro ao carregar CSV: ${err.message}</p>`;
            });
    } else {
        body.innerHTML = exam.result;
    }
}

async function resolveSangerResult(exam, gene) {
    for (const variant of exam.variants || []) {
        try {
            return await decryptSecret(`${sessionPassword}\u0000${gene}`, variant);
        } catch (err) { /* gene incorreto para esta variante */ }
    }
    return exam.failResult;
}

function generateHtmlFromCSV(title, csvText) {
    const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/);
    const separator = lines[0].includes(";") ? ";" : ",";

    // Descarta linhas sem dados e colunas vazias no fim da tabela
    const rows = lines
        .map(line => line.split(separator).map(c => c.trim()))
        .filter(cols => cols.some(c => c !== ""));
    if (rows.length === 0) return `<strong>${title}</strong><p>Arquivo sem dados.</p>`;
    const width = Math.max(...rows.map(cols => cols.reduce((last, c, i) => c !== "" ? i + 1 : last, 0)));

    let html = `<strong>${title}</strong><div class="result-table-container"><table class="result-table"><thead><tr>`;
    rows[0].slice(0, width).forEach(h => html += `<th>${h}</th>`);
    html += '</tr></thead><tbody>';

    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i].slice(0, width);
        while (cols.length < width) cols.push("");
        const isHighlight = cols.some(c => HIGHLIGHT_TERMS.some(t => c.toUpperCase().includes(t)));

        html += `<tr class="${isHighlight ? 'highlight-variant' : ''}">`;
        cols.forEach(c => html += `<td>${c}</td>`);
        html += '</tr>';
    }
    return html + '</tbody></table></div>';
}

function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerText = message;
    if (type === "error") toast.style.background = "#ef4444";
    if (type === "success") toast.style.background = "#059669";
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function updateTimestamp() {
    const started = state ? new Date(state.startedAt) : new Date();
    document.getElementById("timestamp").innerText = `Caso iniciado em: ${started.toLocaleString('pt-BR')}`;
}

/**
 * CONCLUSÃO DO CASO E RELATÓRIO EM PDF
 */
const PDF_LIBS = ["vendor/jspdf.umd.min.js", "vendor/jspdf.plugin.autotable.min.js"];

function examName(exam) {
    if (exam.category === "NGS") return exam.label;
    if (exam.category === "Paternidade") return "Teste de paternidade (STR)";
    if (exam.category === "Sanger") return "Sequenciamento Sanger";
    return exam.category;
}

function examPatient(exam) {
    if (exam.category === "NGS") {
        return /trio/i.test(exam.label) ? "Trio: II-1, I-1 e I-2" : "II-1 (probando)";
    }
    return exam.label;
}

// Conclusões salvas antes da troca de "nome" por "grupo" usam studentName
function conclusionGroup(conclusion) {
    return conclusion.group || conclusion.studentName || "";
}

function totalSpent() {
    return CONFIG.initialMoney - state.money;
}

function updateConclusionUi() {
    const concluded = !!state.conclusion;
    document.getElementById("conclude-btn").style.display = concluded ? "none" : "inline-block";
    document.getElementById("report-btn").style.display = concluded ? "inline-block" : "none";
    const banner = document.getElementById("concluded-banner");
    banner.style.display = concluded ? "flex" : "none";
    if (concluded) {
        document.getElementById("concluded-text").innerText =
            `Caso concluído pelo grupo "${conclusionGroup(state.conclusion)}" em ${new Date(state.conclusion.concludedAt).toLocaleString('pt-BR')}.`;
    }
}

function openConcludeModal() {
    if (state.conclusion) { downloadReport(); return; }
    const pending = state.orders.filter(o => !isReady(o)).length;
    if (pending > 0) {
        showToast(`Aguarde ${pending} exame(s) em análise antes de concluir o caso.`, "error");
        return;
    }
    document.getElementById("conclude-stats").innerHTML = `
        <div><span>Exames solicitados</span><strong>${state.orders.length}</strong></div>
        <div><span>Total gasto</span><strong>${formatCurrency(totalSpent())}</strong></div>
        <div><span>Saldo restante</span><strong>${formatCurrency(state.money)}</strong></div>`;
    setConcludeError("");
    document.getElementById("conclude-modal").style.display = "flex";
    setTimeout(() => document.getElementById("student-name").focus(), 50);
}

function closeConcludeModal() {
    document.getElementById("conclude-modal").style.display = "none";
}

function setConcludeError(message) {
    const el = document.getElementById("conclude-error");
    el.innerText = message;
    el.style.display = message ? "block" : "none";
}

async function confirmConclusion() {
    const studentName = document.getElementById("student-name").value.trim();
    const hypothesis = document.getElementById("hypothesis-input").value.trim();

    if (!studentName) { setConcludeError("Informe o grupo."); document.getElementById("student-name").focus(); return; }
    if (!hypothesis) { setConcludeError("Descreva sua hipótese diagnóstica."); document.getElementById("hypothesis-input").focus(); return; }
    if (state.orders.some(o => !isReady(o))) { setConcludeError("Ainda há exames em análise. Aguarde os resultados."); return; }

    state.conclusion = { group: studentName, hypothesis, concludedAt: Date.now() };
    saveState();
    closeConcludeModal();
    updateConclusionUi();
    const category = currentCategory();
    if (category) showExamsByCategory(category);
    await downloadReport();
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const el = document.createElement("script");
        el.src = src;
        el.onload = resolve;
        el.onerror = () => reject(new Error(`não foi possível carregar ${src}`));
        document.head.appendChild(el);
    });
}

// As fontes padrão do PDF só cobrem o alfabeto latino; troca o que estiver fora dele.
function pdfText(text) {
    return String(text ?? "")
        .replace(/[−‐‑]/g, "-")
        .replace(/[→➡]/g, "->")
        .replace(/[←]/g, "<-")
        .replace(/[≤]/g, "<=").replace(/[≥]/g, ">=")
        .replace(/[^\n\x20-\x7E\xA0-\xFF–—‘’“”•…€]/g, "?");
}

function formatDuration(ms) {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ${minutes % 60} min`;
    return `${Math.floor(hours / 24)} dia(s) e ${hours % 24} h`;
}

async function downloadReport() {
    if (!state.conclusion) return;
    const button = document.getElementById("report-btn");
    button.disabled = true;
    showToast("Gerando relatório em PDF...");
    try {
        for (const src of PDF_LIBS) await loadScript(src);
        const doc = buildReport(state);
        doc.save(reportFileName(state));
        showToast("Relatório baixado.", "success");
    } catch (err) {
        showToast(`Erro ao gerar o PDF: ${err.message}`, "error");
    } finally {
        button.disabled = false;
    }
}

function reportFileName(st) {
    const slug = conclusionGroup(st.conclusion).normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "grupo";
    const date = new Date(st.conclusion.concludedAt).toISOString().slice(0, 10);
    return `relatorio-caso-paraplegia-${slug}-${date}.pdf`;
}

function buildReport(st) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 15;
    const navy = [15, 23, 42], blue = [37, 99, 235], muted = [100, 116, 139];
    const fmtDate = ts => new Date(ts).toLocaleString('pt-BR', { dateStyle: "short", timeStyle: "short" });
    const c = st.conclusion;

    // Cabeçalho
    doc.setFillColor(...navy);
    doc.rect(0, 0, pageW, 30, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text("Relatório do Caso Clínico", margin, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(pdfText("Paraplegia Espástica · Simulação de Diagnóstico Genético"), margin, 22);

    let y = 40;
    const section = (title) => {
        if (y > 260) { doc.addPage(); y = 20; }
        doc.setTextColor(...blue); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
        doc.text(pdfText(title), margin, y);
        doc.setDrawColor(226, 232, 240); doc.line(margin, y + 2, pageW - margin, y + 2);
        y += 6;
    };
    const after = () => { y = doc.lastAutoTable.finalY + 10; };
    const keyValue = { theme: "plain", styles: { fontSize: 10, cellPadding: 1.8, textColor: [30, 41, 59] },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 50, textColor: [71, 85, 105] } },
        margin: { left: margin, right: margin, bottom: 20 } };

    section("Identificação");
    doc.autoTable({ ...keyValue, startY: y, body: [
        ["Grupo", pdfText(conclusionGroup(c))],
        ["Início do caso", fmtDate(st.startedAt)],
        ["Conclusão", fmtDate(c.concludedAt)],
        ["Tempo total", formatDuration(c.concludedAt - st.startedAt)],
    ]});
    after();

    section("Hipótese diagnóstica");
    doc.autoTable({ ...keyValue, startY: y, body: [["Hipótese", pdfText(c.hypothesis)]] });
    after();

    const orders = [...st.orders].sort((a, b) => a.orderedAt - b.orderedAt)
        .map(o => ({ order: o, exam: EXAMS_DB.find(e => e.id === o.id) })).filter(x => x.exam);
    const spent = orders.reduce((sum, x) => sum + x.exam.cost, 0);

    section("Exames solicitados");
    if (orders.length === 0) {
        doc.setTextColor(...muted); doc.setFont("helvetica", "italic"); doc.setFontSize(10);
        doc.text("Nenhum exame foi solicitado.", margin, y + 2);
        y += 12;
    } else {
        doc.autoTable({
            startY: y, margin: { left: margin, right: margin, bottom: 20 }, theme: "striped",
            styles: { fontSize: 9, cellPadding: 2, valign: "middle" }, headStyles: { fillColor: navy },
            head: [["#", "Exame", "Paciente", "Gene alvo", "Solicitado em", "Custo"]],
            body: orders.map(({ order, exam }, i) => [
                String(i + 1), pdfText(examName(exam)), pdfText(examPatient(exam)),
                order.gene ? pdfText(order.gene) : "-", fmtDate(order.orderedAt), pdfText(formatCurrency(exam.cost))]),
            foot: [["", "Total", "", "", "", pdfText(formatCurrency(spent))]], showFoot: "lastPage",
            footStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: "bold" },
            columnStyles: { 0: { halign: "center", cellWidth: 8 }, 3: { halign: "center" }, 5: { halign: "right", cellWidth: 26 } },
        });
        after();
    }


    section("Resumo dos gastos");
    doc.autoTable({ ...keyValue, startY: y, body: [
        ["Orçamento inicial", formatCurrency(CONFIG.initialMoney)],
        ["Total gasto", `${formatCurrency(spent)} (${Math.round(spent / CONFIG.initialMoney * 100)}% do orçamento)`],
        ["Saldo final", formatCurrency(CONFIG.initialMoney - spent)],
        ["Exames solicitados", String(orders.length)],
    ].map(r => r.map(pdfText))});
    after();

    if (orders.length > 0) {
        const byCategory = {};
        orders.forEach(({ exam }) => {
            byCategory[exam.category] = byCategory[exam.category] || { n: 0, total: 0 };
            byCategory[exam.category].n += 1;
            byCategory[exam.category].total += exam.cost;
        });
        doc.autoTable({
            startY: y, margin: { left: margin, right: margin, bottom: 20 }, theme: "striped",
            styles: { fontSize: 9.5, cellPadding: 2 }, headStyles: { fillColor: navy },
            head: [["Tipo de exame", "Quantidade", "Gasto", "% do gasto"]],
            body: Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total).map(([cat, v]) => [
                pdfText(cat), String(v.n), pdfText(formatCurrency(v.total)), `${Math.round(v.total / spent * 100)}%`]),
            columnStyles: { 1: { halign: "center" }, 2: { halign: "right" }, 3: { halign: "right" } },
        });
        after();
    }

    // Rodapé em todas as páginas
    const pages = doc.getNumberOfPages();
    const pageH = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(226, 232, 240); doc.line(margin, pageH - 14, pageW - margin, pageH - 14);
        doc.setTextColor(...muted); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
        doc.text(pdfText("Simulação Genética Médica · Criado por: Profa. Dra. Karina Griesi e Carolina Souza Sanchez"), margin, pageH - 9);
        doc.text(`Gerado em ${fmtDate(Date.now())} · Página ${i} de ${pages}`, pageW - margin, pageH - 9, { align: "right" });
    }
    return doc;
}
