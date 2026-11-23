/**
 * CONFIGURAÇÕES GERAIS
 * O catálogo de exames e os resultados ficam cifrados em secrets.js
 * (gerado por tools/build-secrets.mjs) e só são abertos com a senha.
 */
const CONFIG = {
    initialMoney: 40000,
    money: 40000,
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

let purchasedExams = new Set();
let pendingSangerExamId = null;

document.addEventListener("DOMContentLoaded", () => {
    updateMoneyDisplay(CONFIG.initialMoney, false);
    updateTimestamp();
    
    document.getElementById("password-button").addEventListener("click", tryLogin);
    document.getElementById("password-input").addEventListener("keypress", (e) => {
        if(e.key === "Enter") tryLogin();
    });
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
        initExamCategories();
    } catch (err) {
        errorMsg.style.display = "block";
        setTimeout(() => errorMsg.style.display = "none", 2000);
    } finally {
        button.disabled = false;
    }
}

function switchTab(tabId) {
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.getElementById(`tab-${tabId}`).classList.add("active");
    
    const btnMap = { 'caso': 0, 'exames': 1, 'resultados': 2 };
    document.querySelectorAll(".tab-btn")[btnMap[tabId]].classList.add("active");

    if (tabId === 'resultados') {
        const badge = document.getElementById("notification-badge");
        if(badge) badge.style.display = "none";
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

function showExamsByCategory(category, btnElement) {
    if (btnElement) {
        document.querySelectorAll(".category-btn").forEach(b => b.classList.remove("active"));
        btnElement.classList.add("active");
    }
    
    document.getElementById("selected-category-title").innerText = category;
    const container = document.getElementById("exams-grid");
    container.innerHTML = "";
    
    const filteredExams = EXAMS_DB.filter(e => e.category === category);
    
    filteredExams.forEach(exam => {
        const isBought = purchasedExams.has(exam.id);
        const div = document.createElement("div");
        div.className = "exam-card";
        div.innerHTML = `
            <div>
                <div class="exam-header"><span>${exam.label}</span></div>
                <span class="exam-cost">${formatCurrency(exam.cost)}</span>
            </div>
            <button class="exam-btn" id="btn-${exam.id}" ${isBought ? 'disabled' : ''} onclick="buyExam('${exam.id}')">
                ${isBought ? 'Liberado' : 'Solicitar Exame'}
            </button>`;
        container.appendChild(div);
    });
}

function buyExam(examId) {
    if (purchasedExams.has(examId)) return;
    const exam = EXAMS_DB.find(e => e.id === examId);
    if (CONFIG.money < exam.cost) { 
        showToast("Saldo insuficiente!", "error"); 
        return; 
    }
    if (exam.type === 'input_gene') {
        pendingSangerExamId = examId;
        openSangerModal();
        return;
    }
    executePurchase(exam, null);
}

function openSangerModal() {
    document.getElementById('sanger-gene-input').value = "";
    document.getElementById('sanger-modal').style.display = "flex";
}

function closeSangerModal() {
    document.getElementById('sanger-modal').style.display = "none";
    pendingSangerExamId = null;
}

function confirmSangerRequest() {
    const geneInput = document.getElementById('sanger-gene-input').value.trim().toUpperCase();
    if (!geneInput) { alert("Digite o gene."); return; }
    const exam = EXAMS_DB.find(e => e.id === pendingSangerExamId);
    closeSangerModal();
    executePurchase(exam, geneInput);
}

function executePurchase(exam, userGeneInput) {
    updateMoneyDisplay(CONFIG.money - exam.cost);
    purchasedExams.add(exam.id);
    const btn = document.getElementById(`btn-${exam.id}`);
    if(btn) { btn.innerText = "Em análise..."; btn.disabled = true; }
    showToast(`Processando resultado...`, "info");
    setTimeout(() => {
        if(btn) btn.innerText = "Liberado";
        processResult(exam, userGeneInput);
        if (document.getElementById("tab-resultados").className !== "tab-content active") {
            document.getElementById("notification-badge").style.display = "block";
        }
    }, CONFIG.examDelay);
}

async function resolveSangerResult(exam, gene) {
    for (const variant of exam.variants || []) {
        try {
            return await decryptSecret(`${sessionPassword}\u0000${gene}`, variant);
        } catch (err) { /* gene incorreto para esta variante */ }
    }
    return exam.failResult;
}

async function processResult(exam, userGeneInput) {
    const resultsDiv = document.getElementById("results");
    const emptyState = resultsDiv.querySelector('.empty-state');
    if(emptyState) emptyState.remove();

    const card = document.createElement("div");
    card.className = "result-flashcard";
    const time = new Date().toLocaleTimeString('pt-BR');

    let bodyContent = "";
    
    if (exam.type === "input_gene") {
        bodyContent = await resolveSangerResult(exam, userGeneInput);
    } else if (exam.type === "csv_filter") {
        // Criando o botão de download para arquivos CSV
        const downloadBtnHtml = `
            <div style="margin-bottom: 15px; margin-top: 10px;">
                <a href="${exam.filename}" download="${exam.filename}" style="display: inline-block; padding: 8px 15px; background-color: #1e3a8a; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 0.9em; transition: background 0.3s;" onmouseover="this.style.backgroundColor='#1e40af'" onmouseout="this.style.backgroundColor='#1e3a8a'">
                    📥 Baixar Arquivo Completo (.csv)
                </a>
            </div>
        `;

        bodyContent = `<div id="csv-container-${exam.id}"><p>Carregando dados do sequenciamento...</p></div>`;
        
        fetch(exam.filename)
            .then(res => res.text())
            .then(text => {
                // Inserindo o botão de download acima da tabela gerada
                document.getElementById(`csv-container-${exam.id}`).innerHTML = downloadBtnHtml + generateHtmlFromCSV(exam.resultTitle, text);
            })
            .catch(err => {
                document.getElementById(`csv-container-${exam.id}`).innerHTML = `<p style="color:red">Erro ao carregar CSV: ${err.message}</p>`;
            });
    } else {
        bodyContent = exam.result;
    }

    card.innerHTML = `<div class="result-header"><span>🔬 ${exam.label}</span><span>${time}</span></div><div class="result-body">${bodyContent}</div>`;
    resultsDiv.prepend(card);
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
    if(type === "error") toast.style.background = "#ef4444";
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function updateTimestamp() {
    document.getElementById("timestamp").innerText = `Sessão iniciada: ${new Date().toLocaleString()}`;
}