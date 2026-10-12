/** Copy the already-audited public PoC assets. No downloads, installation, or private inputs. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/subtitle-workbench/assets');
const SHA = bytes => createHash('sha256').update(bytes).digest('hex');
const PREFIX = '/subtitle-workbench/assets/tiny-en-aeaa13760958b03fac5062f457d317d3319c3168-tfjs-3.7.1';
const MODEL = 'onnx-community/whisper-tiny.en_timestamped';
const MODELS = [
  ['config.json',2197,'251ea843b5901a99efa58c0b99b8052c6019aa3e7d2baf46693a1128ff606233'],
  ['generation_config.json',1646,'7b2e8451ed5f118e75fdd991409d72119d21d2fef1eba9723f68fb9c57fe5dc9'],
  ['tokenizer.json',2405679,'5eb60cec1e77aeeb6869a2bb5a8e01a84c3fe5d072d75369343021fe6f5310d0'],
  ['tokenizer_config.json',282662,'93879c3dccdd4b976f709acd85b44778873f30c275e67026f30ca1e4c975230c'],
  ['preprocessor_config.json',339,'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d'],
  ['special_tokens_map.json',2173,'98bdf3ec5b32e31575b02f64b0a32bde7c0449075d34484a7df9bdd3cdeb9fb9'],
  ['onnx/encoder_model_quantized.onnx',10097112,'697eaa5668bb13343965f423d6002273479b8508f592bd26970735516ed5039e'],
  ['onnx/decoder_model_merged_quantized.onnx',30729881,'f2df67fbe1cf39c9b050d05029b55e217a9467f3453ae5110e2bcc0f5ba73652'],
];
const RUNTIME = [
  ['transformers.min.js',870663,'4471bfd47260bea37a61733f6ef385b79087e120e6b61d70ffab6b6bb58de067'],
  ['ort-wasm-simd-threaded.jsep.mjs',44484,'08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9'],
  ['ort-wasm-simd-threaded.jsep.wasm',21596019,'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39'],
];
const CHUNKS = [
  [0,8388608,'2592f4ffa6140b25743db95c0cf26d6c2d1807385c0b0b94c2a6cbce4bcd291b'],
  [8388608,8388608,'dc50baca6d356ba2908dcc058e396fa809a79db9748bfb3e996dfc9257de3400'],
  [16777216,8388608,'b8650db44ac56f9eef5095ae64e3c6039428a5583ece52356ecb39a836590012'],
  [25165824,5564057,'9eedc0209e3b38c385d9dcbf41e7f2cbe5ea792c8f469a1a0cc65a9f2b0654f4'],
];
const expectedFiles = [['model',MODELS],['runtime',RUNTIME]].flatMap(([kind,records])=>records.map(([file,bytes,sha256])=>{
  const url=`${PREFIX}/${kind}/${file}`;
  const parts=file.includes('decoder_model')?CHUNKS.map(([offset,bytes,sha256],index)=>({index,offset,bytes,sha256,url:`${url}.part${index}`})):[{index:0,offset:0,bytes,sha256,url}];
  return {key:`${kind}/${file}`,kind,file,bytes,sha256,parts};
}));
const assertBytes = (data, bytes, sha, label) => {
  if (data.length !== bytes || SHA(data) !== sha) throw Error(`Public resource integrity failed: ${label}`);
};
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? resolve(args[args.indexOf(name)+1]) : fallback;
if (args.includes('--verify')) {
  const manifest = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8'));
  if (manifest.totalBytes !== 66032855 || manifest.model!==MODEL || manifest.prefix!==PREFIX || manifest.revision!=='aeaa13760958b03fac5062f457d317d3319c3168' || manifest.dtype!=='q8' || manifest.transformersJs!=='3.7.1' || manifest.onnxruntimeWeb!=='1.22.0-dev.20250409-89f8206ba4' || JSON.stringify(manifest.files)!==JSON.stringify(expectedFiles)) throw Error('The manifest differs from the audited immutable asset inventory');
  let bytes = 0;
  for (const file of manifest.files) {
    const parts = [];
    for (const part of file.parts) {
      const data = await readFile(join(ROOT,'public',part.url));
      assertBytes(data,part.bytes,part.sha256,part.url);
      if (data.length >= 25*1024*1024) throw Error('Hosting single-file limit exceeded');
      parts.push(data);
    }
    assertBytes(Buffer.concat(parts),file.bytes,file.sha256,file.key);
    bytes += file.bytes;
  }
  for (const license of manifest.notices) {
    const data = await readFile(join(ROOT,'public',license.url));
    assertBytes(data,license.bytes,license.sha256,license.url);
  }
  if (bytes !== manifest.totalBytes) throw Error('Total bytes mismatch');
  console.log(`Verified ${manifest.files.length} logical assets, ${bytes} bytes; 4 decoder pieces; ${manifest.notices.length} notices.`);
} else {
  const source = option('--source','/workspace/shared/lingotrace-whisper-poc');
  const evidence = option('--evidence','/workspace/shared/lingotrace-c1-scope/resource-evidence');
  const files = [];
  const save = async (url,data) => { const path = join(ROOT,'public',url); await mkdir(dirname(path),{recursive:true}); await writeFile(path,data); };
  for (const [kind, records] of [['model',MODELS],['runtime',RUNTIME]]) {
    for (const [file,bytes,sha256] of records) {
      const input = kind === 'model' ? join(source,'models',MODEL,file) : join(source,'package/dist',file);
      const data = await readFile(input);
      assertBytes(data,bytes,sha256,file);
      const url = `${PREFIX}/${kind}/${file}`;
      const parts = file.includes('decoder_model') ? CHUNKS.map(([offset,bytes,sha256],index)=>({index,offset,bytes,sha256,url:`${url}.part${index}`})) : [{index:0,offset:0,bytes,sha256,url}];
      for (const part of parts) { const dataPart = data.subarray(part.offset,part.offset+part.bytes); assertBytes(dataPart,part.bytes,part.sha256,part.url); await save(part.url,dataPart); }
      files.push({key:`${kind}/${file}`,kind,file,bytes,sha256,parts});
    }
  }
  const evidenceManifest = JSON.parse(await readFile(join(evidence,'verification.json'),'utf8'));
  const jinja = JSON.parse(await readFile(join(evidence,'jinja-lock-evidence.json'),'utf8'));
  const notices = [];
  for (const record of [...evidenceManifest.sources,{file:'jinja-LICENSE.txt',source:'https://registry.npmjs.org/@huggingface/jinja/-/jinja-0.5.1.tgz',...jinja['jinja-LICENSE.txt']}]) {
    const data = await readFile(join(evidence,record.file));
    assertBytes(data,record.bytes,record.sha256,record.file);
    const url = `/subtitle-workbench/assets/notices/${record.file}`;
    await save(url,data); notices.push({file:record.file,url,source:record.source,bytes:record.bytes,sha256:record.sha256});
  }
  // Apache-2.0 is included verbatim above; the base model card and upstream MIT notice
  // are both retained, without claiming a new or exclusive conversion license.
  await save('/subtitle-workbench/assets/notices/ATTRIBUTION.txt',Buffer.from(`LOCAL SUBTITLE WORKBENCH: PUBLIC RESOURCE ATTRIBUTION\n\nModel: ${MODEL}\nFixed converted revision: aeaa13760958b03fac5062f457d317d3319c3168\nModel source: https://huggingface.co/${MODEL}/tree/aeaa13760958b03fac5062f457d317d3319c3168\nConversion card identifies openai/whisper-tiny.en as its base, with no separate license field. The archived Hugging Face base card states Apache-2.0; upstream OpenAI Whisper code and weights are MIT. Both source notices are retained; this is provenance documentation, not a claim of a new exclusive conversion license. Apache-2.0 text: transformers-LICENSE.txt. MIT text: whisper-LICENSE.txt. Weight bytes are unchanged; only the decoder distribution is split into four parts, reassembled and SHA-256 verified locally.\n\nTransformers.js 3.7.1: Apache-2.0 (transformers-LICENSE.txt).\nONNXRuntime-web 1.22.0-dev.20250409-89f8206ba4: MIT (onnxruntime-LICENSE.txt); complete bundled ThirdPartyNotices retained.\nBundled @huggingface/jinja 0.5.1: MIT (jinja-LICENSE.txt).\nThe fixed runtime files are unmodified. Original author and copyright notices are retained in these files and accompanying license texts.\n\nNo user media, PCM, file identity, subtitles, or drafts are part of this public resource package.\n`));
  const manifest = {schema:'subtitle-public-assets.v1',prefix:PREFIX,model:MODEL,revision:'aeaa13760958b03fac5062f457d317d3319c3168',dtype:'q8',transformersJs:'3.7.1',onnxruntimeWeb:'1.22.0-dev.20250409-89f8206ba4',modelBytes:43521689,runtimeBytes:22511166,totalBytes:66032855,files,notices};
  await mkdir(OUT,{recursive:true});
  await writeFile(join(OUT,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(join(OUT,'manifest.js'),'// Generated from independently SHA-256 checked public resources. Do not edit.\nexport default '+JSON.stringify(manifest,null,2)+';\n');
  console.log(`Prepared 11 logical resources / 14 deployable files (${manifest.totalBytes} bytes), with license/source notices.`);
}
