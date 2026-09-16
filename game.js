(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const VIEW_W = 960;
  const VIEW_H = 480;
  const TILE = 32;
  const ROWS = 15;
  const COLS = 220;
  const LEVEL_W = COLS * TILE;
  const GROUND_Y = 13 * TILE;
  const GRAVITY = 2200;

  const EMPTY = 0;
  const GROUND = 1;
  const BRICK = 2;
  const QUESTION_COIN = 3;
  const QUESTION_POWER = 4;
  const USED_BLOCK = 5;
  const PIPE = 6;

  const decorations = {
    hills: [
      { x: 4, r: 3 }, { x: 27, r: 4 }, { x: 52, r: 3 },
      { x: 78, r: 4 }, { x: 104, r: 3 }, { x: 136, r: 4 }, { x: 168, r: 3 }
    ],
    bushes: [7, 24, 48, 72, 99, 129, 158, 181],
    clouds: [10, 35, 67, 96, 126, 160, 190]
  };

  let map;
  let pipes;
  let coins;
  let powerups;
  let enemies;
  let particles;
  let popups;
  let fireballs;
  let blockBounce;
  let player;
  let cameraX = 0;
  let state = "playing";
  let score = 0;
  let coinCount = 0;
  let lives = 3;
  let elapsed = 0;
  let hintTimer = 7;
  let goalX = 205 * TILE;
  let checkpointX = 48;
  let lastFrame = performance.now();
  let fireQueued = false;

  const keys = { left: false, right: false, jump: false, run: false, fire: false };
  const enemySpawns = [10, 11, 32, 43, 55, 69, 84, 97, 116, 132, 144, 160, 172];
  let audioCtx = null;

  function unlockAudio() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }

  function tone(freq, duration, type = "square", volume = 0.045, delay = 0, slideTo = null) {
    if (!audioCtx) return;
    const startAt = audioCtx.currentTime + delay;
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, startAt);
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, startAt + duration);
    gain.gain.setValueAtTime(volume, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration);
  }

  const sound = {
    jump() { tone(280, 0.14, "square", 0.04, 0, 540); },
    coin() {
      tone(920, 0.06, "square", 0.035);
      tone(1380, 0.11, "square", 0.035, 0.07);
    },
    stomp() { tone(220, 0.13, "sawtooth", 0.045, 0, 80); },
    power() { [523, 659, 784, 1046].forEach((freq, i) => tone(freq, 0.09, "triangle", 0.05, i * 0.07)); },
    hurt() { tone(240, 0.22, "sawtooth", 0.05, 0, 80); },
    win() { [523, 659, 784, 1046, 1318].forEach((freq, i) => tone(freq, 0.16, "triangle", 0.055, i * 0.12)); }
  };

  function blankMap() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
  }

  function addGroundRange(start, end) {
    for (let x = start; x <= end; x += 1) {
      map[13][x] = GROUND;
      map[14][x] = GROUND;
    }
  }

  function addBlock(x, y, type) { map[y][x] = type; }

  function addCoin(x, y) {
    coins.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2, r: 10, spin: Math.random() * Math.PI * 2 });
  }

  function addPipe(x, height) {
    pipes.push({ x, height });
    for (let y = 13 - height; y < 13; y += 1) {
      map[y][x] = PIPE;
      map[y][x + 1] = PIPE;
    }
  }

  function makeEnemy(tileX) {
    return {
      x: tileX * TILE + 4,
      y: GROUND_Y - 24,
      w: 24,
      h: 24,
      vx: -58,
      vy: 0,
      squash: 0,
      step: Math.random() * 10
    };
  }

  function resetEnemies() { enemies = enemySpawns.map(makeEnemy); }

  function setPlayerForm(form) {
    const bottom = player.y + player.h;
    player.form = form;
    player.w = 24;
    player.h = form === 'small' ? 30 : 58;
    player.y = bottom - player.h;
    player.spawnY = GROUND_Y - player.h;
  }

  function resetGame() {
    map = blankMap();
    pipes = [];
    coins = [];
    powerups = [];
    particles = [];
    popups = [];
    fireballs = [];
    fireQueued = false;
    blockBounce = new Map();
    cameraX = 0;
    state = "playing";
    score = 0;
    coinCount = 0;
    lives = 3;
    elapsed = 0;
    hintTimer = 7;
    goalX = 211 * TILE;
    checkpointX = 48;

    [[0, 59], [62, 104], [108, 149], [152, 219]].forEach(([start, end]) => addGroundRange(start, end));

    addPipe(20, 3);
    addPipe(41, 3);
    addPipe(63, 4);
    addPipe(91, 2);
    addPipe(123, 3);
    addPipe(151, 4);

    addBlock(12, 8, QUESTION_COIN);
    addBlock(15, 8, BRICK);
    addBlock(16, 8, QUESTION_COIN);
    addBlock(17, 8, BRICK);
    addBlock(18, 8, QUESTION_POWER);
    addBlock(30, 8, QUESTION_COIN);
    addBlock(31, 8, BRICK);
    addBlock(32, 8, QUESTION_POWER);
    addBlock(33, 8, BRICK);
    [[53, 6], [54, 6], [55, 6], [54, 5]].forEach(([x, y]) => addBlock(x, y, BRICK));
    addBlock(58, 8, QUESTION_COIN);
    addBlock(70, 8, QUESTION_COIN);
    addBlock(71, 8, BRICK);
    addBlock(72, 8, QUESTION_COIN);
    addBlock(87, 7, QUESTION_POWER);
    addBlock(101, 8, BRICK);
    addBlock(102, 8, QUESTION_COIN);
    addBlock(103, 8, BRICK);
    addBlock(119, 8, QUESTION_COIN);
    addBlock(120, 8, QUESTION_POWER);
    addBlock(137, 7, BRICK);
    addBlock(138, 7, QUESTION_COIN);
    addBlock(139, 7, BRICK);
    addBlock(157, 8, QUESTION_COIN);
    addBlock(158, 8, BRICK);
    addBlock(159, 8, QUESTION_COIN);
    addBlock(176, 7, BRICK);
    addBlock(177, 7, QUESTION_POWER);
    addBlock(178, 7, BRICK);

    for (let step = 0; step < 5; step += 1) {
      for (let row = 12; row >= 12 - step; row -= 1) addBlock(196 + step, row, BRICK);
      for (let row = 12; row >= 12 - (4 - step); row -= 1) addBlock(203 + step, row, BRICK);
    }

    [[24, 10], [25, 10], [26, 10], [36, 9], [37, 9], [47, 8], [48, 8], [49, 8], [76, 10], [77, 10], [93, 9], [94, 9], [111, 8], [112, 8], [130, 9], [131, 9], [164, 8], [165, 8], [166, 8], [186, 9], [187, 9]]
      .forEach(([x, y]) => addCoin(x, y));

    powerups.push({ type: 'star', x: 80 * TILE + 6, y: GROUND_Y - 20, w: 20, h: 20, vx: 90, vy: -80 });
    powerups.push({ type: 'star', x: 146 * TILE + 6, y: GROUND_Y - 20, w: 20, h: 20, vx: 90, vy: -80 });

    resetEnemies();
    player = {
      x: 64,
      y: GROUND_Y - 30,
      w: 24,
      h: 30,
      vx: 0,
      vy: 0,
      facing: 1,
      onGround: false,
      coyote: 0,
      jumpBuffer: 0,
      hurtTimer: 0,
      starTimer: 0,
      walkTime: 0,
      spawnX: 64,
      spawnY: GROUND_Y - 30,
      checkpointTile: 2,
      form: 'small',
      fireCooldown: 0,
      poleTimer: 0
    };
  }

  function tileAtPixel(x, y) {
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);
    if (col < 0 || col >= COLS || row < 0) return GROUND;
    if (row >= ROWS) return EMPTY;
    return map[row][col];
  }

  function isSolidAt(x, y) {
    return tileAtPixel(x, y) !== EMPTY;
  }

  function moveHorizontal(actor, dt) {
    const previousX = actor.x;
    actor.x += actor.vx * dt;
    if (actor.x < 0) {
      actor.x = 0;
      actor.vx = 0;
    }
    if (actor.x + actor.w > LEVEL_W) {
      actor.x = LEVEL_W - actor.w;
      actor.vx = 0;
    }

    const direction = Math.sign(actor.x - previousX);
    if (direction === 0) return;
    const top = Math.floor((actor.y + 1) / TILE);
    const bottom = Math.floor((actor.y + actor.h - 2) / TILE);
    if (direction > 0) {
      const edge = actor.x + actor.w;
      const col = Math.floor(edge / TILE);
      for (let row = top; row <= bottom; row += 1) {
        if (tileAtPixel(col * TILE, row * TILE + 1) !== EMPTY) {
          actor.x = col * TILE - actor.w - 0.01;
          actor.vx = actor === player || actor.type === 'fireball' ? 0 : -actor.vx;
          return;
        }
      }
    } else {
      const col = Math.floor(actor.x / TILE);
      for (let row = top; row <= bottom; row += 1) {
        if (tileAtPixel(col * TILE + TILE - 1, row * TILE + 1) !== EMPTY) {
          actor.x = (col + 1) * TILE + 0.01;
          actor.vx = actor === player || actor.type === 'fireball' ? 0 : -actor.vx;
          return;
        }
      }
    }
  }

  function moveVertical(actor, dt) {
    const previousY = actor.y;
    actor.y += actor.vy * dt;
    const left = Math.floor((actor.x + 3) / TILE);
    const right = Math.floor((actor.x + actor.w - 4) / TILE);
    const direction = Math.sign(actor.y - previousY);

    if (direction > 0) {
      const edge = actor.y + actor.h;
      const row = Math.floor(edge / TILE);
      for (let col = left; col <= right; col += 1) {
        if (tileAtPixel(col * TILE + 1, row * TILE) !== EMPTY) {
          actor.y = row * TILE - actor.h - 0.01;
          actor.vy = 0;
          actor.onGround = true;
          return;
        }
      }
    } else if (direction < 0) {
      const row = Math.floor(actor.y / TILE);
      for (let col = left; col <= right; col += 1) {
        if (tileAtPixel(col * TILE + 1, (row + 1) * TILE - 1) !== EMPTY) {
          actor.y = (row + 1) * TILE + 0.01;
          actor.vy = 0;
          if (actor === player) hitBlockAbove(row, col);
          return;
        }
      }
    }
  }

  function hitBlockAbove(row, col) {
    if (row < 0 || row >= ROWS) return;
    const tile = map[row][col];
    if (![BRICK, QUESTION_COIN, QUESTION_POWER].includes(tile)) return;

    const key = col + ',' + row;
    if (blockBounce.has(key)) return;
    blockBounce.set(key, 0.2);

    if (tile === QUESTION_COIN) {
      map[row][col] = USED_BLOCK;
      coinCount += 1;
      score += 200;
      popups.push({ type: 'coin', x: col * TILE + 6, y: row * TILE, vy: -150, life: 0.8 });
      sound.coin();
    } else if (tile === QUESTION_POWER) {
      map[row][col] = USED_BLOCK;
      const type = player.form === 'small' ? 'mushroom' : 'flower';
      powerups.push({
        type,
        x: col * TILE + 6,
        y: type === 'flower' ? row * TILE : row * TILE - 22,
        w: 20,
        h: 20,
        vx: type === 'mushroom' ? 72 : 0,
        vy: type === 'mushroom' ? -30 : 0,
        emerging: type === 'flower' ? 0.35 : 0
      });
      sound.power();
    } else if (player.form !== 'small') {
      map[row][col] = EMPTY;
      score += 50;
      addParticles(col * TILE + 16, row * TILE + 16, '#d6541f', 12);
      tone(140, 0.09, 'sawtooth', 0.04, 0, 70);
    }
  }

  function addParticles(x, y, color, amount = 12) {
    for (let i = 0; i < amount; i += 1) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 170,
        vy: -Math.random() * 180 - 30,
        life: 0.5 + Math.random() * 0.45,
        color,
        size: 3 + Math.random() * 3
      });
    }
  }

  function intersects(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function applyPowerup(type) {
    if (type === 'mushroom') {
      if (player.form === 'small') setPlayerForm('super');
      score += 1000;
    } else if (type === 'flower') {
      if (player.form === 'small') setPlayerForm('super');
      else setPlayerForm('fire');
      score += 1000;
    } else if (type === 'star') {
      player.starTimer = 10;
      score += 1000;
    }
    sound.power();
  }

  function respawnPlayer(fullReset = false) {
    setPlayerForm('small');
    player.x = player.spawnX;
    player.y = player.spawnY;
    player.vx = 0;
    player.vy = 0;
    player.hurtTimer = 1.5;
    player.starTimer = 0;
    cameraX = Math.max(0, player.spawnX - VIEW_W * 0.35);
    if (fullReset) {
      lives = 3;
      player.checkpointTile = 2;
      player.spawnX = 64;
      player.x = player.spawnX;
      player.y = player.spawnY;
      resetEnemies();
    }
  }

  function hurtPlayer(enemy) {
    if (player.hurtTimer > 0 || player.starTimer > 0) return;
    if (player.form !== 'small') {
      setPlayerForm('small');
      player.hurtTimer = 1.5;
      player.vx = player.x < enemy.x ? -170 : 170;
      player.vy = -260;
      sound.hurt();
      return;
    }
    lives -= 1;
    player.hurtTimer = 1.5;
    player.vx = player.x < enemy.x ? -170 : 170;
    player.vy = -260;
    sound.hurt();
    if (lives <= 0) respawnPlayer(true);
    else respawnPlayer(false);
  }

  function defeatEnemy(enemy) {
    enemy.squash = 0.45;
    enemy.vx = 0;
    score += 100;
    addParticles(enemy.x + enemy.w / 2, enemy.y + 8, '#a855f7', 8);
    sound.stomp();
  }

  function spawnFireball() {
    if (player.form !== 'fire' || player.fireCooldown > 0) return;
    fireballs.push({
      x: player.x + (player.facing > 0 ? player.w + 2 : -12),
      y: player.y + player.h - 18,
      w: 12,
      h: 12,
      type: 'fireball',
      vx: player.facing * 340,
      vy: -120,
      life: 3
    });
    player.fireCooldown = 0.32;
    tone(680, 0.05, 'square', 0.035);
  }

  function updateFireballs(dt) {
    for (const ball of fireballs) {
      ball.life -= dt;
      ball.vy = Math.min(560, ball.vy + 1500 * dt);
      moveHorizontal(ball, dt);
      const wasFalling = ball.vy > 0;
      moveVertical(ball, dt);
      if (wasFalling && ball.onGround) ball.vy = -390;
      if (ball.vx === 0) ball.life = 0;
      for (const enemy of enemies) {
        if (!enemy.dead && enemy.squash <= 0 && intersects(ball, enemy)) {
          defeatEnemy(enemy);
          ball.life = 0;
          break;
        }
      }
    }
    fireballs = fireballs.filter(ball => ball.life > 0 && ball.y < VIEW_H + 120);
  }

  function updatePlayer(dt) {
    if (state === 'pole') {
      player.poleTimer -= dt;
      if (player.poleTimer <= 0) state = 'won';
      return;
    }

    const acceleration = player.onGround ? 2300 : 1450;
    const maxSpeed = keys.run ? 292 : 205;
    const move = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);

    if (move !== 0) {
      player.vx += move * acceleration * dt;
      player.vx = Math.max(-maxSpeed, Math.min(maxSpeed, player.vx));
      player.facing = move;
    } else {
      const friction = player.onGround ? 1850 : 350;
      const amount = friction * dt;
      if (Math.abs(player.vx) <= amount) player.vx = 0;
      else player.vx -= Math.sign(player.vx) * amount;
    }

    player.coyote = player.onGround ? 0.11 : Math.max(0, player.coyote - dt);
    player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
    if (player.jumpBuffer > 0 && player.coyote > 0) {
      player.vy = -760;
      player.onGround = false;
      player.coyote = 0;
      player.jumpBuffer = 0;
      sound.jump();
    }
    if (!keys.jump && player.vy < -210) player.vy += 2600 * dt;

    player.vy = Math.min(850, player.vy + GRAVITY * dt);
    player.onGround = false;
    moveVertical(player, dt);
    moveHorizontal(player, dt);
    player.walkTime += Math.abs(player.vx) * dt / 18;

    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    player.starTimer = Math.max(0, player.starTimer - dt);
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    if (fireQueued) {
      spawnFireball();
      fireQueued = false;
    }

    const nextCheckpoints = [62, 108, 152];
    const nextTile = nextCheckpoints.find(tile => Math.abs(tile - player.checkpointTile - 60) <= 16);
    if (nextTile && player.x > nextTile * TILE) {
      player.checkpointTile = nextTile;
      player.spawnX = nextTile * TILE;
    }
    if (player.y > VIEW_H + 120) {
      lives -= 1;
      sound.hurt();
      if (lives <= 0) resetGame();
      else respawnPlayer(false);
    }

    if (player.x + player.w >= goalX) {
      state = 'pole';
      const heightRatio = Math.max(0, Math.min(1, (GROUND_Y - player.y) / 300));
      score += 400 + Math.round(heightRatio * 4600);
      player.vx = 0;
      player.poleTimer = 1.15;
      addParticles(goalX + 8, 120, '#fde047', 36);
      sound.win();
    }
  }

  function updateEnemies(dt) {
    for (const enemy of enemies) {
      if (enemy.squash > 0) {
        enemy.squash -= dt;
        if (enemy.squash <= 0) enemy.dead = true;
        continue;
      }
      enemy.step += dt * 8;
      enemy.vy = Math.min(760, enemy.vy + GRAVITY * dt);
      const oldVx = enemy.vx;
      enemy.onGround = false;
      moveVertical(enemy, dt);
      moveHorizontal(enemy, dt);
      if (enemy.vx === oldVx) {
        const aheadX = enemy.vx > 0 ? enemy.x + enemy.w + 3 : enemy.x - 3;
        if (!isSolidAt(aheadX, enemy.y + enemy.h + 4)) enemy.vx *= -1;
      }

      if (enemy.y > VIEW_H + 120 || !intersects(player, enemy)) continue;
      const playerBottom = player.y + player.h;
      if (player.starTimer > 0) defeatEnemy(enemy);
      else if (player.vy > 80 && playerBottom - enemy.y < 20) {
        defeatEnemy(enemy);
        player.vy = -430;
      } else hurtPlayer(enemy);
    }
    enemies = enemies.filter(enemy => !enemy.dead && enemy.y < VIEW_H + 160);
  }

  function updatePowerups(dt) {
    for (const item of powerups) {
      if (item.emerging && item.emerging > 0) {
        item.emerging -= dt;
        item.y -= 52 * dt;
      } else {
        item.vy = Math.min(720, item.vy + GRAVITY * dt);
        item.onGround = false;
        moveVertical(item, dt);
        if (item.type === 'star' && item.onGround) item.vy = -420;
        moveHorizontal(item, dt);
      }
      if (!item.collected && intersects(player, item)) {
        item.collected = true;
        applyPowerup(item.type);
        addParticles(item.x + 10, item.y + 10, '#fde047', 18);
      }
    }
    powerups = powerups.filter(item => !item.collected && item.y < VIEW_H + 160);
  }

  function updateCoins(dt) {
    for (const coin of coins) {
      coin.spin += dt * 5;
      const box = { x: coin.x - coin.r, y: coin.y - coin.r, w: coin.r * 2, h: coin.r * 2 };
      if (!coin.collected && intersects(player, box)) {
        coin.collected = true;
        coinCount += 1;
        score += 100;
        addParticles(coin.x, coin.y, '#facc15', 8);
        sound.coin();
      }
    }
    coins = coins.filter(coin => !coin.collected);
  }

  function updateEffects(dt) {
    for (const particle of particles) {
      particle.life -= dt;
      particle.vy += 850 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
    particles = particles.filter(particle => particle.life > 0);

    for (const popup of popups) {
      popup.life -= dt;
      popup.y += popup.vy * dt;
      popup.vy += 420 * dt;
    }
    popups = popups.filter(popup => popup.life > 0);

    for (const [key, timer] of blockBounce) {
      blockBounce.set(key, timer - dt);
      if (timer - dt <= 0) blockBounce.delete(key);
    }
  }

  function update(dt) {
    elapsed += dt;
    if (elapsed > 300) {
      resetGame();
      return;
    }
    hintTimer = Math.max(0, hintTimer - dt);
    updatePlayer(dt);
    updateEnemies(dt);
    updateFireballs(dt);
    updatePowerups(dt);
    updateCoins(dt);
    updateEffects(dt);

    const targetCamera = player.x + player.w / 2 - VIEW_W * 0.38;
    cameraX += (targetCamera - cameraX) * Math.min(1, dt * 7);
    cameraX = Math.max(0, Math.min(LEVEL_W - VIEW_W, cameraX));
  }

  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function outlineRect(x, y, w, h, fill, light, dark) {
    rect(x, y, w, h, fill);
    rect(x, y, w, 3, light);
    rect(x, y, 3, h, light);
    rect(x, y + h - 3, w, 3, dark);
    rect(x + w - 3, y, 3, h, dark);
  }

  function drawCloud(x, y, scale = 1) {
    rect(x + 8 * scale, y + 10 * scale, 54 * scale, 14 * scale, '#ffffff');
    rect(x + 18 * scale, y + 3 * scale, 24 * scale, 12 * scale, '#ffffff');
    rect(x + 2 * scale, y + 15 * scale, 66 * scale, 7 * scale, '#e6f0ff');
  }

  function drawHill(x, radius) {
    const w = radius * TILE * 2;
    const h = radius * TILE * 0.72;
    for (let layer = 0; layer < h; layer += 4) {
      const width = w * (1 - layer / h) * 0.5;
      rect(x - width, GROUND_Y - layer - 4, width * 2, 5, layer % 12 === 0 ? '#1f8f1d' : '#29a52a');
    }
    rect(x - 20, GROUND_Y - h * 0.55, 12, 8, '#16651b');
    rect(x + 22, GROUND_Y - h * 0.38, 14, 8, '#16651b');
  }

  function drawBush(tileX) {
    const x = tileX * TILE - cameraX;
    rect(x, GROUND_Y - 18, 84, 18, '#1b8f21');
    rect(x + 8, GROUND_Y - 28, 22, 18, '#2db832');
    rect(x + 31, GROUND_Y - 34, 24, 22, '#2db832');
    rect(x + 55, GROUND_Y - 26, 22, 18, '#2db832');
    rect(x + 8, GROUND_Y - 7, 70, 5, '#116617');
  }

  function drawGround(x, y, col, row) {
    outlineRect(x, y, TILE, TILE, '#c44a16', '#f4873a', '#6d2209');
    if (row === 13) {
      rect(x, y + 8, TILE, 3, '#7a2a0d');
      rect(x + ((col % 2) * 14), y + 17, 18, 4, '#8a310f');
      rect(x + 4 + ((col + 1) % 2) * 10, y + 25, 14, 3, '#e66a28');
    } else {
      rect(x + 4, y + 6, 10, 8, '#8a310f');
      rect(x + 20, y + 18, 9, 8, '#6d2209');
    }
  }

  function drawBrick(x, y) {
    outlineRect(x, y, TILE, TILE, '#d6541f', '#ff8c42', '#74280b');
    rect(x, y + 14, TILE, 3, '#74280b');
    rect(x + 14, y, 3, 15, '#74280b');
    rect(x + 8, y + 17, 3, 15, '#74280b');
    rect(x + 24, y + 17, 3, 15, '#74280b');
  }

  function drawQuestion(x, y, used = false) {
    if (used) {
      outlineRect(x, y, TILE, TILE, '#8a5a24', '#b98543', '#4c2a0c');
      return;
    }
    const glow = Math.sin(elapsed * 5 + x * 0.02) * 14;
    outlineRect(x, y, TILE, TILE, 'rgb(248,' + Math.round(178 + glow) + ',29)', '#ffe37a', '#8a4300');
    ctx.fillStyle = '#5f2a00';
    ctx.font = 'bold 23px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('?', x + 16, y + 24);
    rect(x + 5, y + 5, 4, 4, '#fff1a8');
  }

  function drawPipeTile(x, y, isTop) {
    if (isTop) {
      outlineRect(x - 3, y, TILE + 6, TILE, '#20a01d', '#7be050', '#075d16');
      rect(x + 5, y + 4, 6, TILE - 8, '#91ff68');
    } else {
      rect(x, y, TILE, TILE, '#20a01d');
      rect(x, y, 3, TILE, '#7be050');
      rect(x + TILE - 4, y, 4, TILE, '#075d16');
      rect(x + 7, y, 6, TILE, '#56c93f');
    }
  }

  function drawTile(col, row) {
    const tile = map[row][col];
    if (tile === EMPTY) return;
    const key = col + ',' + row;
    const bounce = blockBounce.get(key) || 0;
    const offset = bounce > 0 ? -Math.sin((0.2 - bounce) / 0.2 * Math.PI) * 10 : 0;
    const x = col * TILE - cameraX;
    const y = row * TILE + offset;

    if (tile === GROUND) drawGround(x, y, col, row);
    if (tile === BRICK) drawBrick(x, y);
    if (tile === QUESTION_COIN || tile === QUESTION_POWER) drawQuestion(x, y);
    if (tile === USED_BLOCK) drawQuestion(x, y, true);
    if (tile === PIPE) drawPipeTile(x, y, row === 0 || map[row - 1][col] !== PIPE);
  }

  function drawCoin(x, y) {
    const width = Math.max(3, Math.abs(Math.cos(x * 0.03 + elapsed * 5)) * 15);
    rect(x - width / 2, y - 11, width, 22, '#facc15');
    rect(x - width / 2 + 2, y - 7, Math.max(1, width - 4), 4, '#fff7ae');
    rect(x - 1, y - 7, 2, 12, '#b7791f');
  }

  function drawStarShape(x, y, radius, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 === 0 ? radius : radius * 0.45;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawPowerup(item) {
    const x = item.x + item.w / 2 - cameraX;
    const y = item.y + item.h / 2;
    if (item.type === 'mushroom') {
      rect(x - 9, y - 9, 18, 10, '#e11d48');
      rect(x - 11, y - 4, 22, 7, '#e11d48');
      rect(x - 5, y - 8, 5, 5, '#fff7ed');
      rect(x + 3, y - 9, 5, 5, '#fff7ed');
      rect(x - 6, y + 3, 12, 8, '#ffedd5');
      rect(x - 4, y + 5, 3, 3, '#111827');
      rect(x + 2, y + 5, 3, 3, '#111827');
      return;
    }
    if (item.type === 'flower') {
      rect(x - 6, y - 9, 5, 5, '#ef4444');
      rect(x + 2, y - 9, 5, 5, '#ef4444');
      rect(x - 6, y - 1, 5, 5, '#ef4444');
      rect(x + 2, y - 1, 5, 5, '#ef4444');
      rect(x - 3, y - 5, 7, 7, '#fef08a');
      rect(x - 2, y + 4, 5, 9, '#16a34a');
      rect(x - 7, y + 8, 6, 4, '#16a34a');
      return;
    }
    const pulse = player.starTimer > 0 && Math.floor(elapsed * 10) % 2 === 0;
    drawStarShape(x, y, 13, pulse ? '#ffffff' : '#fde047');
    rect(x - 3, y - 5, 3, 3, '#7c2d12');
    rect(x + 2, y - 5, 3, 3, '#7c2d12');
  }

  function drawEnemy(enemy) {
    const x = enemy.x - cameraX;
    const y = enemy.y;
    if (enemy.squash > 0) {
      rect(x, y + 15, 25, 9, '#7e22ce');
      rect(x + 4, y + 12, 6, 4, '#fef08a');
      rect(x + 16, y + 12, 6, 4, '#fef08a');
      return;
    }
    const wobble = Math.sin(enemy.step) * 2;
    rect(x + 2, y + 5 + wobble, 22, 17, '#7e22ce');
    rect(x + 5, y + wobble, 16, 10, '#9333ea');
    rect(x + 7, y + 4 + wobble, 4, 4, '#fef08a');
    rect(x + 15, y + 4 + wobble, 4, 4, '#fef08a');
    rect(x + 8, y + 6 + wobble, 2, 2, '#111827');
    rect(x + 16, y + 6 + wobble, 2, 2, '#111827');
    rect(x + 2, y + 21, 7, 4, '#4c1d95');
    rect(x + 16, y + 21, 7, 4, '#4c1d95');
  }

  function drawPlayer() {
    if (player.hurtTimer > 0 && player.starTimer <= 0 && Math.floor(elapsed * 12) % 2 === 0) return;
    const step = player.onGround && Math.abs(player.vx) > 10 ? Math.sin(player.walkTime) : 0;
    const scaleY = player.form === 'small' ? 1 : 1.42;
    const invincible = player.starTimer > 0;
    const body = invincible && Math.floor(elapsed * 9) % 2 === 0 ? '#fef08a' : '#f97316';
    const fur = invincible ? '#ffffff' : '#ffedd5';
    const overall = invincible && Math.floor(elapsed * 7) % 2 === 0 ? '#38bdf8' : '#2563eb';

    ctx.save();
    ctx.translate(player.x - cameraX + player.w / 2, player.y + player.h);
    ctx.scale(1, scaleY);
    ctx.translate(0, -30);
    ctx.scale(player.facing, 1);
    ctx.translate(-player.w / 2, 0);
    rect(3, 5, 18, 16, fur);
    rect(0, 7, 6, 9, fur);
    rect(18, 7, 7, 9, fur);
    rect(6, 1, 7, 6, fur);
    rect(13, 0, 6, 5, fur);
    rect(14, 1, 3, 3, '#111827');
    rect(6, 17, 14, 9, body);
    rect(5, 22, 15, 7, overall);
    rect(9, 18, 6, 4, '#fde68a');
    rect(15, 8, 3, 3, '#111827');
    rect(4, 10, 4, 3, '#111827');
    rect(2 + step * 3, 26, 8, 4, player.form === 'fire' ? '#7f1d1d' : '#312e81');
    rect(15 - step * 3, 26, 8, 4, player.form === 'fire' ? '#7f1d1d' : '#312e81');
    rect(0, 17, 5, 8, fur);
    ctx.restore();
  }

  function drawGoal() {
    const x = goalX - cameraX;
    rect(x + 5, 62, 6, 354, '#e5e7eb');
    rect(x + 2, 58, 12, 8, '#fef3c7');
    drawStarShape(x + 8, 50, 15, '#fde047');
    const wave = Math.sin(elapsed * 5) * 3;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(x + 11, 76);
    ctx.lineTo(x + 55 + wave, 91);
    ctx.lineTo(x + 11, 110);
    ctx.closePath();
    ctx.fill();
    rect(x - 12, GROUND_Y - 8, 38, 8, '#fbbf24');
  }

  function drawParticlesAndPopups() {
    for (const particle of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, particle.life * 2));
      rect(particle.x - cameraX, particle.y, particle.size, particle.size, particle.color);
    }
    ctx.globalAlpha = 1;
    for (const popup of popups) {
      if (popup.type === 'coin') drawCoin(popup.x + 10 - cameraX, popup.y + 10);
    }
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    gradient.addColorStop(0, '#5c94fc');
    gradient.addColorStop(1, '#8ec5ff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    decorations.clouds.forEach((tile, index) => {
      const rawX = tile * TILE - cameraX * 0.35 + (index % 2) * 70;
      const x = ((rawX % 1280) + 1280) % 1280 - 90;
      const y = 42 + (index % 3) * 34;
      if (x > -120 && x < VIEW_W + 120) drawCloud(x, y, 0.85 + (index % 2) * 0.25);
    });

    decorations.hills.forEach(hill => {
      const rawX = hill.x * TILE - cameraX * 0.65;
      const x = ((rawX % 1400) + 1400) % 1400 - 220;
      if (x > -260 && x < VIEW_W + 260) drawHill(x, hill.r);
    });

    decorations.bushes.forEach(tile => {
      if (tile * TILE - cameraX > -120 && tile * TILE - cameraX < VIEW_W + 120) drawBush(tile);
    });
  }

  function drawTiles() {
    const startCol = Math.max(0, Math.floor(cameraX / TILE) - 1);
    const endCol = Math.min(COLS - 1, Math.ceil((cameraX + VIEW_W) / TILE) + 1);
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) drawTile(col, row);
    }
  }

  function drawEntities() {
    for (const coin of coins) {
      const x = coin.x - cameraX;
      if (x > -30 && x < VIEW_W + 30) drawCoin(x, coin.y);
    }
    for (const item of powerups) {
      if (item.x - cameraX > -40 && item.x - cameraX < VIEW_W + 40) drawPowerup(item);
    }
    for (const enemy of enemies) {
      if (enemy.x - cameraX > -50 && enemy.x - cameraX < VIEW_W + 50) drawEnemy(enemy);
    }
    for (const ball of fireballs) {
      const x = ball.x - cameraX;
      rect(x, ball.y, 12, 12, '#f97316');
      rect(x + 2, ball.y - 2, 8, 5, '#fde047');
      rect(x + 3, ball.y + 3, 4, 4, '#ffffff');
    }
    drawGoal();
    drawPlayer();
    drawParticlesAndPopups();
  }

  function pixelText(text, x, y, color = '#ffffff', size = 18, align = 'left') {
    ctx.font = 'bold ' + size + 'px monospace';
    ctx.textAlign = align;
    ctx.fillStyle = '#1f2937';
    ctx.fillText(text, x + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawHeart(x, y, filled) {
    rect(x + 2, y + 2, 5, 5, filled ? '#ef4444' : '#475569');
    rect(x + 10, y + 2, 5, 5, filled ? '#ef4444' : '#475569');
    rect(x, y + 5, 17, 6, filled ? '#ef4444' : '#475569');
    rect(x + 3, y + 11, 11, 3, filled ? '#ef4444' : '#475569');
    rect(x + 6, y + 14, 5, 2, filled ? '#ef4444' : '#475569');
  }

  function drawHud() {
    pixelText('分数 ' + score, 18, 29, '#fff7d6', 18);
    pixelText('金币 ' + coinCount, 174, 29, '#fde047', 18);
    pixelText('时间 ' + Math.max(0, Math.ceil(300 - elapsed)), 320, 29, '#ffffff', 18);
    pixelText('生命 ' + lives, 456, 29, '#fecaca', 18);
    pixelText('形态 ' + (player.form === 'small' ? '小' : player.form === 'super' ? '大' : '火花'), 545, 29, '#bfdbfe', 18);

    const progress = Math.min(1, player.x / goalX);
    rect(610, 16, 250, 12, 'rgba(15,23,42,.55)');
    rect(612, 18, 246 * progress, 8, '#facc15');
    drawStarShape(612 + 246 * progress, 22, 9, '#fde047');

    if (player.starTimer > 0) {
      pixelText('星星护盾 ' + player.starTimer.toFixed(1) + 's', 760, 45, '#fef08a', 15, 'right');
    }

    if (hintTimer > 0) {
      ctx.globalAlpha = Math.min(1, hintTimer);
      rect(190, 72, 580, 44, 'rgba(15,23,42,.72)');
      pixelText('移动、奔跑、起跳；顶问号砖拿蘑菇变大，火花形态按 X 发火球。', VIEW_W / 2, 100, '#fff7d6', 17, 'center');
      ctx.globalAlpha = 1;
    }
  }

  function drawOverlay() {
    if (state === 'paused') {
      rect(0, 0, VIEW_W, VIEW_H, 'rgba(15,23,42,.55)');
      pixelText('暂停', VIEW_W / 2, 220, '#fde047', 42, 'center');
      pixelText('按 P 继续', VIEW_W / 2, 265, '#ffffff', 20, 'center');
    }
    if (state === 'won') {
      rect(0, 0, VIEW_W, VIEW_H, 'rgba(15,23,42,.62)');
      pixelText('通关成功！', VIEW_W / 2, 190, '#fde047', 48, 'center');
      pixelText('最终分数 ' + score + ' · 金币 ' + coinCount, VIEW_W / 2, 240, '#ffffff', 22, 'center');
      pixelText('按 R 或 Enter 再玩一次', VIEW_W / 2, 285, '#bfdbfe', 19, 'center');
    }
    if (state === 'pole') {
      pixelText('通关！', VIEW_W / 2, 130, '#fde047', 34, 'center');
    }
  }

  function render() {
    drawBackground();
    drawTiles();
    drawEntities();
    drawHud();
    drawOverlay();
  }

  function setRunning(key, pressed) {
    if (['ArrowLeft', 'KeyA'].includes(key)) keys.left = pressed;
    if (['ArrowRight', 'KeyD'].includes(key)) keys.right = pressed;
    if (['ArrowUp', 'KeyW', 'Space'].includes(key)) keys.jump = pressed;
    if (key === 'ShiftLeft' || key === 'ShiftRight') keys.run = pressed;
    if (['KeyX', 'KeyJ'].includes(key)) keys.fire = pressed;
  }

  window.addEventListener('keydown', event => {
    unlockAudio();
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(event.code)) event.preventDefault();
    if (event.code === 'KeyR' || (state === 'won' && event.code === 'Enter')) {
      resetGame();
      return;
    }
    if (event.code === 'KeyP' || event.code === 'Escape') {
      if (state === 'playing') state = 'paused';
      else if (state === 'paused') state = 'playing';
      return;
    }
    if (state !== 'playing' || event.repeat) return;
    if (['KeyX', 'KeyJ'].includes(event.code)) fireQueued = true;
    if (['ArrowUp', 'KeyW', 'Space'].includes(event.code)) player.jumpBuffer = 0.12;
    setRunning(event.code, true);
  });

  window.addEventListener('keyup', event => {
    setRunning(event.code, false);
  });

  document.querySelectorAll('[data-hold]').forEach(button => {
    const action = button.dataset.hold;
    const press = event => {
      event.preventDefault();
      unlockAudio();
      button.setPointerCapture(event.pointerId);
      if (action === 'jump') {
        keys.jump = true;
        if (state === 'playing') player.jumpBuffer = 0.12;
      } else {
        keys[action] = true;
      }
    };
    const release = event => {
      event.preventDefault();
      if (action === 'jump') keys.jump = false;
      else keys[action] = false;
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  });

  function loop(now) {
    const dt = Math.min(0.033, (now - lastFrame) / 1000);
    lastFrame = now;
    if (state === 'playing') update(dt);
    render();
    requestAnimationFrame(loop);
  }

  if (typeof document !== 'undefined') {
    resetGame();
    requestAnimationFrame(loop);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      reset: resetGame,
      getState: () => ({ player, state, score, coinCount, lives, enemies, coins, powerups, fireballs, map, goalX }),
      setKey(key, pressed) {
        keys[key] = pressed;
        if (pressed && key === 'jump') player.jumpBuffer = 0.12;
        if (pressed && key === 'fire') fireQueued = true;
      },
      update
    };
  }
})();
