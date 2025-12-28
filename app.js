const fileInput = document.getElementById('fileInput');
const preview = document.getElementById('preview');
const processBtn = document.getElementById('processBtn');
const langSelect = document.getElementById('langSelect');
const outputEl = document.getElementById('output');
const progressEl = document.getElementById('progress');
const progressBar = progressEl.querySelector('.bar');
const progressLabel = progressEl.querySelector('.label');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');
const preserveDir = document.getElementById('preserveDir');

let currentImage = null;

fileInput.addEventListener('change', e=>{
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const url = URL.createObjectURL(f);
  preview.src = url;
  currentImage = url;
  outputEl.textContent = '';
  downloadBtn.disabled = true;
  copyBtn.disabled = true;
});

processBtn.addEventListener('click', async ()=>{
  if(!currentImage){ alert('Please select an image first.'); return; }
  processBtn.disabled = true;
  progressEl.style.visibility = 'visible';
  progressEl.setAttribute('aria-hidden','false');
  outputEl.textContent = 'Processing...';
  try{
    await runOCR(currentImage, langSelect.value);
  }catch(err){
    outputEl.textContent = 'Error: ' + (err.message || err);
  } finally{
    processBtn.disabled = false;
    // keep progress visible for a moment
    setTimeout(()=>{ progressEl.style.visibility = 'hidden'; }, 600);
  }
});

copyBtn.addEventListener('click', async ()=>{
  try{ await navigator.clipboard.writeText(outputEl.textContent); alert('Copied to clipboard'); }catch(e){ alert('Copy failed') }
});

downloadBtn.addEventListener('click', ()=>{
  const blob = new Blob([outputEl.textContent], {type:'text/plain;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'extracted.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
});

async function runOCR(imageSrc, lang){
  const worker = Tesseract.createWorker({
    logger: m => {
      if(m && m.status && m.progress!=null){
        const p = Math.round(m.progress*100);
        progressBar.style.width = p + '%';
        progressLabel.textContent = `${m.status} ${p}%`;
      } else if(m && m.status){
        progressLabel.textContent = m.status;
      }
    }
  });

  await worker.load();
  await worker.loadLanguage(lang);
  await worker.initialize(lang);
  const { data } = await worker.recognize(imageSrc, { preserve_interword_spaces: '1' });
  await worker.terminate();

  const reconstructed = reconstructFromData(data, lang);
  outputEl.textContent = reconstructed || '';
  if(preserveDir.checked || lang === 'ara'){
    outputEl.setAttribute('dir', 'rtl');
  } else {
    outputEl.setAttribute('dir', 'ltr');
  }
  downloadBtn.disabled = false;
  copyBtn.disabled = false;
}

/* reconstruction: prefer Tesseract lines when present,
   otherwise group words by vertical proximity.
   Uses word bounding boxes to insert non-breaking spaces (U+00A0)
   to approximate original horizontal spacing and preserve blank lines
   from large vertical gaps. All OCR text is used verbatim. */
function reconstructFromData(data, lang){
  const lines = (data.lines && data.lines.length>0) ? data.lines : null;
  const words = (data.words && data.words.length>0) ? data.words : [];
  if(!lines && words.length===0) return '';

  const mapWord = w => ({
    text: (w.text||'').replace(/\u00A0/g,' '),
    x0: w.bbox.x0, x1: w.bbox.x1,
    y0: w.bbox.y0, y1: w.bbox.y1,
    width: (w.bbox.x1 - w.bbox.x0),
    height: (w.bbox.y1 - w.bbox.y0),
    cy: (w.bbox.y0 + w.bbox.y1)/2
  });

  const allWords = words.map(mapWord);
  if(allWords.length===0 && lines){
    // fallback: use line text joined
    return lines.map(l => l.text || '').join('\n');
  }

  const pageLeft = Math.min(...allWords.map(w=>w.x0));
  const pageRight = Math.max(...allWords.map(w=>w.x1));

  const lineHeights = (lines && lines.length>0) ? lines.map(l=> (l.bbox.y1 - l.bbox.y0)) : allWords.map(w=>w.height);
  const avgLineH = Math.max(8, median(lineHeights));

  let lineObjs = [];
  if(lines){
    lineObjs = lines.map(l=>({
      text: l.text || '',
      x0: l.bbox.x0, x1: l.bbox.x1,
      y0: l.bbox.y0, y1: l.bbox.y1,
      words: []
    }));
    for(const w of allWords){
      let assigned = false;
      for(const L of lineObjs){
        if(w.cy >= L.y0 - avgLineH*0.3 && w.cy <= L.y1 + avgLineH*0.3){
          L.words.push(w); assigned = true; break;
        }
      }
      if(!assigned){
        let best = lineObjs[0];
        let bestDist = Math.abs(w.cy - ((best.y0+best.y1)/2));
        for(const L of lineObjs){ const d = Math.abs(w.cy - ((L.y0+L.y1)/2)); if(d < bestDist){ best = L; bestDist = d; } }
        best.words.push(w);
      }
    }
  } else {
    const sorted = allWords.slice().sort((a,b)=>a.cy - b.cy);
    const lineThresh = Math.max(6, avgLineH*0.6);
    for(const w of sorted){
      const last = lineObjs[lineObjs.length-1];
      if(!last || Math.abs(w.cy - ((last.y0+last.y1)/2)) > lineThresh){
        lineObjs.push({x0:w.x0,x1:w.x1,y0:w.y0,y1:w.y1,words:[w]});
      } else {
        last.words.push(w);
        last.x0 = Math.min(last.x0, w.x0); last.x1 = Math.max(last.x1, w.x1);
        last.y0 = Math.min(last.y0, w.y0); last.y1 = Math.max(last.y1, w.y1);
      }
    }
  }

  lineObjs.sort((a,b)=>a.y0 - b.y0);

  const assembleLines = [];
  for(let i=0;i<lineObjs.length;i++){
    const L = lineObjs[i];
    if(L.words.length===0){ assembleLines.push(''); continue; }

    const isRTL = (lang === 'ara');
    L.words.sort((a,b)=> isRTL ? (b.x1 - a.x1) : (a.x0 - b.x0));

    const charWidths = L.words.filter(w=>w.text && w.text.length>0).map(w=> Math.max(1, w.width / Math.max(1,w.text.length)));
    const avgCharW = Math.max(3, median(charWidths.length?charWidths:[L.words[0].height*0.5]));

    const first = L.words[0];
    const leadingGap = Math.max(0, first.x0 - pageLeft);
    const leadingSpaces = Math.min(120, Math.round(leadingGap / Math.max(1, avgCharW)));
    let lineText = '';
    if(leadingSpaces>0) lineText += '\u00A0'.repeat(leadingSpaces);

    for(let j=0;j<L.words.length;j++){
      const w = L.words[j];
      if(j>0){
        const prev = L.words[j-1];
        const gap = isRTL ? Math.max(0, prev.x0 - w.x1) : Math.max(0, w.x0 - prev.x1);
        const spaces = Math.min(120, Math.round(gap / Math.max(1, avgCharW)));
        if(spaces>0) lineText += '\u00A0'.repeat(spaces);
      }
      lineText += w.text;
    }

    assembleLines.push(lineText);

    if(i < lineObjs.length-1){
      const next = lineObjs[i+1];
      const vgap = Math.max(0, next.y0 - L.y1);
      const blankLines = Math.floor(vgap / (avgLineH*1.1));
      for(let b=0;b<blankLines;b++) assembleLines.push('');
    }
  }

  return assembleLines.join('\n');
}

function average(arr){ if(!arr||arr.length===0) return 0; return arr.reduce((a,b)=>a+b,0)/arr.length; }
function median(arr){ if(!arr||arr.length===0) return 0; const s=arr.slice().sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }