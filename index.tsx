
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';

// --- Configuration ---
const LANES = [-2.5, 0, 2.5]; // Left, Center, Right X positions
const LANE_SPEED = 25; // Lane switch speed
const GRAVITY = 70; 
const JUMP_FORCE = 22; 
const RUN_SPEED_START = 20;
const MAX_SPEED = 60;
const SPEED_INC = 0.8; 
const SLIDE_DURATION = 0.8; 
const SHIELD_DURATION = 5.0; 

// --- Tuning ---
const HIT_Z_MIN = -0.7; 
const HIT_Z_MAX = 0.4;  
const HIT_LANE_DIST = 0.6; // Forgiving lane width
const JUMP_CLEARANCE = 0.4; 

// --- Types ---
type GameState = 'START' | 'PLAYING' | 'GAMEOVER';
type ObstacleType = 'JUMP' | 'SLIDE' | 'FULL';
type GameObj = {
    id: number;
    type: 'OBSTACLE' | 'COIN' | 'SHIELD';
    subtype?: ObstacleType;
    lane: number; 
    z: number;
    mesh: THREE.Group | THREE.Mesh;
    active: boolean;
};

type RiggedChar = {
    group: THREE.Group;
    head: THREE.Mesh;
    torso: THREE.Mesh;
    armL: THREE.Group;
    armR: THREE.Group;
    legL: THREE.Group;
    legR: THREE.Group;
    shieldMesh?: THREE.Mesh;
};

// --- Audio Controller ---
class SoundController {
  ctx: AudioContext | null = null;
  noiseBuffer: AudioBuffer | null = null;
  
  // BGM State
  isPlayingMusic = false;
  bgmTimer: number = 0;
  nextNoteTime: number = 0;
  noteIndex: number = 0;
  bgmNodes: AudioNode[] = [];

  constructor() {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AudioContext();
    this.createNoiseBuffer();
  }

  createNoiseBuffer() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2; 
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  }

  resume() {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // --- BGM Sequencer ---
  startBGM() {
      if (this.isPlayingMusic || !this.ctx) return;
      this.isPlayingMusic = true;
      this.resume();
      this.nextNoteTime = this.ctx.currentTime + 0.1;
      this.noteIndex = 0;
      this.bgmTimer = window.setInterval(() => this.scheduler(), 50);
  }

  stopBGM() {
      this.isPlayingMusic = false;
      window.clearInterval(this.bgmTimer);
      // Stop all currently playing BGM nodes
      this.bgmNodes.forEach(n => {
          try { n.disconnect(); } catch(e){}
      });
      this.bgmNodes = [];
  }

  scheduler() {
      if (!this.ctx) return;
      // Look ahead 0.1s
      while (this.nextNoteTime < this.ctx.currentTime + 0.1) {
          this.playPatternStep(this.noteIndex, this.nextNoteTime);
          // 150 BPM -> 0.1s per 16th note. Let's do 8th notes for melody base (0.2s)
          this.nextNoteTime += 0.2; 
          this.noteIndex++;
      }
  }

  playPatternStep(index: number, time: number) {
      if (!this.ctx) return;

      const beat = index % 16; // 2 bars of 8th notes
      
      // --- Bassline (Walking Blues/Surf) ---
      // Key: C Major. C(0), E(4), G(7), A(9) ... 
      // Freqs: C3=130, E3=164, G3=196, A3=220, Bb3=233
      let bassFreq = 0;
      if (beat < 4) { // C chord
          if (beat % 4 === 0) bassFreq = 130.81; // C
          else if (beat % 4 === 2) bassFreq = 196.00; // G
          else bassFreq = 130.81;
      } else if (beat < 8) { // F chord
          if (beat % 4 === 0) bassFreq = 174.61; // F
          else if (beat % 4 === 2) bassFreq = 220.00; // A
          else bassFreq = 174.61;
      } else if (beat < 12) { // G chord
          if (beat % 4 === 0) bassFreq = 196.00; // G
          else if (beat % 4 === 2) bassFreq = 246.94; // B
          else bassFreq = 196.00;
      } else { // C Turnaround
          if (beat % 4 === 0) bassFreq = 130.81;
          else bassFreq = 196.00;
      }

      // Pump the bass
      this.playTone(bassFreq, 0, 0.15, 'triangle', 0.2, time);

      // --- Melody (Syncopated) ---
      // Lead Synth
      let melodyFreq = 0;
      // Simple surf riff
      // Beats: 0, 1.5, 3, 4.5 ...
      const mPattern = [1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 0]; 
      const notes = [523.25, 0, 659.25, 783.99, 0, 659.25, 0, 0, 880.00, 0, 783.99, 659.25, 0, 587.33, 523.25, 0];
      
      if (mPattern[beat]) {
          melodyFreq = notes[beat] || 0;
      }
      
      if (melodyFreq > 0) {
          this.playTone(melodyFreq, 0, 0.15, 'sawtooth', 0.08, time);
      }

      // --- Hi-Hat / Shaker ---
      if (index % 2 === 0) {
          this.playNoiseBurst(time, 0.05);
      }
  }
  
  playNoiseBurst(time: number, duration: number) {
      if (!this.ctx || !this.noiseBuffer) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'highpass';
      filt.frequency.value = 5000;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.05, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      
      src.connect(filt);
      filt.connect(gain);
      gain.connect(this.ctx.destination);
      src.start(time);
      src.stop(time + duration);
      this.bgmNodes.push(src);
  }

  // --- FX ---

  playTone(freqStart: number, freqEnd: number, duration: number, type: OscillatorType = 'sine', vol: number = 0.1, time: number = 0) {
      if (!this.ctx) return;
      const t = time || this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, t);
      if (freqEnd) osc.frequency.linearRampToValueAtTime(freqEnd, t + duration);
      
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      
      osc.start(t);
      osc.stop(t + duration);
      
      // Keep track to stop on game over
      if (this.isPlayingMusic) {
          this.bgmNodes.push(osc); 
          // Cleanup array periodically or just let GC handle disconnected nodes?
          // Better to explicitly disconnect in stopBGM, but for running, we just push.
          if (this.bgmNodes.length > 100) this.bgmNodes.shift(); 
      }
  }

  playJump() { this.playTone(200, 600, 0.15, 'sine', 0.2); }
  playCoin() { this.playTone(1200, 1800, 0.1, 'square', 0.1); }
  playShield() { this.playTone(300, 800, 0.5, 'sine', 0.2); }
  playGameOver() { 
      this.playTone(150, 40, 1.0, 'sawtooth', 0.3); 
      this.playTone(100, 20, 1.0, 'sine', 0.3);
  }

  playNoise(filterFreq: number, duration: number) {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
    src.start();
    src.stop(this.ctx.currentTime + duration);
  }

  playSlide() { this.playNoise(600, 0.3); }
  playCrash() { this.playNoise(200, 0.5); }
}

const App = () => {
  const [gameState, setGameState] = useState<GameState>('START');
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [hasShield, setHasShield] = useState(false);
  const [deathReason, setDeathReason] = useState('');

  const mountRef = useRef<HTMLDivElement>(null);
  const gameStateRef = useRef<GameState>('START');
  
  // Game Logic Refs
  const gameData = useRef({
      score: 0,
      speed: RUN_SPEED_START,
      lane: 1, // 0, 1, 2
      xPos: 0, 
      yPos: 0, 
      velocityY: 0,
      isJumping: false,
      isSliding: false,
      slideTimer: 0,
      shieldTimer: 0,
      objects: [] as GameObj[],
      segments: [] as THREE.Group[],
      nextSegmentZ: 0,
      objIdCounter: 0
  });

  const soundRef = useRef<SoundController | null>(null);

  useEffect(() => {
    soundRef.current = new SoundController();
    if (!mountRef.current) return;

    // --- Three.js Init ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 20, 90);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 120);
    camera.position.set(0, 5, 8);
    camera.lookAt(0, 2, -4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);

    // --- Geometry & Materials ---
    const geo = {
        box: new THREE.BoxGeometry(1, 1, 1),
        cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
        plane: new THREE.PlaneGeometry(1, 1),
        sphere: new THREE.SphereGeometry(1, 16, 16)
    };
    const mat = {
        skin: new THREE.MeshStandardMaterial({ color: 0xffccaa }),
        shirt: new THREE.MeshStandardMaterial({ color: 0x3366cc }),
        monsterSkin: new THREE.MeshStandardMaterial({ color: 0x222222 }),
        monsterFace: new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.5 }),
        path: new THREE.MeshStandardMaterial({ color: 0x777766 }),
        wall: new THREE.MeshStandardMaterial({ color: 0x3a4a3a }),
        gold: new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2 }),
        shield: new THREE.MeshPhongMaterial({ color: 0x00ffff, transparent: true, opacity: 0.4 }),
        wood: new THREE.MeshStandardMaterial({ color: 0x8B4513 }),
        stone: new THREE.MeshStandardMaterial({ color: 0x555555 }),
        fire: new THREE.MeshBasicMaterial({ color: 0xff4400 }),
    };

    // Lights
    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(20, 50, 20);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 1024;
    dir.shadow.mapSize.height = 1024;
    dir.shadow.camera.left = -15;
    dir.shadow.camera.right = 15;
    dir.shadow.camera.top = 30;
    dir.shadow.camera.bottom = -10;
    scene.add(amb, dir);

    // --- Character Rigging ---
    const createCharacter = (type: 'PLAYER' | 'MONSTER'): RiggedChar => {
        const group = new THREE.Group();
        
        // Scale helper
        const s = type === 'MONSTER' ? 1.3 : 1.0;
        const skinMat = type === 'MONSTER' ? mat.monsterSkin : mat.skin;
        const bodyMat = type === 'MONSTER' ? mat.monsterSkin : mat.shirt;

        // Torso
        const torso = new THREE.Mesh(geo.box, bodyMat);
        torso.scale.set(0.5 * s, 0.7 * s, 0.3 * s);
        torso.position.y = 0.85 * s;
        torso.castShadow = true;
        group.add(torso);

        // Head
        const head = new THREE.Mesh(geo.box, skinMat);
        head.scale.set(0.35 * s, 0.35 * s, 0.35 * s);
        head.position.y = 1.4 * s;
        head.castShadow = true;
        group.add(head);

        if (type === 'MONSTER') {
            // Eyes
            const eyeL = new THREE.Mesh(geo.box, mat.monsterFace);
            eyeL.scale.set(0.08, 0.08, 0.1);
            eyeL.position.set(-0.1, 1.4 * s, 0.15 * s);
            const eyeR = new THREE.Mesh(geo.box, mat.monsterFace);
            eyeR.scale.set(0.08, 0.08, 0.1);
            eyeR.position.set(0.1, 1.4 * s, 0.15 * s);
            group.add(eyeL, eyeR);
        }

        // Limbs Helper
        const createLimb = (w: number, h: number, d: number, x: number, y: number, material: THREE.Material) => {
            const pivot = new THREE.Group();
            pivot.position.set(x * s, y * s, 0);
            const mesh = new THREE.Mesh(geo.box, material);
            mesh.scale.set(w * s, h * s, d * s);
            mesh.position.y = (-h/2) * s; // Pivot at top
            mesh.castShadow = true;
            pivot.add(mesh);
            group.add(pivot);
            return pivot;
        };

        const legL = createLimb(0.18, 0.75, 0.2, -0.15, 0.55, bodyMat);
        const legR = createLimb(0.18, 0.75, 0.2, 0.15, 0.55, bodyMat);
        const armL = createLimb(0.15, 0.7, 0.15, -0.35, 1.15, skinMat);
        const armR = createLimb(0.15, 0.7, 0.15, 0.35, 1.15, skinMat);

        let shieldMesh;
        if (type === 'PLAYER') {
            shieldMesh = new THREE.Mesh(geo.sphere, mat.shield);
            shieldMesh.scale.set(1.2, 1.2, 1.2);
            shieldMesh.position.y = 0.8;
            shieldMesh.visible = false;
            group.add(shieldMesh);
        }

        scene.add(group);
        return { group, head, torso, legL, legR, armL, armR, shieldMesh };
    };

    const player = createCharacter('PLAYER');
    const monster = createCharacter('MONSTER');
    monster.group.position.z = 4; // Start behind

    // --- Functions ---

    const spawnObject = (type: 'OBSTACLE' | 'COIN' | 'SHIELD', lane: number, z: number, subtype?: ObstacleType) => {
        const grp = new THREE.Group();
        grp.position.set(LANES[lane], 0, z);
        
        if (type === 'OBSTACLE') {
            if (subtype === 'JUMP') {
                const log = new THREE.Mesh(geo.cyl, mat.wood);
                log.rotation.z = Math.PI / 2;
                log.scale.set(0.3, 2.0, 0.3); // Short visual width
                log.position.y = 0.4;
                log.castShadow = true;
                grp.add(log);
            } else if (subtype === 'SLIDE') {
                const top = new THREE.Mesh(geo.box, mat.stone);
                top.scale.set(3.0, 0.8, 0.8);
                top.position.y = 2.5;
                top.castShadow = true;
                const lCol = new THREE.Mesh(geo.box, mat.stone);
                lCol.scale.set(0.5, 3.0, 0.5);
                lCol.position.set(-1.2, 1.5, 0);
                const rCol = new THREE.Mesh(geo.box, mat.stone);
                rCol.scale.set(0.5, 3.0, 0.5);
                rCol.position.set(1.2, 1.5, 0);
                const fire = new THREE.Mesh(geo.box, mat.fire);
                fire.scale.set(2.0, 0.3, 0.1);
                fire.position.set(0, 2.0, 0);
                grp.add(top, lCol, rCol, fire);
            } else {
                // FULL WALL
                const wall = new THREE.Mesh(geo.box, mat.stone);
                wall.scale.set(2.0, 3.0, 0.8);
                wall.position.y = 1.5;
                wall.castShadow = true;
                grp.add(wall);
            }
        } else if (type === 'COIN') {
            const coin = new THREE.Mesh(geo.cyl, mat.gold);
            coin.rotation.x = Math.PI / 2;
            coin.scale.set(0.4, 0.1, 0.4);
            coin.position.y = 1.0;
            grp.add(coin);
        } else if (type === 'SHIELD') {
            const s = new THREE.Mesh(geo.sphere, mat.shield);
            s.position.y = 1.0;
            grp.add(s);
        }

        scene.add(grp);
        gameData.current.objects.push({
            id: gameData.current.objIdCounter++,
            type,
            subtype,
            lane, 
            z,
            mesh: grp,
            active: true
        });
    };

    const spawnSegment = (zPos: number) => {
        const grp = new THREE.Group();
        
        const floor = new THREE.Mesh(geo.plane, mat.path);
        floor.rotation.x = -Math.PI / 2;
        floor.scale.set(20, 20, 1);
        floor.receiveShadow = true;
        grp.add(floor);
        
        const wl = new THREE.Mesh(geo.box, mat.wall);
        wl.scale.set(2, 5, 20);
        wl.position.set(-8, 2.5, 0);
        grp.add(wl);
        const wr = new THREE.Mesh(geo.box, mat.wall);
        wr.scale.set(2, 5, 20);
        wr.position.set(8, 2.5, 0);
        grp.add(wr);

        grp.position.z = zPos;
        scene.add(grp);
        gameData.current.segments.push(grp);

        if (zPos < -10) {
             const zLoc = zPos;
             const roll = Math.random();
             
             if (roll < 0.3) {
                 const l = Math.floor(Math.random() * 3);
                 const t = Math.random() > 0.6 ? 'FULL' : (Math.random() > 0.5 ? 'JUMP' : 'SLIDE');
                 spawnObject('OBSTACLE', l, zLoc, t as ObstacleType);
             } else if (roll < 0.5) {
                 const safe = Math.floor(Math.random() * 3);
                 [0,1,2].forEach(l => {
                     if(l !== safe) spawnObject('OBSTACLE', l, zLoc, 'FULL');
                 });
             } else if (roll < 0.6) {
                 [0,1,2].forEach(l => spawnObject('OBSTACLE', l, zLoc, 'JUMP'));
             }

             if (Math.random() < 0.5) {
                 const l = Math.floor(Math.random() * 3);
                 const busy = gameData.current.objects.some(o => o.z === zLoc && o.lane === l);
                 if (!busy) {
                     if (Math.random() < 0.05) spawnObject('SHIELD', l, zLoc);
                     else spawnObject('COIN', l, zLoc);
                 }
             }
        }
    };

    const initWorld = () => {
        gameData.current.objects.forEach(o => scene.remove(o.mesh));
        gameData.current.objects = [];
        gameData.current.segments.forEach(s => scene.remove(s));
        gameData.current.segments = [];
        
        gameData.current.nextSegmentZ = 80; 
        while (gameData.current.nextSegmentZ > -160) {
            spawnSegment(gameData.current.nextSegmentZ);
            gameData.current.nextSegmentZ -= 20;
        }
    };
    initWorld();

    // --- Controls ---
    const handleKey = (e: KeyboardEvent) => {
        if (gameStateRef.current !== 'PLAYING') return;
        const gd = gameData.current;

        if (e.key === 'ArrowLeft') {
            if (gd.lane > 0) gd.lane--;
        } else if (e.key === 'ArrowRight') {
            if (gd.lane < 2) gd.lane++;
        } else if (e.key === 'ArrowUp') {
            if (!gd.isJumping && !gd.isSliding) {
                gd.velocityY = JUMP_FORCE;
                gd.isJumping = true;
                soundRef.current?.playJump();
            }
        } else if (e.key === 'ArrowDown') {
            if (gd.isJumping) {
                gd.velocityY = -GRAVITY * 0.5;
            } else if (!gd.isSliding) {
                gd.isSliding = true;
                gd.slideTimer = SLIDE_DURATION;
                soundRef.current?.playSlide();
            }
        }
    };
    window.addEventListener('keydown', handleKey);

    // --- Animation & Loop ---
    const clock = new THREE.Clock();
    let rAF: number;

    const animateChar = (char: RiggedChar, dt: number, isRunning: boolean, speedMod: number) => {
        const time = Date.now() * 0.01 * speedMod;
        
        if (isRunning) {
            // Running Cycle
            char.legL.rotation.x = Math.sin(time) * 0.8;
            char.legR.rotation.x = Math.sin(time + Math.PI) * 0.8;
            char.armL.rotation.x = Math.sin(time + Math.PI) * 0.8;
            char.armR.rotation.x = Math.sin(time) * 0.8;
            
            // Bobbing
            char.group.position.y = Math.abs(Math.sin(time*2)) * 0.1;
        } else {
            // Reset
            char.legL.rotation.x = 0;
            char.legR.rotation.x = 0;
            char.armL.rotation.x = 0;
            char.armR.rotation.x = 0;
            char.group.position.y = 0;
        }
    };

    const updatePlayerPose = (gd: any, delta: number) => {
        // Slide Logic
        if (gd.isSliding) {
             // Duck Head
             player.head.position.y = THREE.MathUtils.lerp(player.head.position.y, 0.5, delta * 15);
             player.torso.position.y = THREE.MathUtils.lerp(player.torso.position.y, 0.4, delta * 15);
             player.torso.scale.y = THREE.MathUtils.lerp(player.torso.scale.y, 0.5, delta * 15);
             
             // Legs forward (slide pose)
             player.legL.rotation.x = -1.2;
             player.legR.rotation.x = -1.4;
             player.armL.rotation.x = -1.0; // Arms back for balance
             player.armR.rotation.x = -1.0;

        } else if (gd.isJumping) {
             player.head.position.y = 1.4;
             player.torso.position.y = 0.85;
             player.torso.scale.y = 1;
             
             // Jump Pose
             player.legL.rotation.x = 0.5; // Knees up
             player.legR.rotation.x = 0.8;
             player.armL.rotation.x = -2.5; // Arms up
             player.armR.rotation.x = -2.5;
        } else {
             // Normal Run
             player.head.position.y = THREE.MathUtils.lerp(player.head.position.y, 1.4, delta * 15);
             player.torso.position.y = THREE.MathUtils.lerp(player.torso.position.y, 0.85, delta * 15);
             player.torso.scale.y = THREE.MathUtils.lerp(player.torso.scale.y, 1, delta * 15);
             
             // Apply Run Cycle
             const time = Date.now() * 0.015;
             player.legL.rotation.x = Math.sin(time) * 1.0;
             player.legR.rotation.x = Math.sin(time + Math.PI) * 1.0;
             player.armL.rotation.x = Math.sin(time + Math.PI) * 0.8;
             player.armR.rotation.x = Math.sin(time) * 0.8;
        }
    };

    const animate = () => {
        rAF = requestAnimationFrame(animate);
        const delta = Math.min(clock.getDelta(), 0.1);
        const gd = gameData.current;

        if (gameStateRef.current === 'PLAYING') {
            gd.speed = Math.min(gd.speed + (SPEED_INC * delta), MAX_SPEED);
            gd.score += gd.speed * delta;
            setScore(Math.floor(gd.score));

            // Shield
            if (gd.shieldTimer > 0) {
                gd.shieldTimer -= delta;
                if (player.shieldMesh) player.shieldMesh.visible = true;
                if (gd.shieldTimer <= 0) {
                    setHasShield(false);
                    if (player.shieldMesh) player.shieldMesh.visible = false;
                }
            }

            // Player Move
            const targetX = LANES[gd.lane];
            gd.xPos = THREE.MathUtils.lerp(gd.xPos, targetX, delta * LANE_SPEED);
            
            if (gd.isJumping) {
                gd.yPos += gd.velocityY * delta;
                gd.velocityY -= GRAVITY * delta;
                if (gd.yPos <= 0) {
                    gd.yPos = 0;
                    gd.isJumping = false;
                    gd.velocityY = 0;
                }
            } else if (gd.isSliding) {
                gd.slideTimer -= delta;
                gd.yPos = 0;
                if (gd.slideTimer <= 0) gd.isSliding = false;
            } else {
                gd.yPos = 0;
            }

            player.group.position.set(gd.xPos, gd.yPos, 0);
            
            // Update Poses
            updatePlayerPose(gd, delta);
            
            // Monster Run
            const monsterTime = Date.now() * 0.015;
            monster.legL.rotation.x = Math.sin(monsterTime) * 1.0;
            monster.legR.rotation.x = Math.sin(monsterTime + Math.PI) * 1.0;
            monster.armL.rotation.x = Math.sin(monsterTime + Math.PI) * 1.0;
            monster.armR.rotation.x = Math.sin(monsterTime) * 1.0;
            
            // Monster Chase Position
            // Stays closer if player is stumbling or moving weirdly? No, just constant threat.
            monster.group.position.x = THREE.MathUtils.lerp(monster.group.position.x, gd.xPos, delta * 3);
            monster.group.position.z = 4.5; // Behind camera
            
            // World Move
            const moveZ = gd.speed * delta;
            gd.segments.forEach(s => s.position.z += moveZ);
            
            // Infinite Bridge
            if (gd.segments[0].position.z > 80) {
                const old = gd.segments.shift();
                if (old) scene.remove(old);
            }
            while (gd.segments[gd.segments.length-1].position.z > -160) {
                spawnSegment(gd.segments[gd.segments.length-1].position.z - 20);
            }

            // Objects
            const nextObjects: GameObj[] = [];
            gd.objects.forEach(obj => {
                if (!obj.active) return;
                obj.z += moveZ;
                obj.mesh.position.z = obj.z;

                if (obj.z > 25) {
                    scene.remove(obj.mesh);
                    obj.active = false;
                    return;
                }
                nextObjects.push(obj);

                // Collision
                if (obj.z > HIT_Z_MIN && obj.z < HIT_Z_MAX) {
                    const dist = Math.abs(gd.xPos - LANES[obj.lane]);
                    if (dist < HIT_LANE_DIST) {
                        if (obj.type === 'COIN') {
                            obj.active = false;
                            scene.remove(obj.mesh);
                            setCoins(c => c+1);
                            soundRef.current?.playCoin();
                        } else if (obj.type === 'SHIELD') {
                            obj.active = false;
                            scene.remove(obj.mesh);
                            gd.shieldTimer = SHIELD_DURATION;
                            setHasShield(true);
                            soundRef.current?.playShield();
                        } else if (obj.type === 'OBSTACLE') {
                            let hit = true;
                            let reason = 'HIT OBSTACLE';
                            if (obj.subtype === 'JUMP') {
                                reason = 'TRIPPED ON LOG';
                                if (gd.yPos > JUMP_CLEARANCE) hit = false;
                            } else if (obj.subtype === 'SLIDE') {
                                reason = 'HIT HEAD ON GATE';
                                if (gd.isSliding) hit = false;
                            } else {
                                reason = 'SMASHED INTO WALL';
                            }

                            if (hit) {
                                if (gd.shieldTimer > 0) {
                                    obj.active = false;
                                    scene.remove(obj.mesh);
                                    soundRef.current?.playCrash();
                                } else {
                                    soundRef.current?.stopBGM(); // Stop music
                                    soundRef.current?.playGameOver();
                                    gameStateRef.current = 'GAMEOVER';
                                    setDeathReason(reason);
                                    setGameState('GAMEOVER');
                                }
                            }
                        }
                    }
                }
            });
            gd.objects = nextObjects;

            // Camera
            camera.position.x = THREE.MathUtils.lerp(camera.position.x, gd.xPos * 0.5, delta * 3);
            camera.position.y = 5 + (gd.yPos * 0.3);

        } else if (gameStateRef.current === 'GAMEOVER') {
            // Monster Catch Animation
            monster.group.position.z = THREE.MathUtils.lerp(monster.group.position.z, 0.0, delta * 8);
            monster.group.position.x = player.group.position.x;
            monster.armL.rotation.x = -1.5; // Grab pose
            monster.armR.rotation.x = -1.5;
        }

        renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
        soundRef.current?.stopBGM();
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('keydown', handleKey);
        cancelAnimationFrame(rAF);
        if (mountRef.current) mountRef.current.innerHTML = '';
    };
  }, [gameState]);

  const startGame = () => {
      soundRef.current?.startBGM(); // Start music
      setScore(0);
      setCoins(0);
      setHasShield(false);
      setDeathReason('');
      gameData.current.score = 0;
      gameData.current.speed = RUN_SPEED_START;
      gameData.current.lane = 1;
      gameData.current.xPos = 0;
      gameData.current.shieldTimer = 0;
      setGameState('PLAYING');
      gameStateRef.current = 'PLAYING';
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      
      {/* HUD */}
      {gameState === 'PLAYING' && (
          <div style={{ position: 'absolute', top: 20, left: 20, color: '#FFD700', fontFamily: 'Cinzel, serif', textShadow: '2px 2px 0 #000' }}>
              <div style={{ fontSize: '40px' }}>{String(score).padStart(6, '0')}</div>
              <div style={{ fontSize: '18px' }}>METERS</div>
              {hasShield && <div style={{ color: '#00FFFF', marginTop: 10, fontSize: '20px' }}>SHIELD ACTIVE</div>}
          </div>
      )}
      {gameState === 'PLAYING' && (
          <div style={{ position: 'absolute', top: 20, right: 20, display: 'flex', alignItems: 'center', color: '#FFD700', fontFamily: 'Cinzel, serif', fontSize: '32px', textShadow: '2px 2px 0 #000' }}>
              <span>{coins}</span>
              <div style={{ width: 30, height: 30, background: '#FFD700', borderRadius: '50%', marginLeft: 10, boxShadow: 'inset -2px -2px 5px rgba(0,0,0,0.5), 0 0 10px #FFD700' }}></div>
          </div>
      )}

      {/* Menus */}
      {(gameState === 'START' || gameState === 'GAMEOVER') && (
          <div style={{ 
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
              background: 'rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', 
              justifyContent: 'center', alignItems: 'center', color: 'white', fontFamily: 'Cinzel, serif' 
          }}>
              <h1 style={{ fontSize: '60px', margin: '0 0 20px 0', color: gameState === 'GAMEOVER' ? '#FF4444' : '#FFD700', textShadow: '0 0 20px rgba(255,0,0,0.5)' }}>
                  {gameState === 'START' ? 'TEMPLE RUNNER 3D' : 'CAUGHT!'}
              </h1>
              
              {gameState === 'GAMEOVER' && (
                  <div style={{ fontSize: '24px', marginBottom: 30, textAlign: 'center' }}>
                      <div style={{ color: '#FF8888', marginBottom: 10 }}>{deathReason}</div>
                      <div>Distance: {score}m</div>
                      <div style={{ marginTop: 5, color: '#FFD700' }}>Coins: {coins}</div>
                  </div>
              )}

              <button 
                  onClick={startGame}
                  style={{ 
                      padding: '15px 50px', fontSize: '28px', fontFamily: 'Cinzel, serif', fontWeight: 'bold',
                      background: 'linear-gradient(to bottom, #FFD700, #B8860B)', border: 'none', cursor: 'pointer', 
                      color: '#442200', borderRadius: '8px', boxShadow: '0 5px 15px rgba(0,0,0,0.5)' 
                  }}
              >
                  {gameState === 'START' ? 'RUN!' : 'TRY AGAIN'}
              </button>
          </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
