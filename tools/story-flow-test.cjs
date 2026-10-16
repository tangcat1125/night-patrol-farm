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
    await page.evaluate(() => {
      GameEngine.showToast=()=>{}; GameEngine.updateHUD=()=>{};
      let seed=1; Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    });
    const result = await page.evaluate(() => {
      const check=(ok,msg)=>{if(!ok)throw Error(msg)};
      const open=id=>storyTest.openDialogueForAnimal(GameState.getAnimal(id));
      const finish=()=>{let n=0;while(!document.getElementById('dialogue-panel').classList.contains('hidden')&&n++<12)document.getElementById('btn-dialogue-ok').click();check(n<12,'Page loop');};
      const resetReading=()=>storyTest.closeDialogue();
      GameEngine.dayAI();
      check(!GameState.sheepRumorCount,'Rumor started before testimony');
      open('sheep');
      check(storyTest.getReading().pages.length===4,'Missing testimony pages');
      const timer=GameState.timer;
      GameEngine.tick();
      check(timer===GameState.timer,'Reading did not pause timer');
      document.getElementById('btn-dialogue-ok').click();
      resetReading();
      check(!GameState.rumorStarted&&!GameState.conversationSeen['sheep-claim'],'Closing early granted testimony');
      open('sheep'); finish();
      check(GameState.rumorStarted,'Finished testimony did not start rumor');
      let ticks=0;
      while(GameState.animals.some(a=>a.id!=='sheep'&&!a.rumorHeard)&&ticks++<1000){
        GameEngine.dayAI();
        if(GameState.pendingSheepDialogue){
          const pending=GameState.pendingSheepDialogue;
          storyTest.openDialogueForAnimal(GameState.getAnimal('sheep'),false,{listenerName:GameState.getAnimal(pending.listenerId).name,pages:pending.pages});
          finish(); GameState.pendingSheepDialogue=null;
        }
      }
      check(ticks<1000,'Rumor pathfinding stalled: '+GameState.animals.filter(a=>!a.rumorHeard).map(a=>a.id));
      check(GameState.animals.filter(a=>(a.species||a.id)!=='crow'&&a.id!=='sheep').every(a=>a.status==='panicked'),'A companion did not believe rumor');
      check(GameState.animals.filter(a=>(a.species||a.id)==='crow').every(a=>a.status==='normal'),'Crow believed rumor');
      open('sheep'); finish();
      check(!GameState.evidence.sheep_truth,'Confessed without witnesses');
      for(const [id,flag] of [['pigeon','night_out'],['duck','duck_shadow'],['crow','crow_tracks']]){
        open(id);
        if(GameState.getAnimal(id).status==='panicked')document.getElementById('btn-action-soothe').click();
        check(!GameState.evidence[flag],'Evidence granted before final page: '+flag);
        finish();
        check(GameState.evidence[flag],'Evidence missing: '+flag);
      }
      open('sheep'); finish();
      check(!GameState.evidence.sheep_truth,'Confessed before physical search');
      for (const site of GameState.searchSites) {
        GameState.player.x=0;GameState.player.z=30;
        check(!GameEngine.inspectEvidence(site.id),'Remote evidence collection');
        GameState.player.x=site.x;GameState.player.z=site.z;
        check(GameEngine.inspectEvidence(site.id),'Search failed');
      }
      GameState.getAnimal('pig').status='injured';
      check(!GameState.rumorStarted && !GameState.pendingSheepDialogue && !GameState.rumorTargetId,'Collected evidence did not stop the lie');
      const rumorsBeforeConfession=GameState.sheepRumorCount;
      GameEngine.dayAI();
      check(GameState.sheepRumorCount===rumorsBeforeConfession,'Sheep lied after evidence was complete');
      open('sheep'); finish();
      check(GameState.evidence.sheep_truth&&!GameState.rumorStarted,'Confession did not stop rumor');
      check(!GameState.animals.some(a=>a.status==='panicked'),'Rumor panic not resolved');
      check(GameState.getAnimal('pig').status==='injured','Confession healed injury');
      open('cow'); finish();
      check(GameState.defenseActive,'Cow did not form cooperative defense after apology');
      open('dog'); finish();
      check(GameState.dogPatrolActive,'Dog dialogue did not enable fast patrol');
      const count=GameState.sheepRumorCount;
      for(let i=0;i<20;i++)GameEngine.dayAI();
      check(GameState.sheepRumorCount===count,'Rumor restarted after truth');
      open('dog');finish();
      check(GameState.dogPatrolActive&&GameState.crowGuardActive,'Defense abilities missing');
      return {companionsReached:count,ticks,evidence:GameState.evidence,readingPausesTimer:true,injuriesPreserved:true};
    });
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify(result,null,2));
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exit(1)});
