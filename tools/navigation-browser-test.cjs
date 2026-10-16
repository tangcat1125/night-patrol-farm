// Run the local play page against the live site's assets, with real WebGL and pointer events.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
async function main(){
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--use-angle=swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>sessionStorage.setItem('farm-play-access','granted-once'));
  await page.route('**/play/main.html',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../play/main.html'),'utf8')}));
  await page.goto('https://tangcat1125.github.io/night-patrol-farm/play/main.html');
  await page.waitForFunction(()=>typeof FarmWorld!=='undefined'&&FarmWorld.renderer&&FarmWorld.playerMesh!==false);
  await page.evaluate(()=>{clearInterval(GameEngine.tickInterval);});
  const go=async (x,z)=>{
   const goal=await page.evaluate(({x,z})=>{
    const point=new THREE.Vector3(x,0,z).project(FarmWorld.camera);
    document.getElementById('webgl-canvas').dispatchEvent(new PointerEvent('pointerdown',{
     clientX:(point.x+1)*window.innerWidth/2,clientY:(1-point.y)*window.innerHeight/2,bubbles:true
    }));
    return {requested:{x,z},goal:GameState.player.pathGoal,end:GameState.player.routeEnd,dialogueHidden:document.getElementById('dialogue-panel').classList.contains('hidden')};
   },{x,z});
   assert(goal.goal,'Pointer did not set route');
   assert(Math.hypot(goal.goal.x-x,goal.goal.z-z)<0.1,JSON.stringify(goal));
   assert(goal.dialogueHidden,'Dialogue prevented a ground command');
   await page.waitForFunction(({x,z})=>Math.hypot(GameState.player.x-x,GameState.player.z-z)<0.02,goal.end,{timeout:30000});
   return goal;
  };
  const moves=[];
  moves.push(await go(5.01,4));
  // Open an actual animal dialogue, then issue a ground click while it is visible.
  await page.evaluate(()=>{
   const animal=GameState.getAnimal('sheep');animal.x=GameState.player.x+1;animal.z=GameState.player.z;
   FarmWorld.animalMeshes.sheep.position.set(animal.x,0,animal.z);
   const body=FarmWorld.animalMeshes.sheep.getObjectByName('Body')||FarmWorld.animalMeshes.sheep;
   const p=new THREE.Vector3();body.getWorldPosition(p);p.project(FarmWorld.camera);
   document.getElementById('webgl-canvas').dispatchEvent(new PointerEvent('pointerdown',{clientX:(p.x+1)*innerWidth/2,clientY:(1-p.y)*innerHeight/2,bubbles:true}));
  });
  assert(await page.evaluate(()=>!document.getElementById('dialogue-panel').classList.contains('hidden')),'Could not open dialogue');
  moves.push(await go(20,4));
  moves.push(await go(11,4)); // The pond must resolve to reachable shore.
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({realWebGL:true,pointerMoves:moves,errors},null,2));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exit(1)});
