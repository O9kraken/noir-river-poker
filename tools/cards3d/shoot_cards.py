import sys, base64, time, json, os
from playwright.sync_api import sync_playwright
OUT=sys.argv[3] if len(sys.argv)>3 else '/home/claude/noir-river-poker/public/art/cards/'
os.makedirs(OUT, exist_ok=True)
st, keys = sys.argv[1], (sys.argv[2] if len(sys.argv)>2 else '')
p=sync_playwright().start(); b=p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
pg=b.new_page(); errs=[]
pg.on('console', lambda m: m.type=='error' and errs.append(m.text)); pg.on('pageerror', lambda e: errs.append(str(e)))
t=time.time(); pg.goto(f'http://localhost:8765/cards.html?set={st}&keys={keys}')
pg.wait_for_function('window.result', timeout=1800000)
r=json.loads(pg.evaluate('window.result'))
pre = 'b-' if st=='bomb' else 'd-'
for k,v in r.items():
    if v.startswith('ERR'): print(k, v[:400]); continue
    open(OUT+pre+k+'.webp','wb').write(base64.b64decode(v.split(',')[1]))
print(len(r), 'cards', round(time.time()-t,1),'s', errs[:3])
b.close(); p.stop()
