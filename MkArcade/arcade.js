// ===== SETUP =====
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const keys = {};
let currentGame = null;
let animId = null;
const BOTTOM_UI_INSET = 72;

function hudBaselineY() {
  return canvas.height - (BOTTOM_UI_INSET - 12);
}

function gameplayFloorY() {
  return canvas.height - (BOTTOM_UI_INSET - 10);
}

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (currentGame?.onKeyDown) currentGame.onKeyDown(e.code);
  if (['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') backToSelector();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('resize', () => { if (currentGame) resizeCanvas(); });

// Clic en el canvas → delegar al juego activo (botón mute, etc.)
canvas.addEventListener('click', e => {
  if (currentGame && typeof currentGame.onClick === 'function') {
    const rect = canvas.getBoundingClientRect();
    currentGame.onClick(e.clientX - rect.left, e.clientY - rect.top);
  }
});

function startGame(type) {
  document.getElementById('selector').style.display = 'none';
  document.getElementById('game-wrap').classList.add('active');
  document.getElementById('back-btn').classList.add('visible');
  resizeCanvas();
  currentGame = type === 'invaders' ? createInvadersGame() :
                type === 'trench' ? createTrenchGame() :
                type === 'pacman' ? createPacmanGame() :
                type === 'tetris' ? createTetrisGame() :
                type === 'simon' ? createSimonGame() :
                type === 'breakout' ? createBreakoutGame() :
                type === 'snake' ? createSnakeGame() :
                type === 'flappy' ? createFlappyGame() :
                createAsteroidsGame();
  if (!animId) loop();
}

function backToSelector() {
  document.getElementById('selector').style.display = 'flex';
  document.getElementById('game-wrap').classList.remove('active');
  document.getElementById('back-btn').classList.remove('visible');
  currentGame = null;
  if (animId) { cancelAnimationFrame(animId); animId = null; }
}

function loop() {
  if (currentGame) { currentGame.update(); currentGame.draw(); }
  animId = requestAnimationFrame(loop);
}

// ===== SPACE INVADERS (renovado) =====
function createInvadersGame() {

  // ── AUDIO ──────────────────────────────────────────────────────────────────
  let audioCtx = null, soundEnabled = true;
  function getACtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function playTone(freq, type, dur, vol = 0.2, freqEnd = null) {
    if (!soundEnabled) return;
    try {
      const c = getACtx(), osc = c.createOscillator(), g = c.createGain();
      osc.connect(g); g.connect(c.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, c.currentTime + dur);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      osc.start(); osc.stop(c.currentTime + dur);
    } catch(e) {}
  }
  const sfx = {
    shoot:       () => playTone(820, 'square', 0.07, 0.15, 420),
    enemyShoot:  () => playTone(160, 'sawtooth', 0.09, 0.07, 80),
    explode:     (big) => {
      playTone(big?110:190, 'sawtooth', big?0.28:0.13, big?0.3:0.2, 45);
      if (big) setTimeout(() => playTone(70,'sawtooth',0.3,0.18,35), 90);
    },
    playerDeath: () => [0,65,130,200,270].forEach((t,i) =>
      setTimeout(() => playTone(390-i*55,'sawtooth',0.13,0.22), t)),
    wave:        () => [0,110,220,340].forEach((t,i) =>
      setTimeout(() => playTone([440,550,660,880][i],'triangle',0.15,0.18), t)),
    start:       () => [{f:523,t:0},{f:659,t:105},{f:784,t:210},{f:1047,t:315},{f:784,t:520},{f:1047,t:630}]
                       .forEach(({f,t}) => setTimeout(() => playTone(f,'square',0.1,0.2), t)),
    gameOver:    () => [{f:880,t:0},{f:740,t:120},{f:622,t:245},{f:523,t:370},{f:440,t:490},{f:294,t:610},{f:220,t:750}]
                       .forEach(({f,t}) => setTimeout(() => playTone(f,'sawtooth',0.14,0.25), t)),
    bomb:        () => { playTone(140,'sawtooth',0.32,0.35,38); setTimeout(()=>playTone(75,'sawtooth',0.22,0.2,38),110); },
  };
  // Pulso ambiental — acelera conforme quedan menos enemigos
  let pulseT = 0, pulseInterval = 42;
  function tickPulse(n) {
    pulseInterval = Math.max(12, 42 - Math.max(0, 25 - n));
    if (++pulseT >= pulseInterval) { pulseT = 0; playTone(58,'sawtooth',0.04,0.05); }
  }

  // ── TIPOS DE ENEMIGO ───────────────────────────────────────────────────────
  //  name, color, hp, spd, pts, sz (hitbox radius), fireRate (prob/frame)
  const ET = [
    { name:'scout',    color:'#ff6b6b', hp:1, spd:2.2, pts:10, sz:16, fr:0.004 },
    { name:'fighter',  color:'#74b9ff', hp:2, spd:1.6, pts:20, sz:20, fr:0.006 },
    { name:'tank',     color:'#a29bfe', hp:4, spd:0.9, pts:35, sz:24, fr:0.008 },
    { name:'kamikaze', color:'#ff9f43', hp:1, spd:3.6, pts:50, sz:15, fr:0     },
    { name:'sniper',   color:'#00cec9', hp:2, spd:1.1, pts:45, sz:17, fr:0.003 },
  ];

  // ── ESTADO ─────────────────────────────────────────────────────────────────
  let score=0, lives=5, wave=0;
  let enemies=[], pBullets=[], eBullets=[], particles=[];
  let px, shootCD=0, invulT=0, shipDeathTimer=0;
  let gameOver=false;
  let waveCountdown=0;       // frames until next wave spawns
  let flashMsg='', flashT=0;
  let lastScoreLifeThreshold = 0;
  const PW=44, PH=22;

  function addScore(pts) {
    score += pts;
    const currentThreshold = Math.floor(score / 200);
    if (currentThreshold > lastScoreLifeThreshold) {
      const extra = currentThreshold - lastScoreLifeThreshold;
      lives += extra;
      lastScoreLifeThreshold = currentThreshold;
      playTone(880, 'sine', 0.15, 0.25);
    }
  }

  // Oleada clásica (grid)
  let classicWave=false, cInvaders=[], cGx=0, cGy=0, cDir=1, cTimer=0, cFrame=0, cFTimer=0;
  const COLS=11, ROWS=5, CIW=32, CIH=24, CIGX=12, CIGY=16;
  const GRID_W=COLS*(CIW+CIGX)-CIGX;
  const C_COLORS=['#ff6b6b','#74b9ff','#a29bfe'];
  // Sprites pixel art clásicos
  const C_SPR=[
    [["   XX   ","  XXXX  "," XXXXXX ","XX XX XX","XXXXXXXX","  X  X  "," X XX X ","X      X"],
     ["   XX   ","  XXXX  "," XXXXXX ","XX XX XX","XXXXXXXX"," XXXXXX ","X X  X X"," X    X "]],
    [[" X    X ","  X  X  "," XXXXXX ","XX XXXXX","XXXXXXXX","XXXXXXXX","X X  X X","  XX  XX"],
     [" X    X ","X X  X X","X XXXXXX","XXXXXXXX","XXXXXXXX"," XXXXXX ","  X  X  ","XX    XX"]],
    [["-XXXX- ","XXXXXXX","X XXXXX","XX X XX","XXXXXXX"," X X X ","X     X"," X   X "],
     ["-XXXX- ","XXXXXXX","X XXXXX","XX X XX","XXXXXXX","X X X X"," X   X "," X   X "]]
  ];

  function getPY() { return canvas.height - (BOTTOM_UI_INSET + 23); }
  function waveSize() { 
    // Empezar con menos enemigos en la oleada 1 (aprox. la mitad de lo habitual) y escalar progresivamente
    const baseSize = Math.round(Math.max(3, canvas.width/180));
    return baseSize + Math.floor(wave * 1.5); 
  }

  // ── SPAWN ──────────────────────────────────────────────────────────────────
  function spawnEnemy(ti) {
    const t = ET[ti];
    const safeTop = 75, safeH = canvas.height * 0.52;
    const side = Math.random();
    let x, y, vx, vy;

    // Velocidad progresiva: comienza al 60% de velocidad y aumenta 10% por oleada hasta llegar a la velocidad normal (100%)
    const speedFactor = Math.min(1.0, 0.5 + wave * 0.1);
    const speed = t.spd * speedFactor;

    if (side < 0.33) {            // desde izquierda
      x=-t.sz; y=safeTop+Math.random()*safeH; vx=speed; vy=0;
    } else if (side < 0.67) {     // desde derecha
      x=canvas.width+t.sz; y=safeTop+Math.random()*safeH; vx=-speed; vy=0;
    } else {                      // desde arriba
      x=60+Math.random()*(canvas.width-120); y=-t.sz;
      vx=(Math.random()-.5)*speed*1.4; vy=speed;
    }

    if (t.name==='kamikaze') {    // apunta al jugador desde el inicio
      const ang = Math.atan2(getPY()-y, px-x);
      vx=Math.cos(ang)*t.spd; vy=Math.sin(ang)*t.spd;
    }

    return { x,y,vx,vy, ti, hp:t.hp, maxHp:t.hp,
             fireCD:30+Math.random()*60,
             phase:Math.random()*Math.PI*2, flash:0, age:0 };
  }

  function spawnWave() {
    wave++;
    if (wave > 1) {
      lives += 2;
      playTone(1047, 'sine', 0.25, 0.25);
    }
    // Cada 3 oleadas: invasión clásica
    if(wave>1 && wave%3===0) { startClassicWave(); return; }
    let pool=[0,0,0,1,1,2];
    if(wave>=2) pool=[0,1,1,2,2,3];
    if(wave>=4) pool=[0,1,2,2,3,4,4];
    if(wave>=6) pool=[1,2,2,3,3,4,4];
    const n = waveSize();
    for (let i=0;i<n;i++) {
      const ti = pool[Math.floor(Math.random()*pool.length)];
      setTimeout(()=>{ if(!gameOver) enemies.push(spawnEnemy(ti)); }, i*320);
    }
    sfx.wave();
    flashMsg=`OLEADA ${wave}`; flashT=90;
  }

  // ── DISPAROS ENEMIGOS ──────────────────────────────────────────────────────
  function fireEnemy(e) {
    const t=ET[e.ti];
    sfx.enemyShoot();
    const py=getPY();
    if (t.name==='scout') {
      eBullets.push({x:e.x,y:e.y+t.sz,vx:0,vy:5.5,kind:'bullet'});
    } else if (t.name==='fighter') {
      eBullets.push({x:e.x,y:e.y+t.sz,vx:-2.2,vy:5,kind:'bullet'});
      eBullets.push({x:e.x,y:e.y+t.sz,vx: 2.2,vy:5,kind:'bullet'});
    } else if (t.name==='tank') {
      eBullets.push({x:e.x,y:e.y+t.sz,vx:0,vy:3,kind:'bomb',r:7,maxR:22});
    } else if (t.name==='sniper') {
      const ang=Math.atan2(py-e.y, px-e.x), sp=8;
      eBullets.push({x:e.x,y:e.y,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,kind:'laser'});
    }
  }

  // ── PARTÍCULAS ─────────────────────────────────────────────────────────────
  function burst(x,y,color,n=10) {
    for(let i=0;i<n;i++){
      const a=Math.random()*Math.PI*2, s=1.5+Math.random()*4;
      particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:28+Math.random()*22|0,color});
    }
  }

  // ── INIT ───────────────────────────────────────────────────────────────────
  function startClassicWave() {
    classicWave=true; cInvaders=[];
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) cInvaders.push({r,c,alive:true});
    cGx=(canvas.width-GRID_W)/2; cGy=70; cDir=1; cTimer=0; cFrame=0; cFTimer=0;
    flashMsg='⚠ ¡INVASIÓN CLÁSICA!'; flashT=100;
    sfx.wave();
  }

  function init() {
    px=canvas.width/2;
    pBullets=[];eBullets=[];particles=[];enemies=[];
    classicWave=false; cInvaders=[];
    gameOver=false; score=0; lives=5; wave=0;
    lastScoreLifeThreshold = 0;
    shootCD=0; invulT=0; shipDeathTimer=0; waveCountdown=100; pulseT=0;
    flashMsg=''; flashT=0;
    setTimeout(()=>{ sfx.start(); spawnWave(); }, 300);
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────
  function update() {
    if(gameOver) return;
    const py=getPY();

    // Jugador
    if(keys['ArrowLeft'])  px=Math.max(PW/2, px-6);
    if(keys['ArrowRight']) px=Math.min(canvas.width-PW/2, px+6);
    shootCD--;
    if(keys['Space']&&shootCD<=0&&pBullets.length<3){
      pBullets.push({x:px,y:py-PH}); shootCD=13; sfx.shoot();
    }
    if(invulT>0) invulT--;

    // Nueva oleada si no hay enemigos
    if(enemies.length===0&&eBullets.length===0) {
      if(--waveCountdown<=0){ waveCountdown=140; spawnWave(); }
    }

    // Enemigos
    enemies.forEach(e=>{
      const t=ET[e.ti];
      e.age++; if(e.flash>0) e.flash--;
      e.phase+=0.06;
      e.x+=e.vx; e.y+=e.vy;

      // Zigzag perpendicular al movimiento principal
      if(t.name==='scout')  { if(Math.abs(e.vx)>Math.abs(e.vy)) e.y+=Math.sin(e.phase)*1.6; else e.x+=Math.sin(e.phase)*1.6; }
      if(t.name==='tank')   { if(Math.abs(e.vx)>Math.abs(e.vy)) e.y+=Math.sin(e.phase)*0.7; else e.x+=Math.sin(e.phase)*0.7; }

      // Kamikaze: re-apunta al jugador cada frame con velocidad progresiva
      if(t.name==='kamikaze'){
        const waveFactor = Math.min(1.0, 0.4 + wave * 0.1); // Comienza al 50% de su velocidad y escala al 100%
        const currentSpeed = t.spd * waveFactor;
        const ang=Math.atan2(py-e.y,px-e.x);
        e.vx=Math.cos(ang)*currentSpeed; e.vy=Math.sin(ang)*currentSpeed;
      }
      // Sniper: glide lateral + descenso suave
      if(t.name==='sniper'){
        if(e.x<t.sz||e.x>canvas.width-t.sz) e.vx*=-1;
        if(e.y>80&&Math.abs(e.vy)<0.5) e.vy=0.35;
      }
      // Fighter: descenso progresivo
      if(t.name==='fighter'&&Math.abs(e.vy)<0.5) e.vy=0.45;

      // Rebote en paredes (excepto kamikaze/sniper)
      if(t.name!=='kamikaze'&&t.name!=='sniper'){
        if(e.x<t.sz)               e.vx=Math.abs(e.vx);
        if(e.x>canvas.width-t.sz)  e.vx=-Math.abs(e.vx);
      }

      // Disparo
      if(t.fr>0){ 
        e.fireCD--; 
        if(e.fireCD<=0){ 
          // El cooldown de disparo es mayor (disparan menos) en oleadas iniciales y disminuye con el tiempo
          const cdMultiplier = Math.max(1.0, 2.2 - wave * 0.2); 
          e.fireCD = (55 + Math.random() * 55) * cdMultiplier; 
          fireEnemy(e); 
        } 
      }
    });

    // Eliminar enemigos fuera de pantalla
    enemies=enemies.filter(e=>e.y<canvas.height+70&&e.x>-90&&e.x<canvas.width+90);

    // Balas jugador
    pBullets.forEach(b=>b.y-=12);
    pBullets=pBullets.filter(b=>b.y>0);

    // Balas enemigas
    eBullets.forEach(b=>{ b.x+=b.vx; b.y+=b.vy; if(b.kind==='bomb'&&b.r<b.maxR) b.r+=0.25; });
    eBullets=eBullets.filter(b=>b.y<canvas.height+20&&b.x>-30&&b.x<canvas.width+30);

    // Partículas
    particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vx*=0.95;p.vy*=0.95;p.life--;});
    particles=particles.filter(p=>p.life>0);

    // Impactos bala-jugador en enemigos
    pBullets=pBullets.filter(pb=>{
      for(let i=enemies.length-1;i>=0;i--){
        const e=enemies[i], t=ET[e.ti];
        if(Math.abs(pb.x-e.x)<t.sz&&Math.abs(pb.y-e.y)<t.sz){
          e.hp--; e.flash=7;
          if(e.hp<=0){ addScore(t.pts); burst(e.x,e.y,t.color,14); sfx.explode(t.name==='tank'); enemies.splice(i,1); }
          return false;
        }
      }
      return true;
    });

    // Impactos bala-enemiga en jugador
    if(invulT<=0){
      eBullets=eBullets.filter(b=>{
        const hr=b.kind==='bomb'?b.r+12:13;
        if(Math.abs(b.x-px)<hr&&Math.abs(b.y-py)<hr){
          lives--; invulT=130; shipDeathTimer=60;
          // Gran explosión de la nave
          burst(px,py,'#00ff41',30); burst(px,py,'#ffffff',12); burst(px,py,'#ffde00',10);
          sfx.playerDeath();
          if(b.kind==='bomb') sfx.bomb();
          if(lives<=0){ gameOver=true; sfx.gameOver(); }
          return false;
        }
        return true;
      });
    }

    // Kamikaze colisiona con jugador
    enemies=enemies.filter(e=>{
      if(ET[e.ti].name==='kamikaze'&&Math.hypot(e.x-px,e.y-py)<28&&invulT<=0){
        lives--; invulT=130; addScore(50); shipDeathTimer=60;
        burst(px,py,'#00ff41',28); burst(e.x,e.y,'#ff9f43',16);
        sfx.explode(false); sfx.playerDeath();
        if(lives<=0){ gameOver=true; sfx.gameOver(); }
        return false;
      }
      return true;
    });

    // ── Oleada clásica ─────────────────────────────────────────────────────
    if(classicWave){
      cFTimer++; if(cFTimer>22){ cFrame++; cFTimer=0; }
      const alive=cInvaders.filter(i=>i.alive);
      const cSpd=Math.max(4,55-Math.floor((COLS*ROWS-alive.length)*1.8));
      cTimer++;
      if(cTimer>=cSpd){
        cTimer=0; cGx+=cDir*10;
        if(alive.length){
          const minC=Math.min(...alive.map(i=>i.c)), maxC=Math.max(...alive.map(i=>i.c));
          if(cGx+maxC*(CIW+CIGX)+CIW>=canvas.width-12||cGx+minC*(CIW+CIGX)<=12){cDir*=-1;cGy+=18;}
        }
      }
      // Disparo clásico
      if(Math.random()<0.006&&alive.length){
        const sh=alive[Math.floor(Math.random()*alive.length)];
        eBullets.push({x:cGx+sh.c*(CIW+CIGX)+CIW/2,y:cGy+sh.r*(CIH+CIGY)+CIH,vx:0,vy:5,kind:'bullet'});
        sfx.enemyShoot();
      }
      // Balas jugador vs clásicos
      pBullets=pBullets.filter(pb=>{
        for(let i=cInvaders.length-1;i>=0;i--){
          const inv=cInvaders[i]; if(!inv.alive) continue;
          const ix=cGx+inv.c*(CIW+CIGX)+CIW/2, iy=cGy+inv.r*(CIH+CIGY)+CIH/2;
          if(Math.abs(pb.x-ix)<CIW/2+2&&Math.abs(pb.y-iy)<CIH/2+2){
            inv.alive=false;
            addScore(inv.r===0?30:inv.r<3?20:10);
            burst(ix,iy,C_COLORS[inv.r===0?0:inv.r<3?1:2],10);
            sfx.explode(false);
            return false;
          }
        }
        return true;
      });
      if(alive.length===0){ classicWave=false; waveCountdown=140; }
      // Invasores clásicos llegan al jugador
      const maxR=alive.length?Math.max(...alive.map(i=>i.r)):0;
      if(alive.length&&cGy+maxR*(CIH+CIGY)+CIH>=py-PH){ gameOver=true; sfx.gameOver(); }
    }

    if(shipDeathTimer>0) shipDeathTimer--;
    tickPulse(enemies.length+(classicWave?cInvaders.filter(i=>i.alive).length:0));
    if(flashT>0) flashT--;
  }

  // ── DRAW ENEMY ─────────────────────────────────────────────────────────────
  function drawEnemy(e) {
    const t=ET[e.ti], s=t.sz, hit=e.flash>0;
    ctx.save(); ctx.translate(e.x,e.y);

    // Barra de vida (multi-HP)
    if(t.hp>1){
      ctx.fillStyle='#222'; ctx.fillRect(-s,-s-8,s*2,4);
      ctx.fillStyle=e.hp===t.hp?'#2ecc71':'#e74c3c';
      ctx.fillRect(-s,-s-8,s*2*(e.hp/t.maxHp),4);
    }

    ctx.fillStyle=hit?'#ffffff':t.color;
    ctx.shadowColor=t.color; ctx.shadowBlur=hit?0:8;

    if(t.name==='scout'){
      ctx.beginPath();
      ctx.moveTo(0,-s); ctx.lineTo(s,0); ctx.lineTo(0,s*.6); ctx.lineTo(-s,0); ctx.closePath(); ctx.fill();
      ctx.fillStyle=hit?'#fff':'rgba(255,160,80,.75)';
      ctx.beginPath(); ctx.arc(0,s*.35,s*.28,0,Math.PI*2); ctx.fill();
    } else if(t.name==='fighter'){
      ctx.beginPath();
      ctx.moveTo(0,-s); ctx.lineTo(s*.5,-s*.3);
      ctx.lineTo(s,s*.3); ctx.lineTo(s*.3,s*.6);
      ctx.lineTo(0,s*.2); ctx.lineTo(-s*.3,s*.6);
      ctx.lineTo(-s,s*.3); ctx.lineTo(-s*.5,-s*.3);
      ctx.closePath(); ctx.fill();
    } else if(t.name==='tank'){
      ctx.beginPath();
      for(let i=0;i<6;i++){const a=i/6*Math.PI*2-Math.PI/2; i?ctx.lineTo(Math.cos(a)*s,Math.sin(a)*s):ctx.moveTo(Math.cos(a)*s,Math.sin(a)*s);}
      ctx.closePath(); ctx.fill();
      ctx.fillStyle=hit?'rgba(255,255,255,.4)':'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.arc(0,0,s*.44,0,Math.PI*2); ctx.fill();
    } else if(t.name==='kamikaze'){
      const ang=Math.atan2(getPY()-e.y,px-e.x);
      ctx.rotate(ang+Math.PI/2);
      ctx.beginPath();
      ctx.moveTo(0,-s); ctx.lineTo(s*.7,s*.7); ctx.lineTo(0,s*.2); ctx.lineTo(-s*.7,s*.7); ctx.closePath(); ctx.fill();
      ctx.fillStyle=`rgba(255,${100+Math.random()*120|0},0,.85)`;
      ctx.beginPath(); ctx.arc(0,s*1.1,s*.32,0,Math.PI*2); ctx.fill();
    } else if(t.name==='sniper'){
      ctx.beginPath();
      ctx.moveTo(0,-s*1.2); ctx.lineTo(s*.4,-s*.2);
      ctx.lineTo(s*.7,s); ctx.lineTo(0,s*.55);
      ctx.lineTo(-s*.7,s); ctx.lineTo(-s*.4,-s*.2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle=hit?'#fff':'rgba(0,255,200,.65)'; ctx.lineWidth=1.5;
      ctx.shadowBlur=0; ctx.beginPath(); ctx.arc(0,0,s*.3,0,Math.PI*2); ctx.stroke();
    }
    ctx.shadowBlur=0; ctx.restore();
  }

  // ── DRAW ───────────────────────────────────────────────────────────────────
  function draw() {
    const py=getPY();
    ctx.fillStyle='#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
    // Estrellas
    ctx.fillStyle='rgba(255,255,255,.2)';
    for(let i=0;i<100;i++) ctx.fillRect((i*173+31)%canvas.width,(i*89+57)%canvas.height,1,1);

    // Game Over
    if(gameOver){
      particles.forEach(p=>{ ctx.fillStyle=`rgba(0,255,65,${p.life/50})`; ctx.beginPath(); ctx.arc(p.x,p.y,2,0,Math.PI*2); ctx.fill(); });
      ctx.textAlign='center';
      ctx.font=`bold ${Math.min(56,canvas.width/12)}px Outfit`; ctx.fillStyle='#ff6b6b';
      ctx.fillText('GAME OVER',canvas.width/2,canvas.height/2-28);
      ctx.font='20px Outfit'; ctx.fillStyle='#fff';
      ctx.fillText(`Puntuación: ${score}  ·  Oleada: ${wave}`,canvas.width/2,canvas.height/2+20);
      ctx.font='13px Outfit'; ctx.fillStyle='rgba(255,255,255,.45)';
      ctx.fillText('Presiona ENTER para reiniciar',canvas.width/2,canvas.height/2+54);
      return;
    }

    enemies.forEach(e=>drawEnemy(e));

    // Proyectiles enemigos
    eBullets.forEach(b=>{
      if(b.kind==='bullet'){
        ctx.fillStyle='#ff4444'; ctx.fillRect(b.x-2,b.y,4,11);
      } else if(b.kind==='bomb'){
        const grd=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,b.r);
        grd.addColorStop(0,'rgba(255,210,0,.9)'); grd.addColorStop(1,'rgba(255,80,0,0)');
        ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill();
      } else if(b.kind==='laser'){
        ctx.save(); ctx.strokeStyle='#00cec9'; ctx.lineWidth=2.5;
        ctx.shadowColor='#00cec9'; ctx.shadowBlur=8;
        ctx.beginPath(); ctx.moveTo(b.x,b.y-10); ctx.lineTo(b.x,b.y+10); ctx.stroke();
        ctx.restore();
      }
    });

    // Proyectiles jugador
    pBullets.forEach(b=>{
      ctx.fillStyle='#aaffaa'; ctx.fillRect(b.x-2,b.y-12,4,12);
      ctx.fillStyle='#fff'; ctx.fillRect(b.x-1,b.y-14,2,4);
    });

    // Partículas
    particles.forEach(p=>{
      const a=Math.min(1,p.life/35);
      ctx.fillStyle=p.color+(Math.floor(a*255).toString(16).padStart(2,'0'));
      ctx.beginPath(); ctx.arc(p.x,p.y,2.5,0,Math.PI*2); ctx.fill();
    });

    // Jugador (parpadea si invulnerable)
    if(!(invulT>0&&Math.floor(invulT/6)%2===0)){
      ctx.fillStyle='#00ff41';
      ctx.beginPath(); ctx.moveTo(px,py-PH); ctx.lineTo(px-PW/2,py); ctx.lineTo(px+PW/2,py); ctx.closePath(); ctx.fill();
      ctx.fillRect(px-4,py-PH-10,8,10);
      ctx.fillStyle=`rgba(0,255,65,${.35+.25*Math.sin(Date.now()*.01)})`;
      ctx.beginPath(); ctx.arc(px,py,5,0,Math.PI*2); ctx.fill();
    }

    // Dibujar oleada clásica
    if(classicWave){
      cInvaders.forEach(inv=>{
        if(!inv.alive) return;
        const ix=cGx+inv.c*(CIW+CIGX)+CIW/2, iy=cGy+inv.r*(CIH+CIGY)+CIH/2;
        const type=inv.r===0?0:inv.r<3?1:2;
        const spr=C_SPR[type][cFrame%2];
        const sc=2, off=4*sc;
        ctx.fillStyle=C_COLORS[type];
        spr.forEach((row,r)=>{
          [...row].forEach((p,c)=>{ if(p==='X') ctx.fillRect(ix-off+c*sc,iy-off+r*sc,sc,sc); });
        });
      });
    }

    // Efecto de explosión de la nave al morir
    if(shipDeathTimer>0){
      const t=shipDeathTimer/60;
      const r=40*(1-t);
      const grd=ctx.createRadialGradient(px,getPY(),0,px,getPY(),r);
      grd.addColorStop(0,`rgba(255,255,200,${t})`);
      grd.addColorStop(0.4,`rgba(0,255,65,${t*.7})`);
      grd.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=grd;
      ctx.beginPath(); ctx.arc(px,getPY(),r,0,Math.PI*2); ctx.fill();
    }

    // Línea suelo
    ctx.strokeStyle='#00ff41'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(0,gameplayFloorY()+12); ctx.lineTo(canvas.width,gameplayFloorY()+12); ctx.stroke();

    // Flash de oleada
    if(flashT>0){
      ctx.textAlign='center';
      ctx.font=`bold ${flashMsg.startsWith('OLEADA')?30:22}px Outfit`;
      ctx.fillStyle=`rgba(255,200,0,${flashT/90})`;
      ctx.fillText(flashMsg,canvas.width/2,canvas.height/3);
    }

    // HUD
    ctx.fillStyle='#fff'; ctx.font='14px Outfit'; ctx.textAlign='left';
    ctx.fillText(`SCORE  ${String(score).padStart(6,'0')}`,20,hudBaselineY()+6);
    ctx.textAlign='center'; ctx.fillStyle='#74b9ff';
    ctx.fillText(`SPACE INVADERS  ·  Oleada ${wave}`,canvas.width/2,hudBaselineY()+6);
    ctx.textAlign='right'; ctx.fillStyle='#ff6b6b';
    ctx.fillText(`♥ ${Math.max(0,lives)}`,canvas.width-20,hudBaselineY()+6);

    // Botón Mute
    const mx=canvas.width-58,my=8,mw=50,mh=22;
    ctx.fillStyle=soundEnabled?'rgba(116,185,255,.15)':'rgba(255,80,80,.2)';
    ctx.strokeStyle=soundEnabled?'#74b9ff':'#ff5555'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.roundRect(mx,my,mw,mh,5); ctx.fill(); ctx.stroke();
    ctx.fillStyle=soundEnabled?'#74b9ff':'#ff5555';
    ctx.font='13px Outfit'; ctx.textAlign='center';
    ctx.fillText(soundEnabled?'🔊 ON':'🔇 OFF',mx+mw/2,my+15);
  }

  function onKeyDown(code){
    if(code==='Enter'&&gameOver) init();
    if(code==='KeyM') soundEnabled=!soundEnabled;
  }
  function onClick(ex,ey){
    const mx=canvas.width-58,my=8,mw=50,mh=22;
    if(ex>=mx&&ex<=mx+mw&&ey>=my&&ey<=my+mh){ soundEnabled=!soundEnabled; try{getACtx().resume();}catch(e){} }
  }

  init();
  return { update, draw, onKeyDown, onClick };
}


// ===== ASTEROIDS =====
function createAsteroidsGame() {
  let score=0, lives=5, level=1;
  let ship, bullets=[], asteroids=[], particles=[];
  let gameOver=false, invTimer=0, shootCD=0;
  let lastScoreLifeThreshold = 0;

  function addScore(pts) {
    score += pts;
    const currentThreshold = Math.floor(score / 500);
    if (currentThreshold > lastScoreLifeThreshold) {
      const extra = currentThreshold - lastScoreLifeThreshold;
      lives += extra;
      lastScoreLifeThreshold = currentThreshold;
      playTone(880, 'sine', 0.15, 0.25); // SFX de vida extra
    }
  }

  // ── MOTOR DE AUDIO (Web Audio API) ──
  let audioCtx = null, soundEnabled = true;
  function getACtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function playTone(freq, type, dur, vol = 0.2, freqEnd = null) {
    if (!soundEnabled) return;
    try {
      const c = getACtx(), osc = c.createOscillator(), g = c.createGain();
      osc.connect(g); g.connect(c.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, c.currentTime + dur);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      osc.start(); osc.stop(c.currentTime + dur);
    } catch(e) {}
  }

  const sfx = {
    shoot: () => playTone(680, 'sawtooth', 0.12, 0.12, 100),
    explode: (sz) => {
      const d = sz === 3 ? 0.38 : sz === 2 ? 0.22 : 0.12;
      const f = sz === 3 ? 120 : sz === 2 ? 220 : 380;
      playTone(f, 'sawtooth', d, sz === 3 ? 0.35 : 0.22, 35);
    },
    thrust: () => {
      // Pitido muy corto para emular motor pulsado
      if (Math.random() < 0.22) playTone(78, 'triangle', 0.05, 0.08, 48);
    },
    death: () => {
      [0, 80, 160, 240].forEach((t, i) =>
        setTimeout(() => playTone(350 - i*70, 'sawtooth', 0.18, 0.25), t)
      );
    },
    start: () => {
      const notes = [261, 329, 392, 523];
      notes.forEach((f, i) => setTimeout(() => playTone(f, 'square', 0.12, 0.16), i * 90));
    },
    gameOver: () => {
      const notes = [440, 392, 349, 293];
      notes.forEach((f, i) => setTimeout(() => playTone(f, 'sawtooth', 0.2, 0.2), i * 130));
    }
  };

  const THRUST=0.18, ROT=0.065, DRAG=0.988, MAX_SPD=9;

  function mkShip() {
    return { x:canvas.width/2, y:canvas.height/2, vx:0, vy:0, angle:-Math.PI/2, dead:false };
  }

  function mkAsteroid(x, y, sz) {
    const a = Math.random()*Math.PI*2;
    const spd = (0.7+Math.random()*1.6)*(4-sz)*0.55+0.4;
    const verts = 8+Math.floor(Math.random()*5);
    const shape = Array.from({length:verts},(_,i)=>{
      const ang=(i/verts)*Math.PI*2, r=sz*22*(0.65+Math.random()*0.35);
      return [Math.cos(ang)*r, Math.sin(ang)*r];
    });
    return { x,y, vx:Math.cos(a)*spd, vy:Math.sin(a)*spd,
             spin:(Math.random()-.5)*0.04, angle:0, sz, r:sz*22, shape };
  }

  function wrap(o) {
    if(o.x<0)o.x+=canvas.width; if(o.x>canvas.width)o.x-=canvas.width;
    if(o.y<0)o.y+=canvas.height; if(o.y>canvas.height)o.y-=canvas.height;
  }

  function explode(x, y, n, color) {
    for(let i=0;i<n;i++){
      const a=Math.random()*Math.PI*2, s=1+Math.random()*4;
      particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:25+Math.floor(Math.random()*30),color});
    }
  }

  function spawnRoids(n) {
    for(let i=0;i<n;i++){
      let x,y,t=0;
      do{ x=Math.random()*canvas.width; y=Math.random()*canvas.height; t++; }
      while(t<20 && Math.hypot(x-canvas.width/2,y-canvas.height/2)<160);
      asteroids.push(mkAsteroid(x,y,3));
    }
  }

  function init(lv=1) {
    ship=mkShip(); bullets=[]; particles=[]; asteroids=[];
    invTimer=200; gameOver=false; spawnRoids(3+lv);
    if(lv === 1) {
      score = 0;
      lives = 5;
      lastScoreLifeThreshold = 0;
    }
    setTimeout(() => sfx.start(), 200);
  }

  function update() {
    if(gameOver) return;
    particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vx*=0.97;p.vy*=0.97;p.life--;});
    particles=particles.filter(p=>p.life>0);

    if(ship.dead){
      invTimer--;
      asteroids.forEach(a=>{a.x+=a.vx;a.y+=a.vy;a.angle+=a.spin;wrap(a);});
      bullets.forEach(b=>{b.x+=b.vx;b.y+=b.vy;b.life--;wrap(b);});
      bullets=bullets.filter(b=>b.life>0);
      if(invTimer<=0){
        if(lives>0){
          ship=mkShip();invTimer=180;
        }else {
          gameOver=true;
          sfx.gameOver();
        }
      }
      return;
    }

    if(invTimer>0) invTimer--;
    if(keys['ArrowLeft'])  ship.angle -= ROT;
    if(keys['ArrowRight']) ship.angle += ROT;
    ship.thrusting = keys['ArrowUp'];
    if(ship.thrusting){
      ship.vx+=Math.cos(ship.angle)*THRUST; ship.vy+=Math.sin(ship.angle)*THRUST;
      const s=Math.hypot(ship.vx,ship.vy);
      if(s>MAX_SPD){ship.vx=ship.vx/s*MAX_SPD;ship.vy=ship.vy/s*MAX_SPD;}
      sfx.thrust();
    }
    ship.vx*=DRAG; ship.vy*=DRAG; ship.x+=ship.vx; ship.y+=ship.vy; wrap(ship);

    shootCD--;
    if(keys['Space']&&shootCD<=0){
      bullets.push({x:ship.x+Math.cos(ship.angle)*22, y:ship.y+Math.sin(ship.angle)*22,
                    vx:Math.cos(ship.angle)*13+ship.vx*0.4, vy:Math.sin(ship.angle)*13+ship.vy*0.4, life:55});
      shootCD=10;
      sfx.shoot();
    }

    asteroids.forEach(a=>{a.x+=a.vx;a.y+=a.vy;a.angle+=a.spin;wrap(a);});
    bullets.forEach(b=>{b.x+=b.vx;b.y+=b.vy;b.life--;wrap(b);});
    bullets=bullets.filter(b=>b.life>0);

    let newRoids=[];
    bullets=bullets.filter(b=>{
      for(let i=asteroids.length-1;i>=0;i--){
        const a=asteroids[i];
        if(Math.hypot(b.x-a.x,b.y-a.y)<a.r){
          addScore(a.sz===3?20:a.sz===2?50:100);
          if(a.sz>1){newRoids.push(mkAsteroid(a.x,a.y,a.sz-1));newRoids.push(mkAsteroid(a.x,a.y,a.sz-1));}
          explode(a.x,a.y,a.sz*5,'#aaa');
          sfx.explode(a.sz);
          asteroids.splice(i,1); return false;
        }
      }
      return true;
    });
    asteroids.push(...newRoids);

    if(invTimer<=0&&!ship.dead){
      for(const a of asteroids){
        if(Math.hypot(ship.x-a.x,ship.y-a.y)<a.r+14){
          ship.dead=true; lives--;
          invTimer=90; explode(ship.x,ship.y,20,'#00ff41');
          sfx.death();
          if(lives<=0) {
            gameOver=true;
            sfx.gameOver();
          }
          break;
        }
      }
    }

    if(asteroids.length===0){ 
      level++; 
      lives += 2; // +2 vidas por pasar de nivel
      playTone(1047, 'sine', 0.25, 0.25);
      spawnRoids(3+level); 
      invTimer=180; 
    }
  }

  function draw() {
    ctx.fillStyle='#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='rgba(255,255,255,0.22)';
    for(let i=0;i<80;i++) ctx.fillRect((i*173+31)%canvas.width,(i*89+57)%canvas.height,1,1);

    if(gameOver){
      // still draw particles on game over
      particles.forEach(p=>{
        ctx.fillStyle=`rgba(170,170,170,${p.life/50})`;
        ctx.beginPath(); ctx.arc(p.x,p.y,2,0,Math.PI*2); ctx.fill();
      });
      ctx.textAlign='center';
      ctx.font=`bold ${Math.min(56,canvas.width/12)}px Outfit`;
      ctx.fillStyle='#ff6b6b';
      ctx.fillText('GAME OVER', canvas.width/2, canvas.height/2-28);
      ctx.font='20px Outfit'; ctx.fillStyle='#fff';
      ctx.fillText(`Puntuación: ${score}`, canvas.width/2, canvas.height/2+18);
      ctx.font='13px Outfit'; ctx.fillStyle='rgba(255,255,255,0.45)';
      ctx.fillText('Presiona ENTER para reiniciar', canvas.width/2, canvas.height/2+52);
      return;
    }

    asteroids.forEach(a=>{
      ctx.save(); ctx.translate(a.x,a.y); ctx.rotate(a.angle);
      ctx.strokeStyle='#ccc'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(a.shape[0][0],a.shape[0][1]);
      a.shape.forEach(v=>ctx.lineTo(v[0],v[1])); ctx.closePath(); ctx.stroke();
      ctx.restore();
    });

    ctx.fillStyle='#fff';
    bullets.forEach(b=>{ ctx.beginPath(); ctx.arc(b.x,b.y,2.5,0,Math.PI*2); ctx.fill(); });

    particles.forEach(p=>{
      const alpha=Math.min(1,p.life/30);
      ctx.fillStyle=p.color==='#00ff41'?`rgba(0,255,65,${alpha})`:`rgba(200,200,200,${alpha})`;
      ctx.beginPath(); ctx.arc(p.x,p.y,2,0,Math.PI*2); ctx.fill();
    });

    if(!ship.dead&&!(invTimer>0&&Math.floor(invTimer/8)%2===0)){
      ctx.save(); ctx.translate(ship.x,ship.y); ctx.rotate(ship.angle);
      ctx.strokeStyle='#00ff41'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(22,0); ctx.lineTo(-13,-11); ctx.lineTo(-7,0); ctx.lineTo(-13,11); ctx.closePath(); ctx.stroke();
      if(ship.thrusting&&Math.random()>0.35){
        ctx.strokeStyle=`hsl(${20+Math.random()*30},100%,55%)`;
        ctx.beginPath(); ctx.moveTo(-7,-5); ctx.lineTo(-22-Math.random()*14,0); ctx.lineTo(-7,5); ctx.stroke();
      }
      ctx.restore();
    }

    ctx.fillStyle='#fff'; ctx.font='15px Outfit';
    ctx.textAlign='left';  ctx.fillText(`SCORE  ${String(score).padStart(6,'0')}`, 20, hudBaselineY());
    ctx.textAlign='center'; ctx.fillText(`NIVEL ${level}`, canvas.width/2, hudBaselineY());
    ctx.textAlign='right';  ctx.fillText(`♥ ${Math.max(0,lives)}`, canvas.width-20, hudBaselineY());

    // Botón Mute
    const mx=canvas.width-58,my=8,mw=50,mh=22;
    ctx.fillStyle=soundEnabled?'rgba(0,255,65,.12)':'rgba(255,80,80,.2)';
    ctx.strokeStyle=soundEnabled?'#00ff41':'#ff5555'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.roundRect(mx,my,mw,mh,5); ctx.fill(); ctx.stroke();
    ctx.fillStyle=soundEnabled?'#00ff41':'#ff5555';
    ctx.font='13px Outfit'; ctx.textAlign='center';
    ctx.fillText(soundEnabled?'🔊 ON':'🔇 OFF',mx+mw/2,my+15);
  }

  function onKeyDown(code) {
    if(code==='Enter'&&gameOver){ score=0;lives=5;level=1; init(1); }
    if(code==='KeyM') soundEnabled = !soundEnabled;
  }

  function onClick(ex, ey) {
    const mx = canvas.width - 58, my = 8, mw = 50, mh = 22;
    if (ex >= mx && ex <= mx+mw && ey >= my && ey <= my+mh) {
      soundEnabled = !soundEnabled;
      try { getACtx().resume(); } catch(e) {}
    }
  }

  init(level);
  return { update, draw, onKeyDown, onClick };
}

// ===== STAR WARS: TRENCH RUN =====
function createTrenchGame() {
  // Proyección pseudo-3D mejorada
  // d: distancia al jugador (0=jugador, MAX_D=máximo visible)
  // wx: posición x en el trench (-1..1)
  const MAX_D   = 260;
  const WIN_DIST = 3200;
  const GRN  = '#39ff14';
  const AMBER = '#ffd32a';
  const RED   = '#ff4757';
  const NEON_BLUE = '#00d2ff';

  function VX() { return canvas.width / 2; }
  function VY() { return canvas.height * 0.27; }
  function PY() { return canvas.height * 0.81; }
  function HW() { return canvas.width  * 0.41; }
  function WH() { return (PY() - VY()) * 0.60; }

  // Proyección con escala exponencial para un crecimiento dramático y realista al acercarse
  function proj(wx, d) {
    const t = 1 - d / MAX_D;
    if (t <= 0.005) return null;
    const s = Math.pow(t, 2.5); // Escala exponencial
    return { x: VX() + wx * HW() * t, y: VY() + (PY() - VY()) * t, s, rawT: t };
  }

  // ── AUDIO SINTETIZADO (Web Audio API) ──────────────────────────────────────
  let audioCtx = null, soundEnabled = true;
  function getACtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function playTone(freq, type, dur, vol = 0.2, freqEnd = null) {
    if (!soundEnabled) return;
    try {
      const c = getACtx(), osc = c.createOscillator(), g = c.createGain();
      osc.connect(g); g.connect(c.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, c.currentTime + dur);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      osc.start(); osc.stop(c.currentTime + dur);
    } catch(e) {}
  }

  const sfx = {
    laser: () => {
      // Disparo doble característico del X-Wing
      playTone(880, 'triangle', 0.12, 0.16, 220);
      setTimeout(() => playTone(880, 'triangle', 0.12, 0.16, 220), 45);
    },
    tieLaser: () => {
      playTone(380, 'sawtooth', 0.15, 0.08, 100);
    },
    explode: (big) => {
      playTone(big ? 100 : 180, 'sawtooth', big ? 0.35 : 0.15, big ? 0.35 : 0.22, 30);
      if (big) setTimeout(() => playTone(60, 'sawtooth', 0.25, 0.2, 30), 80);
    },
    damage: () => {
      playTone(220, 'sawtooth', 0.25, 0.25, 440);
    },
    warning: () => {
      // Pitido de aviso de colisión inminente
      playTone(988, 'sine', 0.08, 0.12);
    },
    start: () => {
      const seq = [{f:293,t:0},{f:392,t:150},{f:493,t:300},{f:587,t:450},{f:493,t:600},{f:587,t:720}];
      seq.forEach(({f,t}) => setTimeout(() => playTone(f, 'square', 0.15, 0.18), t));
    },
    win: () => {
      const seq = [{f:523,t:0},{f:784,t:150},{f:698,t:300},{f:659,t:420},{f:587,t:540},{f:1047,t:660}];
      seq.forEach(({f,t}) => setTimeout(() => playTone(f, 'triangle', 0.2, 0.25), t));
    },
    gameOver: () => {
      const seq = [{f:330,t:0},{f:311,t:140},{f:293,t:280},{f:220,t:420}];
      seq.forEach(({f,t}) => setTimeout(() => playTone(f, 'sawtooth', 0.3, 0.2), t));
    }
  };

  // ── ESTADO DEL JUEGO ────────────────────────────────────────────────────────
  let score, lives, px, speed, distTraveled;
  let gameOver, won, invTimer, shootCD, spawnTimer, flashTimer;
  let flashMsg = '';
  let obstacles, enemies, pBullets, eBullets, particles;
  let portHit;
  let damageFlashT = 0;       // Indica flash rojo en pantalla al recibir daño
  let proximityWarning = false; // Aviso visual de obstáculo muy cerca
  let warningSoundT = 0;      // Controla el intervalo del pitido de peligro
  let lastScoreLifeThreshold = 0;

  function addScore(pts) {
    score += pts;
    const currentThreshold = Math.floor(score / 200);
    if (currentThreshold > lastScoreLifeThreshold) {
      const extra = currentThreshold - lastScoreLifeThreshold;
      lives += extra;
      lastScoreLifeThreshold = currentThreshold;
      playTone(880, 'sine', 0.15, 0.25); // SFX de vida extra
    }
  }

  function explode(sx, sy, n, col) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, spd = 2 + Math.random() * 5.5;
      particles.push({ x:sx, y:sy, vx:Math.cos(a)*spd, vy:Math.sin(a)*spd,
                       life: 20 + Math.floor(Math.random()*28), col });
    }
  }

  function takeHit() {
    if (invTimer > 0) return;
    lives--;
    damageFlashT = 20;
    explode(VX() + px * HW(), PY() - 8, 25, GRN);
    px = 0; invTimer = 150;
    sfx.damage();
    if (lives <= 0) {
      gameOver = true;
      sfx.gameOver();
    }
  }

  function init() {
    score = 0; lives = 5; px = 0; speed = 1.5; distTraveled = 0;
    lastScoreLifeThreshold = 0;
    gameOver = won = portHit = false;
    invTimer = 150; shootCD = 0; spawnTimer = 0; flashTimer = 0;
    damageFlashT = 0; proximityWarning = false; warningSoundT = 0;
    obstacles = []; enemies = []; pBullets = []; eBullets = []; particles = [];
    for (let i = 0; i < 8; i++) {
      const d = 100 + i * 140 + Math.random() * 60;
      spawnAt(d);
    }
    setTimeout(() => sfx.start(), 200);
  }

  function spawnAt(d) {
    const r = Math.random();
    if (r < 0.33) {
      obstacles.push({ wx: Math.random() * 1.3 - 0.65, d, w: 0.13, kind:'tower' });
    } else if (r < 0.70) {
      const bwx = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.5);
      enemies.push({ wx:bwx, d, baseWX:bwx, waveFreq:0.03+Math.random()*0.04,
                     waveT:0, hp:1, flash:0, kind:'tie', shootCD:999 });
    } else {
      enemies.push({ wx:(Math.random()<0.5?-1:1)*1.06, d, hp:2, flash:0, kind:'turret',
                     shootCD: 80 + Math.floor(Math.random()*60) });
    }
  }

  function update() {
    if (gameOver || won) return;

    spawnTimer++;
    if (spawnTimer >= 52) {
      spawnTimer = 0;
      if (WIN_DIST - distTraveled > 450) spawnAt(MAX_D + 10);
    }

    speed = Math.min(4.5, 1.5 + distTraveled / 900);
    distTraveled += speed;

    const LIM = 0.84;
    if (keys['ArrowLeft'])  px = Math.max(-LIM, px - 0.05);
    if (keys['ArrowRight']) px = Math.min( LIM, px + 0.05);

    shootCD--;
    if (keys['Space'] && shootCD <= 0 && invTimer <= 90) {
      pBullets.push({ wx: px, d: 8 });
      shootCD = 11;
      sfx.laser();
    }

    obstacles.forEach(o => o.d -= speed);
    enemies.forEach(e => {
      e.d -= speed;
      if (e.flash > 0) e.flash--;
      if (e.kind === 'tie') {
        e.waveT += e.waveFreq;
        e.wx = e.baseWX + Math.sin(e.waveT) * 0.38;
      }
      if (e.kind === 'turret' && e.d < MAX_D * 0.72 && e.d > 18) {
        e.shootCD--;
        if (e.shootCD <= 0) {
          const ep = proj(e.wx, e.d);
          if (ep) {
            const psx = VX() + px * HW();
            const ang = Math.atan2(PY() - ep.y, psx - ep.x);
            eBullets.push({ x:ep.x, y:ep.y, vx:Math.cos(ang)*5, vy:Math.sin(ang)*5 });
            sfx.tieLaser();
            e.shootCD = 75 + Math.floor(Math.random() * 55);
          }
        }
      }
    });

    // Proximidad de peligro (aviso visual y sonoro si hay obstáculos/enemigos muy cerca)
    let closeAlert = false;
    [...obstacles, ...enemies].forEach(o => {
      if (o.d > 0 && o.d < 50 && Math.abs(px - o.wx) < (o.w || 0.20) + 0.20) {
        closeAlert = true;
      }
    });
    proximityWarning = closeAlert;
    if (proximityWarning) {
      warningSoundT--;
      if (warningSoundT <= 0) {
        sfx.warning();
        warningSoundT = 15; // pitido recurrente rápido
      }
    } else {
      warningSoundT = 0;
    }

    // Avanzar balas del jugador
    pBullets.forEach(b => b.d += 22);

    // Avanzar balas enemigas
    eBullets.forEach(b => { b.x += b.vx; b.y += b.vy; });

    // Impacto de balas de jugador en enemigos
    pBullets = pBullets.filter(b => {
      if (b.d > MAX_D + 20) return false;
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.d < 0 || e.d > MAX_D) continue;
        // Ajustamos la tolerancia vertical-horizontal para que el tiro sea más preciso y satisfactorio
        const wxThresh = e.kind === 'tie' ? 0.35 : 0.25;
        if (Math.abs(b.d - e.d) < 32 && Math.abs(b.wx - e.wx) < wxThresh) {
          e.hp--;
          e.flash = 6; // Destello de daño
          if (e.hp <= 0) {
            addScore(e.kind === 'turret' ? 200 : 100);
            flashMsg = e.kind === 'turret' ? '+200' : '+100';
            flashTimer = 50;
            const ep = proj(e.wx, Math.max(e.d, 1));
            if (ep) explode(ep.x, ep.y, 16, AMBER);
            sfx.explode(e.kind === 'turret');
            enemies.splice(i, 1);
          } else {
            // Pitido de escudo enemigo dañado
            playTone(400, 'sine', 0.05, 0.08);
          }
          return false;
        }
      }
      return true;
    });

    // Impacto del puerto térmico
    const portDist = WIN_DIST - distTraveled;
    if (!portHit && portDist > 0 && portDist < MAX_D) {
      pBullets.forEach(b => {
        if (!portHit && Math.abs(b.wx) < 0.24 && b.d < portDist + 28 && b.d > portDist - 28) {
          portHit = true; won = true;
          addScore(1000);
          lives += 2; // +2 vidas por completar el nivel/tanda
          flashMsg = '¡IMPACTO DIRECTO!'; flashTimer = 110;
          const pp = proj(0, portDist);
          if (pp) explode(pp.x, pp.y, 45, '#ff6400');
          sfx.explode(true);
          sfx.win();
        }
      });
    }
    if (portDist < -60 && !portHit && !won) {
      gameOver = true;
      sfx.gameOver();
    }

    // Balas enemigas golpean jugador
    const psx = VX() + px * HW();
    eBullets = eBullets.filter(b => {
      if (Math.hypot(b.x - psx, b.y - (PY()-8)) < 24) { takeHit(); return false; }
      return b.x > -30 && b.x < canvas.width+30 && b.y < canvas.height+10 && b.y > -10;
    });

    // Colisión de nave de jugador con obstáculos o enemigos
    [...obstacles, ...enemies].forEach(o => {
      if (invTimer > 0) return;
      if (o.d > 22 || o.d < -15) return;
      if (Math.abs(px - o.wx) < (o.w || 0.20) + 0.13) takeHit();
    });

    if (invTimer > 0) invTimer--;
    if (damageFlashT > 0) damageFlashT--;

    obstacles = obstacles.filter(o => o.d > -30);
    enemies   = enemies.filter(e => e.d > -20);
    pBullets  = pBullets.filter(b => b.d < MAX_D + 30);
    particles.forEach(p => { p.x+=p.vx; p.y+=p.vy; p.vx*=0.96; p.vy*=0.96; p.life--; });
    particles = particles.filter(p => p.life > 0);
    if (flashTimer > 0) flashTimer--;
  }

  function drawTrench() {
    // Superficie superior de la Estrella de la Muerte
    ctx.fillStyle = 'rgba(20,22,28,0.98)';
    ctx.fillRect(0, 0, canvas.width, VY() + 2);
    ctx.strokeStyle = 'rgba(70,80,100,0.18)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 36) {
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x, VY()); ctx.stroke();
    }
    for (let y = 0; y < VY(); y += 36) {
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
    }
    // Estrellas
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i < 35; i++) ctx.fillRect((i*137+19)%canvas.width, (i*79+13)%(VY()-2), 1.5, 1.5);

    // Líneas de profundidad de la trinchera
    const N = 18;
    for (let i = 1; i <= N; i++) {
      const tt = (N - i + 1) / N;
      const lx  = VX() - HW() * tt;
      const rx  = VX() + HW() * tt;
      const fy  = VY() + (PY() - VY()) * tt;
      const wty = fy - WH() * tt;
      const a   = tt * 0.58 + 0.05;
      ctx.strokeStyle = `rgba(57,255,20,${a.toFixed(2)})`;
      ctx.lineWidth = tt > 0.88 ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(lx, fy);  ctx.lineTo(rx, fy);  ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx, wty); ctx.lineTo(lx, fy);  ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx, wty); ctx.lineTo(rx, fy);  ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx, wty); ctx.lineTo(rx, wty); ctx.stroke();
    }
    // Líneas de convergencia principales
    ctx.strokeStyle = 'rgba(57,255,20,0.88)'; ctx.lineWidth = 2.5;
    const edges = [
      [VX(), VY(), VX()-HW(), PY()],
      [VX(), VY(), VX()+HW(), PY()],
      [VX(), VY(), VX()-HW(), PY()-WH()],
      [VX(), VY(), VX()+HW(), PY()-WH()]
    ];
    edges.forEach(([x1,y1,x2,y2]) => {
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    });
  }

  // X-Wing detallado con alas de combate en ataque, motores pulsantes y neon
  function drawXWing(cx, cy) {
    ctx.save(); ctx.translate(cx, cy);

    // Propulsores encendidos (motores traseros con animación pulsante azul/naranja)
    const enginePulse = 8 + 4 * Math.sin(Date.now() / 60);
    ctx.shadowBlur = enginePulse * 1.5;

    // Fuego de los 4 propulsores
    [[-12,-2], [-8,2], [8,2], [12,-2]].forEach(([ex,ey]) => {
      ctx.fillStyle = NEON_BLUE;
      ctx.beginPath(); ctx.arc(ex, ey, enginePulse * 0.32, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(ex, ey, enginePulse * 0.16, 0, Math.PI*2); ctx.fill();
    });
    ctx.shadowBlur = 0;

    // Cuerpo Central del X-Wing
    ctx.strokeStyle = GRN; ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(25,60,30,0.85)';
    ctx.beginPath();
    ctx.moveTo(0,-24);
    ctx.lineTo(-4,6);
    ctx.lineTo(0,3);
    ctx.lineTo(4,6);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // Alas de combate (Geometría X abierta de ataque)
    ctx.lineWidth = 1.6;
    const wings = [
      [-4,-4, -28,-14, -26, 4, -4, 1],  // Superior izquierda
      [ 4,-4,  28,-14,  26, 4,  4, 1],  // Superior derecha
      [-4, 1, -26,  4, -24,16, -4, 9],  // Inferior izquierda
      [ 4, 1,  26,  4,  24,16,  4, 9]   // Inferior derecha
    ];
    wings.forEach(p => {
      ctx.beginPath();
      ctx.moveTo(p[0],p[1]); ctx.lineTo(p[2],p[3]);
      ctx.lineTo(p[4],p[5]); ctx.lineTo(p[6],p[7]);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });

    // Cañones láser en las 4 puntas de las alas
    ctx.fillStyle = RED;
    [[-28,-14], [-26,4], [28,-14], [26,4]].forEach(([cxn,cyn]) => {
      ctx.fillRect(cxn-1, cyn-8, 2, 8);
      ctx.beginPath(); ctx.arc(cxn, cyn-8, 2.2, 0, Math.PI*2); ctx.fill();
    });

    ctx.restore();
  }

  // TIE Fighter detallado con cabina frontal esférica y alas hexagonales estructuradas
  function drawTIE(cx, cy, s) {
    const r = Math.max(s, 0.05);
    ctx.save(); ctx.translate(cx, cy);

    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1.5 + r * 1.5;

    // Alas laterales hexagonales negras / metálicas
    ctx.fillStyle = 'rgba(15,16,22,0.92)';
    [[-1], [1]].forEach(([dir]) => {
      const wx = dir * 26 * r;
      ctx.beginPath();
      ctx.moveTo(wx, -12*r);
      ctx.lineTo(wx + dir*4*r, -7*r);
      ctx.lineTo(wx + dir*4*r,  7*r);
      ctx.lineTo(wx,  12*r);
      ctx.lineTo(wx - dir*4*r,  7*r);
      ctx.lineTo(wx - dir*4*r, -7*r);
      ctx.closePath(); ctx.fill(); ctx.stroke();

      // Radios de refuerzo de las alas TIE
      ctx.beginPath();
      ctx.moveTo(wx, -12*r); ctx.lineTo(wx, 12*r);
      ctx.moveTo(wx - dir*4*r, -7*r); ctx.lineTo(wx + dir*4*r, 7*r);
      ctx.moveTo(wx + dir*4*r, -7*r); ctx.lineTo(wx - dir*4*r, 7*r);
      ctx.stroke();
    });

    // Brazos de soporte de la cabina
    ctx.beginPath();
    ctx.moveTo(-11*r, 0); ctx.lineTo(-24*r, 0);
    ctx.moveTo( 11*r, 0); ctx.lineTo( 24*r, 0);
    ctx.stroke();

    // Cabina esférica central
    ctx.fillStyle = 'rgba(25,27,35,0.92)';
    ctx.beginPath(); ctx.arc(0, 0, 11*r, 0, Math.PI*2); ctx.fill(); ctx.stroke();

    // Vidrio segmentado de la cabina del TIE
    ctx.strokeStyle = 'rgba(255,211,42,0.6)';
    ctx.beginPath(); ctx.arc(0, 0, 5*r, 0, Math.PI*2); ctx.stroke();
    for (let a = 0; a < Math.PI*2; a += Math.PI/4) {
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(a)*10*r, Math.sin(a)*10*r); ctx.stroke();
    }

    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width,canvas.height);

    if (gameOver || won) {
      particles.forEach(p => {
        const a = Math.min(1, p.life/30);
        const c = p.col === GRN ? `rgba(57,255,20,${a})` :
                  p.col === AMBER ? `rgba(255,211,42,${a})` : `rgba(255,100,0,${a})`;
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(p.x,p.y,2.5,0,Math.PI*2); ctx.fill();
      });
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.min(52,canvas.width/13)}px Outfit`;
      ctx.fillStyle = won ? GRN : RED;
      ctx.fillText(won ? '¡VICTORIA!' : 'GAME OVER', canvas.width/2, canvas.height/2 - 36);
      if (won) {
        ctx.font = '15px Outfit'; ctx.fillStyle = AMBER;
        ctx.fillText('¡Destruiste la Estrella de la Muerte!', canvas.width/2, canvas.height/2 + 2);
      } else {
        ctx.font = '15px Outfit'; ctx.fillStyle = AMBER;
        ctx.fillText('No alcanzaste el puerto de escape', canvas.width/2, canvas.height/2 + 2);
      }
      ctx.font = '19px Outfit'; ctx.fillStyle = '#fff';
      ctx.fillText(`Puntuación: ${score}`, canvas.width/2, canvas.height/2 + 34);
      ctx.font = '12px Outfit'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('Presiona ENTER para reiniciar', canvas.width/2, canvas.height/2 + 60);
      return;
    }

    drawTrench();

    // Renderizar objetos lejanos a cercanos (3D real)
    const allObj = [
      ...obstacles.map(o => ({...o, _t:'obs'})),
      ...enemies.map(e => ({...e, _t:'ene'})),
      ...pBullets.map(b => ({...b, _t:'pb'}))
    ].sort((a,b) => b.d - a.d);

    allObj.forEach(o => {
      if (o.d < -20 || o.d > MAX_D + 10) return;
      const dd = Math.max(o.d, 1);
      const p = proj(o.wx, dd);
      if (!p || p.s < 0.015) return;

      if (o._t === 'obs') {
        const tw = o.w * HW() * p.s * 2;
        const th = (PY() - VY()) * p.s * 0.55;
        // Torre metálica detailed
        ctx.fillStyle   = `rgba(45,48,58,${p.s*0.95})`;
        ctx.strokeStyle = `rgba(130,140,165,${p.s})`;
        ctx.lineWidth = 1 + p.s * 1.5;
        ctx.fillRect(p.x-tw/2, p.y-th, tw, th);
        ctx.strokeRect(p.x-tw/2, p.y-th, tw, th);

        // Paneles metálicos técnicos en la torre
        ctx.fillStyle   = `rgba(20,22,28,${p.s*0.7})`;
        ctx.fillRect(p.x-tw*0.35, p.y-th*0.8, tw*0.7, th*0.25);
        ctx.strokeRect(p.x-tw*0.35, p.y-th*0.8, tw*0.7, th*0.25);

        // Cabezal sensor/cañón de la torre
        ctx.fillStyle   = `rgba(190,100,20,${p.s*0.85})`;
        ctx.strokeStyle = `rgba(240,130,30,${p.s})`;
        ctx.fillRect(p.x-tw*0.62, p.y-th-6*p.s, tw*1.24, 6*p.s);
        ctx.strokeRect(p.x-tw*0.62, p.y-th-6*p.s, tw*1.24, 6*p.s);

      } else if (o._t === 'ene') {
        const hit = o.flash > 0;
        if (o.kind === 'tie') {
          // Destello blanco al recibir disparo
          if (hit) {
            ctx.save(); ctx.shadowBlur = 15; ctx.shadowColor = '#fff';
          }
          drawTIE(p.x, p.y, p.s);
          if (hit) ctx.restore();
        } else {
          // Torretas del suelo
          ctx.strokeStyle = hit ? '#ffffff' : AMBER;
          ctx.fillStyle = hit ? 'rgba(255,255,255,0.4)' : 'rgba(255,211,42,0.18)';
          ctx.lineWidth = 1.5 + p.s * 1.5;
          ctx.beginPath(); ctx.arc(p.x,p.y,16*p.s,0,Math.PI*2); ctx.fill(); ctx.stroke();
          const psx = VX() + px * HW();
          const ang = Math.atan2(PY()-p.y, psx-p.x);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(p.x,p.y);
          ctx.lineTo(p.x+Math.cos(ang)*22*p.s, p.y+Math.sin(ang)*22*p.s); ctx.stroke();
        }

      } else { // Balas de jugador (con estela hacia la pantalla)
        const ft = proj(o.wx, Math.max(dd - 28, 1));
        ctx.strokeStyle = GRN; ctx.lineWidth = 2.5 + p.s * 2;
        ctx.shadowColor = GRN; ctx.shadowBlur = 10 * p.s;
        ctx.beginPath();
        if (ft) ctx.moveTo(ft.x,ft.y); else ctx.moveTo(VX(),PY());
        ctx.lineTo(p.x,p.y);
        ctx.stroke(); ctx.shadowBlur = 0;
      }
    });

    // Puerto térmico de escape
    const portDist = WIN_DIST - distTraveled;
    if (portDist > 0 && portDist < MAX_D * 0.82) {
      const pp = proj(0, portDist);
      if (pp && pp.s > 0.04) {
        const pr = 18 * pp.s;
        const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 110);
        ctx.strokeStyle = `rgba(255,100,0,${pulse})`;
        ctx.lineWidth = 2;
        ctx.shadowColor = '#ff6400'; ctx.shadowBlur = 14 * pulse;
        ctx.beginPath(); ctx.arc(pp.x,pp.y,pr,0,Math.PI*2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(pp.x-pr*1.7,pp.y); ctx.lineTo(pp.x+pr*1.7,pp.y);
        ctx.moveTo(pp.x,pp.y-pr*1.7); ctx.lineTo(pp.x,pp.y+pr*1.7);
        ctx.stroke(); ctx.shadowBlur = 0;
        if (pp.s > 0.18) {
          ctx.textAlign = 'center';
          ctx.font = `${Math.floor(10*pp.s+7)}px Outfit`;
          ctx.fillStyle = '#ff8c00';
          ctx.fillText('PUERTO DE ESCAPE', pp.x, pp.y - pr - 5);
        }
      }
    }

    // Proyectiles enemigos
    ctx.fillStyle = RED; ctx.shadowColor = RED; ctx.shadowBlur = 6;
    eBullets.forEach(b => { ctx.beginPath(); ctx.arc(b.x,b.y,4.5,0,Math.PI*2); ctx.fill(); });
    ctx.shadowBlur = 0;

    // Partículas
    particles.forEach(p => {
      const a = Math.min(1, p.life/30);
      const c = p.col === GRN ? `rgba(57,255,20,${a})` :
                p.col === AMBER ? `rgba(255,211,42,${a})` : `rgba(255,100,0,${a})`;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(p.x,p.y,2,0,Math.PI*2); ctx.fill();
    });

    // Nave X-Wing del Jugador (parpadea si es invulnerable)
    if (invTimer <= 0 || Math.floor(invTimer/7) % 2 === 0) {
      drawXWing(VX() + px * HW(), PY() - 8);
    }

    // Flash rojo de daño en los bordes de la pantalla
    if (damageFlashT > 0) {
      ctx.fillStyle = `rgba(255, 0, 0, ${damageFlashT * 0.02})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Barra de progreso inferior
    const prog = Math.min(distTraveled / WIN_DIST, 1);
    const bx = 20, bw = canvas.width-40, bh = 5, by = canvas.height - (BOTTOM_UI_INSET - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = GRN;
    ctx.fillRect(bx, by, bw*prog, bh);
    ctx.fillStyle = '#ff6400';
    ctx.fillRect(bx+bw-7, by-3, 5, bh+6);
    ctx.textAlign = 'right'; ctx.font = '9px Outfit'; ctx.fillStyle = '#ff8c00';
    ctx.fillText('PUERTO', bx+bw, by-5);

    // Alerta visual de colisión inminente (obstáculos demasiado cerca)
    if (proximityWarning) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px Outfit';
      ctx.fillStyle = (Math.floor(Date.now() / 120) % 2 === 0) ? '#ff4757' : 'rgba(255, 71, 87, 0.2)';
      ctx.fillText('COLLISION WARNING', canvas.width/2, VY() + 45);
    }

    // Mensaje flash en el centro
    if (flashTimer > 0) {
      ctx.textAlign = 'center'; ctx.font = 'bold 20px Outfit';
      ctx.fillStyle = `rgba(255,200,0,${flashTimer/55})`;
      ctx.fillText(flashMsg, canvas.width/2, canvas.height*0.50);
    }

    // HUD inferior
    ctx.fillStyle = '#fff'; ctx.font = '14px Outfit';
    ctx.textAlign = 'left';   ctx.fillText(`SCORE  ${String(score).padStart(6,'0')}`, 20, hudBaselineY()+6);
    ctx.textAlign = 'center'; ctx.fillStyle = AMBER;
    ctx.fillText('TRENCH RUN', canvas.width/2, hudBaselineY()+6);
    ctx.textAlign = 'right';  ctx.fillStyle = '#ff6b6b';
    ctx.fillText(`♥ ${Math.max(0,lives)}`, canvas.width-20, hudBaselineY()+6);

    // Botón Mute
    const mx=canvas.width-58,my=8,mw=50,mh=22;
    ctx.fillStyle=soundEnabled?'rgba(255,211,42,.15)':'rgba(255,80,80,.2)';
    ctx.strokeStyle=soundEnabled?'#ffd32a':'#ff5555'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.roundRect(mx,my,mw,mh,5); ctx.fill(); ctx.stroke();
    ctx.fillStyle=soundEnabled?'#ffd32a':'#ff5555';
    ctx.font='13px Outfit'; ctx.textAlign='center';
    ctx.fillText(soundEnabled?'🔊 ON':'🔇 OFF',mx+mw/2,my+15);
  }

  function onKeyDown(code) {
    if (code === 'Enter' && (gameOver || won)) init();
    if (code === 'KeyM') soundEnabled = !soundEnabled;
  }

  function onClick(ex, ey) {
    const mx = canvas.width - 58, my = 8, mw = 50, mh = 22;
    if (ex >= mx && ex <= mx+mw && ey >= my && ey <= my+mh) {
      soundEnabled = !soundEnabled;
      try { getACtx().resume(); } catch(e) {}
    }
  }

  init();
  return { update, draw, onKeyDown, onClick };
}

// ===== PACMAN (LABERINTO ALEATORIO) =====
function createPacmanGame() {
  const COLS = 19;
  const ROWS = 21;
  
  let grid = [];
  let px = 9, py = 15;
  let dirX = 0, dirY = 0;
  let nextDirX = 0, nextDirY = 0;
  let lastAngle = 0;
  
  let ghosts = [];
  let score = 0;
  let lives = 5;
  let gameOver = false;
  let won = false;
  let totalDots = 0;
  let frightenedTimer = 0;
  let chompTimer = 0;
  let flashMsg = '';
  let flashTimer = 0;
  let dyingTimer = 0;
  let lastScoreLifeThreshold = 0;

  function addScore(pts) {
    score += pts;
    const currentThreshold = Math.floor(score / 200);
    if (currentThreshold > lastScoreLifeThreshold) {
      const extra = currentThreshold - lastScoreLifeThreshold;
      lives += extra;
      lastScoreLifeThreshold = currentThreshold;
      playTone(880, 'sine', 0.15, 0.25); // SFX de vida extra
    }
  }

  // ── MOTOR DE SONIDO (Web Audio API) ──
  let audioCtx = null;
  let soundEnabled = true;

  function getACtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, type, duration, volume = 0.25, startFreq = null, endFreq = null) {
    if (!soundEnabled) return;
    try {
      const ctx = getACtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = type;
      if (startFreq !== null) {
        osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(endFreq || freq, ctx.currentTime + duration);
      } else {
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
      }
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch(e) {}
  }

  // chompAlternador para el sonido waka-waka
  let chompPhase = 0;
  function playChomp() {
    const freqs = [280, 220];
    playTone(freqs[chompPhase % 2], 'square', 0.06, 0.15);
    chompPhase++;
  }
  function playPowerPellet() {
    playTone(300, 'sawtooth', 0.08, 0.2, 300, 600);
    setTimeout(() => playTone(500, 'sawtooth', 0.15, 0.2, 500, 900), 80);
  }
  function playEatGhost() {
    playTone(800, 'square', 0.05, 0.3, 800, 400);
    setTimeout(() => playTone(600, 'square', 0.07, 0.3, 600, 1200), 60);
  }
  function playDeath() {
    if (!soundEnabled) return;
    [0,70,140,210,280,350].forEach((t, i) => {
      setTimeout(() => playTone(440 - i*55, 'sawtooth', 0.09, 0.2), t);
    });
  }
  function playWin() {
    if (!soundEnabled) return;
    const notes = [523,659,784,1047];
    notes.forEach((f, i) => setTimeout(() => playTone(f, 'triangle', 0.18, 0.3), i * 130));
  }

  function playGameOver() {
    if (!soundEnabled) return;
    // Sirena descendente dramática
    const seqs = [
      {f:880, t:0},   {f:740, t:120}, {f:622, t:240},
      {f:523, t:360}, {f:440, t:480}, {f:370, t:600},
      {f:294, t:720}, {f:220, t:880}
    ];
    seqs.forEach(({f,t}) => setTimeout(() => playTone(f, 'sawtooth', 0.14, 0.28), t));
  }

  function playStart() {
    if (!soundEnabled) return;
    // Fanfarria tipo arcade clásico
    const seq = [
      {f:523,d:0.1,t:0}, {f:659,d:0.1,t:110}, {f:784,d:0.1,t:220},
      {f:1047,d:0.2,t:330}, {f:784,d:0.08,t:580}, {f:1047,d:0.35,t:690}
    ];
    seq.forEach(({f,d,t}) => setTimeout(() => playTone(f, 'square', d, 0.22), t));
  }

  function findShortestPathDir(startX, startY, targetX, targetY, currentDirX, currentDirY, isDeadGhost) {
    const dirs = [[0,-1], [0,1], [-1,0], [1,0]];
    const possibleNextSteps = [];
    
    dirs.forEach(([dx, dy]) => {
      // Evitar dar marcha atrás si ya se está en movimiento
      if (currentDirX !== 0 || currentDirY !== 0) {
        if (dx === -currentDirX && dy === -currentDirY) return;
      }
      
      let nextX = startX + dx;
      if (nextX < 0) nextX = COLS - 1;
      if (nextX >= COLS) nextX = 0;
      const nextY = startY + dy;
      
      if (nextY >= 0 && nextY < ROWS) {
        const cell = grid[nextY][nextX];
        if (cell === 1) return;
        // Impedir que fantasmas vivos entren por arriba de la jaula central (celda 4)
        if (cell === 4 && !isDeadGhost && startY < nextY) return;
        
        possibleNextSteps.push({ dx, dy, x: nextX, y: nextY });
      }
    });
    
    if (possibleNextSteps.length === 0) {
      // Permitir retroceder si no hay otra opción de movimiento válida
      let revX = startX - currentDirX;
      if (revX < 0) revX = COLS - 1;
      if (revX >= COLS) revX = 0;
      const revY = startY - currentDirY;
      if (revY >= 0 && revY < ROWS && grid[revY][revX] !== 1) {
        return [-currentDirX, -currentDirY];
      }
      return [0, 0];
    }
    
    let bestDir = [possibleNextSteps[0].dx, possibleNextSteps[0].dy];
    let minPathLength = Infinity;
    
    possibleNextSteps.forEach(step => {
      const q = [[step.x, step.y, 1]];
      const vis = new Set([`${step.x},${step.y}`]);
      let foundDist = Infinity;
      
      while (q.length > 0) {
        const [cx, cy, d] = q.shift();
        
        if (cx === targetX && cy === targetY) {
          foundDist = d;
          break;
        }
        
        for (const [dx, dy] of dirs) {
          let nx = cx + dx;
          if (nx < 0) nx = COLS - 1;
          if (nx >= COLS) nx = 0;
          const ny = cy + dy;
          
          if (ny >= 0 && ny < ROWS && grid[ny][nx] !== 1) {
            if (grid[ny][nx] === 4 && !isDeadGhost && cy < ny) continue;
            
            const key = `${nx},${ny}`;
            if (!vis.has(key)) {
              vis.add(key);
              q.push([nx, ny, d + 1]);
            }
          }
        }
      }
      
      if (foundDist < minPathLength) {
        minPathLength = foundDist;
        bestDir = [step.dx, step.dy];
      }
    });
    
    return bestDir;
  }

  function generateRandomMaze() {
    const tempGrid = [];
    for (let r = 0; r < ROWS; r++) {
      tempGrid[r] = [];
      for (let c = 0; c < COLS; c++) {
        tempGrid[r][c] = 1; // Todo pared al inicio
      }
    }

    // DFS para tallar pasillos en la mitad izquierda (columnas 0 a 9)
    function carve(r, c) {
      tempGrid[r][c] = 0;
      const dirs = [
        [-2, 0], // Arriba
        [2, 0],  // Abajo
        [0, -2], // Izquierda
        [0, 2]   // Derecha
      ];
      // Mezclar direcciones
      dirs.sort(() => Math.random() - 0.5);

      for (let [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 1 && nr < ROWS - 1 && nc >= 1 && nc <= 9) {
          if (tempGrid[nr][nc] === 1) {
            // Evitar tocar la casa de fantasmas (filas 8-12, columnas 6-11)
            if (!(nr >= 7 && nr <= 12 && nc >= 6 && nc <= 11)) {
              tempGrid[r + dr/2][c + dc/2] = 0;
              tempGrid[nr][nc] = 0;
              carve(nr, nc);
            }
          }
        }
      }
    }

    carve(1, 1);

    // Añadir caminos en bucle aleatorios (eliminar paredes intermedias)
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < 9; c++) {
        if (tempGrid[r][c] === 1) {
          if (r >= 7 && r <= 12 && c >= 6 && c <= 11) continue;
          const horiz = (tempGrid[r][c-1] !== 1 && tempGrid[r][c+1] !== 1);
          const vert = (tempGrid[r-1][c] !== 1 && tempGrid[r+1][c] !== 1);
          if ((horiz || vert) && Math.random() < 0.3) {
            tempGrid[r][c] = 0;
          }
        }
      }
    }

    // Configurar Casa de Fantasmas fija y simétrica en el centro
    tempGrid[8][7]=1; tempGrid[8][8]=1; tempGrid[8][9]=3; tempGrid[8][10]=1; tempGrid[8][11]=1;
    tempGrid[9][7]=1; tempGrid[9][8]=1; tempGrid[9][9]=4; tempGrid[9][10]=1; tempGrid[9][11]=1;
    tempGrid[10][7]=1; tempGrid[10][8]=3; tempGrid[10][9]=3; tempGrid[10][10]=3; tempGrid[10][11]=1;
    tempGrid[11][7]=1; tempGrid[11][8]=1; tempGrid[11][9]=1; tempGrid[11][10]=1; tempGrid[11][11]=1;
    tempGrid[8][8]=1; tempGrid[8][10]=1; // Cerrar laterales arriba

    // Forzar camino de salida arriba de la casa de fantasmas para conectar con el resto del mapa
    tempGrid[7][6]=3; tempGrid[7][7]=3; tempGrid[7][8]=3; tempGrid[7][9]=3;

    // Forzar túnel lateral de escape en la fila 10
    tempGrid[10][0] = 3; tempGrid[10][1] = 3;

    // Espejar a la mitad derecha para simetría horizontal perfecta
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < 10; c++) {
        tempGrid[r][COLS - 1 - c] = tempGrid[r][c];
      }
    }

    // Ubicar pastillas de poder en las esquinas si hay camino tallado
    const corners = [[1, 1], [1, COLS-2], [ROWS-2, 1], [ROWS-2, COLS-2]];
    corners.forEach(([cr, cc]) => {
      tempGrid[cr][cc] = 2;
    });

    // Limpiar zona de spawn de Pacman
    tempGrid[15][9] = 3;
    tempGrid[15][8] = 3;
    tempGrid[15][10] = 3;

    return tempGrid;
  }

  function init() {
    grid = generateRandomMaze();
    score = 0;
    lives = 5;
    lastScoreLifeThreshold = 0;
    gameOver = false;
    won = false;
    frightenedTimer = 0;
    dyingTimer = 0;
    chompTimer = 0;
    flashMsg = ''; flashTimer = 0;
    
    // Contar total de bolitas
    totalDots = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === 0 || grid[r][c] === 2) {
          totalDots++;
        }
      }
    }

    ghosts = [
      { name: 'blinky', color: '#ff3333', x: 9, y: 10, dirX: 0, dirY: -1, state: 'normal', ntX: 9, ntY: 9 },
      { name: 'pinky',  color: '#ff88cc', x: 8, y: 10, dirX: 0, dirY: -1, state: 'normal', ntX: 8, ntY: 9 },
      { name: 'inky',   color: '#33ffff', x: 10, y: 10, dirX: 0, dirY: -1, state: 'normal', ntX: 10, ntY: 9 }
    ];

    resetPositions();
    setTimeout(() => playStart(), 200);
  }

  function resetPositions() {
    px = 9; py = 15;
    dirX = 0; dirY = 0;
    nextDirX = 0; nextDirY = 0;
    lastAngle = 0;

    ghosts.forEach((g, i) => {
      g.x = 8 + i;
      g.y = 10;
      g.dirX = 0;
      g.dirY = -1;
      g.ntX = 8 + i; // next tile x
      g.ntY = 9;     // next tile y (hacia arriba, hacia la gate)
      g.state = 'normal';
    });
  }

  function update() {
    if (gameOver || won) return;

    // Animación de muerte
    if (dyingTimer > 0) {
      dyingTimer--;
      if (dyingTimer === 0) {
        if (lives <= 0) {
          gameOver = true;
          playGameOver();
        } else {
          resetPositions();
        }
      }
      return;
    }

    // Procesar teclado para dirección deseada
    let dx = 0, dy = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) { dx = -1; dy = 0; }
    else if (keys['ArrowRight'] || keys['KeyD']) { dx = 1; dy = 0; }
    else if (keys['ArrowUp'] || keys['KeyW']) { dx = 0; dy = -1; }
    else if (keys['ArrowDown'] || keys['KeyS']) { dx = 0; dy = 1; }

    const speed = 0.12;

    if (dx === 0 && dy === 0) {
      // Detener Pacman y alinearlo a la cuadrícula
      dirX = 0;
      dirY = 0;
      px = Math.round(px);
      py = Math.round(py);
    } else {
      // Mover Pacman con colisiones simplificadas y responsivas
      if (dx !== 0) {
        py = Math.round(py); // Alinear verticalmente al carril
        let nextCellX = Math.round(px + dx);
        if (nextCellX < 0) nextCellX = COLS - 1;
        if (nextCellX >= COLS) nextCellX = 0;
        
        const cell = grid[py][nextCellX];
        if (cell !== 1 && cell !== 4) {
          px += dx * speed;
          // Wrap-around al salir por un extremo del túnal
          if (px < -0.5) px = COLS - 0.5;
          if (px > COLS - 0.5) px = -0.5;
          dirX = dx; dirY = 0;
        } else {
          const centerDist = px - Math.round(px);
          if (Math.sign(centerDist) === -dx) {
            px += dx * speed;
          } else {
            px = Math.round(px);
            dirX = 0; dirY = 0;
          }
        }
      } else if (dy !== 0) {
        px = Math.round(px); // Alinear horizontalmente al carril
        let nextCellY = Math.round(py + dy);
        if (nextCellY < 0) nextCellY = ROWS - 1;
        if (nextCellY >= ROWS) nextCellY = 0;
        
        const cell = grid[nextCellY][px];
        if (cell !== 1 && cell !== 4) {
          py += dy * speed;
          dirX = 0; dirY = dy;
        } else {
          const centerDist = py - Math.round(py);
          if (Math.sign(centerDist) === -dy) {
            py += dy * speed;
          } else {
            py = Math.round(py);
            dirX = 0; dirY = 0;
          }
        }
      }
    }

    // chompTimer avanza siempre para que la animación sea independiente del movimiento
    chompTimer++;
    if (dirX !== 0 || dirY !== 0) {
      if (dirX === 1) lastAngle = 0;
      else if (dirX === -1) lastAngle = Math.PI;
      else if (dirY === 1) lastAngle = Math.PI / 2;
      else if (dirY === -1) lastAngle = -Math.PI / 2;
    }

    // Comer bolitas/energizers
    const curX = Math.min(COLS-1, Math.max(0, Math.round(px)));
    const curY = Math.min(ROWS-1, Math.max(0, Math.round(py)));

    if (grid[curY][curX] === 0) {
      grid[curY][curX] = 3;
      addScore(10);
      totalDots--;
      playChomp();
    } else if (grid[curY][curX] === 2) {
      grid[curY][curX] = 3;
      addScore(50);
      totalDots--;
      playPowerPellet();
      frightenedTimer = 360; // 6 segundos a 60fps
      ghosts.forEach(g => {
        if (g.state === 'normal') {
          g.state = 'frightened';
          g.dirX *= -1;
          g.dirY *= -1;
        }
      });
    }

    if (totalDots <= 0) { 
      won = true; 
      lives += 2; // +2 vidas por completar el nivel/tanda
      playTone(1047, 'sine', 0.25, 0.25);
      playWin(); 
    }

    // Decrementar temporizador de asustados
    if (frightenedTimer > 0) {
      frightenedTimer--;
      if (frightenedTimer === 0) {
        ghosts.forEach(g => {
          if (g.state === 'frightened') g.state = 'normal';
        });
      }
    }

    // Actualizar Fantasmas
    const speedGhostNormal = 0.10;
    const speedGhostFright  = 0.06;
    const speedGhostDead    = 0.22;

    // Elige la siguiente casilla válida para un fantasma vivo usando BFS
    function chooseNextTile(g) {
      const gx = Math.round(g.x), gy = Math.round(g.y);
      const dirs = [[0,-1],[0,1],[-1,0],[1,0]];

      // Determinar target
      let tx = Math.round(px), ty = Math.round(py);
      if (gy >= 9 && gy <= 11 && gx >= 7 && gx <= 11) { tx = 9; ty = 7; } // salir de casa
      else if (g.name === 'pinky') { tx = Math.round(px + dirX*3); ty = Math.round(py + dirY*3); }
      else if (g.name === 'inky') {
        if (Math.hypot(gx-Math.round(px), gy-Math.round(py)) <= 6) { tx=1; ty=1; }
      }
      if (g.state === 'frightened') { tx = Math.round(Math.random()*COLS); ty = Math.round(Math.random()*ROWS); }

      // Recopilar casillas válidas (sin reversa, sin paredes)
      const candidates = [];
      for (const [dx, dy] of dirs) {
        if (dx === -g.dirX && dy === -g.dirY) continue; // sin reversa
        let nx = gx + dx;
        if (nx < 0) nx = COLS - 1;
        if (nx >= COLS) nx = 0;
        const ny = gy + dy;
        if (ny < 0 || ny >= ROWS) continue;
        const cell = grid[ny][nx];
        if (cell === 1) continue; // pared
        if (cell === 4 && g.state !== 'dead' && gy < ny) continue; // gate solo para muertos
        candidates.push([dx, dy, nx, ny]);
      }

      if (candidates.length === 0) {
        // Callejon sin salida: invertir dirección
        let rx = gx - g.dirX, ry = gy - g.dirY;
        if (rx < 0) rx = COLS-1; if (rx >= COLS) rx = 0;
        if (ry >= 0 && ry < ROWS && grid[ry][rx] !== 1) {
          g.dirX = -g.dirX; g.dirY = -g.dirY;
          g.ntX = rx; g.ntY = ry;
        } else {
          // Buscar cualquier dirección libre sin restricción
          for (const [dx, dy] of dirs) {
            let nx = gx+dx; if (nx<0) nx=COLS-1; if (nx>=COLS) nx=0;
            const ny = gy+dy;
            if (ny>=0&&ny<ROWS&&grid[ny][nx]!==1) { g.dirX=dx; g.dirY=dy; g.ntX=nx; g.ntY=ny; return; }
          }
        }
        return;
      }

      if (candidates.length === 1) {
        g.dirX = candidates[0][0]; g.dirY = candidates[0][1];
        g.ntX  = candidates[0][2]; g.ntY  = candidates[0][3];
        return;
      }

      // BFS: elegir el candidato con camino más corto al target
      let bestDist = Infinity, bestIdx = 0;
      for (let i = 0; i < candidates.length; i++) {
        const [,, sx, sy] = candidates[i];
        const q = [[sx, sy, 1]], vis = new Set([`${sx},${sy}`]);
        let found = Infinity;
        outer: while (q.length) {
          const [cx, cy, d] = q.shift();
          if (cx===tx && cy===ty) { found=d; break; }
          for (const [dx2, dy2] of dirs) {
            let nx2=cx+dx2; if(nx2<0)nx2=COLS-1; if(nx2>=COLS)nx2=0;
            const ny2=cy+dy2;
            if(ny2<0||ny2>=ROWS) continue;
            const c2=grid[ny2][nx2];
            if(c2===1) continue;
            if(c2===4 && g.state!=='dead' && cy<ny2) continue;
            const k=`${nx2},${ny2}`;
            if(!vis.has(k)){vis.add(k);q.push([nx2,ny2,d+1]);}
          }
        }
        if (found < bestDist) { bestDist=found; bestIdx=i; }
      }
      g.dirX = candidates[bestIdx][0]; g.dirY = candidates[bestIdx][1];
      g.ntX  = candidates[bestIdx][2]; g.ntY  = candidates[bestIdx][3];
    }

    ghosts.forEach(g => {
      // ── FANTASMA MUERTO: movimiento en línea recta directo a la jaula ──
      if (g.state === 'dead') {
        const dx = 9 - g.x, dy = 10 - g.y;
        const dist = Math.hypot(dx, dy);
        if (dist < speedGhostDead) {
          g.x = 9; g.y = 10;
          g.dirX = 0; g.dirY = -1;
          g.ntX = 9; g.ntY = 9;
          g.state = 'normal';
        } else {
          g.x += (dx/dist)*speedGhostDead;
          g.y += (dy/dist)*speedGhostDead;
        }
        // Colisión Pacman-Fantasma (muertos no pueden matar)
        return;
      }

      // ── FANTASMA VIVO: sistema tile-based ──
      const sp = g.state === 'frightened' ? speedGhostFright : speedGhostNormal;

      // Moverse hacia la casilla destino (ntX, ntY)
      const dx = g.ntX - g.x, dy = g.ntY - g.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= sp) {
        // Llegamos a la casilla destino: snappear y elegir la siguiente
        g.x = g.ntX;
        g.y = g.ntY;
        // Wrap-around horizontal
        if (g.x < 0) g.x = COLS - 1;
        if (g.x >= COLS) g.x = 0;
        chooseNextTile(g);
      } else {
        g.x += (dx/dist)*sp;
        g.y += (dy/dist)*sp;
      }

      // Colisiones Pacman - Fantasmas
      const dToPac = Math.hypot(px - g.x, py - g.y);
      if (dToPac < 0.6 && dyingTimer === 0) {
        if (g.state === 'normal') {
          dyingTimer = 60; // 1 segundo de animación de muerte
          lives--;
          flashMsg = '¡PERDISTE UNA VIDA!';
          flashTimer = 60;
          playDeath();
          if (lives <= 0) setTimeout(() => playGameOver(), 700);
        } else if (g.state === 'frightened') {
          g.state = 'dead';
          addScore(200);
          flashMsg = '+200';
          flashTimer = 50;
          playEatGhost();
        }
      }
    });

    if (flashTimer > 0) flashTimer--;
  }

  function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cellSize = Math.min(canvas.width / COLS, (canvas.height - BOTTOM_UI_INSET - 40) / ROWS);
    const offsetX = (canvas.width - COLS * cellSize) / 2;
    const offsetY = 20;

    // 1. Dibujar Laberinto
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cx = offsetX + c * cellSize;
        const cy = offsetY + r * cellSize;
        const cell = grid[r][c];

        if (cell === 1) {
          // Pared oscura con neon
          ctx.fillStyle = '#000818';
          ctx.fillRect(cx, cy, cellSize, cellSize);

          ctx.strokeStyle = '#0033ff';
          ctx.lineWidth = 1.5;

          if (r > 0 && grid[r-1][c] !== 1) {
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + cellSize, cy); ctx.stroke();
          }
          if (r < ROWS - 1 && grid[r+1][c] !== 1) {
            ctx.beginPath(); ctx.moveTo(cx, cy + cellSize); ctx.lineTo(cx + cellSize, cy + cellSize); ctx.stroke();
          }
          if (c > 0 && grid[r][c-1] !== 1) {
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + cellSize); ctx.stroke();
          }
          if (c < COLS - 1 && grid[r][c+1] !== 1) {
            ctx.beginPath(); ctx.moveTo(cx + cellSize, cy); ctx.lineTo(cx + cellSize, cy + cellSize); ctx.stroke();
          }
        } else if (cell === 0) {
          // Bolita normal
          ctx.fillStyle = '#ffde00';
          ctx.beginPath();
          ctx.arc(cx + cellSize/2, cy + cellSize/2, cellSize * 0.15, 0, Math.PI*2);
          ctx.fill();
        } else if (cell === 2) {
          // Bolita de poder (Energizer intermitente)
          if (Math.floor(chompTimer / 10) % 2 === 0) {
            ctx.fillStyle = '#ffde00';
            ctx.beginPath();
            ctx.arc(cx + cellSize/2, cy + cellSize/2, cellSize * 0.32, 0, Math.PI*2);
            ctx.fill();
          }
        } else if (cell === 4) {
          // Puerta blanca/rosa de fantasmas
          ctx.fillStyle = '#ff88cc';
          ctx.fillRect(cx, cy + cellSize/2 - 2, cellSize, 4);
        }
      }
    }

    // 2. Dibujar Pacman
    if (!gameOver && !won) {
      const pcx = offsetX + px * cellSize + cellSize / 2;
      const pcy = offsetY + py * cellSize + cellSize / 2;
      
      if (dyingTimer > 0) {
        // Círculo encogiéndose al morir
        const radius = (cellSize / 2 * 0.85) * (dyingTimer / 60);
        ctx.fillStyle = '#ffde00';
        ctx.beginPath();
        ctx.arc(pcx, pcy, radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const radius = cellSize / 2 * 0.85;
        const mouthAngle = 0.22 + 0.18 * Math.sin(chompTimer * 0.35);

        ctx.fillStyle = '#ffde00';
        ctx.beginPath();
        ctx.moveTo(pcx, pcy);
        ctx.arc(pcx, pcy, radius, lastAngle + mouthAngle, lastAngle + 2 * Math.PI - mouthAngle);
        ctx.lineTo(pcx, pcy);
        ctx.fill();
      }
    }

    // 3. Dibujar Fantasmas
    ghosts.forEach(g => {
      const gcx = offsetX + g.x * cellSize + cellSize / 2;
      const gcy = offsetY + g.y * cellSize + cellSize / 2;
      const radius = cellSize / 2 * 0.85;

      if (g.state === 'dead') {
        // Solo ojos
        drawEyes(gcx, gcy, g.dirX, g.dirY, radius);
        return;
      }

      ctx.beginPath();
      ctx.arc(gcx, gcy - radius * 0.1, radius, Math.PI, 0, false);
      ctx.lineTo(gcx + radius, gcy + radius);

      // Wiggle inferior animado
      const wiggles = 3;
      const w = radius * 2 / wiggles;
      const wiggleOffset = Math.floor(chompTimer / 8) % 2;
      for (let i = 0; i < wiggles; i++) {
        const rx = gcx + radius - i * w;
        const ry = gcy + radius;
        const dy = (i % 2 === wiggleOffset) ? radius * 0.18 : -radius * 0.18;
        ctx.lineTo(rx - w/2, ry + dy);
        ctx.lineTo(rx - w, ry);
      }
      ctx.lineTo(gcx - radius, gcy - radius * 0.1);

      const isScaredFlasher = frightenedTimer > 0 && frightenedTimer < 100 && Math.floor(frightenedTimer / 10) % 2 === 0;
      ctx.fillStyle = g.state === 'frightened' ? (isScaredFlasher ? '#fff' : '#2b3dff') : g.color;
      ctx.fill();

      // Rostro
      if (g.state === 'frightened') {
        ctx.fillStyle = isScaredFlasher ? '#ff0000' : '#ffde00';
        ctx.fillRect(gcx - radius * 0.35, gcy - radius * 0.2, 2.5, 2.5);
        ctx.fillRect(gcx + radius * 0.15, gcy - radius * 0.2, 2.5, 2.5);

        ctx.strokeStyle = isScaredFlasher ? '#ff0000' : '#ffde00';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(gcx - radius * 0.4, gcy + radius * 0.28);
        ctx.lineTo(gcx - radius * 0.2, gcy + radius * 0.18);
        ctx.lineTo(gcx, gcy + radius * 0.28);
        ctx.lineTo(gcx + radius * 0.2, gcy + radius * 0.18);
        ctx.lineTo(gcx + radius * 0.4, gcy + radius * 0.28);
        ctx.stroke();
      } else {
        drawEyes(gcx, gcy, g.dirX, g.dirY, radius);
      }
    });

    function drawEyes(cx, cy, dx, dy, r) {
      ctx.fillStyle = '#fff';
      const ex1 = cx - r * 0.45;
      const ex2 = cx + r * 0.45;
      const ey = cy - r * 0.18;
      ctx.beginPath(); ctx.arc(ex1, ey, r * 0.35, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2, ey, r * 0.35, 0, Math.PI*2); ctx.fill();

      ctx.fillStyle = '#2b3dff';
      const pxOffset = dx * r * 0.18;
      const pyOffset = dy * r * 0.18;
      ctx.beginPath(); ctx.arc(ex1 + pxOffset, ey + pyOffset, r * 0.16, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex2 + pxOffset, ey + pyOffset, r * 0.16, 0, Math.PI*2); ctx.fill();
    }

    // 4. Cartelera victoria/derrota
    if (gameOver || won) {
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.min(50, canvas.width/13)}px Outfit`;
      ctx.fillStyle = gameOver ? '#ff3333' : '#ffde00';
      ctx.fillText(gameOver ? 'GAME OVER' : '¡VICTORIA!', canvas.width/2, canvas.height/2 - 20);
      ctx.font = '18px Outfit'; ctx.fillStyle = '#fff';
      ctx.fillText(`Puntuación final: ${score}`, canvas.width/2, canvas.height/2 + 20);
      ctx.font = '12px Outfit'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('Presiona ENTER para jugar otra vez', canvas.width/2, canvas.height/2 + 55);
    }

    // 5. Mostrar flash de puntaje
    if (flashTimer > 0) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 16px Outfit';
      ctx.fillStyle = `rgba(255, 222, 0, ${flashTimer / 50})`;
      ctx.fillText(flashMsg, offsetX + px * cellSize + cellSize/2, offsetY + py * cellSize - 10);
    }

    // HUD inferior
    ctx.fillStyle = '#fff'; ctx.font = '15px Outfit';
    ctx.textAlign = 'left'; ctx.fillText(`SCORE  ${String(score).padStart(6,'0')}`, 20, hudBaselineY());
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffde00';
    ctx.fillText('PAC MAN', canvas.width/2, hudBaselineY());
    ctx.textAlign = 'right'; ctx.fillStyle = '#ff3333';
    ctx.fillText(`♥ ${Math.max(0, lives)}`, canvas.width-20, hudBaselineY());

    // Botón mute
    const muteX = canvas.width - 58, muteY = 8, muteW = 50, muteH = 22;
    ctx.fillStyle = soundEnabled ? 'rgba(255,222,0,0.15)' : 'rgba(255,80,80,0.2)';
    ctx.strokeStyle = soundEnabled ? '#ffde00' : '#ff5555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(muteX, muteY, muteW, muteH, 5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = soundEnabled ? '#ffde00' : '#ff5555';
    ctx.font = '13px Outfit'; ctx.textAlign = 'center';
    ctx.fillText(soundEnabled ? '🔊 ON' : '🔇 OFF', muteX + muteW/2, muteY + 15);
  }

  function onKeyDown(code) {
    if (code === 'Enter' && (gameOver || won)) init();
    if (code === 'KeyM') soundEnabled = !soundEnabled;
  }

  function onClick(ex, ey) {
    const muteX = canvas.width - 58, muteY = 8, muteW = 50, muteH = 22;
    if (ex >= muteX && ex <= muteX+muteW && ey >= muteY && ey <= muteY+muteH) {
      soundEnabled = !soundEnabled;
      try { getACtx().resume(); } catch(e) {}
    }
  }

  init();
  return { update, draw, onKeyDown, onClick };
}


// ===== TETRIS =====
function createTetrisGame() {
  const GRID_W = 10;
  const GRID_H = 20;
  
  let score = 0;
  let lives = 5;
  let level = 1;
  let linesClearedTotal = 0;
  let gameOver = false;
  let gameBoard = [];
  
  let currentPiece = null;
  let nextPiece = null;
  let dropCounter = 0;
  let dropInterval = 1000; // ms por caída
  let lastTime = 0;
  let lastScoreLifeThreshold = 0;
  
  // ── PIEZAS (I, J, L, O, S, T, Z) ──
  const SHAPES = {
    'I': [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
    'J': [[2,0,0], [2,2,2], [0,0,0]],
    'L': [[0,0,3], [3,3,3], [0,0,0]],
    'O': [[4,4], [4,4]],
    'S': [[0,5,5], [5,5,0], [0,0,0]],
    'T': [[0,6,0], [6,6,6], [0,0,0]],
    'Z': [[7,7,0], [0,7,7], [0,0,0]]
  };
  
  const COLORS = [
    null,
    '#00ffff', // I - Celeste
    '#0000ff', // J - Azul
    '#ffa500', // L - Naranja
    '#ffff00', // O - Amarillo
    '#00ff00', // S - Verde
    '#9932cc', // T - Morado
    '#ff0000'  // Z - Rojo
  ];

  // ── MOTOR DE AUDIO (Web Audio API) ──
  let audioCtx = null;
  let soundEnabled = true;

  function getACtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, type, duration, volume = 0.25) {
    if (!soundEnabled) return;
    try {
      const ctx = getACtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(); osc.stop(ctx.currentTime + duration);
    } catch(e) {}
  }

  function addScore(pts) {
    score += pts;
    const currentThreshold = Math.floor(score / 600);
    if (currentThreshold > lastScoreLifeThreshold) {
      const extra = currentThreshold - lastScoreLifeThreshold;
      lives += extra;
      lastScoreLifeThreshold = currentThreshold;
      playTone(880, 'sine', 0.15, 0.25);
    }
  }

  function createMatrix(w, h) {
    const matrix = [];
    while (h--) {
      matrix.push(new Array(w).fill(0));
    }
    return matrix;
  }

  function randomPiece() {
    const pieces = 'IJLOSTZ';
    const type = pieces[Math.floor(Math.random() * pieces.length)];
    const matrix = SHAPES[type].map(row => [...row]);
    return {
      matrix,
      pos: { x: Math.floor(GRID_W / 2) - Math.floor(matrix[0].length / 2), y: 0 },
      colorIndex: 'IJLOSTZ'.indexOf(type) + 1
    };
  }

  function collide(board, piece) {
    const m = piece.matrix;
    const o = piece.pos;
    for (let r = 0; r < m.length; ++r) {
      for (let c = 0; c < m[r].length; ++c) {
        if (m[r][c] !== 0 &&
           (board[r + o.y] === undefined ||
            board[r + o.y][c + o.x] === undefined ||
            board[r + o.y][c + o.x] !== 0)) {
          return true;
        }
      }
    }
    return false;
  }

  function merge(board, piece) {
    piece.matrix.forEach((row, r) => {
      row.forEach((value, c) => {
        if (value !== 0) {
          board[r + piece.pos.y][c + piece.pos.x] = piece.colorIndex;
        }
      });
    });
  }

  function rotate(matrix) {
    for (let y = 0; y < matrix.length; ++y) {
      for (let x = 0; x < y; ++x) {
        [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
      }
    }
    matrix.forEach(row => row.reverse());
  }

  function playerRotate() {
    const pos = currentPiece.pos.x;
    let offset = 1;
    rotate(currentPiece.matrix);
    while (collide(gameBoard, currentPiece)) {
      currentPiece.pos.x += offset;
      offset = -(offset + (offset > 0 ? 1 : -1));
      if (offset > currentPiece.matrix[0].length) {
        rotate(currentPiece.matrix); // revertir
        rotate(currentPiece.matrix);
        rotate(currentPiece.matrix);
        currentPiece.pos.x = pos;
        return;
      }
    }
    playTone(330, 'triangle', 0.08, 0.1);
  }

  function playerMove(dir) {
    currentPiece.pos.x += dir;
    if (collide(gameBoard, currentPiece)) {
      currentPiece.pos.x -= dir;
    } else {
      playTone(200, 'triangle', 0.05, 0.08);
    }
  }

  function playerDrop() {
    currentPiece.pos.y++;
    if (collide(gameBoard, currentPiece)) {
      currentPiece.pos.y--;
      merge(gameBoard, currentPiece);
      playTone(180, 'sine', 0.12, 0.15); // Sonido al consolidar pieza
      sweep();
      resetPiece();
    }
    dropCounter = 0;
  }

  function resetPiece() {
    currentPiece = nextPiece;
    nextPiece = randomPiece();
    if (collide(gameBoard, currentPiece)) {
      lives--;
      playTone(150, 'sawtooth', 0.5, 0.25);
      if (lives <= 0) {
        gameOver = true;
        playTone(100, 'sawtooth', 0.8, 0.3);
      } else {
        gameBoard = createMatrix(GRID_W, GRID_H);
      }
    }
  }

  function sweep() {
    let rowCount = 0;
    outer: for (let y = gameBoard.length - 1; y >= 0; --y) {
      for (let x = 0; x < gameBoard[y].length; ++x) {
        if (gameBoard[y][x] === 0) {
          continue outer;
        }
      }
      const row = gameBoard.splice(y, 1)[0].fill(0);
      gameBoard.unshift(row);
      ++y;
      rowCount++;
    }
    if (rowCount > 0) {
      const lineScores = [0, 40, 100, 300, 1200];
      const pts = (lineScores[rowCount] || 1200) * level;
      addScore(pts);
      linesClearedTotal += rowCount;
      playTone(523 + rowCount * 100, 'square', 0.2, 0.2);
      
      // Subir nivel cada 10 líneas
      const newLevel = Math.floor(linesClearedTotal / 10) + 1;
      if (newLevel > level) {
        level = newLevel;
        lives += 2; // +2 vidas por pasar a un nuevo nivel/tanda
        playTone(1047, 'sine', 0.25, 0.25);
        dropInterval = Math.max(100, 1000 - (level - 1) * 100);
      }
    }
  }

  function init() {
    gameBoard = createMatrix(GRID_W, GRID_H);
    score = 0;
    lives = 5;
    level = 1;
    linesClearedTotal = 0;
    gameOver = false;
    dropInterval = 1000;
    lastScoreLifeThreshold = 0;
    currentPiece = randomPiece();
    nextPiece = randomPiece();
    lastTime = performance.now();
    playTone(523, 'sine', 0.15, 0.15);
  }

  function update() {
    if (gameOver) return;
    const time = performance.now();
    const deltaTime = time - lastTime;
    lastTime = time;

    dropCounter += deltaTime;
    if (dropCounter > dropInterval) {
      playerDrop();
    }
  }

  function draw() {
    // Fondo oscuro
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Cuadrícula y marcos estéticos en la zona central
    const cellSz = Math.min(28, Math.floor((canvas.height - 180) / GRID_H));
    const boardW = GRID_W * cellSz;
    const boardH = GRID_H * cellSz;
    const startX = Math.floor((canvas.width - boardW) / 2);
    const startY = 80;

    // Dibujar tablero físico (células)
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(startX, startY, boardW, boardH);
    
    // Dibujar rejilla interior
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= GRID_W; c++) {
      ctx.beginPath();
      ctx.moveTo(startX + c * cellSz, startY);
      ctx.lineTo(startX + c * cellSz, startY + boardH);
      ctx.stroke();
    }
    for (let r = 0; r <= GRID_H; r++) {
      ctx.beginPath();
      ctx.moveTo(startX, startY + r * cellSz);
      ctx.lineTo(startX + boardW, startY + r * cellSz);
      ctx.stroke();
    }

    // Borde exterior
    ctx.strokeStyle = '#2ed573';
    ctx.lineWidth = 3;
    ctx.strokeRect(startX - 2, startY - 2, boardW + 4, boardH + 4);

    // Dibujar bloques fijos en el tablero
    gameBoard.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value !== 0) {
          ctx.fillStyle = COLORS[value];
          ctx.fillRect(startX + x * cellSz + 1, startY + y * cellSz + 1, cellSz - 2, cellSz - 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.strokeRect(startX + x * cellSz + 1, startY + y * cellSz + 1, cellSz - 2, cellSz - 2);
        }
      });
    });

    // Dibujar pieza actual en caída
    if (currentPiece) {
      currentPiece.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value !== 0) {
            ctx.fillStyle = COLORS[currentPiece.colorIndex];
            ctx.fillRect(startX + (currentPiece.pos.x + x) * cellSz + 1, startY + (currentPiece.pos.y + y) * cellSz + 1, cellSz - 2, cellSz - 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.strokeRect(startX + (currentPiece.pos.x + x) * cellSz + 1, startY + (currentPiece.pos.y + y) * cellSz + 1, cellSz - 2, cellSz - 2);
          }
        });
      });
    }

    // Dibujar panel lateral "Siguiente Pieza" a la derecha
    const nextX = startX + boardW + 28;
    const nextY = startY + 20;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px Outfit';
    ctx.textAlign = 'left';
    ctx.fillText('SIGUIENTE', nextX, nextY);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.strokeRect(nextX - 5, nextY + 10, cellSz * 4 + 10, cellSz * 4 + 10);
    
    if (nextPiece) {
      const offsetX = Math.floor((4 - nextPiece.matrix[0].length) / 2);
      const offsetY = Math.floor((4 - nextPiece.matrix.length) / 2);
      nextPiece.matrix.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value !== 0) {
            ctx.fillStyle = COLORS[nextPiece.colorIndex];
            ctx.fillRect(nextX + (x + offsetX) * cellSz, nextY + 20 + (y + offsetY) * cellSz, cellSz - 1, cellSz - 1);
          }
        });
      });
    }

    // Pantalla de Game Over
    if (gameOver) {
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.min(50, canvas.width/13)}px Outfit`;
      ctx.fillStyle = '#ff3333';
      ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20);
      ctx.font = '18px Outfit'; ctx.fillStyle = '#fff';
      ctx.fillText(`Puntuación final: ${score}`, canvas.width / 2, canvas.height / 2 + 20);
      ctx.font = '12px Outfit'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('Presiona ENTER para jugar otra vez', canvas.width / 2, canvas.height / 2 + 55);
    }

    // HUD inferior
    ctx.fillStyle = '#fff'; ctx.font = '15px Outfit';
    ctx.textAlign = 'left'; ctx.fillText(`SCORE  ${String(score).padStart(6,'0')}`, 20, hudBaselineY());
    ctx.textAlign = 'center'; ctx.fillStyle = '#2ed573';
    ctx.fillText(`TETRIS  ·  NIVEL ${level}`, canvas.width/2, hudBaselineY());
    ctx.textAlign = 'right'; ctx.fillStyle = '#ff3333';
    ctx.fillText(`♥ ${Math.max(0, lives)}`, canvas.width-20, hudBaselineY());

    // Botón mute
    const muteX = canvas.width - 58, muteY = 8, muteW = 50, muteH = 22;
    ctx.fillStyle = soundEnabled ? 'rgba(46,213,115,0.15)' : 'rgba(255,80,80,0.2)';
    ctx.strokeStyle = soundEnabled ? '#2ed573' : '#ff5555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(muteX, muteY, muteW, muteH, 5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = soundEnabled ? '#2ed573' : '#ff5555';
    ctx.font = '13px Outfit'; ctx.textAlign = 'center';
    ctx.fillText(soundEnabled ? '🔊 ON' : '🔇 OFF', muteX + muteW/2, muteY + 15);
  }

  function onKeyDown(code) {
    if (gameOver) {
      if (code === 'Enter') init();
      return;
    }
    if (code === 'ArrowLeft') {
      playerMove(-1);
    } else if (code === 'ArrowRight') {
      playerMove(1);
    } else if (code === 'ArrowDown') {
      playerDrop();
    } else if (code === 'ArrowUp') {
      playerRotate();
    } else if (code === 'KeyM') {
      soundEnabled = !soundEnabled;
    }
  }

  function onClick(ex, ey) {
    const muteX = canvas.width - 58, muteY = 8, muteW = 50, muteH = 22;
    if (ex >= muteX && ex <= muteX+muteW && ey >= muteY && ey <= muteY+muteH) {
      soundEnabled = !soundEnabled;
      try { getACtx().resume(); } catch(e) {}
    }
  }

  init();
  return { update, draw, onKeyDown, onClick };
}


// ===== SIMON SAYS =====
function createSimonGame() {
  let score = 0;
  let lives = 5;
  let level = 1;
  let gameOver = false;
  let lastScoreLifeThreshold = 0;
  
  let sequence = [];
  let userSequence = [];
  let isDisplayingSequence = false;
  let displayIndex = 0;
  let displayTimer = 0;
  let displayDuration = 30; // frames por color
  let silenceDuration = 15;   // frames de silencio entre colores
  let isLightUp = false;
  let activeColorIndex = -1;
  
  let userTurn = false;
  let successTimer = 0;
  let failureTimer = 0;
  
  // 4 cuadrantes/colores
  // 0: verde, 1: rojo, 2: amarillo, 3: azul
  const COLORS = [
    { normal: '#1b4d22', active: '#2ed573', freq: 329.63 }, // Mi (E4) - Verde
    { normal: '#7a1c1c', active: '#ff4757', freq: 261.63 }, // Do (C4) - Rojo
    { normal: '#8a650f', active: '#ffa502', freq: 392.00 }, // Sol (G4) - Amarillo
    { normal: '#0f3a60', active: '#1e90ff', freq: 220.00 }  // La (A3) - Azul
  ];

  // ── MOTOR DE AUDIO (Web Audio API) ──
  let audioCtx = null;
  let soundEnabled = true;

  function getACtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, type, duration, volume = 0.25) {
    if (!soundEnabled) return;
    try {
      const ctx = getACtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(); osc.stop(ctx.currentTime + duration);
    } catch(e) {}
  }

  function addScore(pts) {
    score += pts;
    const currentThreshold = Math.floor(score / 200);
    if (currentThreshold > lastScoreLifeThreshold) {
      const extra = currentThreshold - lastScoreLifeThreshold;
      lives += extra;
      lastScoreLifeThreshold = currentThreshold;
      playTone(880, 'sine', 0.15, 0.25);
    }
  }

  function nextRound() {
    userTurn = false;
    userSequence = [];
    // Agregar un color aleatorio a la secuencia
    sequence.push(Math.floor(Math.random() * 4));
    
    // Incrementar complejidad: a mayor nivel, mayor velocidad de secuencia
    displayDuration = Math.max(10, 30 - level * 2);
    silenceDuration = Math.max(5, 15 - Math.floor(level / 2));
    
    isDisplayingSequence = true;
    displayIndex = 0;
    displayTimer = 0;
    isLightUp = false;
    activeColorIndex = -1;
  }

  // Temporizador para que el usuario responda (5 segundos a 60fps = 300 frames)
  let responseTimer = 0;
  const RESPONSE_TIMEOUT = 300; 

  function handleUserClick(index) {
    if (!userTurn || isDisplayingSequence || gameOver) return;
    
    activeColorIndex = index;
    displayTimer = 15; // Mantener iluminado por 15 frames para que se note claramente el tap
    playTone(COLORS[index].freq, 'sine', 0.2, 0.25);
    
    userSequence.push(index);
    responseTimer = 0; // Reiniciar temporizador de inactividad al interactuar
    
    // Verificar correspondencia
    const currentStep = userSequence.length - 1;
    if (userSequence[currentStep] !== sequence[currentStep]) {
      triggerFailure();
    } else if (userSequence.length === sequence.length) {
      // Éxito: ronda completada
      level++;
      
      // Ganar puntos cada 4 tandas (niveles)
      if (level > 1 && (level - 1) % 4 === 0) {
        addScore(100);
      }
      
      // Cada 3 niveles superados, regalar 2 vidas adicionales
      if (level > 1 && (level - 1) % 3 === 0) {
        lives += 2;
        playTone(1047, 'sine', 0.25, 0.25);
      }
      
      successTimer = 35;
      userTurn = false; // Desactivar clics adicionales mientras se procesa la transición
      playTone(660, 'sine', 0.15, 0.2); // sonido éxito
      setTimeout(() => nextRound(), 750);
    }
  }

  function triggerFailure() {
    lives--;
    failureTimer = 45;
    userTurn = false;
    playTone(120, 'sawtooth', 0.4, 0.3); // sonido error
    
    if (lives <= 0) {
      gameOver = true;
      playTone(90, 'sawtooth', 0.8, 0.3);
    } else {
      // Volver a mostrar la secuencia actual (sin agregar color nuevo)
      setTimeout(() => {
        userSequence = [];
        isDisplayingSequence = true;
        displayIndex = 0;
        displayTimer = 0;
        isLightUp = false;
      }, 950);
    }
  }

  function init() {
    score = 0;
    lives = 5;
    level = 1;
    gameOver = false;
    lastScoreLifeThreshold = 0;
    sequence = [];
    userSequence = [];
    isDisplayingSequence = false;
    successTimer = 0;
    failureTimer = 0;
    activeColorIndex = -1;
    responseTimer = 0;
    nextRound();
  }

  function update() {
    if (gameOver) return;

    if (successTimer > 0) successTimer--;
    if (failureTimer > 0) failureTimer--;

    // Lógica para reproducir/iluminar la secuencia
    if (isDisplayingSequence) {
      displayTimer++;
      if (!isLightUp) {
        // Silencio previo: activar luz
        if (displayTimer >= silenceDuration) {
          isLightUp = true;
          displayTimer = 0;
          activeColorIndex = sequence[displayIndex];
          playTone(COLORS[activeColorIndex].freq, 'sine', 0.25, 0.25);
        }
      } else {
        // Tiempo iluminado: apagar luz y pasar al siguiente
        if (displayTimer >= displayDuration) {
          isLightUp = false;
          displayTimer = 0;
          activeColorIndex = -1;
          displayIndex++;
          if (displayIndex >= sequence.length) {
            isDisplayingSequence = false;
            userTurn = true;
            responseTimer = 0; // Iniciar el temporizador para la respuesta del usuario
          }
        }
      }
    } else {
      // Si es turno del usuario, temporizar inactividad
      if (userTurn) {
        responseTimer++;
        if (responseTimer >= RESPONSE_TIMEOUT) {
          triggerFailure();
        }
      }
      
      // Control de tiempo para clics/taps visuales del usuario
      if (activeColorIndex !== -1) {
        displayTimer--;
        if (displayTimer <= 0) {
          activeColorIndex = -1;
        }
      }
    }
  }

  function draw() {
    // Fondo oscuro
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2 - 10;
    const outerRadius = Math.min(220, canvas.height / 2.6);
    const innerRadius = outerRadius * 0.35;

    // Efecto visual de fondo de éxito/fracaso
    if (failureTimer > 0) {
      ctx.fillStyle = `rgba(255, 71, 87, ${failureTimer * 0.006})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (successTimer > 0) {
      ctx.fillStyle = `rgba(46, 213, 115, ${successTimer * 0.006})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Dibujar base del tablero circular
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius + 8, 0, Math.PI * 2);
    ctx.fill();

    // Dibujar los 4 cuadrantes (Verde, Rojo, Amarillo, Azul)
    const paddingAngle = 0.06; // Pequeño espacio negro entre botones

    // 0: Verde (Arriba Izquierda)
    ctx.fillStyle = (activeColorIndex === 0) ? COLORS[0].active : COLORS[0].normal;
    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius, Math.PI + paddingAngle, Math.PI * 1.5 - paddingAngle);
    ctx.arc(centerX, centerY, innerRadius, Math.PI * 1.5 - paddingAngle, Math.PI + paddingAngle, true);
    ctx.closePath();
    ctx.fill();

    // 1: Rojo (Arriba Derecha)
    ctx.fillStyle = (activeColorIndex === 1) ? COLORS[1].active : COLORS[1].normal;
    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius, Math.PI * 1.5 + paddingAngle, Math.PI * 2 - paddingAngle);
    ctx.arc(centerX, centerY, innerRadius, Math.PI * 2 - paddingAngle, Math.PI * 1.5 + paddingAngle, true);
    ctx.closePath();
    ctx.fill();

    // 2: Amarillo (Abajo Izquierda)
    ctx.fillStyle = (activeColorIndex === 2) ? COLORS[2].active : COLORS[2].normal;
    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius, Math.PI - paddingAngle, Math.PI * 0.5 + paddingAngle, true);
    ctx.arc(centerX, centerY, innerRadius, Math.PI * 0.5 + paddingAngle, Math.PI - paddingAngle);
    ctx.closePath();
    ctx.fill();

    // 3: Azul (Abajo Derecha)
    ctx.fillStyle = (activeColorIndex === 3) ? COLORS[3].active : COLORS[3].normal;
    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius, paddingAngle, Math.PI * 0.5 - paddingAngle);
    ctx.arc(centerX, centerY, innerRadius, Math.PI * 0.5 - paddingAngle, paddingAngle, true);
    ctx.closePath();
    ctx.fill();

    // Centro decorativo negro
    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
    ctx.fill();

    // Texto interior indicando de quién es el turno
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Outfit';
    ctx.textAlign = 'center';
    if (gameOver) {
      ctx.fillStyle = '#ff4757';
      ctx.fillText('FIN', centerX, centerY + 4);
    } else if (isDisplayingSequence) {
      ctx.fillStyle = '#ffa502';
      ctx.fillText('SIMON', centerX, centerY - 2);
      ctx.fillText('DICE', centerX, centerY + 8);
    } else {
      ctx.fillStyle = '#2ed573';
      ctx.fillText('TU', centerX, centerY - 2);
      ctx.fillText('TURNO', centerX, centerY + 8);
    }

    // Pantalla de Game Over
    if (gameOver) {
      ctx.fillStyle = 'rgba(10,13,22,0.85)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.min(50, canvas.width/13)}px Outfit`;
      ctx.fillStyle = '#ff3333';
      ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20);
      ctx.font = '18px Outfit'; ctx.fillStyle = '#fff';
      ctx.fillText(`Puntuación final: ${score}`, canvas.width / 2, canvas.height / 2 + 20);
      ctx.font = '12px Outfit'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('Presiona ENTER para jugar otra vez', canvas.width / 2, canvas.height / 2 + 55);
    }

    // HUD inferior
    ctx.fillStyle = '#fff'; ctx.font = '15px Outfit';
    ctx.textAlign = 'left'; ctx.fillText(`SCORE  ${String(score).padStart(6,'0')}`, 20, hudBaselineY());
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffa502';
    ctx.fillText(`SIMON SAYS  ·  RONDA ${level}`, canvas.width/2, hudBaselineY());
    ctx.textAlign = 'right'; ctx.fillStyle = '#ff3333';
    ctx.fillText(`♥ ${Math.max(0, lives)}`, canvas.width-20, hudBaselineY());

    // Botón mute
    const muteX = canvas.width - 58, muteY = 8, muteW = 50, muteH = 22;
    ctx.fillStyle = soundEnabled ? 'rgba(255,165,2,0.15)' : 'rgba(255,80,80,0.2)';
    ctx.strokeStyle = soundEnabled ? '#ffa502' : '#ff5555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(muteX, muteY, muteW, muteH, 5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = soundEnabled ? '#ffa502' : '#ff5555';
    ctx.font = '13px Outfit'; ctx.textAlign = 'center';
    ctx.fillText(soundEnabled ? '🔊 ON' : '🔇 OFF', muteX + muteW/2, muteY + 15);
  }

  function onKeyDown(code) {
    if (gameOver) {
      if (code === 'Enter') init();
      return;
    }
    // Mapeo teclado: Flechas o WASD para los 4 cuadrantes
    // Arriba-Izquierda (Verde): ArrowLeft / KeyA / KeyW
    // Arriba-Derecha (Rojo): ArrowUp / KeyD
    // Abajo-Izquierda (Amarillo): ArrowDown / KeyS
    // Abajo-Derecha (Azul): ArrowRight
    if (code === 'ArrowLeft' || code === 'KeyA') {
      handleUserClick(0);
    } else if (code === 'ArrowUp' || code === 'KeyW') {
      handleUserClick(1);
    } else if (code === 'ArrowDown' || code === 'KeyS') {
      handleUserClick(2);
    } else if (code === 'ArrowRight' || code === 'KeyD') {
      handleUserClick(3);
    } else if (code === 'KeyM') {
      soundEnabled = !soundEnabled;
    }
  }

  function onClick(ex, ey) {
    const muteX = canvas.width - 58, muteY = 8, muteW = 50, muteH = 22;
    if (ex >= muteX && ex <= muteX+muteW && ey >= muteY && ey <= muteY+muteH) {
      soundEnabled = !soundEnabled;
      try { getACtx().resume(); } catch(e) {}
      return;
    }

    if (!userTurn || isDisplayingSequence || gameOver) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2 - 10;
    const outerRadius = Math.min(220, canvas.height / 2.6);
    const innerRadius = outerRadius * 0.35;

    const dx = ex - centerX;
    const dy = ey - centerY;
    const dist = Math.hypot(dx, dy);

    if (dist >= innerRadius && dist <= outerRadius) {
      // Calcular cuadrante según coordenadas relativas
      if (dx < 0 && dy < 0) {
        handleUserClick(0); // Verde
      } else if (dx >= 0 && dy < 0) {
        handleUserClick(1); // Rojo
      } else if (dx < 0 && dy >= 0) {
        handleUserClick(2); // Amarillo
      } else if (dx >= 0 && dy >= 0) {
        handleUserClick(3); // Azul
      }
    }
  }

  init();
  return { update, draw, onKeyDown, onClick };
}


// ===== BREAKOUT =====
function createBreakoutGame() {
  let score = 0;
  let lives = 5;
  let level = 1;
  let gameOver = false;
  let won = false;
  let lastScoreLifeThreshold = 0;

  // Parámetros paleta
  let paddleX = 0;
  const paddleW = 90;
  const paddleH = 12;
  const paddleYOffset = 60; // Separación del fondo

  // Parámetros pelota
  let ballX = 0, ballY = 0;
  let ballVX = 0, ballVY = 0;
  const ballRadius = 6;
  let baseSpeed = 6.2;

  // Ladrillos
  let bricks = [];
  const brickRows = 5;
  const brickCols = 10;
  const brickHeight = 16;
  const brickPadding = 5;
  
  const ROW_COLORS = ['#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#9932cc'];

  // Partículas para efectos de destrucción
  let particles = [];

  // ── MOTOR DE AUDIO (Web Audio API) ──
  let audioCtx = null;
  let soundEnabled = true;

  function getACtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, type, duration, volume = 0.25) {
    if (!soundEnabled) return;
    try {
      const ctx = getACtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(); osc.stop(ctx.currentTime + duration);
    } catch(e) {}
  }

  function addScore(pts) {
    score += pts;
    const currentThreshold = Math.floor(score / 200);
    if (currentThreshold > lastScoreLifeThreshold) {
      const extra = currentThreshold - lastScoreLifeThreshold;
      lives += extra;
      lastScoreLifeThreshold = currentThreshold;
      playTone(880, 'sine', 0.15, 0.25);
    }
  }

  function initBricks() {
    bricks = [];
    // Cambiar layout de ladrillos según nivel
    const activeRows = Math.min(8, brickRows + Math.floor(level / 2));
    
    const totalBrickW = canvas.width * 0.85;
    const individualW = Math.floor(totalBrickW / brickCols) - brickPadding;
    const startX = Math.floor((canvas.width - totalBrickW) / 2);
    const startY = 90;

    for (let r = 0; r < activeRows; r++) {
      const color = ROW_COLORS[r % ROW_COLORS.length];
      for (let c = 0; c < brickCols; c++) {
        bricks.push({
          x: startX + c * (individualW + brickPadding),
          y: startY + r * (brickHeight + brickPadding),
          w: individualW,
          h: brickHeight,
          color,
          pts: (activeRows - r) * 10,
          alive: true
        });
      }
    }
  }

  function resetBall() {
    ballX = canvas.width / 2;
    ballY = canvas.height - paddleYOffset - 30;
    
    // Lanzar hacia arriba con ángulo aleatorio
    const angle = -Math.PI / 4 - Math.random() * (Math.PI / 2);
    ballVX = Math.cos(angle) * baseSpeed;
    ballVY = Math.sin(angle) * baseSpeed;
  }

  function createExplosion(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 20 + Math.random() * 20,
        color
      });
    }
  }

  function init() {
    score = 0;
    lives = 5;
    level = 1;
    gameOver = false;
    won = false;
    lastScoreLifeThreshold = 0;
    baseSpeed = 6.2;
    paddleX = (canvas.width - paddleW) / 2;
    particles = [];
    initBricks();
    resetBall();
    playTone(523, 'sine', 0.2, 0.15);
  }

  function nextLevel() {
    level++;
    lives += 2; // +2 vidas por pasar de tanda/nivel
    baseSpeed = Math.min(10.0, 6.2 + level * 0.45); // Aumentar velocidad de la bola
    playTone(1047, 'sine', 0.3, 0.25);
    initBricks();
    resetBall();
  }

  function update() {
    if (gameOver || won) return;

    // Actualizar partículas
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
    });
    particles = particles.filter(p => p.life > 0);

    // Mover paleta
    const speedPaddle = 12;
    if (keys['ArrowLeft']) {
      paddleX = Math.max(0, paddleX - speedPaddle);
      if (Math.random() < 0.25) playTone(120, 'triangle', 0.05, 0.04); // Sonido de movimiento
    }
    if (keys['ArrowRight']) {
      paddleX = Math.min(canvas.width - paddleW, paddleX + speedPaddle);
      if (Math.random() < 0.25) playTone(120, 'triangle', 0.05, 0.04);
    }

    // Mover pelota
    ballX += ballVX;
    ballY += ballVY;

    // Colisión paredes laterales
    if (ballX - ballRadius <= 0) {
      ballX = ballRadius;
      ballVX *= -1;
      playTone(380, 'triangle', 0.05, 0.1);
    }
    if (ballX + ballRadius >= canvas.width) {
      ballX = canvas.width - ballRadius;
      ballVX *= -1;
      playTone(380, 'triangle', 0.05, 0.1);
    }

    // Colisión pared superior
    if (ballY - ballRadius <= 50) {
      ballY = 50 + ballRadius;
      ballVY *= -1;
      playTone(380, 'triangle', 0.05, 0.1);
    }

    // Caída inferior (Pérdida de vida)
    if (ballY + ballRadius >= canvas.height) {
      lives--;
      playTone(150, 'sawtooth', 0.4, 0.2);
      if (lives <= 0) {
        gameOver = true;
        playTone(90, 'sawtooth', 0.8, 0.3);
      } else {
        resetBall();
      }
      return;
    }

    // Colisión con la paleta
    const paddleY = canvas.height - paddleYOffset;
    if (ballVY > 0 && 
        ballY + ballRadius >= paddleY && 
        ballY - ballRadius <= paddleY + paddleH &&
        ballX >= paddleX && 
        ballX <= paddleX + paddleW) {
      
      ballY = paddleY - ballRadius;
      ballVY *= -1;

      // Desviar ángulo según dónde golpee la paleta
      const hitPoint = (ballX - (paddleX + paddleW / 2)) / (paddleW / 2);
      ballVX = hitPoint * baseSpeed * 0.9;
      
      playTone(440, 'sine', 0.08, 0.15);
    }

    // Colisión con ladrillos
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i];
      if (!b.alive) continue;

      if (ballX + ballRadius >= b.x && 
          ballX - ballRadius <= b.x + b.w && 
          ballY + ballRadius >= b.y && 
          ballY - ballRadius <= b.y + b.h) {
        
        b.alive = false;
        createExplosion(b.x + b.w/2, b.y + b.h/2, b.color);
        addScore(b.pts);
        
        // Rebote físico simple en ladrillo
        ballVY *= -1;
        playTone(600, 'triangle', 0.05, 0.12);
        break; 
      }
    }

    // Verificar si limpió el nivel
    if (bricks.filter(b => b.alive).length === 0) {
      nextLevel();
    }
  }

  function draw() {
    // Fondo espacial/retro
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dibujar partículas
    particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 3, 3);
    });

    // Borde superior estético
    ctx.fillStyle = '#00ff41';
    ctx.fillRect(0, 50, canvas.width, 2);

    // Dibujar paleta
    ctx.fillStyle = '#00ff41';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00ff41';
    ctx.fillRect(paddleX, canvas.height - paddleYOffset, paddleW, paddleH);
    ctx.shadowBlur = 0; // reset shadow

    // Dibujar pelota
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
    ctx.fill();

    // Dibujar ladrillos
    bricks.forEach(b => {
      if (b.alive) {
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = '#0a0d16';
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
    });

    // Pantalla de Game Over
    if (gameOver) {
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.min(50, canvas.width/13)}px Outfit`;
      ctx.fillStyle = '#ff3333';
      ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20);
      ctx.font = '18px Outfit'; ctx.fillStyle = '#fff';
      ctx.fillText(`Puntuación final: ${score}`, canvas.width / 2, canvas.height / 2 + 20);
      ctx.font = '12px Outfit'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('Presiona ENTER para jugar otra vez', canvas.width / 2, canvas.height / 2 + 55);
    }

    // HUD inferior
    ctx.fillStyle = '#fff'; ctx.font = '15px Outfit';
    ctx.textAlign = 'left'; ctx.fillText(`SCORE  ${String(score).padStart(6,'0')}`, 20, hudBaselineY());
    ctx.textAlign = 'center'; ctx.fillStyle = '#00ff41';
    ctx.fillText(`BREAKOUT  ·  NIVEL ${level}`, canvas.width/2, hudBaselineY());
    ctx.textAlign = 'right'; ctx.fillStyle = '#ff3333';
    ctx.fillText(`♥ ${Math.max(0, lives)}`, canvas.width-20, hudBaselineY());

    // Botón mute
    const muteX = canvas.width - 58, muteY = 8, muteW = 50, muteH = 22;
    ctx.fillStyle = soundEnabled ? 'rgba(0,255,65,0.15)' : 'rgba(255,80,80,0.2)';
    ctx.strokeStyle = soundEnabled ? '#00ff41' : '#ff5555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(muteX, muteY, muteW, muteH, 5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = soundEnabled ? '#00ff41' : '#ff5555';
    ctx.font = '13px Outfit'; ctx.textAlign = 'center';
    ctx.fillText(soundEnabled ? '🔊 ON' : '🔇 OFF', muteX + muteW/2, muteY + 15);
  }

  function onKeyDown(code) {
    if (gameOver) {
      if (code === 'Enter') init();
      return;
    }
    if (code === 'KeyM') {
      soundEnabled = !soundEnabled;
    }
  }

  function onClick(ex, ey) {
    const muteX = canvas.width - 58, muteY = 8, muteW = 50, muteH = 22;
    if (ex >= muteX && ex <= muteX+muteW && ey >= muteY && ey <= muteY+muteH) {
      soundEnabled = !soundEnabled;
      try { getACtx().resume(); } catch(e) {}
    }
  }

  init();
  return { update, draw, onKeyDown, onClick };
}


// ===== SNAKE =====
function createSnakeGame() {
  const COLS = 26;
  const ROWS = 18;

  let score = 0;
  let lives = 5;
  let level = 1;
  let gameOver = false;
  let lastScoreLifeThreshold = 0;

  // Rejilla de juego
  let snake = [];
  let dirX = 1, dirY = 0;
  let nextDirX = 1, nextDirY = 0;
  
  let appleX = 0, appleY = 0;
  let appleType = 'apple'; // 'apple' (20pts), 'banana' (30pts), 'cherry' (50pts), 'grapes' (80pts)
  let obstacles = []; // {x, y}

  // Corazón especial de vida extra (Muy raro, temporal)
  let heartActive = false;
  let heartX = -1, heartY = -1;
  let heartTimer = 0;
  let heartDuration = 0;

  // Tiempos
  let updateInterval = 140; // ms por tick (movimiento)
  let lastUpdateTime = 0;

  // Partículas de explosión
  let particles = [];

  // ── MOTOR DE AUDIO (Web Audio API) ──
  let audioCtx = null;
  let soundEnabled = true;

  function getACtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, type, duration, volume = 0.25) {
    if (!soundEnabled) return;
    try {
      const ctx = getACtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(); osc.stop(ctx.currentTime + duration);
    } catch(e) {}
  }

  function addScore(pts) {
    score += pts;
    const currentThreshold = Math.floor(score / 200);
    if (currentThreshold > lastScoreLifeThreshold) {
      const extra = currentThreshold - lastScoreLifeThreshold;
      lives += extra;
      lastScoreLifeThreshold = currentThreshold;
      playTone(880, 'sine', 0.15, 0.25);
    }
  }

  function spawnApple() {
    let valid = false;
    while (!valid) {
      appleX = Math.floor(Math.random() * COLS);
      appleY = Math.floor(Math.random() * ROWS);
      
      // Asegurar que no aparezca sobre la serpiente u obstáculos
      const onSnake = snake.some(segment => segment.x === appleX && segment.y === appleY);
      const onObstacle = obstacles.some(obs => obs.x === appleX && obs.y === appleY);
      if (!onSnake && !onObstacle) {
        valid = true;
      }
    }

    // Determinar tipo de fruta aleatoriamente con pesos de rareza
    const rand = Math.random();
    if (rand < 0.50) {
      appleType = 'apple'; // Manzana (50%)
    } else if (rand < 0.78) {
      appleType = 'banana'; // Plátano (28%)
    } else if (rand < 0.93) {
      appleType = 'cherry'; // Cereza (15%)
    } else {
      appleType = 'grapes'; // Uvas (7%)
    }

    // Spawn de corazón especial (Muy raro: 1.5% de probabilidad al cambiar de fruta, si no hay uno activo)
    if (!heartActive && Math.random() < 0.015) {
      let hValid = false;
      let hX = 0, hY = 0;
      let attempts = 0;
      while (!hValid && attempts < 100) {
        attempts++;
        hX = Math.floor(Math.random() * COLS);
        hY = Math.floor(Math.random() * ROWS);
        const onSnake = snake.some(s => s.x === hX && s.y === hY);
        const onObstacle = obstacles.some(o => o.x === hX && o.y === hY);
        const onApple = (hX === appleX && hY === appleY);
        if (!onSnake && !onObstacle && !onApple) {
          hValid = true;
        }
      }
      if (hValid) {
        heartX = hX;
        heartY = hY;
        heartActive = true;
        // Tiempo de vida aleatorio (entre 5 y 10 segundos = 300 a 600 frames)
        heartDuration = 300 + Math.floor(Math.random() * 300);
        heartTimer = heartDuration;
      }
    }
  }

  function initObstacles() {
    obstacles = [];
    // Spawnea más obstáculos fijos según el nivel actual
    const count = Math.min(15, (level - 1) * 2);
    for (let i = 0; i < count; i++) {
      let ox, oy, valid = false;
      while (!valid) {
        ox = Math.floor(Math.random() * COLS);
        oy = Math.floor(Math.random() * ROWS);
        
        // Evitar que aparezca cerca del punto de spawn inicial de la serpiente
        const tooCloseToCenter = Math.abs(ox - 5) < 4 && Math.abs(oy - 9) < 4;
        const onObstacle = obstacles.some(obs => obs.x === ox && obs.y === oy);
        if (!tooCloseToCenter && !onObstacle) {
          valid = true;
        }
      }
      obstacles.push({ x: ox, y: oy });
    }
  }

  function init() {
    score = 0;
    lives = 5;
    level = 1;
    gameOver = false;
    lastScoreLifeThreshold = 0;
    dirX = 1; dirY = 0;
    nextDirX = 1; nextDirY = 0;
    updateInterval = 140;
    heartActive = false;

    // Serpiente inicial con 3 segmentos en la zona central
    snake = [
      { x: 5, y: 9 },
      { x: 4, y: 9 },
      { x: 3, y: 9 }
    ];

    initObstacles();
    spawnApple();
    lastUpdateTime = performance.now();
    playTone(523, 'sine', 0.15, 0.15);
  }

  function nextLevel() {
    level++;
    lives += 2; // +2 vidas por pasar de tanda/nivel
    updateInterval = Math.max(50, 140 - level * 10); // Aumentar velocidad
    playTone(1047, 'sine', 0.25, 0.25);
    heartActive = false;
    
    // Resetear posición de serpiente sin perder score
    snake = [
      { x: 5, y: 9 },
      { x: 4, y: 9 },
      { x: 3, y: 9 }
    ];
    dirX = 1; dirY = 0;
    nextDirX = 1; nextDirY = 0;
    initObstacles();
    spawnApple();
  }

  function update() {
    // Actualizar partículas independientemente del tick de la serpiente
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
    });
    particles = particles.filter(p => p.life > 0);

    // Actualizar temporizador de corazón temporal si está activo
    if (heartActive) {
      heartTimer--;
      if (heartTimer <= 0) {
        heartActive = false;
        heartX = -1;
        heartY = -1;
      }
    }

    if (gameOver) return;

    const currentTime = performance.now();
    if (currentTime - lastUpdateTime >= updateInterval) {
      lastUpdateTime = currentTime;
      tickMove();
    }
  }

  function tickMove() {
    dirX = nextDirX;
    dirY = nextDirY;

    // Calcular nueva cabeza
    const head = { x: snake[0].x + dirX, y: snake[0].y + dirY };

    // Colisión con paredes
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      triggerDeath();
      return;
    }

    // Colisión con sí misma
    const selfCollide = snake.some(segment => segment.x === head.x && segment.y === head.y);
    if (selfCollide) {
      triggerDeath();
      return;
    }

    // Colisión con obstáculos
    const obstacleCollide = obstacles.some(obs => obs.x === head.x && obs.y === head.y);
    if (obstacleCollide) {
      triggerDeath();
      return;
    }

    // Insertar nueva cabeza
    snake.unshift(head);

    // Colisión con fruta o corazón
    let ateSomething = false;
    if (head.x === appleX && head.y === appleY) {
      ateSomething = true;
      let pts = 20;
      let toneFreq = 660;
      if (appleType === 'banana') {
        pts = 30;
        toneFreq = 700;
      } else if (appleType === 'cherry') {
        pts = 50;
        toneFreq = 780;
      } else if (appleType === 'grapes') {
        pts = 80;
        toneFreq = 880;
      }

      addScore(pts);
      playTone(toneFreq, 'sine', 0.12, 0.22);
      spawnApple();
      
      // Subir de nivel al comer 5 manzanas (100 puntos por nivel)
      if (score > 0 && score % 100 === 0) {
        nextLevel();
      }
    }

    // Colisión con corazón especial
    if (heartActive && head.x === heartX && head.y === heartY) {
      ateSomething = true;
      lives++;
      heartActive = false;
      heartX = -1;
      heartY = -1;
      playTone(1047, 'sine', 0.35, 0.3); // Sonido triunfal de vida extra
    }

    if (!ateSomething) {
      // Remover cola para emular movimiento si no comió nada
      snake.pop();
    }
  }

  function triggerDeath() {
    // Generar partículas de explosión en la posición de la cabeza
    const cellSz = Math.floor(Math.min((canvas.width * 0.92) / COLS, ((canvas.height - 110) * 0.92) / ROWS));
    const boardW = COLS * cellSz;
    const boardH = ROWS * cellSz;
    const startX = Math.floor((canvas.width - boardW) / 2);
    const startY = 40 + Math.floor(((canvas.height - 110) - boardH) / 2);
    
    const headX = startX + snake[0].x * cellSz + cellSz / 2;
    const headY = startY + snake[0].y * cellSz + cellSz / 2;
    
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4;
      particles.push({
        x: headX,
        y: headY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 15 + Math.random() * 15,
        color: '#ff4757'
      });
    }

    lives--;
    playTone(150, 'sawtooth', 0.4, 0.25);
    if (lives <= 0) {
      gameOver = true;
      playTone(90, 'sawtooth', 0.8, 0.3);
    } else {
      // Re-iniciar serpiente en la zona central
      snake = [
        { x: 5, y: 9 },
        { x: 4, y: 9 },
        { x: 3, y: 9 }
      ];
      dirX = 1; dirY = 0;
      nextDirX = 1; nextDirY = 0;
      spawnApple();
    }
  }

  function draw() {
    // Fondo retro
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calcular medidas del tablero optimizadas para mayor tamaño dinámico
    const maxBoardW = canvas.width * 0.92;
    const maxBoardH = (canvas.height - 110) * 0.92;
    
    // El tamaño de la celda es el mínimo espacio para que quepan las columnas y filas
    const cellSz = Math.floor(Math.min(maxBoardW / COLS, maxBoardH / ROWS));
    
    const boardW = COLS * cellSz;
    const boardH = ROWS * cellSz;
    const startX = Math.floor((canvas.width - boardW) / 2);
    const startY = 40 + Math.floor(((canvas.height - 110) - boardH) / 2);

    // Dibujar partículas activas
    particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 3, 3);
    });

    // Fondo del tablero de juego
    ctx.fillStyle = 'rgba(255,255,255,0.015)';
    ctx.fillRect(startX, startY, boardW, boardH);

    // Rejilla de juego sutil
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(startX + c * cellSz, startY);
      ctx.lineTo(startX + c * cellSz, startY + boardH);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(startX, startY + r * cellSz);
      ctx.lineTo(startX + boardW, startY + r * cellSz);
      ctx.stroke();
    }

    // Borde del tablero (igual color que los obstáculos y sus bordes)
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 4; // Borde más grueso
    ctx.strokeRect(startX - 2, startY - 2, boardW + 4, boardH + 4);
    
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(startX - 1, startY - 1, boardW + 2, boardH + 2);

    // Dibujar obstáculos
    ctx.fillStyle = '#4b5563';
    obstacles.forEach(obs => {
      ctx.fillRect(startX + obs.x * cellSz + 2, startY + obs.y * cellSz + 2, cellSz - 4, cellSz - 4);
      ctx.strokeStyle = '#9ca3af';
      ctx.strokeRect(startX + obs.x * cellSz + 2, startY + obs.y * cellSz + 2, cellSz - 4, cellSz - 4);
    });

    // Dibujar fruta según el tipo
    const ax = startX + appleX * cellSz + cellSz / 2;
    const ay = startY + appleY * cellSz + cellSz / 2;
    const r = cellSz / 2 - 2;

    if (appleType === 'apple') {
      // --- MANZANA ---
      ctx.fillStyle = '#ff3838';
      ctx.beginPath();
      ctx.arc(ax - r*0.15, ay + r*0.08, r*0.9, 0, Math.PI * 2);
      ctx.arc(ax + r*0.15, ay + r*0.08, r*0.9, 0, Math.PI * 2);
      ctx.fill();

      // Tallo (marrón)
      ctx.strokeStyle = '#8b5a2b';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(ax, ay - r*0.7);
      ctx.quadraticCurveTo(ax + r*0.25, ay - r*1.1, ax + r*0.3, ay - r*1.2);
      ctx.stroke();

      // Hoja (verde)
      ctx.fillStyle = '#2ed573';
      ctx.beginPath();
      ctx.ellipse(ax + r*0.28, ay - r*1.05, r*0.35, r*0.18, Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();

      // Brillo blanco
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(ax - r*0.32, ay - r*0.32, r*0.22, 0, Math.PI * 2);
      ctx.fill();

    } else if (appleType === 'banana') {
      // --- PLÁTANO ---
      ctx.strokeStyle = '#ffa502';
      ctx.lineWidth = r * 0.45;
      ctx.lineCap = 'round';
      
      ctx.beginPath();
      // Curva arqueada de plátano
      ctx.arc(ax - r*0.3, ay - r*0.3, r * 0.95, 0.1 * Math.PI, 0.65 * Math.PI, false);
      ctx.stroke();
      
      // Punta marrón
      ctx.fillStyle = '#5c4033';
      ctx.beginPath();
      ctx.arc(ax + r*0.62, ay + r*0.48, r*0.18, 0, Math.PI * 2);
      ctx.fill();

    } else if (appleType === 'cherry') {
      // --- CEREZAS (Par de cerezas) ---
      // Tallos unidos
      ctx.strokeStyle = '#2ed573';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay - r*0.7);
      ctx.lineTo(ax - r*0.4, ay + r*0.2);
      ctx.moveTo(ax, ay - r*0.7);
      ctx.lineTo(ax + r*0.4, ay + r*0.2);
      ctx.stroke();

      // Cereza 1 (Izquierda)
      ctx.fillStyle = '#ff2b2b';
      ctx.beginPath();
      ctx.arc(ax - r*0.4, ay + r*0.3, r*0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(ax - r*0.5, ay + r*0.2, r*0.12, 0, Math.PI * 2);
      ctx.fill();

      // Cereza 2 (Derecha)
      ctx.fillStyle = '#d63031';
      ctx.beginPath();
      ctx.arc(ax + r*0.4, ay + r*0.3, r*0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(ax + r*0.3, ay + r*0.2, r*0.12, 0, Math.PI * 2);
      ctx.fill();

    } else if (appleType === 'grapes') {
      // --- UVAS (Racimo de círculos morados) ---
      ctx.fillStyle = '#9b59b6';
      
      // Circulitos simulando racimo
      ctx.beginPath();
      ctx.arc(ax, ay - r*0.3, r*0.35, 0, Math.PI * 2);
      ctx.arc(ax - r*0.35, ay, r*0.35, 0, Math.PI * 2);
      ctx.arc(ax + r*0.35, ay, r*0.35, 0, Math.PI * 2);
      ctx.arc(ax, ay + r*0.35, r*0.35, 0, Math.PI * 2);
      ctx.fill();

      // Tallo
      ctx.strokeStyle = '#27ae60';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(ax, ay - r*0.3);
      ctx.quadraticCurveTo(ax - r*0.2, ay - r*0.8, ax - r*0.1, ay - r*0.95);
    }

    // Dibujar Corazón especial si está activo (independiente de la fruta)
    if (heartActive) {
      const hx = startX + heartX * cellSz + cellSz / 2;
      const hy = startY + heartY * cellSz + cellSz / 2;
      const hr = cellSz / 2 - 2;

      // Dibujar forma de corazón usando curvas Bézier
      ctx.fillStyle = '#ff2b2b';
      
      // Añadir sutil efecto de parpadeo/pulsación si le queda menos de 2 segundos (120 frames)
      if (heartTimer > 120 || Math.floor(heartTimer / 10) % 2 === 0) {
        ctx.beginPath();
        ctx.moveTo(hx, hy + hr * 0.4);
        // Lado izquierdo del corazón
        ctx.bezierCurveTo(hx - hr * 0.8, hy - hr * 0.7, hx - hr * 1.2, hy + hr * 0.1, hx, hy + hr * 1.0);
        // Lado derecho del corazón
        ctx.bezierCurveTo(hx + hr * 1.2, hy + hr * 0.1, hx + hr * 0.8, hy - hr * 0.7, hx, hy + hr * 0.4);
        ctx.fill();
        
        // Brillo blanco en el corazón
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(hx - hr * 0.3, hy - hr * 0.2, hr * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Dibujar Serpiente
    snake.forEach((segment, idx) => {
      const cx = startX + segment.x * cellSz;
      const cy = startY + segment.y * cellSz;

      if (idx === 0) {
        // --- CABEZA ---
        ctx.fillStyle = '#2ed573';
        ctx.shadowBlur = 4;
        ctx.shadowColor = '#2ed573';
        
        ctx.beginPath();
        // Redondear el frente de la cabeza según la dirección de movimiento
        if (dirX === 1) { // Derecha
          ctx.roundRect(cx + 1, cy + 1, cellSz - 2, cellSz - 2, [0, cellSz/2, cellSz/2, 0]);
        } else if (dirX === -1) { // Izquierda
          ctx.roundRect(cx + 1, cy + 1, cellSz - 2, cellSz - 2, [cellSz/2, 0, 0, cellSz/2]);
        } else if (dirY === 1) { // Abajo
          ctx.roundRect(cx + 1, cy + 1, cellSz - 2, cellSz - 2, [0, 0, cellSz/2, cellSz/2]);
        } else if (dirY === -1) { // Arriba
          ctx.roundRect(cx + 1, cy + 1, cellSz - 2, cellSz - 2, [cellSz/2, cellSz/2, 0, 0]);
        } else {
          ctx.rect(cx + 1, cy + 1, cellSz - 2, cellSz - 2);
        }
        ctx.fill();
        ctx.shadowBlur = 0; // reset

        // Ojos detallados (Base blanca + Pupila negra)
        let eye1X = cx + cellSz/2, eye1Y = cy + cellSz/2;
        let eye2X = cx + cellSz/2, eye2Y = cy + cellSz/2;
        
        if (dirX !== 0) {
          eye1X = cx + cellSz * 0.65 * (dirX === 1 ? 1 : 0.5);
          eye1Y = cy + cellSz * 0.28;
          eye2X = cx + cellSz * 0.65 * (dirX === 1 ? 1 : 0.5);
          eye2Y = cy + cellSz * 0.72;
        } else if (dirY !== 0) {
          eye1X = cx + cellSz * 0.28;
          eye1Y = cy + cellSz * 0.65 * (dirY === 1 ? 1 : 0.5);
          eye2X = cx + cellSz * 0.72;
          eye2Y = cy + cellSz * 0.65 * (dirY === 1 ? 1 : 0.5);
        }

        // Dibujar globos oculares (Blancos)
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(eye1X, eye1Y, cellSz * 0.16, 0, Math.PI * 2);
        ctx.arc(eye2X, eye2Y, cellSz * 0.16, 0, Math.PI * 2);
        ctx.fill();

        // Dibujar pupilas (Negras)
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(eye1X + (dirX * 0.8), eye1Y + (dirY * 0.8), cellSz * 0.08, 0, Math.PI * 2);
        ctx.arc(eye2X + (dirX * 0.8), eye2Y + (dirY * 0.8), cellSz * 0.08, 0, Math.PI * 2);
        ctx.fill();

      } else if (idx === snake.length - 1) {
        // --- COLA ---
        ctx.fillStyle = '#1e824c';
        ctx.beginPath();
        // Dibujar cola en disminución y punta redondeada
        const shrink = cellSz * 0.35;
        ctx.arc(cx + cellSz/2, cy + cellSz/2, (cellSz - shrink)/2, 0, Math.PI * 2);
        ctx.fill();
        
      } else {
        // --- CUERPO ---
        // Disminución progresiva del grosor del cuerpo hacia la cola
        const progress = idx / snake.length; // 0 a 1
        const shrink = cellSz * 0.2 * progress;
        
        ctx.fillStyle = '#1e824c';
        ctx.beginPath();
        ctx.roundRect(cx + 1 + shrink/2, cy + 1 + shrink/2, cellSz - 2 - shrink, cellSz - 2 - shrink, 4);
        ctx.fill();
      }
    });

    // Pantalla de Game Over
    if (gameOver) {
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.min(50, canvas.width/13)}px Outfit`;
      ctx.fillStyle = '#ff3333';
      ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20);
      ctx.font = '18px Outfit'; ctx.fillStyle = '#fff';
      ctx.fillText(`Puntuación final: ${score}`, canvas.width / 2, canvas.height / 2 + 20);
      ctx.font = '12px Outfit'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('Presiona ENTER para jugar otra vez', canvas.width / 2, canvas.height / 2 + 55);
    }

    // HUD inferior
    ctx.fillStyle = '#fff'; ctx.font = '15px Outfit';
    ctx.textAlign = 'left'; ctx.fillText(`SCORE  ${String(score).padStart(6,'0')}`, 20, hudBaselineY());
    ctx.textAlign = 'center'; ctx.fillStyle = '#2ed573';
    ctx.fillText(`SNAKE  ·  NIVEL ${level}`, canvas.width/2, hudBaselineY());
    ctx.textAlign = 'right'; ctx.fillStyle = '#ff3333';
    ctx.fillText(`♥ ${Math.max(0, lives)}`, canvas.width-20, hudBaselineY());

    // Botón mute
    const muteX = canvas.width - 58, muteY = 8, muteW = 50, muteH = 22;
    ctx.fillStyle = soundEnabled ? 'rgba(46,213,115,0.15)' : 'rgba(255,80,80,0.2)';
    ctx.strokeStyle = soundEnabled ? '#2ed573' : '#ff5555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(muteX, muteY, muteW, muteH, 5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = soundEnabled ? '#2ed573' : '#ff5555';
    ctx.font = '13px Outfit'; ctx.textAlign = 'center';
    ctx.fillText(soundEnabled ? '🔊 ON' : '🔇 OFF', muteX + muteW/2, muteY + 15);
  }

  function onKeyDown(code) {
    if (gameOver) {
      if (code === 'Enter') init();
      return;
    }
    // Evitar reversa directa de 180 grados
    if ((code === 'ArrowLeft' || code === 'KeyA') && dirX === 0) {
      nextDirX = -1; nextDirY = 0;
      playTone(180, 'triangle', 0.04, 0.08);
    } else if ((code === 'ArrowRight' || code === 'KeyD') && dirX === 0) {
      nextDirX = 1; nextDirY = 0;
      playTone(180, 'triangle', 0.04, 0.08);
    } else if ((code === 'ArrowUp' || code === 'KeyW') && dirY === 0) {
      nextDirX = 0; nextDirY = -1;
      playTone(180, 'triangle', 0.04, 0.08);
    } else if ((code === 'ArrowDown' || code === 'KeyS') && dirY === 0) {
      nextDirX = 0; nextDirY = 1;
      playTone(180, 'triangle', 0.04, 0.08);
    } else if (code === 'KeyM') {
      soundEnabled = !soundEnabled;
    }
  }

  function onClick(ex, ey) {
    const muteX = canvas.width - 58, muteY = 8, muteW = 50, muteH = 22;
    if (ex >= muteX && ex <= muteX+muteW && ey >= muteY && ey <= muteY+muteH) {
      soundEnabled = !soundEnabled;
      try { getACtx().resume(); } catch(e) {}
    }
  }

  init();
  return { update, draw, onKeyDown, onClick };
}


// ===== FLAPPY BIRD =====
function createFlappyGame() {
  let score = 0;
  let lives = 5;
  let level = 1;
  let gameOver = false;
  let lastScoreLifeThreshold = 0;

  // Parámetros del pájaro
  let birdY = 0;
  let birdVY = 0;
  const birdX = 120;
  const birdRadius = 14;
  const gravity = 0.35;
  const jumpStrength = -6.2;

  // Tuberías
  let pipes = [];
  let pipeSpeed = 2.8;
  let pipeSpawnTimer = 0;
  let gapHeight = 135; // Espacio libre vertical entre tuberías
  const pipeWidth = 60;

  // Nubes de fondo decorativas
  let clouds = [];

  // Tiempo de gracia/planeo al inicio (2 segundos a 60fps = 120 frames)
  let graceTimer = 120;

  // ── MOTOR DE AUDIO (Web Audio API) ──
  let audioCtx = null;
  let soundEnabled = true;

  function getACtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, type, duration, volume = 0.25) {
    if (!soundEnabled) return;
    try {
      const ctx = getACtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(); osc.stop(ctx.currentTime + duration);
    } catch(e) {}
  }

  function addScore(pts) {
    score += pts;
    const currentThreshold = Math.floor(score / 50);
    if (currentThreshold > lastScoreLifeThreshold) {
      const extra = currentThreshold - lastScoreLifeThreshold;
      lives += extra;
      lastScoreLifeThreshold = currentThreshold;
      playTone(880, 'sine', 0.15, 0.25);
    }
  }

  function spawnPipe() {
    // Generar tuberías con alturas coherentes
    const minH = 60;
    const maxH = canvas.height - 200 - gapHeight;
    const topHeight = minH + Math.floor(Math.random() * (maxH - minH));
    
    pipes.push({
      x: canvas.width,
      topHeight,
      bottomY: topHeight + gapHeight,
      passed: false
    });
  }

  function init() {
    score = 0;
    lives = 5;
    level = 1;
    gameOver = false;
    lastScoreLifeThreshold = 0;
    birdY = canvas.height / 2;
    birdVY = 0;
    pipeSpeed = 2.8;
    gapHeight = 135;
    pipes = [];
    pipeSpawnTimer = 0;
    graceTimer = 120; // 2 segundos de planeo inicial

    // Inicializar 4 nubes a lo largo de la pantalla
    clouds = [];
    for (let i = 0; i < 4; i++) {
      clouds.push({
        x: Math.random() * canvas.width,
        y: 80 + Math.random() * 150,
        speed: 0.3 + Math.random() * 0.4,
        scale: 0.6 + Math.random() * 0.6
      });
    }
    
    spawnPipe();
    playTone(523, 'sine', 0.2, 0.15);
  }

  function nextLevel() {
    level++;
    lives += 2; // +2 vidas por pasar de tanda/nivel
    pipeSpeed = Math.min(6.0, 2.8 + level * 0.4); // Velocidad lateral incremental
    gapHeight = Math.max(95, 135 - level * 6); // Reducir brecha vertical progresivamente
    playTone(1047, 'sine', 0.3, 0.25);
    
    // Limpiar tuberías para transición limpia
    pipes = [];
    pipeSpawnTimer = 0;
    spawnPipe();
  }

  function update() {
    // Mover nubes de fondo (incluso si el juego terminó para darle vida visual)
    clouds.forEach(c => {
      c.x -= c.speed;
      if (c.x + 80 * c.scale < 0) {
        c.x = canvas.width + 20;
        c.y = 80 + Math.random() * 150;
        c.speed = 0.3 + Math.random() * 0.4;
        c.scale = 0.6 + Math.random() * 0.6;
      }
    });

    if (gameOver) return;

    // Disminuir graceTimer si está activo
    if (graceTimer > 0) {
      graceTimer--;
      // El pájaro planea sutilmente arriba y abajo (efecto hover sin caer)
      birdY = canvas.height / 2 + Math.sin(performance.now() * 0.007) * 5;
      return; // No procesar caídas ni avance de tuberías durante planeo inicial
    }

    // Físicas del pájaro
    birdVY += gravity;
    birdY += birdVY;

    // Limites de pantalla (techo y suelo)
    if (birdY - birdRadius <= 50) {
      birdY = 50 + birdRadius;
      birdVY = 0;
    }
    if (birdY + birdRadius >= canvas.height - 50) {
      triggerDeath();
      return;
    }

    // Mover y procesar tuberías
    pipeSpawnTimer++;
    // Frecuencia de aparición de tuberías según velocidad
    const spawnRate = Math.max(80, Math.floor(280 / pipeSpeed));
    if (pipeSpawnTimer >= spawnRate) {
      pipeSpawnTimer = 0;
      spawnPipe();
    }

    for (let i = 0; i < pipes.length; i++) {
      const p = pipes[i];
      p.x -= pipeSpeed;

      // Detección de colisión (caja delimitadora simplificada para el pájaro)
      if (birdX + birdRadius > p.x && 
          birdX - birdRadius < p.x + pipeWidth) {
        if (birdY - birdRadius < p.topHeight || birdY + birdRadius > p.bottomY) {
          triggerDeath();
          return;
        }
      }

      // Sumar puntuación al esquivar
      if (!p.passed && p.x + pipeWidth < birdX) {
        p.passed = true;
        addScore(20);
        playTone(587, 'sine', 0.08, 0.15);

        // Cada 5 tuberías superadas (100 puntos), pasar de tanda/nivel
        if (score > 0 && score % 100 === 0) {
          nextLevel();
        }
      }
    }

    // Filtrar tuberías fuera de pantalla
    pipes = pipes.filter(p => p.x + pipeWidth > -50);
  }

  function triggerDeath() {
    lives--;
    playTone(150, 'sawtooth', 0.4, 0.25);
    if (lives <= 0) {
      gameOver = true;
      playTone(90, 'sawtooth', 0.8, 0.3);
    } else {
      // Reposicionar pájaro y limpiar tuberías del tramo actual
      birdY = canvas.height / 2;
      birdVY = 0;
      pipes = [];
      pipeSpawnTimer = 0;
      spawnPipe();
    }
  }

  function draw() {
    // Fondo cielo retro claro
    ctx.fillStyle = '#74b9ff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dibujar nubes decorativas de fondo
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    clouds.forEach(c => {
      const s = c.scale;
      ctx.beginPath();
      // Dibujar una nube estilizada con 3 círculos superpuestos y base plana
      ctx.arc(c.x, c.y, 16 * s, 0, Math.PI * 2);
      ctx.arc(c.x + 14 * s, c.y - 10 * s, 20 * s, 0, Math.PI * 2);
      ctx.arc(c.x + 32 * s, c.y, 16 * s, 0, Math.PI * 2);
      ctx.rect(c.x, c.y - 4 * s, 32 * s, 20 * s);
      ctx.fill();
    });

    // Dibujar obstáculos naturales (Troncos y ramas de árboles más estilizados y orgánicos)
    pipes.forEach(p => {
      // ── RAMA SUPERIOR (Cuelga hacia abajo desde la orilla superior) ──
      const topYStart = 0;
      const topHeight = p.topHeight;

      // Dibujar rama curva orgánica (delgada en la punta, más ancha en la base)
      ctx.strokeStyle = '#a0522d';
      ctx.lineWidth = 14; // Más delgado que el fillRect original (60px) para que parezca una rama real
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x + pipeWidth/2, topYStart);
      // Ligera curva hacia la izquierda o derecha según la posición
      ctx.quadraticCurveTo(p.x + pipeWidth/2 - 8, topHeight * 0.5, p.x + pipeWidth/2 - 2, topHeight - 12);
      ctx.stroke();

      // Detalles de textura de madera internos
      ctx.strokeStyle = '#5c2d16';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(p.x + pipeWidth/2 - 2, topYStart);
      ctx.quadraticCurveTo(p.x + pipeWidth/2 - 9, topHeight * 0.5, p.x + pipeWidth/2 - 3, topHeight - 16);
      ctx.stroke();

      // Pequeñas hojas brotando a los costados del palo de la rama superior
      ctx.fillStyle = '#2ecc71';
      if (topHeight > 80) {
        ctx.beginPath();
        // Hoja izquierda alta
        ctx.ellipse(p.x + pipeWidth/2 - 18, topYStart + topHeight * 0.35, 10, 5, -Math.PI / 6, 0, Math.PI * 2);
        // Hoja derecha media
        ctx.ellipse(p.x + pipeWidth/2 + 18, topYStart + topHeight * 0.65, 10, 5, Math.PI / 6, 0, Math.PI * 2);
        ctx.fill();
        
        // Ramitas de las hojas
        ctx.strokeStyle = '#a0522d';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(p.x + pipeWidth/2 - 4, topYStart + topHeight * 0.35);
        ctx.quadraticCurveTo(p.x + pipeWidth/2 - 12, topYStart + topHeight * 0.37, p.x + pipeWidth/2 - 14, topYStart + topHeight * 0.35);
        ctx.moveTo(p.x + pipeWidth/2 + 4, topYStart + topHeight * 0.65);
        ctx.quadraticCurveTo(p.x + pipeWidth/2 + 12, topYStart + topHeight * 0.63, p.x + pipeWidth/2 + 14, topYStart + topHeight * 0.65);
        ctx.stroke();
      }

      // Follaje / Hojas en la punta de la rama superior
      ctx.fillStyle = '#27ae60';
      ctx.beginPath();
      ctx.ellipse(p.x + pipeWidth/2 - 2, p.topHeight - 2, 28, 14, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x + pipeWidth/2 - 12, p.topHeight - 8, 16, 10, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x + pipeWidth/2 + 8, p.topHeight - 8, 16, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // Detalles claros en las hojas
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      ctx.ellipse(p.x + pipeWidth/2 - 8, p.topHeight - 4, 8, 4, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x + pipeWidth/2 + 4, p.topHeight - 4, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();

      // ── ÁRBOL INFERIOR (Crece desde abajo) ──
      const bottomHeight = canvas.height - p.bottomY;

      // Dibujar tronco curva orgánica
      ctx.strokeStyle = '#a0522d';
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x + pipeWidth/2, canvas.height);
      ctx.quadraticCurveTo(p.x + pipeWidth/2 + 8, p.bottomY + bottomHeight * 0.5, p.x + pipeWidth/2 + 2, p.bottomY + 12);
      ctx.stroke();

      // Detalles de textura de madera internos
      ctx.strokeStyle = '#5c2d16';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(p.x + pipeWidth/2 + 2, canvas.height);
      ctx.quadraticCurveTo(p.x + pipeWidth/2 + 9, p.bottomY + bottomHeight * 0.5, p.x + pipeWidth/2 + 3, p.bottomY + 16);
      ctx.stroke();

      // Pequeñas hojas brotando a los costados del tronco inferior
      ctx.fillStyle = '#2ecc71';
      if (bottomHeight > 80) {
        ctx.beginPath();
        // Hoja derecha alta
        ctx.ellipse(p.x + pipeWidth/2 + 18, p.bottomY + bottomHeight * 0.35, 10, 5, -Math.PI / 6, 0, Math.PI * 2);
        // Hoja izquierda baja
        ctx.ellipse(p.x + pipeWidth/2 - 18, p.bottomY + bottomHeight * 0.65, 10, 5, Math.PI / 6, 0, Math.PI * 2);
        ctx.fill();
        
        // Ramitas de las hojas
        ctx.strokeStyle = '#a0522d';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(p.x + pipeWidth/2 + 4, p.bottomY + bottomHeight * 0.35);
        ctx.quadraticCurveTo(p.x + pipeWidth/2 + 12, p.bottomY + bottomHeight * 0.37, p.x + pipeWidth/2 + 14, p.bottomY + bottomHeight * 0.35);
        ctx.moveTo(p.x + pipeWidth/2 - 4, p.bottomY + bottomHeight * 0.65);
        ctx.quadraticCurveTo(p.x + pipeWidth/2 - 12, p.bottomY + bottomHeight * 0.63, p.x + pipeWidth/2 - 14, p.bottomY + bottomHeight * 0.65);
        ctx.stroke();
      }

      // Follaje / Hojas en la punta superior del árbol inferior
      ctx.fillStyle = '#27ae60';
      ctx.beginPath();
      ctx.ellipse(p.x + pipeWidth/2, p.bottomY, 35, 18, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x + pipeWidth/2 - 15, p.bottomY + 12, 22, 14, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x + pipeWidth/2 + 15, p.bottomY + 12, 22, 14, 0, 0, Math.PI * 2);
      ctx.fill();

      // Detalles claros en las hojas
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      ctx.ellipse(p.x + pipeWidth/2 - 8, p.bottomY + 4, 10, 5, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x + pipeWidth/2 + 10, p.bottomY + 2, 8, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // Dibujar pájaro (Flappy) con aspecto estilizado y ovalado (menos redondo)
    ctx.save();
    ctx.translate(birdX, birdY);
    
    // Rotar levemente según velocidad vertical
    const angle = Math.min(Math.PI / 4, Math.max(-Math.PI / 7, birdVY * 0.08));
    ctx.rotate(angle);

    // Cuerpo elíptico (menos redondo)
    ctx.fillStyle = '#ffd32a';
    ctx.beginPath();
    ctx.ellipse(0, 0, birdRadius * 1.25, birdRadius * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d6a000';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Cola (plumas traseras)
    ctx.fillStyle = '#ff7675';
    ctx.beginPath();
    ctx.moveTo(-birdRadius * 1.2, -birdRadius * 0.3);
    ctx.lineTo(-birdRadius * 1.7, -birdRadius * 0.6);
    ctx.lineTo(-birdRadius * 1.6, birdRadius * 0.1);
    ctx.lineTo(-birdRadius * 1.7, birdRadius * 0.6);
    ctx.lineTo(-birdRadius * 1.1, birdRadius * 0.3);
    ctx.fill();

    // Ala blanca
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(-8, 2, 7, 5, Math.PI / 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Ojo y pupila
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(6, -5, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(7.2, -5, 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Pico naranja
    ctx.fillStyle = '#ff9f43';
    ctx.beginPath();
    ctx.moveTo(13, -3);
    ctx.lineTo(24, 0);
    ctx.lineTo(13, 3);
    ctx.fill();

    ctx.restore();

    // Pantalla de Game Over
    if (gameOver) {
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.min(50, canvas.width/13)}px Outfit`;
      ctx.fillStyle = '#ff3333';
      ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20);
      ctx.font = '18px Outfit'; ctx.fillStyle = '#fff';
      ctx.fillText(`Puntuación final: ${score}`, canvas.width / 2, canvas.height / 2 + 20);
      ctx.font = '12px Outfit'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('Presiona ESPACIO o ENTER para saltar/reiniciar', canvas.width / 2, canvas.height / 2 + 55);
    }

    // HUD inferior
    ctx.fillStyle = '#fff'; ctx.font = '15px Outfit';
    ctx.textAlign = 'left'; ctx.fillText(`SCORE  ${String(score).padStart(6,'0')}`, 20, hudBaselineY());
    ctx.textAlign = 'center'; ctx.fillStyle = '#ffd32a';
    ctx.fillText(`FLAPPY BIRD  ·  TANDA ${level}`, canvas.width/2, hudBaselineY());
    ctx.textAlign = 'right'; ctx.fillStyle = '#ff3333';
    ctx.fillText(`♥ ${Math.max(0, lives)}`, canvas.width-20, hudBaselineY());

    // Botón mute
    const muteX = canvas.width - 58, muteY = 8, muteW = 50, muteH = 22;
    ctx.fillStyle = soundEnabled ? 'rgba(255,211,42,0.15)' : 'rgba(255,80,80,0.2)';
    ctx.strokeStyle = soundEnabled ? '#ffd32a' : '#ff5555';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(muteX, muteY, muteW, muteH, 5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = soundEnabled ? '#ffd32a' : '#ff5555';
    ctx.font = '13px Outfit'; ctx.textAlign = 'center';
    ctx.fillText(soundEnabled ? '🔊 ON' : '🔇 OFF', muteX + muteW/2, muteY + 15);
  }

  function onKeyDown(code) {
    if (gameOver) {
      if (code === 'Enter' || code === 'Space') init();
      return;
    }
    // Impulso del pájaro (salto) con ESPACIO, flecha arriba o W
    if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') {
      graceTimer = 0; // Cancelar tiempo de gracia al saltar
      birdVY = jumpStrength;
      playTone(400, 'sine', 0.05, 0.12); // Tono de salto
    } else if (code === 'KeyM') {
      soundEnabled = !soundEnabled;
    }
  }

  function onClick(ex, ey) {
    const muteX = canvas.width - 58, muteY = 8, muteW = 50, muteH = 22;
    if (ex >= muteX && ex <= muteX+muteW && ey >= muteY && ey <= muteY+muteH) {
      soundEnabled = !soundEnabled;
      try { getACtx().resume(); } catch(e) {}
      return;
    }

    if (!gameOver) {
      // Un clic/tap en pantalla también provoca impulso de vuelo
      graceTimer = 0; // Cancelar tiempo de gracia al saltar
      birdVY = jumpStrength;
      playTone(400, 'sine', 0.05, 0.12);
    }
  }

  init();
  return { update, draw, onKeyDown, onClick };
}

// ===== COMMS =====
function deskioAction(a)  { console.log('MERKE_ACTION:' + a); }
function deskioNavigate(u){ console.log('MERKE_NAVIGATE:' + u); }


// ===== EVENT LISTENERS PARA CUMPLIR CON CSP DE MANIFEST V3 =====
document.addEventListener('DOMContentLoaded', () => {
  // Desordenar aleatoriamente las tarjetas de juego en el contenedor
  const container = document.querySelector('.game-cards');
  if (container) {
    const cards = Array.from(container.children);
    // Mezcla aleatoria de Fisher-Yates
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      container.appendChild(cards[j]); // Mover elemento al final reordena el DOM
    }
  }

  // Botón Salir
  const exitBtn = document.getElementById('exit-btn');
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      window.close();
    });
  }

  // Botón Volver
  const backBtn = document.getElementById('back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      backToSelector();
    });
  }

  // Tarjetas de juego
  const gameCards = document.querySelectorAll('.game-card');
  gameCards.forEach(card => {
    card.addEventListener('click', () => {
      const gameType = card.getAttribute('data-game');
      if (gameType) {
        startGame(gameType);
      }
    });
  });

  // Modal Acerca de
  const aboutBtn = document.getElementById('mkarcade-about-modal-open-btn');
  const aboutModal = document.getElementById('mkarcade-about-modal');
  const aboutCloseBtn = document.getElementById('mkarcade-about-modal-close-btn');
  const aboutLink = document.getElementById('mkarcade-about-modal-link');

  if (aboutBtn && aboutModal) {
    aboutBtn.addEventListener('click', () => {
      aboutModal.style.display = 'flex';
    });
  }
  if (aboutModal) {
    aboutModal.addEventListener('click', (e) => {
      if (e.target === aboutModal) aboutModal.style.display = 'none';
    });
  }
  if (aboutCloseBtn && aboutModal) {
    aboutCloseBtn.addEventListener('click', () => {
      aboutModal.style.display = 'none';
    });
  }
  if (aboutLink) {
    aboutLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://ext.merke.net', '_blank');
    });
  }
});
