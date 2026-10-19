// Exercises the shipped story/UI code in Chromium; WebGL and audio are stubbed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
async function main() {
  let html = fs.readFileSync(path.join(root, 'play/main.html'), 'utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (tag) => {
    if (tag.includes('const GameState =') || tag.includes('const GameEngine =') || tag.includes('const DIALOGUES_DATA =') || tag.includes('document.addEventListener("DOMContentLoaded"')) return tag;
    return '';
  });
  html = html.replace('loadDialogueJson().finally(() => { GameEngine.init(); renderLoop(); });',
    '');
  html = html.replace('        // Raycasting for user clicks', 'window.storyTest = {openDialogueForAnimal, closeDialogue, getReading: () => activeReading};\n        // Raycasting for user clicks');
  const bundle = fs.readFileSync(path.join(root, 'dialogues/bundle.js'), 'utf8');
  html = html.replace('<head>', '<head><style>.hidden{display:none!important}</style><script>' + bundle +
    'const SoundAudio = new Proxy({}, {get:()=>()=>{}}); const THREE={Mesh:class{constructor(){this.position={set(){}}}},BoxGeometry:class{},MeshBasicMaterial:class{}}; const FarmWorld={animalMeshes:{},scene:{add(){},getObjectByName(){return null}}};<\/script>');
  const browser = await chromium.launch({headless:true,
    ...(process.env.STORY_BROWSER_EXECUTABLE ? {executablePath:process.env.STORY_BROWSER_EXECUTABLE} : {channel:'chrome'})});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(html);
    assert.deepEqual(errors,[]);
    await page.evaluate(() => { GameEngine.showToast=()=>{}; GameEngine.updateHUD=()=>{}; });

    for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(()=>storyTest.closeDialogue());
      await page.evaluate(()=>{
        const ui=document.getElementById('ui-layer');ui.classList.remove('mobile-data-open');
        const drawer=document.getElementById('clue-board');
        if(getComputedStyle(drawer).display!=='none')throw Error('Drawer starts open');
      });
      await page.locator('#mobile-data-toggle').click();
      assert(await page.locator('#clue-board').isVisible(),'Drawer not opened');
      const box=await page.locator('#clue-board').boundingBox();
      assert(Math.abs(box.x+box.width/2-viewport.width/2)<2,'Drawer off center');
      await page.evaluate(()=>{GameState.conversationSeen={};storyTest.openDialogueForAnimal(GameState.getAnimal('sheep'));});
      assert(!await page.locator('#clue-board').isVisible(),'Clues cover reading');
      assert(!await page.locator('#toast-banner').isVisible(),'Toast covers reading');
      assert(await page.evaluate(()=>document.getElementById('dialogue-panel').parentElement===document.body),'Dialogue trapped in HUD stacking context');
      while(await page.evaluate(()=>storyTest.getReading().index<storyTest.getReading().pages.length-1))await page.locator('#btn-dialogue-ok').click();
      for(const selector of ['#btn-dialogue-ok','#btn-follow-next','#btn-end-dialogue-game']){
        const result=await page.locator(selector).evaluate(el=>{
          const r=el.getBoundingClientRect();return {inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
        });
        assert(result.inside&&result.hit,selector+' obscured '+JSON.stringify({viewport,result}));
      }
      const dialog=await page.locator('#dialogue-panel').boundingBox();
      assert(Math.abs(dialog.x+dialog.width/2-viewport.width/2)<2,'Dialogue off center');
      assert(dialog.y+dialog.height<=viewport.height,'Dialogue below screen');
      await page.screenshot({path:path.join(root,'hud-reading-'+viewport.width+'.png')});
      await page.locator('#btn-dialogue-ok').click();
      assert(await page.evaluate(()=>GameState.player.guidedTargetId==='pigeon'),'Read button did not navigate to next actor');
      assert(!await page.locator('#dialogue-panel').isVisible(),'Dialogue remained open after follow');
      await page.screenshot({path:path.join(root,'hud-'+viewport.width+'.png')});
    }
    await page.evaluate(()=>{
      GameState.evidence={night_out:true};GameState.conversationSeen={};
      storyTest.openDialogueForAnimal(GameState.getAnimal('crow'));
    });
    while(await page.evaluate(()=>storyTest.getReading().index<storyTest.getReading().pages.length-1))await page.locator('#btn-dialogue-ok').click();
    await page.locator('#btn-follow-next').click();
    assert(await page.evaluate(()=>GameState.evidence.crow_tracks&&GameState.searchTarget==='mud_wool'),'Crow follow did not unlock field search');
    await page.evaluate(()=>{ GameEngine.showEndModal=GameEngine.showEndModalOriginal || GameEngine.showEndModal; storyTest.openDialogueForAnimal(GameState.getAnimal('sheep')); });
    await page.locator('#btn-end-dialogue-game').click();
    assert(await page.evaluate(()=>GameState.gameOver&&!GameState.player.destination),'Teacher end did not stop game');
    assert(!await page.locator('#dialogue-panel').isVisible(),'Teacher end left reading open');
    assert.deepEqual(errors,[]);
    console.log('HUD passed: 1440px desktop, 390px portrait and 844px landscape; drawer collapse, topmost centered dialogue, visible clickable actions, next-character navigation and crow-to-search transition.');
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exit(1)});
