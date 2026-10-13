// Embarque dans l'application le moteur de vision (MediaPipe) et le modèle de silhouettes,
// pour que l'analyse tourne SANS internet sur le lieu du tournoi.
// - moteur WebAssembly : copié depuis node_modules/@mediapipe/tasks-vision/wasm
// - modèle pose_landmarker_lite (Google, Apache 2.0) : téléchargé une fois, empreinte vérifiée
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'public', 'mediapipe', 'wasm');
const modelDst = join(root, 'public', 'models', 'pose_landmarker_lite.task');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const MODEL_SHA256 = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

mkdirSync(wasmDst, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  copyFileSync(join(wasmSrc, f), join(wasmDst, f));
}

mkdirSync(dirname(modelDst), { recursive: true });
if (!existsSync(modelDst) || sha256(readFileSync(modelDst)) !== MODEL_SHA256) {
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Téléchargement du modèle impossible : HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== MODEL_SHA256) throw new Error('Empreinte du modèle inattendue : téléchargement refusé');
  writeFileSync(modelDst, buf);
  console.log(`modèle de silhouettes téléchargé (${(buf.length / 1048576).toFixed(1)} Mo)`);
}
console.log('moteur de vision prêt (public/mediapipe, public/models)');
