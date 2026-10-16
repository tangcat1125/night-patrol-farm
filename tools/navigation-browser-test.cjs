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
   await page.waitForTimeout(600); // Let the following camera settle before projecting a screen click.
   const screen=await page.evaluate(({x,z})=>{
    const point=new THREE.Vector3(x,0,z).project(FarmWorld.camera);
    return {x:(point.x+1)*window.innerWidth/2,y:(1-point.y)*window.innerHeight/2};
   },{x,z});
   assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y).id,screen),'webgl-canvas','Transparent UI intercepted the ground');
   await page.mouse.click(screen.x,screen.y);
   const goal=await page.evaluate(({x,z})=>{
    return {requested:{x,z},goal:GameState.player.pathGoal,end:GameState.player.routeEnd,dialogueHidden:document.getElementById('dialogue-panel').classList.contains('hidden')};
   },{x,z});
   assert(goal.goal,'Pointer did not set route');
   assert(Math.hypot(goal.goal.x-x,goal.goal.z-z)<0.1,JSON.stringify(goal));
   assert(goal.dialogueHidden,'Dialogue prevented a ground command');
   await page.waitForFunction(({x,z})=>Math.hypot(GameState.player.x-x,GameState.player.z-z)<0.02,goal.end,{timeout:30000});
   return goal;
  };
  const moves=[];
  // The exact blank HUD area highlighted in the user's screenshot. Real mouse
  // input must reach the canvas at both matching display sizes.
  for(const config of [{width:2048,height:767},{width:1907,height:714}]){
   await page.setViewportSize(config);
   await page.evaluate(()=>{
    GameState.player.x=2;GameState.player.z=8;GameState.player.destination=null;GameState.player.path=[];
    GameState.player.mesh.position.set(2,0,8);
    FarmWorld.camera.position.set(44,44,50);FarmWorld.controls.target.set(2,0,8);FarmWorld.controls.update();
   });
   await page.waitForTimeout(250);
   const point={x:config.width*1142/2048,y:config.height*175/767};
   const before=await page.evaluate(({x,y})=>{
    FarmWorld.raycaster.setFromCamera(new THREE.Vector2(x/innerWidth*2-1,1-y/innerHeight*2),FarmWorld.camera);
    const ground=FarmWorld.raycaster.intersectObjects(FarmWorld.scene.children,true).find(h=>h.object.name==='Ground');
    return {element:document.elementFromPoint(x,y).id,ground:ground&&{x:ground.point.x,z:ground.point.z}};
   },point);
   assert.equal(before.element,'webgl-canvas','Screenshot click blocked by '+before.element);
   assert(before.ground,'Screenshot point did not project onto ground');
   await page.mouse.click(point.x,point.y);
   const end=await page.evaluate(()=>GameState.player.routeEnd);
   assert(end,'Screenshot click ignored');
   await page.waitForFunction(({x,z})=>Math.hypot(GameState.player.x-x,GameState.player.z-z)<0.02,end,{timeout:30000});
   moves.push({screenshotClick:point,arrived:end,viewport:config});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.waitForTimeout(250);
  moves.push(await go(5.01,4));
  // Open an actual animal dialogue, then issue a ground click while it is visible.
  const sheepScreen=await page.evaluate(()=>{
   const animal=GameState.getAnimal('sheep');animal.x=GameState.player.x+1;animal.z=GameState.player.z;
   FarmWorld.animalMeshes.sheep.position.set(animal.x,0,animal.z);
   const body=FarmWorld.animalMeshes.sheep.getObjectByName('Body')||FarmWorld.animalMeshes.sheep;
   const p=new THREE.Vector3();body.getWorldPosition(p);p.project(FarmWorld.camera);
   return {x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};
  });
  await page.mouse.click(sheepScreen.x,sheepScreen.y);
  assert(await page.evaluate(()=>!document.getElementById('dialogue-panel').classList.contains('hidden')),'Could not open dialogue');
  moves.push(await go(20,4));
  moves.push(await go(11,4)); // The pond must resolve to reachable shore.
  const goalBeforeControls=await page.evaluate(()=>({...GameState.player.pathGoal}));
  await page.locator('#btn-trap-mode').click();
  assert(await page.evaluate(()=>GameState.isPlacingTrap),'Real control button lost pointer input');
  assert.deepEqual(await page.evaluate(()=>GameState.player.pathGoal),goalBeforeControls,'Control click also moved the player');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({realWebGL:true,pointerMoves:moves,errors},null,2));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exit(1)});
