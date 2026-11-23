#!/usr/bin/env node
/**
 * Gera secrets.js (conteúdo cifrado do desafio) a partir de um JSON em texto claro.
 *
 * Uso:  SENHA='a-senha' node tools/build-secrets.mjs caminho/para/gabarito.source.json
 *
 * O JSON de origem contém o gabarito: NÃO o coloque no repositório.
 * Formato: { "highlightTerms": ["GENE"], "exams": [ ...exames... ] }
 * Exames do tipo "input_gene" usam "correctGenes", "successResult" e "failResult".
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const ITERATIONS = 200000;
const password = process.env.SENHA;
const sourcePath = process.argv[2];
if (!password || !sourcePath) {
    console.error("Uso: SENHA='a-senha' node tools/build-secrets.mjs gabarito.source.json");
    process.exit(1);
}

const enc = new TextEncoder();
const b64 = (buf) => Buffer.from(buf).toString('base64');

async function deriveKey(secret, salt) {
    const material = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
}

async function encrypt(secret, salt, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(secret, salt);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
    return { iv: b64(iv), data: b64(data) };
}

const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const salt = crypto.getRandomValues(new Uint8Array(16));

// O resultado positivo do Sanger só é decifrável com senha + gene correto.
const exams = [];
for (const exam of source.exams) {
    if (exam.type !== 'input_gene') { exams.push(exam); continue; }
    const { correctGenes, successResult, ...rest } = exam;
    const variants = [];
    for (const gene of correctGenes) {
        variants.push(await encrypt(`${password}\u0000${gene.trim().toUpperCase()}`, salt, successResult));
    }
    exams.push({ ...rest, variants });
}

const payload = await encrypt(password, salt, JSON.stringify({ highlightTerms: source.highlightTerms || [], exams }));
const out = { v: 1, iterations: ITERATIONS, salt: b64(salt), ...payload };
writeFileSync(new URL('../secrets.js', import.meta.url),
    `// Gerado por tools/build-secrets.mjs — não edite à mão.\nconst SECRETS = ${JSON.stringify(out)};\n`);
console.log(`secrets.js gerado (${exams.length} exames).`);
