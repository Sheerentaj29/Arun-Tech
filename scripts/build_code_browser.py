#!/usr/bin/env python3
"""Build a single-file, self-contained HTML code browser for the Arun-Tech repo.
Embeds all source/config/doc files as JSON; client-side JS renders a file tree,
syntax highlighting, line numbers, file filter and full-text search."""
import json, os, subprocess

REPO = "/home/z/my-project/Arun-Tech"
OUT = "/home/z/my-project/download/Arun-Tech-code-browser.html"

def tracked():
    return [f for f in subprocess.run(["git", "ls-files"], cwd=REPO, capture_output=True, text=True).stdout.split("\n") if f.strip()]

INCLUDE_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".css", ".sql", ".prisma", ".sh", ".json", ".md", ".txt", ".svg", ".bak"}
INCLUDE_DIRS = ("src/", "prisma/", "scripts/", "tests/", "examples/", "mini-services/", "docs/", "public/", "download/")
INCLUDE_ROOT = {"package.json", "next.config.ts", "tsconfig.json", "tailwind.config.ts",
                "postcss.config.mjs", "components.json", "eslint.config.mjs",
                ".gitignore", "worklog.md"}
EXCLUDE = {"package-lock.json", "bun.lock", "scripts/dev.pid"}

files = []
for f in tracked():
    if f in EXCLUDE:
        continue
    ext = os.path.splitext(f)[1].lower()
    if f in INCLUDE_ROOT:
        files.append(f); continue
    if f == ".env":
        files.append(f); continue
    if f.startswith(INCLUDE_DIRS) and ext in INCLUDE_EXT:
        files.append(f); continue

data = {}
total = 0
for f in sorted(set(files)):
    p = os.path.join(REPO, f)
    if not os.path.isfile(p):
        continue
    try:
        content = open(p, encoding="utf-8", errors="replace").read()
    except Exception:
        continue
    if f == ".env":  # redact secret values
        import re
        content = re.sub(r"=(.+)$", r"= [REDACTED]", content, flags=re.M)
    data[f] = content
    total += len(content)

blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")

def fmt_size(b):
    return f"{b/1048576:.1f} MB" if b >= 1048576 else f"{b/1024:.0f} KB"

html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Arun-Tech - Code Preview</title>
<style>
:root{
  --bg:#0d1117;--bg2:#161b22;--bg3:#1c2330;--border:#2d333b;--text:#c9d1d9;
  --dim:#8b949e;--accent:#58a6ff;--accent2:#3fb950;--sel:#1f6feb33;--kw:#ff7b72;
  --str:#a5d6ff;--com:#8b949e;--num:#79c0ff;--type:#ffa657;--fn:#d2a8ff;
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}
header{background:var(--bg2);border-bottom:1px solid var(--border);padding:10px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
header .logo{font-weight:700;font-size:16px;color:#fff;letter-spacing:.3px}
header .logo span{color:var(--accent)}
header .sub{color:var(--dim);font-size:12px}
#search{background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:7px 12px;font-size:13px;width:230px;outline:none}
#search:focus{border-color:var(--accent)}
#mode{display:flex;gap:4px}
#mode button{background:var(--bg3);border:1px solid var(--border);color:var(--dim);padding:6px 12px;font-size:12px;border-radius:6px;cursor:pointer}
#mode button.on{color:#fff;background:var(--sel);border-color:var(--accent)}
#stats{margin-left:auto;color:var(--dim);font-size:12px;white-space:nowrap}
#wrap{display:flex;flex:1;min-height:0}
#sidebar{width:320px;background:var(--bg2);border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0}
#sidebar h3{font-size:11px;text-transform:uppercase;color:var(--dim);letter-spacing:1px;padding:12px 14px 6px}
.node{user-select:none}
.dirlabel{display:flex;align-items:center;gap:6px;padding:4px 14px;cursor:pointer;font-size:13px;color:var(--text);font-weight:600}
.dirlabel:hover{background:var(--bg3)}
.dirlabel .arrow{color:var(--dim);font-size:10px;transition:transform .12s}
.dirlabel.closed .arrow{transform:rotate(-90deg)}
.dirlabel .cnt{margin-left:auto;font-size:11px;color:var(--dim);font-weight:400}
.fileitem{display:flex;align-items:center;gap:7px;padding:3px 14px 3px 26px;cursor:pointer;font-size:12.5px;color:var(--dim);font-family:Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fileitem:hover{background:var(--bg3);color:var(--text)}
.fileitem.active{background:var(--sel);color:#fff}
.badge{font-size:9px;padding:1px 5px;border-radius:4px;font-weight:700;flex-shrink:0}
.b-ts{background:#3178c6;color:#fff}.b-tsx{background:#3178c6;color:#fff}
.b-json{background:#8bc34a;color:#123}.b-sql{background:#e38c00;color:#231a00}
.b-prisma{background:#5a67d8;color:#fff}.b-sh{background:#4ec9b0;color:#00302a}
.b-md{background:#6e7681;color:#fff}.b-css{background:#c164c8;color:#fff}
.b-env{background:#dbab09;color:#231a00}.b-txt{background:#4b5257;color:#fff}
#main{flex:1;display:flex;flex-direction:column;min-width:0}
#filehead{background:var(--bg2);border-bottom:1px solid var(--border);padding:9px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
#filepath{font-family:Consolas,monospace;font-size:13px;color:var(--accent)}
#filemeta{color:var(--dim);font-size:12px}
#copy{margin-left:auto;background:var(--bg3);border:1px solid var(--border);color:var(--dim);padding:5px 12px;font-size:12px;border-radius:6px;cursor:pointer}
#copy:hover{color:#fff;border-color:var(--accent)}
#codearea{flex:1;overflow:auto;padding:14px 0}
pre{font-family:'Cascadia Code',Consolas,'Fira Code',monospace;font-size:13px;line-height:1.55;tab-size:2}
.ln{display:grid;grid-template-columns:56px 1fr}
.ln div:nth-child(1){text-align:right;padding-right:14px;color:#4d5866;user-select:none}
.ln div:nth-child(2){white-space:pre;padding-right:24px}
.ln.hl div:nth-child(2){background:#bb800933}
.kw{color:var(--kw)}.str{color:var(--str)}.com{color:var(--com);font-style:italic}
.num{color:var(--num)}.type{color:var(--type)}.fn{color:var(--fn)}.tag{color:#7ee787}.attr{color:#79c0ff}
#empty{display:flex;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:var(--dim)}
#empty .big{font-size:42px;color:#30363d}
#results{flex:1;overflow:auto;padding:14px 18px}
.result{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:10px;cursor:pointer}
.result:hover{border-color:var(--accent)}
.result .rp{font-family:Consolas,monospace;font-size:12px;color:var(--accent)}
.result .sn{font-family:Consolas,monospace;font-size:12.5px;color:var(--text);margin-top:5px;white-space:pre-wrap;word-break:break-all}
.result .sn mark{background:#bb800966;color:#fff;border-radius:3px;padding:0 2px}
.result .ln2{color:var(--dim);font-size:11px;margin-left:8px}
#sidebar::-webkit-scrollbar,#codearea::-webkit-scrollbar,#results::-webkit-scrollbar{width:10px;height:10px}
#sidebar::-webkit-scrollbar-thumb,#codearea::-webkit-scrollbar-thumb,#results::-webkit-scrollbar-thumb{background:#30363d;border-radius:5px}
@media(max-width:760px){#sidebar{position:absolute;z-index:9;height:100%;transform:translateX(-100%);transition:.15s}#sidebar.open{transform:none}#menu{display:inline-block}}
#menu{display:none;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;cursor:pointer}
</style>
</head>
<body>
<header>
  <button id="menu">&#9776;</button>
  <div class="logo">Arun-Tech <span>/ code preview</span></div>
  <div class="sub">github.com/Sheerentaj29/Arun-Tech &middot; branch main &middot; __NFILES__ files</div>
  <input id="search" placeholder="Filter files or search code..." autocomplete="off">
  <div id="mode">
    <button id="mf" class="on">File filter</button>
    <button id="mc">Full-text</button>
  </div>
  <div id="stats">__SIZE__</div>
</header>
<div id="wrap">
  <div id="sidebar"><h3>Files</h3><div id="tree"></div></div>
  <div id="main">
    <div id="empty">
      <div class="big">&lt;/&gt;</div>
      <div style="font-size:18px;color:var(--text)">Select a file from the tree to preview its code</div>
      <div id="etip" style="font-size:13px">Tip: switch to <b>Full-text</b> mode to search inside all files</div>
    </div>
    <div id="filehead" style="display:none">
      <span id="filepath"></span><span id="filemeta"></span><button id="copy">Copy code</button>
    </div>
    <div id="codearea" style="display:none"><pre id="code"></pre></div>
    <div id="results" style="display:none"></div>
  </div>
</div>
<script id="data" type="application/json">__DATA__</script>
<script>
const FILES = JSON.parse(document.getElementById('data').textContent);
const paths = Object.keys(FILES);
const $ = s => document.querySelector(s);
let mode = 'filter', active = null;

function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
const KW = ['import','from','export','default','const','let','var','function','return','if','else','for','while','switch','case','break','continue','new','class','extends','implements','interface','type','enum','async','await','try','catch','finally','throw','typeof','instanceof','in','of','this','super','static','public','private','protected','readonly','get','set','as','is','satisfies','void','null','undefined','true','false','never','any','unknown','string','number','boolean','object','keyof','infer','declare','namespace','module','require','yield','delete','do','abstract','override'];
const SQLKW = ['CREATE','TABLE','PRIMARY','KEY','FOREIGN','REFERENCES','UNIQUE','INDEX','NOT','NULL','DEFAULT','ALTER','DROP','ADD','CONSTRAINT','SELECT','INSERT','INTO','VALUES','UPDATE','SET','DELETE','FROM','WHERE','JOIN','LEFT','ON','ORDER','BY','GROUP','LIMIT','CASCADE','SEQUENCE','SERIAL','TEXT','INTEGER','BOOLEAN','TIMESTAMP','VARCHAR','JSONB','BIGSERIAL','Timestamptz','DateTime','String','Int','Boolean','Float','Json','model','enum','IF','EXISTS','TRIGGER','FUNCTION','RETURNS','BEGIN','END','LANGUAGE','plpgsql','COLUMN','TYPE','USING','ROW','BEFORE','AFTER','WITH','CONFLICT','DO','NOTHING'];
const SHKW = ['if','then','else','elif','fi','for','in','do','done','while','case','esac','function','echo','export','source','cd','mkdir','cp','mv','rm','set','local','return','exit','read','pkill','bun','node','npm','git','curl','tar','sed','sleep','docker','sudo','apt','install'];
function hl(code, ext){
  let re, cls;
  if(['ts','tsx','js','mjs','cjs'].includes(ext)){
    re = /(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)|('(?:[^'\\\\\\n]|\\\\.)*'|"(?:[^"\\\\\\n]|\\\\.)*"|`(?:[^`\\\\]|\\\\.)*`)|\\b(${KW.join('|')})\\b|\\b(\\d+(?:\\.\\d+)?)\\b|\\b([A-Z][A-Za-z0-9_]*)\\b|\\b([a-zA-Z_$][\\w$]*)(?=\\()/g;
    cls = ['com','str','kw','num','type','fn'];
  } else if(ext==='sql'||ext==='prisma'){
    re = /(--[^\\n]*|\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|('(?:[^'\\\\\\n]|\\\\.)*')|\\b(${SQLKW.join('|')})\\b|(@\\w+|\\$\\w+)|\\b(\\d+(?:\\.\\d+)?)\\b/g;
    cls = ['com','str','kw','attr','num'];
  } else if(ext==='sh'){
    re = /(#[^\\n]*)|('(?:[^'\\\\\\n]|\\\\.)*'|"(?:[^"\\\\\\n]|\\\\.)*")|\\b(${SHKW.join('|')})\\b|\\b(\\d+)\\b|(\\$\\{?\\w+\\}?)/g;
    cls = ['com','str','kw','num','attr'];
  } else if(ext==='json'){
    re = /("(?:[^"\\\\\\n]|\\\\.)*")(\\s*:)?|\\b(true|false|null)\\b|\\b(-?\\d+(?:\\.\\d+)?)\\b/g;
    cls = ['str','','kw','num'];
  } else if(ext==='css'){
    re = /(\\/\\*[\\s\\S]*?\\*\\/)|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')|([.#][\\w-]+|\\bhtml\\b|\\bbody\\b)|([\\w-]+)(?=\\s*:)|(#[0-9a-fA-F]{3,8}\\b|\\b\\d+(?:\\.\\d+)?(?:px|rem|em|%|vh|vw)?\\b)/g;
    cls = ['com','str','tag','attr','num'];
  } else if(ext==='md'){
    re = /(^[#>][^\\n]*)|(`[^`\\n]+`|```)|\\*\\*[^*\\n]+\\*\\*|\\bhttps?:\\/\\/[^\\s)]+/gm;
    cls = ['kw','str','type'];
  } else if(ext==='env'||ext==='bak'){
    re = /(#|^\\s*[A-Z_]+=)/gm; cls = ['com'];
  } else {
    return esc(code);
  }
  let out = '', last = 0, m;
  while((m = re.exec(code)) !== null){
    out += esc(code.slice(last, m.index));
    let c = 'kw';
    for(let i=1;i<m.length;i++){ if(m[i]!==undefined){ c = cls[i-1]||'kw'; break; } }
    if(!c) c = 'kw';
    out += '<span class="'+c+'">'+esc(m[0])+'</span>';
    last = m.index + m[0].length;
    if(m[0].length===0) re.lastIndex++;
  }
  out += esc(code.slice(last));
  return out;
}
function extOf(p){const b=p.split('/').pop();if(p==='.env')return 'env';const e=b.lastIndexOf('.');return e<0?'txt':b.slice(e+1).toLowerCase()}
const BADGE = {ts:'TS',tsx:'TSX',json:'JSON',sql:'SQL',prisma:'DB',sh:'SH',md:'MD',css:'CSS',env:'ENV',txt:'TXT',svg:'SVG'};
function badgeCls(e){return 'b-'+e in document.createElement('x').style?'':'';}
function badgeFor(e){return 'b-'+e}

/* ---- build tree ---- */
function buildTree(filter){
  const root = {};
  for(const p of paths){
    if(filter && !p.toLowerCase().includes(filter)) continue;
    const parts = p.split('/'); let n = root;
    for(let i=0;i<parts.length-1;i++){ const k=parts.slice(0,i+1).join('/'); n[k] = n[k]||{}; n = n[k]; }
    n[p] = true;
  }
  const tree = $('#tree'); tree.innerHTML = '';
  function render(node, container, depth){
    const keys = Object.keys(node).sort((a,b)=>{
      const ad = node[a]!==true, bd = node[b]!==true;
      if(ad!==bd) return ad?-1:1;
      return a.split('/').pop().localeCompare(b.split('/').pop());
    });
    for(const k of keys){
      if(node[k]===true){
        const name = k.split('/').pop(); const e = extOf(k);
        const item = document.createElement('div');
        item.className = 'fileitem'; item.dataset.path = k;
        item.innerHTML = '<span class="badge '+badgeFor(e)+'">'+(BADGE[e]||e.toUpperCase().slice(0,4))+'</span><span>'+esc(name)+'</span>';
        item.onclick = ()=>openFile(k);
        container.appendChild(item);
      } else {
        const name = k.split('/').pop();
        const wrap = document.createElement('div'); wrap.className='node';
        const label = document.createElement('div'); label.className='dirlabel';
        const cnt = Object.keys(node[k]).filter(x=>node[k][x]===true).length;
        label.innerHTML = '<span class="arrow">&#9660;</span><span>'+esc(name)+'/</span><span class="cnt">'+cnt+'f</span>';
        const child = document.createElement('div');
        label.onclick = ()=>{ label.classList.toggle('closed'); child.style.display = label.classList.contains('closed')?'none':'block'; };
        wrap.appendChild(label); wrap.appendChild(child);
        container.appendChild(wrap);
        render(node[k], child, depth+1);
      }
    }
  }
  render(root, tree, 0);
}
buildTree(null);

/* ---- open file ---- */
function openFile(p){
  active = p;
  document.querySelectorAll('.fileitem').forEach(el=>el.classList.toggle('active', el.dataset.path===p));
  $('#empty').style.display='none'; $('#results').style.display='none';
  $('#filehead').style.display='flex'; $('#codearea').style.display='block';
  const content = FILES[p]; const lines = content.split('\\n');
  const e = extOf(p);
  $('#filepath').textContent = p;
  $('#filemeta').textContent = lines.length + ' lines · ' + fmt(content.length) + ' · ' + e.toUpperCase();
  const hlLines = hl(content, e).split('\\n');
  let html = '';
  for(let i=0;i<lines.length;i++){
    html += '<div class="ln" id="L'+(i+1)+'"><div>'+(i+1)+'</div><div>'+(hlLines[i]||'')+'</div></div>';
  }
  $('#code').innerHTML = html;
  $('#codearea').scrollTop = 0;
}
function fmt(b){return b>=1024*1024?(b/1048576).toFixed(1)+' MB':b>=1024?(b/1024).toFixed(0)+' KB':b+' B'}
$('#copy').onclick = ()=>{ if(active){ navigator.clipboard.writeText(FILES[active]); $('#copy').textContent='Copied'; setTimeout(()=>$('#copy').textContent='Copy code',1200);} };

/* ---- search ---- */
let searchTimer;
$('#search').oninput = ()=>{ clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 180); };
document.querySelectorAll('#mode button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#mode button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
  mode = b.id==='mf'?'filter':'full'; doSearch();
});
function doSearch(){
  const q = $('#search').value.trim().toLowerCase();
  if(mode==='filter'){ buildTree(q||null); if(!q){/*keep view*/} return; }
  if(!q){ $('#results').style.display='none'; if(active){$('#filehead').style.display='flex';$('#codearea').style.display='block';} return; }
  $('#results').style.display='block'; $('#filehead').style.display='none'; $('#codearea').style.display='none';
  $('#empty').style.display='none';
  let hits = 0, out = '';
  for(const p of paths){
    const lines = FILES[p].split('\\n');
    let shown = 0;
    for(let i=0;i<lines.length && shown<4 && hits<60;i++){
      const idx = lines[i].toLowerCase().indexOf(q);
      if(idx>=0){
        hits++;
        const L = lines[i]; const s = Math.max(0,idx-60), epos = Math.min(L.length, idx+q.length+60);
        const snip = (s>0?'...':'')+L.slice(s,epos)+(epos<L.length?'...':'');
        out += '<div class="result" data-p="'+esc(p)+'" data-l="'+(i+1)+'"><span class="rp">'+esc(p)+'</span><span class="ln2">line '+(i+1)+'</span><div class="sn">'+esc(snip).replace(new RegExp(q.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&'),'ig'),'<mark>$&</mark>')+'</div></div>';
        shown++;
      }
    }
    if(hits>=60) break;
  }
  $('#results').innerHTML = out || '<div style="color:var(--dim);padding:30px;text-align:center">No matches found</div>';
  document.querySelectorAll('.result').forEach(r=>r.onclick=()=>{ openFile(r.dataset.p); setTimeout(()=>{ const el=document.getElementById('L'+r.dataset.l); if(el){el.scrollIntoView({block:'center'}); el.classList.add('hl'); setTimeout(()=>el.classList.remove('hl'),1500);} },50); });
  $('#results').insertAdjacentHTML('afterbegin','<div style="color:var(--dim);font-size:12px;margin-bottom:10px">'+hits+' match'+(hits===1?'':'es')+(hits>=60?' (showing first 60)':'')+'</div>');
}
$('#menu').onclick = ()=>$('#sidebar').classList.toggle('open');

/* default file */
openFile('package.json');
</script>
</body>
</html>"""

html = html.replace("__DATA__", blob)
html = html.replace("__NFILES__", str(len(data)))
html = html.replace("__SIZE__", fmt_size(total))

with open(OUT, "w", encoding="utf-8") as fh:
    fh.write(html)

print(f"Wrote {OUT} ({os.path.getsize(OUT)/1024:.0f} KB), {len(data)} files embedded, {fmt_size(total)} of code")
print("Largest embedded files:")
for p in sorted(data, key=lambda k: -len(data[k]))[:8]:
    print(f"  {len(data[p]):>8} B  {p}")
