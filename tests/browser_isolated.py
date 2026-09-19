"""Optional isolated Chromium smoke test. Does NOT test HTTP, PWA install or SW.
Requires Python, playwright and a Chromium binary. No navigation-policy changes.
Run: python tests/browser_isolated.py [--chromium /path/to/chromium]
"""
from pathlib import Path
import argparse, base64, json, re, shutil
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium', default=shutil.which('chromium') or shutil.which('chromium-browser'))
parser.add_argument('--output', default='test-output/isolated-browser')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / 'site'
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
html = (root / 'index.html').read_text(encoding='utf-8')
html = re.sub(r'<link[^>]+>', '', html)
html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
html = html.replace('</head>', '<style>' + (root/'style.css').read_text() + '</style></head>')
assets = {'/'+str(f.relative_to(root)).replace('\\','/'): base64.b64encode(f.read_bytes()).decode()
          for f in root.rglob('*') if f.is_file()}
parts = []
for name in ['math.js','clock.js','perf.js','game.js','atlas.js','audio.js','display.js','main.js']:
    script = (root/'src'/name).read_text(encoding='utf-8')
    script = re.sub(r'^import .*?;\n', '', script, flags=re.M).replace('export ', '')
    url = json.dumps('http://test.invalid/src/'+name)
    script = script.replace('import.meta.url', url)
    if name == 'atlas.js':
        script = script.replace("i.src=new URL('../assets/atlas.png'," + url + ");",
                                "i.src='data:image/png;base64,'+__assets['/assets/atlas.png'];")
    parts.append(script)
script = '''(function(){const __assets=ASSETS;
window.fetch=async input=>{
  const bytes=__assets[new URL(String(input)).pathname];
  return bytes ? new Response(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)))
               : new Response('Not found',{status:404});
};
CONTENT
})();'''.replace('ASSETS', json.dumps(assets)).replace('CONTENT', '\n'.join(parts))
with sync_playwright() as p:
    options = {'headless':True}
    if args.chromium: options['executable_path'] = args.chromium
    browser = p.chromium.launch(**options)
    context = browser.new_context(viewport={'width':960,'height':820},device_scale_factor=1)
    page = context.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(html); page.evaluate(script)
    page.wait_for_function('window.flappy',timeout=15000)
    assert page.input_value('#aspect') == 'original'
    assert not page.is_checked('#performance-mode')
    assert page.evaluate('[game.width,game.height]') == [576,1024]
    assert page.is_disabled('#refresh-cache')
    page.evaluate('flappy.pause();for(let i=0;i<60;i++)flappy.step();')
    assert page.evaluate('flappy.snapshot().state') == 'MENU'
    page.screenshot(path=str(out/'menu.png'))
    page.evaluate('flappy.step({touches:[{x:78,y:375}]});flappy.step();for(let i=0;i<5;i++)flappy.step();')
    page.evaluate('for(let i=0;i<60;i++)flappy.step();')
    assert page.evaluate('flappy.snapshot().state') == 'READY'
    page.screenshot(path=str(out/'ready.png'))
    page.evaluate('flappy.step({tap:{x:144,y:256}});for(let i=0;i<4;i++)flappy.step();')
    assert page.evaluate('flappy.snapshot().state') == 'PLAYING'
    page.screenshot(path=str(out/'playing.png'))
    page.evaluate('for(let i=0;i<236;i++)flappy.step();')
    assert page.evaluate('flappy.snapshot().state') == 'GAME_OVER'
    page.screenshot(path=str(out/'gameover.png'))
    page.click('#open-options'); page.screenshot(path=str(out/'options.png'))
    page.click('#close-options'); page.wait_for_timeout(100)
    page.evaluate('flappy.pause(false)'); page.keyboard.down('Space')
    page.wait_for_timeout(100);page.keyboard.up('Space')
    page.wait_for_function("flappy.snapshot().state==='READY'&&flappy.snapshot().ready.stage===1",timeout=10000)
    assert page.evaluate('flappy.snapshot().state') == 'READY'
    page.keyboard.press('Space');page.wait_for_timeout(100)
    assert page.evaluate('flappy.snapshot().state') == 'PLAYING'
    page.wait_for_function('flappy.audio.buffers.size===5',timeout=10000)
    audio = page.evaluate('({state:flappy.audio.context?.state,buffers:flappy.audio.buffers.size,error:flappy.audio.error})')
    assert audio['state'] == 'running' and audio['buffers'] == 5 and not audio['error']
    page.set_viewport_size({'width':390,'height':844})
    page.evaluate("document.querySelector('#aspect').value='adapted';document.querySelector('#aspect').dispatchEvent(new Event('change',{bubbles:true}))")
    page.wait_for_timeout(50)
    layout = page.evaluate('flappy.layout()')
    assert layout['topGap'] > 0 and layout['bottomGap'] > 0
    rect = page.locator('#game').bounding_box()
    assert abs(rect['height']-844) < 1
    page.screenshot(path=str(out/'mobile.png'))
    assert not errors, errors
    context.close()
    mobile = browser.new_context(viewport={'width':844,'height':390}, screen={'width':844,'height':390}, device_scale_factor=2, has_touch=True, is_mobile=True)
    mobile_page = mobile.new_page(); mobile_errors=[]
    mobile_page.on('pageerror', lambda e: mobile_errors.append(str(e)))
    mobile_page.set_content(html); mobile_page.evaluate(script)
    mobile_page.wait_for_function('window.flappy',timeout=15000)
    assert mobile_page.locator('#orientation-lock').is_visible()
    assert not mobile_errors, mobile_errors
    mobile.close()
    report = {'environment':'Isolated Chromium DOM, original assets embedded; no network navigation',
              'errors':errors,'audio':audio,'keyboardRestart':'READY','keyboardFlap':'PLAYING','landscapeGuard':'VISIBLE',
              'offlineBrowser':'NOT_TESTED','httpModuleLoading':'NOT_TESTED',
              'localStoragePersistence':'NOT_TESTED','nativeAPKComparison':'NOT_TESTED'}
    (out/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2));browser.close()
