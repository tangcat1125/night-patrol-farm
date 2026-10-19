const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../play/main.html'),'utf8');
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('const GameState ='))[1];
const context=vm.createContext({});
vm.runInContext(script+'\nglobalThis.state=GameState;',context);
const state=context.state;
function arrive(from,to,delta=1/60){
  Object.assign(state.player,{x:from.x,z:from.z,path:[],destination:null,pathGoal:null});
  state.planPlayerRoute(to);
  const end={...state.player.routeEnd};
  let frames=0;
  while(state.player.destination&&frames++<5000){
    state.advancePlayer(delta);
    assert(state.canMoveTo(state.player.x,state.player.z,0.45),'Entered obstacle');
  }
  assert(frames<5000,'Navigation stalled '+JSON.stringify({from,to,end,player:state.player}));
  assert(Math.hypot(state.player.x-end.x,state.player.z-end.z)<1e-6,'Missed resolved endpoint');
  return end;
}
// Fractional endpoints whose rounded grid cells are inside obstacles.
const cases=[
  [{x:2,z:8},{x:5.01,z:4}],
  [{x:5.01,z:4},{x:20,z:4}],
  [{x:-3,z:1.3},{x:-3,z:-9}],
  [{x:-9.01,z:-14},{x:9.01,z:-14}],
  [{x:-10,z:10},{x:-2,z:13}],
  [{x:2.1,z:8.1},{x:2.25,z:8.25}],
  [{x:1.46,z:-4},{x:4,z:-5}],
  [{x:4,z:-5},{x:1.46,z:-4}],
  [{x:32,z:32},{x:-32,z:-32}]
];
for(const [from,to] of cases){
  assert(state.canMoveTo(to.x,to.z,0.45));
  const end=arrive(from,to);
  assert(Math.hypot(end.x-to.x,end.z-to.z)<1e-6,'Lost exact click point');
}
let seed=827;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
function freePoint(){let p;do{p={x:random()*64-32,z:random()*64-32};}while(!state.canMoveTo(p.x,p.z,0.45));return p;}
for(let i=0;i<120;i++){
  const from=freePoint(),to=freePoint(),end=arrive(from,to,i%2?1/60:0.1);
  assert(Math.hypot(end.x-to.x,end.z-to.z)<1e-6,'Random exact goal missed');
}
// Clicking blocked scenery still produces a reachable shore / building edge.
for(const to of [{x:11,z:4},{x:-3,z:-4},{x:0,z:-14},{x:12,z:-4}]){
  const end=arrive({x:2,z:8},to);
  assert(state.canMoveTo(end.x,end.z,0.45));
}
// A changed obstacle invalidates the next segment and triggers a new route.
Object.assign(state.player,{x:20,z:20});
state.planPlayerRoute({x:20,z:-20});
state.colliders.push({xMin:19,xMax:21,zMin:10,zMax:12});
let frames=0;
while(state.player.destination&&frames++<5000)state.advancePlayer(1/60);
assert(frames<5000);
assert(Math.hypot(state.player.x-20,state.player.z+20)<1e-6,'No recovery after route obstruction');
// A second click replaces the first route immediately.
state.planPlayerRoute({x:-20,z:20});
state.advancePlayer(0.1);
state.planPlayerRoute({x:30.2,z:-19.7});
frames=0;
while(state.player.destination&&frames++<5000)state.advancePlayer(1/60);
assert(Math.hypot(state.player.x-30.2,state.player.z+19.7)<1e-6);
console.log('Navigation passed: 129 exact routes, 4 blocked goals, obstacle recovery, and destination replacement.');
