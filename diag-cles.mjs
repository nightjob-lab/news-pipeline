// Diagnostic des clés LLM, lancé à la main par le workflow « diag-cles ».
// Ne journalise QUE des noms de secrets et un statut, jamais une valeur ni un
// corps de réponse (le dépôt est public, ses journaux aussi).
//   GEMINI_API_KEY_N : vivante | morte | quota | absente | doublon de … | erreur HTTP n
const GENERATION = String(process.env.DIAG_GENERATION || 'true') === 'true';
const MODELE = String(process.env.DIAG_MODELE || 'gemini-3.1-flash-lite').trim();
const DEPOT = process.env.GITHUB_REPOSITORY || 'nightjob-lab/news-pipeline';

async function http(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const texte = await r.text().catch(() => '');
    return { code: r.status, texte };
  } catch (e) {
    return { code: 0, texte: e?.name === 'AbortError' ? 'timeout' : 'réseau' };
  } finally {
    clearTimeout(t);
  }
}

const cleMorte = (code, texte) =>
  code === 401 || code === 403 ||
  (code === 400 && /API_KEY_INVALID|API key not valid|API key expired|API_KEY_EXPIRED/i.test(texte));

async function testerGemini(cle) {
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  const entetes = { 'x-goog-api-key': cle, 'Content-Type': 'application/json' };
  const liste = await http(`${base}/models?pageSize=1`, { headers: entetes });
  if (cleMorte(liste.code, liste.texte)) return 'morte';
  if (liste.code !== 200) return `erreur HTTP ${liste.code}`;
  if (!GENERATION) return 'vivante (liste des modèles seulement)';
  const reflexion = /lite/i.test(MODELE) ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 };
  const gen = await http(`${base}/models/${encodeURIComponent(MODELE)}:generateContent`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Réponds OK.' }] }],
      generationConfig: { maxOutputTokens: 8, thinkingConfig: reflexion },
    }),
  });
  if (gen.code === 200) return 'vivante';
  if (gen.code === 429) return /PerDay|per_day|RequestsPerDay/i.test(gen.texte) ? 'quota (journalier épuisé)' : 'quota';
  if (cleMorte(gen.code, gen.texte)) return 'morte';
  if (gen.code === 404) return `vivante (modèle ${MODELE} introuvable pour cette clé)`;
  return `erreur HTTP ${gen.code}`;
}

async function testerOpenAI(url, cle) {
  const r = await http(url, { headers: { Authorization: `Bearer ${cle}` } });
  if (r.code === 200) return 'vivante';
  if (r.code === 429) return 'quota';
  if (r.code === 401) return 'morte';
  if (r.code === 403) return 'morte ou sans crédit (403)';
  return `erreur HTTP ${r.code}`;
}

const lignes = [];
const mortes = [];
const vues = new Map(); // valeur → nom (en mémoire seulement)
let vivantes = 0;
let quotas = 0;

console.log(`Diagnostic Gemini · génération ${GENERATION ? `ON (${MODELE}, 1 requête par clé)` : 'OFF'}`);
for (let i = 1; i <= 60; i++) {
  const nom = `GEMINI_API_KEY_${i}`;
  const cle = String(process.env[nom] || '').trim();
  let statut;
  if (!cle) statut = 'absente';
  else if (vues.has(cle)) statut = `doublon de ${vues.get(cle)}`;
  else {
    vues.set(cle, nom);
    statut = await testerGemini(cle);
  }
  if (statut === 'absente') continue;
  if (statut.startsWith('vivante')) vivantes++;
  if (statut.startsWith('quota')) quotas++;
  if (statut === 'morte' || statut.startsWith('doublon')) mortes.push(nom);
  lignes.push(`${nom} : ${statut}`);
}
lignes.forEach(l => console.log(l));
console.log(`\nGemini : ${vivantes} vivante(s), ${quotas} au quota, ${mortes.length} morte(s) ou en doublon, sur ${lignes.length} secret(s) rempli(s).`);

console.log('\nAutres fournisseurs :');
const autres = [
  ['XAI_API_KEY', 'https://api.x.ai/v1/models'],
  ['GROQ_API_KEY', 'https://api.groq.com/openai/v1/models'],
  ['MISTRAL_API_KEY', 'https://api.mistral.ai/v1/models'],
  ['MISTRAL_API_KEY_2', 'https://api.mistral.ai/v1/models'],
];
for (const [nom, url] of autres) {
  const cle = String(process.env[nom] || '').trim();
  console.log(`${nom} : ${cle ? await testerOpenAI(url, cle) : 'absente'}`);
}

if (mortes.length) {
  console.log('\nSecrets à supprimer (à lancer sur le Mac, après vérification) :');
  mortes.forEach(n => console.log(`gh secret delete ${n} -R ${DEPOT}`));
}
