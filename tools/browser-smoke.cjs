// Optional local browser smoke check; start Chrome with --remote-debugging-port=9237.
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function main() {
  const targets = await fetch('http://127.0.0.1:9237/json/list').then(r => r.json());
  const target = targets.find(item => item.type === 'page');
  if (!target) throw Error('No Chrome page target');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (!data.id || !pending.has(data.id)) return;
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    data.error ? reject(Error(data.error.message)) : resolve(data.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const index = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  const play = pathToFileURL(path.resolve(__dirname, '../play/main.html')).href;
  await send('Page.navigate', { url: index });
  await wait(1000);
  await evaluate('sessionStorage.setItem("farm-play-access", "granted-once")');
  await send('Page.navigate', { url: play });
  await wait(6000);
  const initial = await evaluate('({phase: GameState.phase, animals: GameState.animals.length, jsonAnimals: Object.keys(DIALOGUES_DATA).length, renderer: !!FarmWorld.renderer, branches: Object.keys(STORY_BRANCHES.conversations).length})');
  if (!initial.renderer || initial.jsonAnimals !== 12 || initial.branches !== 12) throw Error(`Initialization failed: ${JSON.stringify(initial)}`);
  const talkAnimal = async id => {
    const result = await evaluate(`(() => {
    const animal = GameState.getAnimal(${JSON.stringify(id)});
    GameState.player.x = animal.x + 1; GameState.player.z = animal.z + 1;
    FarmWorld.camera.position.set(animal.x + 42,44,animal.z + 42);
    FarmWorld.controls.target.set(animal.x,0,animal.z);
    FarmWorld.controls.update();
    const point = new THREE.Vector3();
    const body = FarmWorld.animalMeshes[animal.id].getObjectByName('Body') || FarmWorld.animalMeshes[animal.id];
    body.getWorldPosition(point);
    point.project(FarmWorld.camera);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(point.x,point.y),FarmWorld.camera);
    const hits = ray.intersectObjects(FarmWorld.scene.children,true).slice(0,4)
      .map(hit => [hit.object.name,hit.object.parent?.name]);
    const canvas = document.getElementById('webgl-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown',{
      clientX:(point.x+1)*window.innerWidth/2,
      clientY:(1-point.y)*window.innerHeight/2,
      bubbles:true
    }));
    const dialogue = document.getElementById('dialogue-content').innerText;
    let pages = 0;
    while (!document.getElementById('dialogue-panel').classList.contains('hidden') && pages++ < 12) {
      document.getElementById('btn-dialogue-ok').click();
    }
    if (pages >= 12) throw Error('Dialogue did not finish');
    return {evidence:{...GameState.evidence}, dialogue, hits,
      visible:!document.getElementById('dialogue-panel').classList.contains('hidden')};
  })()`);
    await evaluate('document.getElementById("btn-dialogue-ok").click()');
    return result;
  };
  const sheepClaim = await talkAnimal('sheep');
  if (sheepClaim.evidence.sheep_truth) throw Error('Sheep confessed before evidence');
  const pigeonTalk = await talkAnimal('pigeon');
  if (!pigeonTalk.evidence.night_out) throw Error(`Pigeon clue failed: ${JSON.stringify(pigeonTalk)}`);
  const duckTalk = await talkAnimal('duck');
  if (!duckTalk.evidence.duck_shadow) throw Error(`Duck clue failed: ${JSON.stringify(duckTalk)}`);
  const crowTalk = await talkAnimal('crow');
  if (!crowTalk.evidence.crow_tracks) throw Error(`Crow clue failed: ${JSON.stringify(crowTalk)}`);
  const sheepTruth = await talkAnimal('sheep');
  if (!sheepTruth.evidence.sheep_truth) throw Error(`Sheep confession failed: ${JSON.stringify({first:sheepClaim, second:sheepTruth})}`);
  const dogTalk = await talkAnimal('dog');
  const pigTalk = await talkAnimal('pig');
  const defense = await evaluate('({dogPatrol:GameState.dogPatrolActive, west:!!GameState.discoveredClues.west, southeast:!!GameState.discoveredClues.southeast})');
  if (!defense.dogPatrol || !defense.west || !defense.southeast) throw Error(`Defense branch failed: ${JSON.stringify({dogTalk,pigTalk,defense})}`);
  const night = await evaluate('GameState.timer=1; GameEngine.tick(); ({phase: GameState.phase, wolves: GameState.wolves.length})');
  if (night.phase !== 'Night' || night.wolves < 4) throw Error(`Night failed: ${JSON.stringify(night)}`);
  const pounceStart = await evaluate(`(() => {
    const wolf = GameState.wolves[2];
    const chicken = GameState.getAnimal('chicken');
    GameState.animals.filter(a => (a.species || a.id) === 'dog').forEach(a => a.status = 'injured');
    chicken.x = 18; chicken.z = 18; chicken.status = 'normal';
    wolf.x = 20; wolf.z = 18; wolf.targetId = 'chicken';
    for (const other of GameState.wolves.filter(w => w !== wolf && w !== GameState.wolves[0])) { other.isDead = true; FarmWorld.removeWolf(other.id); }
    GameEngine.nightAI();
    return {attacking:wolf.attacking, id:wolf.id};
  })()`);
  if (!pounceStart.attacking) throw Error(`Wolf pounce did not start: ${JSON.stringify(pounceStart)}`);
  await wait(600);
  const pounce = await evaluate('({injured:GameState.getAnimal("chicken").status, removed:!FarmWorld.wolfMeshes["' + pounceStart.id + '"]})');
  if (pounce.injured !== 'injured' || !pounce.removed) throw Error(`Wolf pounce did not finish: ${JSON.stringify(pounce)}`);
  const capture = await evaluate(`(() => {
    for (const other of GameState.wolves) { other.isDead = true; FarmWorld.removeWolf(other.id); }
    const wolf = {id:'qa-catch',x:18,z:18,targetId:'chicken',isDead:false,captured:false};
    GameState.wolves.push(wolf); FarmWorld.spawnWolf(wolf.id,wolf.x,wolf.z);
    GameState.traps.push({id:'qa-hit',x:18,z:18}); FarmWorld.placeTrap('qa-hit',18,18);
    GameState.traps.push({id:'qa-spare',x:-23,z:-23}); FarmWorld.placeTrap('qa-spare',-23,-23);
    GameEngine.nightAI();
    FarmWorld.spawnWolf('qa-flee',22,-22);
    GameState.wolves.push({id:'qa-flee',x:22,z:-22,targetId:null,isDead:false,captured:false});
    return {captured:wolf.captured, caughtTrap:GameState.traps.find(t=>t.id==='qa-hit').capturedWolfId===wolf.id};
  })()`);
  if (!capture.captured || !capture.caughtTrap) throw Error(`Capture failed: ${JSON.stringify(capture)}`);
  const morning = await evaluate('GameEngine.togglePhase(); ({phase: GameState.phase, retreating: GameState.wolves.filter(w=>w.retreating).length, traps: GameState.traps.map(t=>t.id), wolvesKilled: GameState.wolvesKilled})');
  if (morning.phase !== 'Day' || morning.retreating < 1 || morning.wolvesKilled < 1 || morning.traps.join(',') !== 'qa-spare') throw Error(`Retreat/trap persistence failed: ${JSON.stringify(morning)}`);
  const patrol = await evaluate(`(() => {
    const dog = GameState.getAnimal('dog');
    const before = {x:dog.x,z:dog.z};
    GameState.getAnimal('sheep').status = 'dead';
    dog.status = 'normal';
    GameState.dogPatrolActive = true;
    GameEngine.dayAI();
    return {moved:Math.hypot(dog.x-before.x,dog.z-before.z)};
  })()`);
  if (patrol.moved < 0.5) throw Error(`Dog patrol failed: ${JSON.stringify(patrol)}`);
  console.log(JSON.stringify({ initial, evidenceChain: {
    sheepClaim: sheepClaim.dialogue, pigeon: pigeonTalk.dialogue,
    duck: duckTalk.dialogue, crow: crowTalk.dialogue, confession: sheepTruth.dialogue
  }, defense, night, pounce, capture, morning, patrol }, null, 2));
  socket.close();
}
main().catch(error => { console.error(error); process.exit(1); });
