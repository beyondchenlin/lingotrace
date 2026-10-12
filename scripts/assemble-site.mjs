import {cp,mkdir,rm,access} from 'node:fs/promises';
await access('out/studio/index.html');
await mkdir('dist',{recursive:true});
for(const part of ['studio','_next','studio-assets']){await rm(`dist/${part}`,{recursive:true,force:true});await cp(`out/${part}`,`dist/${part}`,{recursive:true});}
console.log('Studio export merged. Existing root and /demo routes retained.');
