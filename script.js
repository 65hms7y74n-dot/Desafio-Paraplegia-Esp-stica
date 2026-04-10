/**
 * CONFIGURAÇÕES GERAIS - CASO SPG11
 */
const CONFIG = {
    accessHash: "RzNub21AbXJwYg==", // Senha Base64: G3nom@mrpb
    initialMoney: 40000,
    money: 40000,
    examDelay: 8000 // 8 segundos de processamento
};

/**
 * DATABASE DE EXAMES ATUALIZADA
 */
const EXAMS_DB = [
    {
        id: "cgh_probando",
        category: "Array-CGH",
        label: "Probando (M.S.)",
        cost: 3000,
        type: "text",
        result: "<strong>Resultado array-CGH probando:</strong> Ausência de variações de número de cópias (CNVs) clinicamente relevantes. Foram identificadas múltiplas regiões de ausência de heterozigose (AOH), totalizando ~150Mb, consistente com a consanguinidade parental."
    },
    {
        id: "sanger_probando",
        category: "Sanger",
        label: "Sanger Probando",
        cost: 600,
        type: "input_gene",
        correctGenes: ["SPG11"],
        successResult: "<strong>Sanger Probando (Gene SPG11):</strong> Detectada a variante patogênica NM_025137.4:c.4841dupA (p.Met1614Asnfs*4) em <strong>homozigose</strong>.",
        failResult: "<strong>Sanger Probando:</strong> Foram investigados os exons do gene solicitado. Não foram detectadas variantes de interesse clínico para este caso."
    },
    {
        id: "sanger_mae",
        category: "Sanger",
        label: "Sanger Mãe",
        cost: 600,
        type: "input_gene",
        correctGenes: ["SPG11"],
        successResult: "<strong>Sanger Mãe (Gene SPG11):</strong> Detectada a variante c.4841dupA em <strong>heterozigose</strong> (Portadora assintomática).",
        failResult: "<strong>Sanger Mãe:</strong> Negativo para a região solicitada."
    },
    {
        id: "sanger_pai",
        category: "Sanger",
        label: "Sanger Pai",
        cost: 600,
        type: "input_gene",
        correctGenes: ["SPG11"],
        successResult: "<strong>Sanger Pai (Gene SPG11):</strong> Detectada a variante c.4841dupA em <strong>heterozigose</strong> (Portador assintomático).",
        failResult: "<strong>Sanger Pai:</strong> Negativo para a região solicitada."
    },
    {
        id: "painel_probando",
        category: "NGS",
        label: "Painel Paraplegias (Probando)",
        cost: 4000,
        type: "csv_filter",
        filename: "CG2_AtInt_caso_paraplegia_espastica_painel_probando.csv",
        resultTitle: "Painel Paraplegias (Probando)"
    },
    {
        id: "painel_familia",
        category: "NGS",
        label: "Painel Segregação (Família)",
        cost: 5000,
        type: "csv_filter",
        filename: "CG2_AtInt_caso_paraplegia_espastica_painel_familia.csv",
        resultTitle: "Painel Segregação (Família)"
    },
    {
        id: "exoma_probando",
        category: "NGS",
        label: "Exoma Probando",
        cost: 7000,
        type: "csv_filter",
        filename: "CG2_AtInt_caso_paraplegia_espastica_exoma_probando.csv",
        resultTitle: "Exoma Probando"
    },
    {
        id: "exoma_familia",
        category: "NGS",
        label: "Exoma Trio (Toda Família)",
        cost: 10000,
        type: "csv_filter",
        filename: "CG2_AtInt_caso_paraplegia_espastica_exoma_familia.csv",
        resultTitle: "Exoma Trio (Toda Família)"
    }
];

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

function tryLogin() {
    const input = document.getElementById("password-input").value;
    const errorMsg = document.getElementById("login-error");
    
    if (btoa(input) === CONFIG.accessHash) {
        document.getElementById("password-container").style.display = "none";
        document.getElementById("game-container").style.display = "flex";
        initExamCategories(); 
    } else {
        errorMsg.style.display = "block";
        setTimeout(() => errorMsg.style.display = "none", 2000);
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
    if (!animate) {
        CONFIG.money = newValue;
        element.innerText = formatCurrency(newValue);
        return;
    }
    const startValue = CONFIG.money;
    const endValue = newValue;
    const duration = 1000;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const currentMoney = startValue + (endValue - startValue) * progress;
        element.innerText = formatCurrency(currentMoney);
        if (progress < 1) requestAnimationFrame(update);
        else CONFIG.money = endValue;
    }
    requestAnimationFrame(update);
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

function processResult(exam, userGeneInput) {
    const resultsDiv = document.getElementById("results");
    const emptyState = resultsDiv.querySelector('.empty-state');
    if(emptyState) emptyState.remove();

    const card = document.createElement("div");
    card.className = "result-flashcard";
    const time = new Date().toLocaleTimeString('pt-BR');

    let bodyContent = "";
    
    if (exam.type === "input_gene") {
        bodyContent = exam.correctGenes.includes(userGeneInput) ? exam.successResult : exam.failResult;
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
    const rows = csvText.trim().split("\n");
    let html = `<strong>${title}</strong><div class="result-table-container"><table class="result-table"><thead><tr>`;
    
    const separator = rows[0].includes(";") ? ";" : ",";
    
    const headers = rows[0].split(separator);
    headers.forEach(h => html += `<th>${h.trim()}</th>`);
    html += '</tr></thead><tbody>';
    
    for(let i=1; i<rows.length; i++) {
        let cols = rows[i].split(separator);
        let isHighlight = cols.some(c => c.toUpperCase().includes("SPG11"));
        
        html += `<tr class="${isHighlight ? 'highlight-variant' : ''}">`;
        cols.forEach(c => html += `<td>${c.trim()}</td>`);
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