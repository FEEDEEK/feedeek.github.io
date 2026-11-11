// (vyjmuto z app.js, řádky 1097-2778)
import { S, hasPerm } from "./state.js";
import { tbSleep, TB_BATCH_WINDOW, tbBeerCollectiveMsgs, tbShotCollectiveMsgs, tbJointCollectiveMsgs, tbPick, tbJoinNamesCz, tbBeerUpMsgs, tbBeerDownMsgs, tbShotUpMsgs, tbShotDownMsgs, tbJointUpMsgs, tbJointDownMsgs, tbSaveSkill, TB_REEL_ITEM_H, tbShuffleArray, handicapSessionKey, tbKey, TB_SHOT_ICON, TB_JOINT_ICON, tbGetPlayerStats, tbRawHandicap, tbCalculateCurrentSkill, tbEffectiveStats } from "./tb-core.js";
import { escapeHtml } from "./util.js";
import { TEAM_EMBLEMS, TEAM_COLORS, autoStyle, teamCaptain, teamObj, trophySvg, teamName, podiumCupHtml, teamMembersHtml, buildFfaPodiumHtml } from "./turnaj-common.js";
import { onSnapshot, doc, updateDoc, collection, setDoc, getDocs, increment, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { logAction } from "./audit.js";
import { appApi } from "./hooks.js";

// ---- Zvuk výherního automatu (nahrávka z videa): točení ve smyčce -> rána při každém hráči -> závěr ----
const TB_SLOT_FILES = { draw: 'assets/audio/slot-draw.mp3' };
// časy (s od začátku slot-draw.mp3), kdy v nahrávce cinknou 3 hráči - podle nich se zastavují válce
const TB_SLOT_HITS = [1.37, 2.12, 2.84];
let tbSlotT0 = 0;
const tbSlotBuffers = {};
let tbSlotLoading = false, tbSpinNode = null, tbEndNode = null;
function tbLoadSlotSounds(){
    if(tbSlotLoading) return;
    tbEnsureAudio();
    if(!S.tbAudioCtx) return;
    tbSlotLoading = true;
    Object.entries(TB_SLOT_FILES).forEach(([name, file]) => {
        fetch(file).then(r => r.arrayBuffer())
            .then(b => new Promise((res, rej) => S.tbAudioCtx.decodeAudioData(b, res, rej)))
            .then(buf => { tbSlotBuffers[name] = buf; })
            .catch(() => { tbSlotLoading = false; });
    });
}
function tbFadeStopNode(node, fadeSec){
    if(!node) return;
    try{
        const t = S.tbAudioCtx.currentTime;
        node.gain.gain.cancelScheduledValues(t);
        node.gain.gain.setValueAtTime(node.gain.gain.value, t);
        node.gain.gain.linearRampToValueAtTime(0.0001, t + Math.max(0.02, fadeSec));
        node.src.stop(t + Math.max(0.02, fadeSec) + 0.02);
    }catch(e){}
}
function tbSlotPlayBuffer(name, loop, vol){
    const buf = tbSlotBuffers[name];
    if(!buf || !S.tbAudioCtx) return null;
    const src = S.tbAudioCtx.createBufferSource();
    const gain = S.tbAudioCtx.createGain();
    src.buffer = buf; src.loop = !!loop;
    gain.gain.value = vol;
    src.connect(gain); gain.connect(S.tbAudioCtx.destination);
    src.start();
    return { src, gain };
}
function tbSlotSpinStart(){
    if(!S.tbSoundEnabled) return;
    tbEnsureAudio(); tbLoadSlotSounds();
    tbFadeStopNode(tbSpinNode, 0.05); tbFadeStopNode(tbEndNode, 0.1);
    tbSlotT0 = performance.now();
    tbSpinNode = tbSlotPlayBuffer('draw', false, 1.5);
}
function tbSlotSpinStop(fadeSec){ tbFadeStopNode(tbSpinNode, fadeSec); tbSpinNode = null; }
function tbSlotFinale(){
    return;
    if(!S.tbSoundEnabled) return;
    tbEndNode = tbSlotPlayBuffer('end', false, 1);
}
// "rána" při vybrání hráče - hluboký úder + krátký prasknutí
function tbSlotBang(stage){
    return;
    if(!S.tbSoundEnabled) return;
    if(tbSlotBuffers['hit'+stage]){ tbSlotPlayBuffer('hit'+stage, false, 1); return; }
    try{
        tbEnsureAudio();
        if(!S.tbAudioCtx) return;
        const t0 = S.tbAudioCtx.currentTime;
        const up = 1 + ((stage || 1) - 1) * 0.18;
        const osc = S.tbAudioCtx.createOscillator(), og = S.tbAudioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(190 * up, t0);
        osc.frequency.exponentialRampToValueAtTime(42, t0 + 0.22);
        og.gain.setValueAtTime(0.0001, t0);
        og.gain.exponentialRampToValueAtTime(0.9, t0 + 0.008);
        og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
        osc.connect(og); og.connect(S.tbAudioCtx.destination);
        osc.start(t0); osc.stop(t0 + 0.36);
        const len = Math.floor(S.tbAudioCtx.sampleRate * 0.09);
        const nb = S.tbAudioCtx.createBuffer(1, len, S.tbAudioCtx.sampleRate);
        const d = nb.getChannelData(0);
        for(let i = 0; i < len; i++){ d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
        const ns = S.tbAudioCtx.createBufferSource(), ng = S.tbAudioCtx.createGain(), nf = S.tbAudioCtx.createBiquadFilter();
        ns.buffer = nb; nf.type = 'lowpass'; nf.frequency.value = 2800; ng.gain.value = 0.5;
        ns.connect(nf); nf.connect(ng); ng.connect(S.tbAudioCtx.destination); ns.start(t0);
    }catch(e){ /* ticho */ }
}

function tbEnsureAudio() {
    if (!S.tbAudioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) S.tbAudioCtx = new Ctx();
    }
    if (S.tbAudioCtx && S.tbAudioCtx.state === 'suspended') { S.tbAudioCtx.resume().catch(() => {}); }
}
function tbPlayBeep(freq, dur, type) {
    if (!S.tbSoundEnabled) return;
    try {
        tbEnsureAudio();
        if (!S.tbAudioCtx) return;
        const osc = S.tbAudioCtx.createOscillator();
        const gain = S.tbAudioCtx.createGain();
        osc.type = type || 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.14, S.tbAudioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, S.tbAudioCtx.currentTime + dur);
        osc.connect(gain); gain.connect(S.tbAudioCtx.destination);
        osc.start(); osc.stop(S.tbAudioCtx.currentTime + dur);
    } catch (e) { /* ticho, když audio nejde */ }
}
function tbSpeak(text) {
    if (!S.tbSoundEnabled) return;
    try {
        if (!('speechSynthesis' in window)) return;
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 1.0; utter.pitch = 1.0;
        const voices = speechSynthesis.getVoices();
        let voice = null;
        if (S.tbSelectedVoiceURI) voice = voices.find(v => v.voiceURI === S.tbSelectedVoiceURI);
        if (!voice) voice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('cs'));
        if (voice) { utter.voice = voice; utter.lang = voice.lang; } else { utter.lang = 'cs-CZ'; }
        speechSynthesis.speak(utter);
    } catch (e) { /* ticho */ }
}
function tbPopulateVoiceList() {
    try {
        const select = document.getElementById('tbVoiceSelect');
        if (!select || !('speechSynthesis' in window)) return;
        const voices = speechSynthesis.getVoices();
        if (!voices.length) return;
        const current = select.value;
        select.innerHTML = '<option value="">Výchozí hlas</option>';
        const sorted = [...voices].sort((a, b) => {
            const aCs = a.lang && a.lang.toLowerCase().startsWith('cs') ? 0 : 1;
            const bCs = b.lang && b.lang.toLowerCase().startsWith('cs') ? 0 : 1;
            if (aCs !== bCs) return aCs - bCs;
            return a.name.localeCompare(b.name);
        });
        sorted.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.voiceURI;
            opt.textContent = `${v.name} (${v.lang})`;
            select.appendChild(opt);
        });
        if (current) select.value = current;
    } catch (e) { /* ticho */ }
}
if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = tbPopulateVoiceList;
}

function tbPlayGulpSound() {
    if (!S.tbSoundEnabled) return;
    try {
        tbEnsureAudio();
        if (!S.tbAudioCtx) return;
        const t0 = S.tbAudioCtx.currentTime;
        const osc = S.tbAudioCtx.createOscillator();
        const gain = S.tbAudioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(190, t0);
        osc.frequency.exponentialRampToValueAtTime(85, t0 + 0.16);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
        osc.connect(gain); gain.connect(S.tbAudioCtx.destination);
        osc.start(t0); osc.stop(t0 + 0.22);
    } catch (e) { /* ticho */ }
}
function tbPlayClink() {
    if (!S.tbSoundEnabled) return;
    try {
        tbEnsureAudio();
        if (!S.tbAudioCtx) return;
        const t0 = S.tbAudioCtx.currentTime;
        const osc = S.tbAudioCtx.createOscillator();
        const gain = S.tbAudioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1500, t0);
        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
        osc.connect(gain); gain.connect(S.tbAudioCtx.destination);
        osc.start(t0); osc.stop(t0 + 0.27);
    } catch (e) { /* ticho */ }
}
function tbPlaySizzle(durationSec) {
    if (!S.tbSoundEnabled) return;
    try {
        tbEnsureAudio();
        if (!S.tbAudioCtx) return;
        const bufferSize = Math.floor(S.tbAudioCtx.sampleRate * durationSec);
        const buffer = S.tbAudioCtx.createBuffer(1, bufferSize, S.tbAudioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) { data[i] = (Math.random() * 2 - 1) * 0.6; }
        const noise = S.tbAudioCtx.createBufferSource();
        noise.buffer = buffer;
        const filter = S.tbAudioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 3200;
        filter.Q.value = 0.6;
        const gain = S.tbAudioCtx.createGain();
        const t0 = S.tbAudioCtx.currentTime;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.045, t0 + 0.3);
        gain.gain.setValueAtTime(0.045, t0 + Math.max(0.3, durationSec - 0.4));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);
        noise.connect(filter); filter.connect(gain); gain.connect(S.tbAudioCtx.destination);
        noise.start(t0); noise.stop(t0 + durationSec);
    } catch (e) { /* ticho */ }
}
async function tbDrinkWithGulps(totalMs, gulps) {
    const interval = totalMs / gulps;
    for (let i = 0; i < gulps; i++) {
        tbPlayGulpSound();
        await tbSleep(interval);
    }
}
function tbPlayReelTick() {
    return; // místo cvakání hraje nahrávka (tbPlaySlotSample)
    if (!S.tbSoundEnabled) return;
    try {
        tbEnsureAudio();
        if (!S.tbAudioCtx) return;
        const t0 = S.tbAudioCtx.currentTime;
        const osc = S.tbAudioCtx.createOscillator();
        const gain = S.tbAudioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = 480 + Math.random() * 260;
        gain.gain.setValueAtTime(0.045, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
        osc.connect(gain); gain.connect(S.tbAudioCtx.destination);
        osc.start(t0); osc.stop(t0 + 0.04);
    } catch (e) { /* ticho */ }
}
function tbPlayMulticastCharge(){
    tbSlotSpinStart(); return;
    if (!S.tbSoundEnabled) return;
    try{
        tbEnsureAudio();
        if(!S.tbAudioCtx) return;
        const t0 = S.tbAudioCtx.currentTime;
        const osc = S.tbAudioCtx.createOscillator();
        const gain = S.tbAudioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, t0);
        osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.5);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.4);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
        osc.connect(gain); gain.connect(S.tbAudioCtx.destination);
        osc.start(t0); osc.stop(t0 + 0.56);
    }catch(e){ /* ticho */ }
}

// Elektrický "multicast" zásah - eskaluje s parametrem stage (1., 2., 3. zásah v jednom kole losování)
function tbPlayMulticastZap(stage, announce){
    tbSlotBang(stage); return;
    if (!S.tbSoundEnabled) return;
    try{
        tbEnsureAudio();
        if(!S.tbAudioCtx) return;
        const t0 = S.tbAudioCtx.currentTime;
        const pitchMul = 1 + (stage - 1) * 0.28;

        // elektrický sestupný "zzzap"
        const zap = S.tbAudioCtx.createOscillator();
        const zapGain = S.tbAudioCtx.createGain();
        zap.type = 'sawtooth';
        zap.frequency.setValueAtTime(1900 * pitchMul, t0);
        zap.frequency.exponentialRampToValueAtTime(140 * pitchMul, t0 + 0.32);
        zapGain.gain.setValueAtTime(0.0001, t0);
        zapGain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.018);
        zapGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
        zap.connect(zapGain); zapGain.connect(S.tbAudioCtx.destination);
        zap.start(t0); zap.stop(t0 + 0.33);

        // magický "crackle" šum
        const bufferSize = Math.floor(S.tbAudioCtx.sampleRate * 0.28);
        const buffer = S.tbAudioCtx.createBuffer(1, bufferSize, S.tbAudioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) { data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2); }
        const noise = S.tbAudioCtx.createBufferSource();
        noise.buffer = buffer;
        const filter = S.tbAudioCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 2200 * (pitchMul * 0.6 + 0.4);
        const noiseGain = S.tbAudioCtx.createGain();
        noiseGain.gain.setValueAtTime(0.13, t0);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
        noise.connect(filter); filter.connect(noiseGain); noiseGain.connect(S.tbAudioCtx.destination);
        noise.start(t0);

        // hluboký magický "impact"
        const boom = S.tbAudioCtx.createOscillator();
        const boomGain = S.tbAudioCtx.createGain();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(190 * pitchMul, t0);
        boom.frequency.exponentialRampToValueAtTime(45 * pitchMul, t0 + 0.22);
        boomGain.gain.setValueAtTime(0.0001, t0);
        boomGain.gain.exponentialRampToValueAtTime(0.24, t0 + 0.012);
        boomGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
        boom.connect(boomGain); boomGain.connect(S.tbAudioCtx.destination);
        boom.start(t0); boom.stop(t0 + 0.27);

        if(announce){
            setTimeout(() => tbSpeak('Multicast!'), 80);
        }
    }catch(e){ /* ticho */ }
}

function tbBeerSVG() {
    return `
    <svg class="tb-event-svg" viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="tbBeerGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ffd873"/>
                <stop offset="100%" stop-color="#e29b1f"/>
            </linearGradient>
            <clipPath id="tbBeerClip"><rect x="20" y="34" width="64" height="92" rx="8"/></clipPath>
        </defs>
        <rect x="18" y="32" width="68" height="96" rx="10" fill="#0c1327" stroke="#2b2b2b" stroke-width="3"/>
        <path d="M86 52 h16 a14 14 0 0 1 0 48 h-16" fill="none" stroke="#2b2b2b" stroke-width="4"/>
        <g clip-path="url(#tbBeerClip)">
            <rect class="tb-beer-liquid" x="20" y="46" width="64" height="80" fill="url(#tbBeerGrad)"/>
            <rect x="34" y="46" width="4" height="80" fill="#fff2c2" opacity="0.35"/>
            <rect x="54" y="46" width="3" height="80" fill="#fff2c2" opacity="0.25"/>
            <rect x="68" y="46" width="4" height="80" fill="#fff2c2" opacity="0.3"/>
            <path class="tb-beer-foam" d="M20 40 Q26 24 34 38 Q42 20 52 38 Q60 22 68 38 Q76 22 84 38 L84 50 L20 50 Z" fill="#fff8ea"/>
        </g>
    </svg>`;
}
function tbBeerSVGCalm() {
    return `
    <svg class="tb-event-svg" viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
        <rect x="18" y="32" width="68" height="96" rx="10" fill="#0c1327" stroke="#0fbc7c" stroke-width="3"/>
        <path d="M86 52 h16 a14 14 0 0 1 0 48 h-16" fill="none" stroke="#0fbc7c" stroke-width="4"/>
        <rect x="20" y="100" width="64" height="26" fill="#e29b1f" opacity="0.5"/>
        <path d="M20 40 Q26 24 34 38 Q42 20 52 38 Q60 22 68 38 Q76 22 84 38 L84 50 L20 50 Z" fill="#fff8ea" opacity="0.5"/>
    </svg>`;
}
function tbShotSVG() {
    return `
    <svg class="tb-event-svg tb-shot-svg-tip" viewBox="0 0 120 110" xmlns="http://www.w3.org/2000/svg">
        <defs><clipPath id="tbShotClip2"><path d="M20 28 L100 28 L91 98 Q60 108 29 98 Z"/></clipPath></defs>
        <path d="M20 28 L100 28 L91 98 Q60 108 29 98 Z" fill="none" stroke="#111" stroke-width="5"/>
        <g clip-path="url(#tbShotClip2)">
            <rect class="tb-shot-liquid2" x="20" y="30" width="80" height="70" fill="#f2a71b"/>
        </g>
        <rect x="38" y="34" width="6" height="55" fill="#fff" opacity="0.7"/>
        <rect x="54" y="34" width="6" height="55" fill="#fff" opacity="0.5"/>
    </svg>`;
}
function tbShotSVGCalm() {
    return `
    <svg class="tb-event-svg" viewBox="0 0 120 110" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 28 L100 28 L91 98 Q60 108 29 98 Z" fill="none" stroke="#0fbc7c" stroke-width="5"/>
    </svg>`;
}
function tbJointSVG() {
    return `
    <svg class="tb-event-svg" viewBox="0 0 220 60" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="tbPaperGrad3" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#fbf8ee"/>
                <stop offset="50%" stop-color="#e9e3d0"/>
                <stop offset="100%" stop-color="#d6cfb8"/>
            </linearGradient>
            <radialGradient id="tbEmberGrad3" cx="35%" cy="35%" r="65%">
                <stop offset="0%" stop-color="#fff6d0"/>
                <stop offset="30%" stop-color="#ffb347"/>
                <stop offset="65%" stop-color="#e2571c"/>
                <stop offset="100%" stop-color="#7a2408"/>
            </radialGradient>
        </defs>
        <g class="tb-joint-body-group3">
            <path d="M14 30 Q4 30 14 23 L14 37 Q4 30 14 30 Z" fill="#efe9d8" stroke="#a89f86" stroke-width="1"/>
            <rect x="14" y="22" width="160" height="16" rx="8" fill="url(#tbPaperGrad3)" stroke="#a89f86" stroke-width="1.2"/>
            <line x1="45" y1="23.5" x2="45" y2="36.5" stroke="#bdb495" stroke-width="0.8" opacity="0.6"/>
            <line x1="80" y1="23.5" x2="80" y2="36.5" stroke="#bdb495" stroke-width="0.8" opacity="0.6"/>
            <line x1="115" y1="23.5" x2="115" y2="36.5" stroke="#bdb495" stroke-width="0.8" opacity="0.6"/>
            <line x1="150" y1="23.5" x2="150" y2="36.5" stroke="#bdb495" stroke-width="0.8" opacity="0.6"/>
        </g>
        <g class="tb-joint-ember-group3">
            <ellipse class="tb-joint-glow3" cx="182" cy="30" rx="19" ry="17" fill="#ff8a3d" opacity="0.28"/>
            <circle cx="182" cy="30" r="11" fill="#3a2a20"/>
            <circle cx="182" cy="30" r="9" fill="url(#tbEmberGrad3)"/>
            <circle class="tb-joint-flicker3" cx="182" cy="30" r="5" fill="#fff2c2" opacity="0.7"/>
            <circle class="tb-ash-fleck tb-f1" cx="188" cy="42" r="1.4" fill="#8a8a8a"/>
            <circle class="tb-ash-fleck tb-f2" cx="179" cy="44" r="1" fill="#8a8a8a"/>
            <g class="tb-joint-smoke2">
                <path class="tb-smoke-path tb-s1" d="M182 15 q-5 -10 3 -18 q6 -7 -1 -16" fill="none" stroke="#d7dde5" stroke-width="2.4" stroke-linecap="round"/>
                <path class="tb-smoke-path tb-s2" d="M190 17 q6 -9 -3 -17 q-6 -7 2 -15" fill="none" stroke="#d7dde5" stroke-width="1.8" stroke-linecap="round"/>
            </g>
        </g>
    </svg>`;
}
function tbJointSVGCalm() {
    return `
    <svg class="tb-event-svg" viewBox="0 0 220 60" xmlns="http://www.w3.org/2000/svg">
        <rect x="14" y="22" width="160" height="16" rx="8" fill="#efe9d8" stroke="#0fbc7c" stroke-width="1.2"/>
        <ellipse cx="182" cy="30" rx="6" ry="5" fill="#a0aec0"/>
    </svg>`;
}

function tbBeerModalHTML(name, msg) { return `<div class="tb-event-title">🍺 ${escapeHtml(name)} si dává pivo!</div>${tbBeerSVG()}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`; }
function tbBeerModalCalmHTML(name, msg) { return `<div class="tb-event-title">🍺 ${escapeHtml(name)} slaví střízlivost!</div>${tbBeerSVGCalm()}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`; }
function tbShotModalHTML(name, msg) { return `<div class="tb-event-title">🥃 ${escapeHtml(name)} si dává panáka!</div>${tbShotSVG()}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`; }
function tbShotModalCalmHTML(name, msg) { return `<div class="tb-event-title">🥃 ${escapeHtml(name)} nechal panáka být!</div>${tbShotSVGCalm()}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`; }
function tbJointModalHTML(name, msg) { return `<div class="tb-event-title">🍁 ${escapeHtml(name)} si zapaluje jointa!</div>${tbJointSVG()}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`; }
function tbJointModalCalmHTML(name, msg) { return `<div class="tb-event-title">🍁 ${escapeHtml(name)} to uhasil!</div>${tbJointSVGCalm()}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`; }

function tbQueueSubstanceEvent(type, player, before, after, amount) {
    if (S.tbDraftInProgress) return;
    S.tbPendingEvents.push({ type, player, before, after, amount });
    if (S.tbBatchTimer) clearTimeout(S.tbBatchTimer);
    S.tbBatchTimer = setTimeout(tbFlushBatch, TB_BATCH_WINDOW);
}

function tbFlushBatch() {
    S.tbBatchTimer = null;
    const batchEvents = S.tbPendingEvents;
    S.tbPendingEvents = [];
    if (batchEvents.length === 0) return;
    // Seskupit podle typu (piva / panáky / jointy) a přehrát postupně, každý typ se svou vlastní hláškou
    const byType = {};
    batchEvents.forEach(e => { (byType[e.type] = byType[e.type] || []).push(e); });
    const order = ['beers', 'shots', 'joints'].filter(ty => byType[ty] && byType[ty].length);
    S.tbEventQueue = S.tbEventQueue.then(async () => {
        for (const ty of order) {
            const group = byType[ty];
            if (group.length === 1) await tbPlaySingleSubstanceEvent(group[0]);
            else await tbPlayBatchEvent(group);
        }
    });
}

async function tbPlayBatchEvent(batchEvents) {
    const overlay = document.getElementById('tbEventOverlay');
    const modal = document.getElementById('tbEventModal');
    if(!overlay || !modal) return;

    const counts = {};
    batchEvents.forEach(e => counts[e.type] = (counts[e.type] || 0) + 1);
    let domType = batchEvents[0].type, domCount = 0;
    for (const t in counts) { if (counts[t] > domCount) { domCount = counts[t]; domType = t; } }

    let svgHTML, animDuration, titleWord, collectiveMsgs;
    if (domType === 'beers') { svgHTML = tbBeerSVG(); animDuration = 4400; titleWord = '🍺 Skupinová runda piva!'; collectiveMsgs = tbBeerCollectiveMsgs; }
    else if (domType === 'shots') { svgHTML = tbShotSVG(); animDuration = 2200; titleWord = '🥃 Skupinová runda panáků!'; collectiveMsgs = tbShotCollectiveMsgs; }
    else { svgHTML = tbJointSVG(); animDuration = 5600; titleWord = '🍁 Skupinové zapalování!'; collectiveMsgs = tbJointCollectiveMsgs; }

    const uniqueNames = [...new Set(batchEvents.map(e => e.player.name))];
    const msg = tbPick(collectiveMsgs).replace('{names}', tbJoinNamesCz(uniqueNames));

    modal.innerHTML = `<div class="tb-event-title">${titleWord}</div>${svgHTML}<div class="tb-event-message tb-show" id="tbEventMessage">${escapeHtml(msg)}</div>`;
    overlay.classList.add('tb-show');
    tbSpeak(msg);

    if (domType === 'beers') {
        await tbDrinkWithGulps(animDuration, 5);
    } else if (domType === 'shots') {
        tbPlayClink();
        await tbSleep(250);
        tbPlayGulpSound();
        await tbSleep(animDuration - 250);
    } else {
        tbPlaySizzle(animDuration / 1000);
        await tbSleep(animDuration);
    }
    await tbSleep(700);

    overlay.classList.remove('tb-show');
    await tbSleep(320);
}

async function tbPlaySingleSubstanceEvent(ev) {
    const { type, player, amount } = ev;
    const overlay = document.getElementById('tbEventOverlay');
    const modal = document.getElementById('tbEventModal');
    if(!overlay || !modal) return;
    const up = amount > 0;
    let animDuration, msgPool;

    if (type === 'beers') { animDuration = up ? 4400 : 900; msgPool = up ? tbBeerUpMsgs : tbBeerDownMsgs; }
    else if (type === 'shots') { animDuration = up ? 2200 : 900; msgPool = up ? tbShotUpMsgs : tbShotDownMsgs; }
    else { animDuration = up ? 5600 : 900; msgPool = up ? tbJointUpMsgs : tbJointDownMsgs; }

    const msg = tbPick(msgPool).replace('{name}', player.name);
    let html;
    if (type === 'beers') html = up ? tbBeerModalHTML(player.name, msg) : tbBeerModalCalmHTML(player.name, msg);
    else if (type === 'shots') html = up ? tbShotModalHTML(player.name, msg) : tbShotModalCalmHTML(player.name, msg);
    else html = up ? tbJointModalHTML(player.name, msg) : tbJointModalCalmHTML(player.name, msg);

    modal.innerHTML = html;
    overlay.classList.add('tb-show');
    tbSpeak(msg);

    if (up && type === 'beers') {
        await tbDrinkWithGulps(animDuration, 5);
    } else if (up && type === 'shots') {
        tbPlayClink();
        await tbSleep(250);
        tbPlayGulpSound();
        await tbSleep(animDuration - 250);
    } else if (up && type === 'joints') {
        tbPlaySizzle(animDuration / 1000);
        await tbSleep(animDuration);
    } else {
        await tbSleep(animDuration);
    }
    await tbSleep(700);

    overlay.classList.remove('tb-show');
    await tbSleep(320);
}

// ---------- Losování týmů: formulář nového turnaje ----------
export function tbInvalidateDraw(){
  S.tbDraw.teams = null;
  const box = document.getElementById('tb-drawn-teams');
  if(box) box.innerHTML = '';
}
export function tbTeamSizeVal(){
  const el = document.getElementById('tb-team-size');
  const v = el ? parseInt(el.value, 10) : 3;
  return Math.min(6, Math.max(1, v || 3));
}
function tbAutoTeamCount(){
  return Math.max(1, Math.ceil(S.tbDraw.players.length / tbTeamSizeVal()));
}
export function tbUpdateTeamCountHint(){
  const inp = document.getElementById('tb-team-count');
  if(inp) inp.placeholder = `auto (${tbAutoTeamCount()})`;
}
export function tbRenderDrawPlayers(){
  const listDiv = document.getElementById('tb-draw-players');
  if(!listDiv) return;
  if(S.tbDraw.players.length === 0){
    listDiv.innerHTML = '<div class="empty">Zatím žádní hráči. Vyber akci, nebo někoho přidej ručně.</div>';
  }else{
    listDiv.innerHTML = S.tbDraw.players.map(p => `
      <div class="tb-draw-player">
        <span class="tb-draw-name">${escapeHtml(p.name)}</span>
        <label class="tb-draw-skill">Skill <input type="number" min="1" max="100" value="${p.baseSkill}" data-tb-dskill="${p.id}"></label>
        <button type="button" class="tb-draw-remove" data-tb-dremove="${p.id}" title="Odebrat">✕</button>
      </div>`).join('');
  }
  listDiv.querySelectorAll('[data-tb-dskill]').forEach(inp => inp.addEventListener('change', () => {
    const pl = S.tbDraw.players.find(x => String(x.id) === inp.dataset.tbDskill);
    if(!pl) return;
    pl.baseSkill = Math.min(100, Math.max(1, parseInt(inp.value, 10) || 50));
    pl.touched = true;
    inp.value = pl.baseSkill;
    tbSaveSkill(pl.name, pl.baseSkill);
    tbInvalidateDraw();
  }));
  listDiv.querySelectorAll('[data-tb-dremove]').forEach(btn => btn.addEventListener('click', () => {
    S.tbDraw.players = S.tbDraw.players.filter(x => String(x.id) !== btn.dataset.tbDremove);
    tbRenderDrawPlayers();
    tbInvalidateDraw();
  }));
  tbUpdateTeamCountHint();
}
export function tbRenderDrawnTeams(){
  const box = document.getElementById('tb-drawn-teams');
  if(!box) return;
  if(!S.tbDraw.teams){ box.innerHTML = ''; return; }
  const skillOf = n => (S.tbDraw.players.find(p => p.name === n) || {}).baseSkill || 0;
  box.innerHTML = `<div class="section-title" style="font-size:15px; margin-top:18px;">Vylosované týmy — název, znak a barvu můžeš změnit</div>
    <div class="tb-drawn-grid">` + S.tbDraw.teams.map((tm, i) => `
      <div class="tb-drawn-team">
        <div class="tb-drawn-head">
          <button type="button" class="team-style-btn" data-dt-toggle="${i}" style="border-color:${tm.color || 'var(--line)'};">
            <span style="color:${tm.color || 'inherit'};">${tm.emblem || '🚩'}</span>
          </button>
          <input type="text" class="tb-drawn-name" data-tb-tname="${i}" value="${escapeHtml(tm.name)}" style="${tm.color ? `color:${tm.color};` : ''}">
          <div class="team-style-panel" data-dt-panel="${i}" style="display:none;">
            <div class="team-style-panel-label">Logo</div>
            <div class="chip-row">
              ${TEAM_EMBLEMS.map(em => `<span class="chip" data-dt-emblem="${i}" data-val="${em}" style="cursor:pointer; font-size:15px; ${tm.emblem === em ? 'border-color:var(--gold); color:var(--gold);' : ''}">${em}</span>`).join('')}
            </div>
            <div class="team-style-panel-label">Barva</div>
            <div class="chip-row">
              ${TEAM_COLORS.map(c => `<span class="color-swatch ${tm.color === c ? 'active' : ''}" data-dt-color="${i}" data-val="${c}" style="background:${c};"></span>`).join('')}
            </div>
          </div>
        </div>
        ${tm.members.map(n => `<div class="tb-drawn-member"><span>${escapeHtml(n)}</span><span>${skillOf(n)}</span></div>`).join('')}
        <div class="tb-drawn-total">Σ ${tm.members.reduce((a, n) => a + skillOf(n), 0)}</div>
      </div>`).join('') + `</div>`;
  box.querySelectorAll('[data-tb-tname]').forEach(inp => inp.addEventListener('input', () => {
    S.tbDraw.teams[parseInt(inp.dataset.tbTname, 10)].name = inp.value;
  }));
  box.querySelectorAll('[data-dt-toggle]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const i = btn.dataset.dtToggle;
    box.querySelectorAll('[data-dt-panel]').forEach(p => {
      p.style.display = (p.dataset.dtPanel === i && p.style.display === 'none') ? 'flex' : 'none';
    });
  }));
  box.querySelectorAll('[data-dt-emblem]').forEach(el => el.addEventListener('click', () => {
    const tm = S.tbDraw.teams[parseInt(el.dataset.dtEmblem, 10)];
    tm.emblem = (tm.emblem === el.dataset.val) ? '' : el.dataset.val;
    tbRenderDrawnTeams();
  }));
  box.querySelectorAll('[data-dt-color]').forEach(el => el.addEventListener('click', () => {
    const tm = S.tbDraw.teams[parseInt(el.dataset.dtColor, 10)];
    tm.color = (tm.color === el.dataset.val) ? '' : el.dataset.val;
    tbRenderDrawnTeams();
  }));
}
if(!window.__tbDtOutside){
  window.__tbDtOutside = true;
  document.addEventListener('click', (e) => {
    if(!e.target.closest('[data-dt-panel]') && !e.target.closest('[data-dt-toggle]')){
      document.querySelectorAll('[data-dt-panel]').forEach(p => { p.style.display = 'none'; });
    }
  });
}
export function tbStartDrawFromForm(){
  const size = tbTeamSizeVal();
  const P = S.tbDraw.players.length;
  const minTeams = Math.ceil(P / size);
  const numTeams = parseInt(document.getElementById('tb-team-count').value, 10) || minTeams;
  if(P < 2){ alert('Přidej aspoň 2 hráče.'); return; }
  if(numTeams < 2){ alert('Turnaj potřebuje aspoň 2 týmy — zvyš počet týmů.'); return; }
  if(numTeams < minTeams){ alert(`Na ${P} hráčů po ${size} potřebuješ aspoň ${minTeams} týmů.`); return; }
  if(numTeams > P){ alert('Týmů je víc než hráčů.'); return; }
  tbStartDraft({
    players: S.tbDraw.players.map(p => ({ name: p.name, baseSkill: p.baseSkill })),
    teamSize: size,
    numTeams,
    onConfirm: (teams) => {
      S.tbDraw.players.forEach(p => tbSaveSkill(p.name, p.baseSkill));
      S.tbDraw.teams = teams.map((t, i) => ({ name: `Tým ${i+1}`, members: t.members, ...autoStyle(i) }));
      tbRenderDrawnTeams();
    }
  });
}

// ---------- Losovací automat (N válců = hráčů v týmu) ----------
function tbEnsureOverlay(){
  let overlay = document.getElementById('tbEventOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.className = 'tb-event-overlay';
    overlay.id = 'tbEventOverlay';
    overlay.innerHTML = '<div class="tb-event-modal" id="tbEventModal"></div>';
    document.body.appendChild(overlay);
  }
  return overlay;
}

function tbSlotModalHTML(teamId, N){
  const avail = N > 3 ? 540 : 424;
  const w = Math.min(122, Math.floor((avail - 14 * (N - 1)) / N));
  let reels = '', labels = '';
  for(let k = 0; k < N; k++){
    reels += `<div class="tb-reel-window" style="width:${w}px;"><div class="tb-reel-strip" id="tbReelStrip${k+1}"></div></div>`;
    labels += `<div class="tb-reel-label" style="width:${w}px;">${k === 0 ? '👑 Vůdce' : 'Člen ' + k}</div>`;
  }
  return `
    <button type="button" class="tb-modal-close-btn" id="tbCancelDraftBtn" title="Zavřít a zrušit losování">✕</button>
    <div class="tb-event-title">🎰 Losování Týmu ${teamId}</div>
    <div class="tb-slot-frame ${N > 4 ? 'tb-slot-compact' : ''}" id="tbSlotFrame" style="${N > 3 ? 'max-width:none;' : ''}">
        <div class="tb-slot-title">MULTICAST</div>
        <div class="tb-slot-subtitle">Ogre Magi rozhoduje o osudu týmu...</div>
        <div class="tb-reels-row">${reels}</div>
        <div class="tb-reel-labels-row">${labels}</div>
        <div class="tb-lever-wrap" id="tbLeverWrap">
            <div class="tb-lever-rod"></div>
            <div class="tb-lever-knob"></div>
            <div class="tb-lever-base"></div>
        </div>
    </div>
    <div class="tb-slot-status-line" id="tbSlotStatus">Zatáhni za páku a vylosuj Tým ${teamId}!</div>
    <div class="tb-results-list" id="tbResultsList"></div>
    <div class="tb-slot-actions" id="tbSlotActions">
        <button type="button" class="tb-btn-confirm" id="tbConfirmTeamsBtn">✅ Potvrdit týmy</button>
        <button type="button" class="tb-btn-reroll" id="tbRerollTeamsBtn">🔄 Losovat znovu</button>
    </div>`;
}

function tbBuildReelStrip(stripEl, pool, targetName, loops) {
    const namesPool = pool.length ? pool : [targetName];
    const preFiller = namesPool[Math.floor(Math.random() * namesPool.length)] || targetName;
    const items = [preFiller, targetName];
    for (let i = 0; i < loops; i++) { items.push(...namesPool); }
    stripEl.innerHTML = items.map(n => `<div class="tb-reel-item"><span>${escapeHtml(n)}</span></div>`).join('');
    const targetIndex = 1;
    const startIndex = items.length - 1;
    const startT = (1 - startIndex) * TB_REEL_ITEM_H;
    stripEl.style.transform = `translateY(${startT}px)`;
    return { targetIndex, startIndex };
}

function tbSpinReelPhysics(stripEl, targetIndex, startIndex, durationMs) {
    return new Promise(resolve => {
        const startT = (1 - startIndex) * TB_REEL_ITEM_H;
        const finalT = (1 - targetIndex) * TB_REEL_ITEM_H;
        const distance = finalT - startT;
        stripEl.classList.add('tb-spinning');
        const startTime = performance.now();
        let lastTickStep = -1;
        function frame(now) {
            const t = Math.min((now - startTime) / durationMs, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            const currentT = startT + eased * distance;
            stripEl.style.transform = `translateY(${currentT}px)`;
            const step = Math.floor((currentT - startT) / TB_REEL_ITEM_H);
            if (step !== lastTickStep) { lastTickStep = step; tbPlayReelTick(); }
            if (t < 1) {
                requestAnimationFrame(frame);
            } else {
                stripEl.style.transform = `translateY(${finalT}px)`;
                stripEl.classList.remove('tb-spinning');
                const landedItem = stripEl.children[targetIndex];
                if (landedItem) landedItem.classList.add('tb-landed');
                resolve();
            }
        }
        requestAnimationFrame(frame);
    });
}

function tbStartConstantSpin(stripEl, pool) {
    const namesPool = pool.length ? pool : ['???'];
    const minUnitLen = 8;
    let unit = [];
    while (unit.length < minUnitLen) { unit.push(...tbShuffleArray(namesPool)); }
    const items = [...unit, ...unit];
    stripEl.innerHTML = items.map(n => `<div class="tb-reel-item"><span>${escapeHtml(n)}</span></div>`).join('');
    stripEl.classList.add('tb-spinning');
    const unitHeight = unit.length * TB_REEL_ITEM_H;
    const speed = 0.62;
    let pos = 0;
    let last = performance.now();
    let tickAcc = 0;
    let running = true;
    function frame(now) {
        if (!running) return;
        const dt = now - last; last = now;
        pos = (pos + speed * dt) % unitHeight;
        stripEl.style.transform = `translateY(${pos - unitHeight}px)`;
        tickAcc += dt;
        if (tickAcc > 90) { tickAcc = 0; tbPlayReelTick(); }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return { stop() { running = false; } };
}

function tbDecelerateAndLand(stripEl, pool, targetName, durationMs) {
    const r = tbBuildReelStrip(stripEl, pool, targetName, 4);
    return tbSpinReelPhysics(stripEl, r.targetIndex, r.startIndex, durationMs);
}

async function tbSpinCurrentTeam() {
    const draft = S.tbCurrentDraft;
    if(!draft) return;
    const team = draft.teams[draft.index];
    const N = draft.N;
    const modal = document.getElementById('tbEventModal');
    const lever = modal.querySelector('#tbLeverWrap');
    const status = modal.querySelector('#tbSlotStatus');
    lever.classList.add('tb-disabled', 'tb-lever-pulled');
    status.textContent = 'Losuje se...';
    tbPlayMulticastCharge();
    await tbSleep(280);
    lever.classList.remove('tb-lever-pulled');

    const placed = new Set();
    draft.teams.slice(0, draft.index).forEach(tm => tm.members.forEach(m => { if(m) placed.add(m.name); }));
    const strips = [], pools = [];
    for(let k = 0; k < N; k++){
        strips.push(modal.querySelector('#tbReelStrip' + (k + 1)));
        pools.push(draft.tiers[k].filter(p => !placed.has(p.name) && p !== team.members[k]).map(p => p.name));
    }
    const spins = strips.map((s, k) => tbStartConstantSpin(s, pools[k]));
    // pokud je načtená nahrávka, válce se zastavují přesně na cinknutí
    const synced = !!(tbSpinNode && tbSlotBuffers.draw);
    if(!synced) await tbSleep(600);

    for(let k = 0; k < N; k++){
        const hitAt = TB_SLOT_HITS[Math.max(0, TB_SLOT_HITS.length - N + k)] * 1000;
        const DEC = synced ? 650 : 950;
        if(synced){ const wait = hitAt - DEC - (performance.now() - tbSlotT0); if(wait > 0) await tbSleep(wait); }
        spins[k].stop();
        const target = team.members[k] ? team.members[k].name : '—';
        await tbDecelerateAndLand(strips[k], pools[k], target, DEC);
        if(S.tbDraftCancelled){ for(let j = k + 1; j < N; j++) spins[j].stop(); tbSlotSpinStop(0.1); return; }
        tbPlayMulticastZap(k + 1, k === N - 1 && N > 1);
    }

    const names = team.members.filter(Boolean).map(m => m.name);
    const line = document.createElement('div');
    line.className = 'tb-result-entry';
    line.textContent = `Tým ${team.id}: ${tbJoinNamesCz(names)}`;
    modal.querySelector('#tbResultsList').appendChild(line);
    await tbSleep(700);

    draft.index++;
    if(draft.index < draft.teams.length){
        const nextTeam = draft.teams[draft.index];
        modal.querySelector('.tb-event-title').textContent = `🎰 Losování Týmu ${nextTeam.id}`;
        status.textContent = `Zatáhni za páku a vylosuj Tým ${nextTeam.id}!`;
        lever.classList.remove('tb-disabled');
    }else{
        status.textContent = '🏆 Všechny týmy jsou vylosované!';
        lever.classList.add('tb-disabled');
        modal.querySelector('#tbSlotActions').style.display = 'flex';
    }
}

function tbOnLeverClick() {
    if (S.tbSpinBusy || !S.tbCurrentDraft) return;
    const lever = document.querySelector('#tbLeverWrap');
    if (lever && lever.classList.contains('tb-disabled')) return;
    S.tbSpinBusy = true;
    tbSpinCurrentTeam().finally(() => { S.tbSpinBusy = false; });
}

function tbCloseOverlay(){
    const overlay = document.getElementById('tbEventOverlay');
    if(overlay) overlay.classList.remove('tb-show');
}
function tbCancelDraft() {
    S.tbDraftCancelled = true;
    tbSlotSpinStop(0.1); tbFadeStopNode(tbEndNode, 0.1);
    tbCloseOverlay();
    S.tbCurrentDraft = null;
    S.tbDraftInProgress = false;
}
function tbConfirmTeams() {
    const draft = S.tbCurrentDraft;
    if(!draft) return;
    const teams = draft.teams.map(t => ({ members: t.members.filter(Boolean).map(m => m.name) }));
    const cb = draft.cfg.onConfirm;
    tbCloseOverlay();
    S.tbCurrentDraft = null;
    S.tbDraftInProgress = false;
    if(cb) cb(teams);
}
function tbRerollTeams() {
    if(S.tbCurrentDraft) tbStartDraft(S.tbCurrentDraft.cfg);
}

export function tbStartDraft(cfg) {
    try{ tbLoadSlotSounds(); }catch(e){}
    S.tbDraftCancelled = false;
    S.tbDraftInProgress = true;
    const N = cfg.teamSize, T = cfg.numTeams;
    const sorted = cfg.players.map(p => ({ name: p.name, currentSkill: p.baseSkill })).sort((a, b) => b.currentSkill - a.currentSkill);

    // hadí rozdělení: vrstva k = k-tá nejsilnější skupina hráčů, ve vrstvách se pořadí zamíchá
    const tiers = [];
    for(let k = 0; k < N; k++) tiers.push(tbShuffleArray(sorted.slice(k * T, (k + 1) * T)));
    const teams = Array.from({ length: T }, (_, i) => ({ id: i + 1, members: Array(N).fill(null) }));
    tiers.forEach((tier, k) => tier.forEach((p, i) => { teams[(k % 2 === 0) ? i : (T - 1 - i)].members[k] = p; }));

    S.tbCurrentDraft = { teams, tiers, N, T, index: 0, cfg };
    const overlay = tbEnsureOverlay();
    const modal = document.getElementById('tbEventModal');
    modal.innerHTML = tbSlotModalHTML(1, N);
    document.getElementById('tbCancelDraftBtn').addEventListener('click', tbCancelDraft);
    document.getElementById('tbLeverWrap').addEventListener('click', tbOnLeverClick);
    document.getElementById('tbConfirmTeamsBtn').addEventListener('click', tbConfirmTeams);
    document.getElementById('tbRerollTeamsBtn').addEventListener('click', tbRerollTeams);
    overlay.classList.add('tb-show');
}

// ---------- Živé události (pití) + pomocné funkce turnaje ----------
// Napojuje se na sdílenou "session" (akce+den, nebo samotný turnaj), ne na turnaj samotný,
// aby dva turnaje stejné akce/dne sdílely piva i skill živě mezi sebou.
let tbLiveUnsub = null, tbLiveDrinkEventsUnsub = null, tbLiveSessionKey = null;
export function tbStopLive(){
    if(tbLiveUnsub){ tbLiveUnsub(); tbLiveUnsub = null; }
    if(tbLiveDrinkEventsUnsub){ tbLiveDrinkEventsUnsub(); tbLiveDrinkEventsUnsub = null; }
    tbLiveSessionKey = null;
}
export function tbEnsureLive(t){
    const key = handicapSessionKey(t);
    if(tbLiveSessionKey === key) return;
    tbStopLive();
    tbLiveSessionKey = key;
    tbEnsureOverlay();

    tbLiveUnsub = onSnapshot(doc(db, 'handicapSessions', key), (snap) => {
        S.handicapCache[key] = snap.exists() ? { skills: snap.data().skills || {}, drinks: snap.data().drinks || {} } : { skills:{}, drinks:{} };
        // jednorázové doplnění základního skillu u starších turnajů (aby zůstal i další den)
        try{
            const sk = snap.exists() ? (snap.data().skills || {}) : {};
            if(hasPerm('turnaj') && !t.baseSkills && Object.keys(sk).length){
                const bs = {}; Object.entries(sk).forEach(([k, v]) => { if(typeof v === 'number') bs[`baseSkills.${k}`] = v; });
                if(Object.keys(bs).length) updateDoc(doc(db, 'tournaments', t.id), bs).catch(()=>{});
            }
        }catch(e){}
        appApi.renderTurnajPage();
    }, (err) => console.error('Handicap session:', err));

    let ready = false;
    tbLiveDrinkEventsUnsub = onSnapshot(collection(db, 'handicapSessions', key, 'drinkEvents'), (snap) => {
        if(!ready){ if(!snap.metadata.fromCache) ready = true; return; } // staré události se nepřehrávají
        snap.docChanges().forEach(ch => {
            if(ch.type !== 'added') return;
            const d = ch.doc.data();
            if(!d || !d.name) return;
            if(d.by && d.by === S.currentNick) return; // vlastní právě potvrzené změny už byly přehrány okamžitě
            tbQueueSubstanceEvent(d.type, { name: d.name }, 0, 0, d.amount || 1);
        });
    }, (err) => console.error('Živé události:', err));
}

async function tbSetSkill(t, name, raw){
    if(!hasPerm('turnaj')) return;
    const v = Math.min(100, Math.max(1, parseInt(raw, 10) || 50));
    try{
        await setDoc(doc(db, 'handicapSessions', handicapSessionKey(t)), { [`skills.${tbKey(name)}`]: v }, { merge: true });
        updateDoc(doc(db, 'tournaments', t.id), { [`baseSkills.${tbKey(name)}`]: v }).catch(()=>{});
        tbSaveSkill(name, v);
    }catch(err){ console.error(err); }
}

// ---------- Graf "Vývoj" (jak komu ubýval skill podle piv/panáků/jointů v čase) ----------
let tbGraphAllEvents = null; // cache načtených událostí pro aktuálně otevřený graf
let tbGraphTid = null;
let tbGraphTypes = { beers:true, shots:true, joints:true };
let tbGraphPlayers = null; // Set jmen, null = všichni

export async function openTbDevGraphModal(t){
  tbGraphTid = t.id;
  tbGraphAllEvents = null;
  tbGraphTypes = { beers:true, shots:true, joints:true };
  tbGraphPlayers = null;
  renderTbDevGraphModal(t, true);
  try{
    const key = handicapSessionKey(t);
    const snap = await getDocs(collection(db, 'handicapSessions', key, 'drinkEvents'));
    tbGraphAllEvents = snap.docs.map(d => d.data()).filter(d => d && d.name && d.ts).sort((a,b) => a.ts.localeCompare(b.ts));
  }catch(err){ console.error(err); tbGraphAllEvents = []; }
  renderTbDevGraphModal(t, false);
}
export function closeTbDevGraphModal(){
  tbGraphTid = null;
  const o = document.getElementById('tbGraphOverlay');
  if(o) o.remove();
}

const TB_GRAPH_COLORS = ['#e84393','#4a90d9','#f0c94e','#2ecc71','#9b59b6','#e67e22','#1abc9c','#e74c3c'];

function renderTbDevGraphModal(t, loading){
  let overlay = document.getElementById('tbGraphOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'tbGraphOverlay';
    overlay.className = 'tb-drink-overlay';
    overlay.addEventListener('click', (e) => { if(e.target === overlay) closeTbDevGraphModal(); });
    document.body.appendChild(overlay);
  }
  const allNames = [...new Set((tbGraphAllEvents || []).map(e => e.name))].sort((a,b)=>a.localeCompare(b));
  const selectedNames = tbGraphPlayers || new Set(allNames);

  overlay.innerHTML = `<div class="tb-drink-modal" style="width:760px;">
    <button type="button" class="tb-modal-close-btn" data-tbg-close>✕</button>
    <div class="tb-drink-title">📈 Vývoj</div>
    <div class="tb-drink-sub">Jak komu ubýval skill podle piv, panáků a jointů v průběhu turnaje.</div>
    ${loading ? '<p class="empty">Načítám historii...</p>' : renderTbGraphBody(t, allNames, selectedNames)}
  </div>`;
  overlay.querySelector('[data-tbg-close]').addEventListener('click', closeTbDevGraphModal);
  if(loading) return;

  overlay.querySelectorAll('[data-tbg-type]').forEach(cb => cb.addEventListener('change', () => {
    tbGraphTypes[cb.dataset.tbgType] = cb.checked;
    renderTbDevGraphModal(t, false);
  }));
  overlay.querySelectorAll('[data-tbg-player]').forEach(cb => cb.addEventListener('change', () => {
    if(!tbGraphPlayers) tbGraphPlayers = new Set(allNames);
    if(cb.checked) tbGraphPlayers.add(cb.dataset.tbgPlayer); else tbGraphPlayers.delete(cb.dataset.tbgPlayer);
    renderTbDevGraphModal(t, false);
  }));
  const allBtn = overlay.querySelector('[data-tbg-all]');
  if(allBtn) allBtn.addEventListener('click', () => { tbGraphPlayers = new Set(allNames); renderTbDevGraphModal(t, false); });
  const noneBtn = overlay.querySelector('[data-tbg-none]');
  if(noneBtn) noneBtn.addEventListener('click', () => { tbGraphPlayers = new Set(); renderTbDevGraphModal(t, false); });
}

function renderTbGraphBody(t, allNames, selectedNames){
  if(allNames.length === 0){
    return '<p class="empty" style="color:#b89b6a;">Zatím žádná zaznamenaná piva, panáky ani jointy k zobrazení.</p>';
  }
  const typeRow = `
    <div class="tbg-filters">
      <label><input type="checkbox" data-tbg-type="beers" ${tbGraphTypes.beers?'checked':''}> 🍺 Piva</label>
      <label><input type="checkbox" data-tbg-type="shots" ${tbGraphTypes.shots?'checked':''}> ${TB_SHOT_ICON} Panáky</label>
      <label><input type="checkbox" data-tbg-type="joints" ${tbGraphTypes.joints?'checked':''}> ${TB_JOINT_ICON} Jointy</label>
    </div>
    <div class="tbg-players">
      ${allNames.map((n,i) => `<label style="color:${TB_GRAPH_COLORS[i % TB_GRAPH_COLORS.length]};"><input type="checkbox" data-tbg-player="${escapeHtml(n)}" ${selectedNames.has(n)?'checked':''}> ${escapeHtml(n)}</label>`).join('')}
      <button type="button" class="btn-ghost btn-sm" data-tbg-all>Vše</button>
      <button type="button" class="btn-ghost btn-sm" data-tbg-none>Nic</button>
    </div>
  `;
  return typeRow + buildTbGraphSvg(t, allNames, selectedNames);
}

function buildTbGraphSvg(t, allNames, selectedNames){
  const graphEvents = (tbGraphAllEvents || []).filter(e => tbGraphTypes[e.type]);
  const names = allNames.filter(n => selectedNames.has(n));
  if(names.length === 0) return '<p class="empty" style="color:#b89b6a;">Vyber aspoň jednoho hráče.</p>';

  const W = 680, H = 260, padL = 40, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  // pro každého hráče spočítat efektivní skill po každé JEHO relevantní události (v čase)
  const series = names.map((name, idx) => {
    const base = tbGetPlayerStats(t, name).base;
    let beers = 0, shots = 0, joints = 0;
    const points = [{ t: 0, y: base === null ? 0 : base }];
    graphEvents.filter(e => e.name === name).forEach((e, i) => {
      if(e.type === 'beers') beers = Math.max(0, beers + e.amount);
      if(e.type === 'shots') shots = Math.max(0, shots + e.amount);
      if(e.type === 'joints') joints = Math.max(0, joints + e.amount);
      const y = base === null ? -tbRawHandicap(beers, shots, joints) : tbCalculateCurrentSkill({ baseSkill: base, beers, shots, joints });
      points.push({ t: i + 1, y });
    });
    return { name, color: TB_GRAPH_COLORS[allNames.indexOf(name) % TB_GRAPH_COLORS.length], points, base };
  }).filter(s => s.points.length > 1); // jen hráči, co mají aspoň jednu událost

  if(series.length === 0) return '<p class="empty" style="color:#b89b6a;">Vybraní hráči zatím nemají žádné zaznamenané pití těchhle typů.</p>';

  const maxT = Math.max(1, ...series.map(s => s.points[s.points.length-1].t));
  const allY = series.flatMap(s => s.points.map(p => p.y));
  const minY = Math.min(0, ...allY), maxY = Math.max(10, ...allY);
  const x = tt => padL + (tt / maxT) * plotW;
  const y = yy => padT + plotH - ((yy - minY) / (maxY - minY || 1)) * plotH;

  const gridLines = [];
  for(let i = 0; i <= 4; i++){
    const gy = padT + (plotH / 4) * i;
    const val = Math.round(maxY - ((maxY - minY) / 4) * i);
    gridLines.push(`<line x1="${padL}" y1="${gy}" x2="${W-padR}" y2="${gy}" stroke="#3a281a" stroke-width="1"/><text x="${padL-6}" y="${gy+4}" font-size="10" fill="#8a7550" text-anchor="end">${val}</text>`);
  }

  const linesHtml = series.map(s => {
    const d = s.points.map((p,i) => `${i===0?'M':'L'}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
    const dots = s.points.map(p => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="3" fill="${s.color}"/>`).join('');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2"/>${dots}`;
  }).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" class="tbg-svg" xmlns="http://www.w3.org/2000/svg">
      ${gridLines.join('')}
      ${linesHtml}
    </svg>
    <div class="tbg-legend">${series.map(s => `<span style="color:${s.color};">● ${escapeHtml(s.name)}${s.base===null?' (handicap)':''}</span>`).join('')}</div>
  `;
}

// ---------- Okno "Handicap" (Dota styl) ----------
let tbDrinkModalTid = null;
let tbDrinkPending = {}; // klíč "jméno|typ" -> nepotvrzená změna (+/-), dokud se neklikne na Potvrdit
export function tbCloseDrinkModal(){
    tbDrinkModalTid = null;
    tbDrinkPending = {};
    const o = document.getElementById('tbDrinkOverlay');
    if(o) o.remove();
}
export function openTbDrinkModal(t){
    tbDrinkModalTid = t.id;
    tbDrinkPending = {};
    tbRenderDrinkModal();
}
export function tbRefreshDrinkModal(){
    if(tbDrinkModalTid) tbRenderDrinkModal();
}
function tbPendingCount(){
    return Object.values(tbDrinkPending).reduce((a, d) => a + Math.abs(d), 0);
}
function tbAdjustPending(name, type, delta){
    const key = name + '|' + type;
    tbDrinkPending[key] = (tbDrinkPending[key] || 0) + delta;
    if(tbDrinkPending[key] === 0) delete tbDrinkPending[key];
    tbRenderDrinkModal();
}
async function tbConfirmDrinkChanges(){
    const tid = tbDrinkModalTid;
    const t = S.allTournaments.find(x => x.id === tid);
    const entries = Object.entries(tbDrinkPending).filter(([,d]) => d !== 0);
    if(!tid || !t || entries.length === 0) return;
    tbDrinkPending = {};
    tbRenderDrinkModal();

    const sessionKey = handicapSessionKey(t);
    // zapsat do sdílené session (ostatním turnajům stejné akce/dne i na projektoru se to objeví přes živé události)
    const writes = entries.map(([key, delta]) => {
        const [name, type] = key.split('|');
        return setDoc(doc(db, 'handicapSessions', sessionKey), { [`drinks.${tbKey(name)}.${type}`]: increment(delta) }, { merge: true })
            .then(() => addDoc(collection(db, 'handicapSessions', sessionKey, 'drinkEvents'), { type, name, amount: delta, by: S.currentNick || '', ts: new Date().toISOString() }))
            .catch(err => { console.error(err); });
    });

    // vlastní animace přehrát rovnou, bez čekání na debounce (seskupené podle typu, tbFlushBatch to zajistí)
    entries.forEach(([key, delta]) => {
        const [name, type] = key.split('|');
        S.tbPendingEvents.push({ type, player: { name }, before: 0, after: 0, amount: delta });
    });
    if(S.tbBatchTimer){ clearTimeout(S.tbBatchTimer); S.tbBatchTimer = null; }
    tbFlushBatch();

    await Promise.all(writes);
}
function tbRenderDrinkModal(){
    const t = S.allTournaments.find(x => x.id === tbDrinkModalTid);
    if(!t){ tbCloseDrinkModal(); return; }
    let overlay = document.getElementById('tbDrinkOverlay');
    if(!overlay){
        overlay = document.createElement('div');
        overlay.id = 'tbDrinkOverlay';
        overlay.className = 'tb-drink-overlay';
        overlay.addEventListener('click', (e) => { if(e.target === overlay) tbCloseDrinkModal(); });
        document.body.appendChild(overlay);
    }
    const prev = overlay.querySelector('.tb-drink-body');
    const prevScroll = prev ? prev.scrollTop : 0;
    const ctrl = (icon, type, name, n, pendingD) => `<span class="tb-drink-ctl${pendingD ? ' tb-drink-ctl-pending' : ''}"><span class="tb-drink-ico">${icon}</span><button type="button" class="tb-sub-btn" data-tbd="${escapeHtml(name)}|${type}|-1">−</button><b>${n}${pendingD ? `<em class="tb-drink-pending-diff">${pendingD > 0 ? '+' : ''}${pendingD}</em>` : ''}</b><button type="button" class="tb-sub-btn" data-tbd="${escapeHtml(name)}|${type}|1">+</button></span>`;
    const body = (t.teams || []).map((tm, i) => {
        const members = tm.members || [];
        if(!members.length) return '';
        return `<div class="tb-drink-team">
            <div class="tb-drink-teamname">${tm.emblem ? escapeHtml(tm.emblem) + ' ' : ''}${escapeHtml(tm.name || `Tým ${i+1}`)}</div>
            ${members.map(n => {
                const pB = tbDrinkPending[n + '|beers'] || 0, pS = tbDrinkPending[n + '|shots'] || 0, pJ = tbDrinkPending[n + '|joints'] || 0;
                const s = tbEffectiveStats(t, n);
                const shownBeers = s.beers + pB, shownShots = s.shots + pS, shownJoints = s.joints + pJ;
                const base = s.base === null ? 0 : s.base;
                const shownEff = s.base === null ? null : tbCalculateCurrentSkill({ baseSkill: base, beers: shownBeers, shots: shownShots, joints: shownJoints });
                const shownHc = shownEff === null ? tbRawHandicap(shownBeers, shownShots, shownJoints) : Math.max(0, base - shownEff);
                return `<div class="tb-drink-row" data-tbd-name="${escapeHtml(n)}">
                    <div class="tb-drink-name">${escapeHtml(n)}</div>
                    <label class="tb-drink-skill">Skill <input type="number" min="1" max="100" placeholder="50" value="${s.base === null ? '' : s.base}" data-tbd-skill></label>
                    <div class="tb-drink-eff">${shownEff !== null ? `→ <b>${shownEff}</b>${shownHc > 0 ? ` <em>−${shownHc}</em>` : ''}` : (shownHc > 0 ? `Handicap <em>−${shownHc}</em>` : '')}</div>
                    ${ctrl('🍺', 'beers', n, shownBeers, pB)}${ctrl(TB_SHOT_ICON, 'shots', n, shownShots, pS)}${ctrl(TB_JOINT_ICON, 'joints', n, shownJoints, pJ)}
                </div>`;
            }).join('')}
        </div>`;
    }).join('') || '<div class="empty" style="color:#b89b6a;">Turnaj zatím nemá žádné hráče v týmech.</div>';
    const pendingN = tbPendingCount();
    overlay.innerHTML = `<div class="tb-drink-modal">
        <button type="button" class="tb-modal-close-btn" data-tbd-close>✕</button>
        <div class="tb-drink-title">Handicap turnaje</div>
        <div class="tb-drink-sub">Naklikej piva, panáky a jointy a potvrď tlačítkem dole — teprve pak se to uloží a spustí se animace všem na stránce.</div>
        <div class="tb-drink-body">${body}</div>
        <div class="tb-drink-footer">
            <button type="button" class="tb-btn-confirm" id="tbd-confirm-btn" ${pendingN ? '' : 'disabled'}>✅ Potvrdit${pendingN ? ` (${pendingN})` : ''}</button>
        </div>
    </div>`;
    const nb = overlay.querySelector('.tb-drink-body');
    if(nb) nb.scrollTop = prevScroll;
    overlay.querySelector('[data-tbd-close]').addEventListener('click', tbCloseDrinkModal);
    overlay.querySelector('#tbd-confirm-btn').addEventListener('click', tbConfirmDrinkChanges);
    overlay.querySelectorAll('.tb-drink-row').forEach(row => {
        const name = row.dataset.tbdName;
        row.querySelectorAll('[data-tbd]').forEach(btn => btn.addEventListener('click', () => {
            const [, type, d] = btn.dataset.tbd.split('|');
            tbAdjustPending(name, type, parseInt(d, 10));
        }));
        const sk = row.querySelector('[data-tbd-skill]');
        sk.addEventListener('change', () => tbSetSkill(t, name, sk.value));
    });
}

// ---------- Týmy nad pavoukem ----------
export function renderTourneyTeamsPanel(t, box){
    if(!box) return;
    const teams = t.teams || [];
    if(!teams.some(tm => (tm.members || []).length)){ box.innerHTML = ''; return; }
    box.innerHTML = teams.map((tm, i) => {
        let sumEff = 0, sumHc = 0, any = false;
        const capt = teamCaptain(t, tm);
        const rows = (tm.members || []).map(n => {
            const s = tbEffectiveStats(t, n);
            if(s.eff !== null){ any = true; sumEff += s.eff; sumHc += s.handicap; }
            const dr = (s.beers || s.shots || s.joints)
                ? `<span class="ttp-drinks">${s.beers ? `🍺${s.beers} ` : ''}${s.shots ? `${TB_SHOT_ICON}${s.shots} ` : ''}${s.joints ? `${TB_JOINT_ICON}${s.joints}` : ''}</span>` : '';
            const isCapt = n === capt;
            return `<div class="ttp-player"><span class="ttp-name ${isCapt ? 'ttp-captain' : ''}">${isCapt ? '👑 ' : ''}${escapeHtml(n)}</span>${dr}<span class="ttp-skill">${s.base !== null ? s.base : '–'}${s.handicap > 0 ? `<em class="ttp-hc">−${s.handicap}</em>` : ''}</span></div>`;
        }).join('');
        const nameStyle = tm.color ? `style="color:${tm.color};"` : '';
        return `<div class="ttp-card">
            <div class="ttp-head"><span ${nameStyle}>${tm.emblem ? escapeHtml(tm.emblem) + ' ' : ''}${escapeHtml(tm.name || `Tým ${i+1}`)}</span>${any ? `<span class="ttp-total"><b>${sumEff}</b>${sumHc > 0 ? ` <em class="ttp-hc">−${sumHc}</em>` : ''}</span>` : ''}</div>
            ${rows}
        </div>`;
    }).join('');
}

export function tbUnlockSound(){
    S.tbSoundUnlocked = true;
    S.tbSoundEnabled = true;
    try{ tbEnsureAudio(); if(S.tbAudioCtx && S.tbAudioCtx.state === 'suspended') S.tbAudioCtx.resume(); }catch(e){}
    try{
        if('speechSynthesis' in window){
            const u = new SpeechSynthesisUtterance('Zvuk zapnut');
            u.lang = 'cs-CZ';
            speechSynthesis.speak(u);
        }
    }catch(e){}
    tbPlayBeep(880, 0.12, 'triangle');
}

function isMemberElsewhere(teams, currentIdx, nick){
  return teams.some((tm,i) => i!==currentIdx && tm.members.includes(nick));
}

async function renderTeamEditor(t, container, onSaved){
  const editorWrap = document.createElement('div');
  editorWrap.className = 'tourney-setup-panel';
  editorWrap.innerHTML = `<div class="empty">Načítám přihlášené na akci...</div>`;
  container.appendChild(editorWrap);

  let goingRegs = [];
  if(t.eventId){
    try{
      const snap = await getDocs(collection(db, 'events', t.eventId, 'registrations'));
      goingRegs = snap.docs.map(d => d.data()).filter(r => r.status !== 'maybe').sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
    }catch(err){ console.error(err); }
  }

  editorWrap.innerHTML = `
    <div class="team-editor" id="team-editor-grid"></div>
    <div style="display:flex; gap:10px; margin-top:14px;">
      <button type="button" id="btn-add-team" class="btn-sm">+ Přidat tým</button>
      <button type="button" id="btn-save-teams">Uložit týmy</button>
    </div>
  `;

  let workingTeams = JSON.parse(JSON.stringify(t.teams || []));

  function renderGrid(){
    const grid = document.getElementById('team-editor-grid');
    grid.innerHTML = workingTeams.map((team, ti) => `
      <div class="team-editor-card">
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px; position:relative;">
          <button type="button" class="team-style-btn" data-team-style-toggle="${ti}" style="border-color:${team.color||'var(--line)'};">
            <span style="color:${team.color||'inherit'};">${team.emblem || '🚩'}</span>
          </button>
          <input type="text" class="team-name" data-team-name="${ti}" value="${escapeHtml(team.name)}" style="flex:1; color:${team.color||'inherit'};">
          <div class="team-style-panel" data-team-style-panel="${ti}" style="display:none;">
            <div class="team-style-panel-label">Logo</div>
            <div class="chip-row">
              ${TEAM_EMBLEMS.map(em => `<span class="chip" data-team-emblem="${ti}" data-emblem-val="${em}" style="cursor:pointer; font-size:15px; ${team.emblem===em?'border-color:var(--gold); color:var(--gold);':''}">${em}</span>`).join('')}
            </div>
            <div class="team-style-panel-label">Barva</div>
            <div class="chip-row">
              ${TEAM_COLORS.map(c => `<span class="color-swatch ${team.color===c?'active':''}" data-team-color="${ti}" data-color-val="${c}" style="background:${c};"></span>`).join('')}
            </div>
          </div>
        </div>
        <div class="team-roster-list">
          ${goingRegs.map(r => `
            <label class="team-roster-item">
              <input type="checkbox" data-team-member="${ti}" value="${escapeHtml(r.nick)}" ${team.members.includes(r.nick)?'checked':''}>
              <span>${escapeHtml(r.nick)}${isMemberElsewhere(workingTeams, ti, r.nick) ? ' (hostuje)' : ''}</span>
            </label>
          `).join('')}
          ${team.members.filter(m => !goingRegs.some(r=>r.nick===m)).map(guest => `
            <label class="team-roster-item">
              <input type="checkbox" data-team-guest-remove="${ti}" value="${escapeHtml(guest)}" checked>
              <span>${escapeHtml(guest)} (host)</span>
            </label>
          `).join('')}
        </div>
        <div class="team-guest-row">
          <input type="text" placeholder="Přidat hráče mimo seznam (i neregistrovaného)" data-guest-input="${ti}">
          <button type="button" class="btn-ghost btn-sm" data-guest-add="${ti}">+</button>
        </div>
        ${workingTeams.length > 2 ? `<button type="button" class="btn-ghost btn-sm" data-remove-team="${ti}" style="margin-top:8px; color:var(--crimson); border-color:var(--crimson);">Odebrat tým</button>` : ''}
      </div>
    `).join('');

    grid.querySelectorAll('[data-team-name]').forEach(inp => {
      inp.addEventListener('input', () => { workingTeams[parseInt(inp.dataset.teamName,10)].name = inp.value; });
    });
    grid.querySelectorAll('[data-team-style-toggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ti = btn.dataset.teamStyleToggle;
        grid.querySelectorAll('[data-team-style-panel]').forEach(p => {
          p.style.display = (p.dataset.teamStylePanel === ti && p.style.display === 'none') ? 'flex' : 'none';
        });
      });
    });
    grid.querySelectorAll('[data-team-emblem]').forEach(el => {
      el.addEventListener('click', () => {
        workingTeams[parseInt(el.dataset.teamEmblem,10)].emblem = el.dataset.emblemVal;
        renderGrid();
      });
    });
    grid.querySelectorAll('[data-team-color]').forEach(el => {
      el.addEventListener('click', () => {
        workingTeams[parseInt(el.dataset.teamColor,10)].color = el.dataset.colorVal;
        renderGrid();
      });
    });
    grid.querySelectorAll('[data-team-member]').forEach(cb => {
      cb.addEventListener('change', () => {
        const ti = parseInt(cb.dataset.teamMember,10);
        const nick = cb.value;
        if(cb.checked){ if(!workingTeams[ti].members.includes(nick)) workingTeams[ti].members.push(nick); }
        else{ workingTeams[ti].members = workingTeams[ti].members.filter(m=>m!==nick); }
        renderGrid();
      });
    });
    grid.querySelectorAll('[data-team-guest-remove]').forEach(cb => {
      cb.addEventListener('change', () => {
        if(!cb.checked){
          const ti = parseInt(cb.dataset.teamGuestRemove,10);
          workingTeams[ti].members = workingTeams[ti].members.filter(m=>m!==cb.value);
          renderGrid();
        }
      });
    });
    grid.querySelectorAll('[data-guest-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ti = parseInt(btn.dataset.guestAdd,10);
        const input = grid.querySelector(`[data-guest-input="${ti}"]`);
        const val = input.value.trim();
        if(!val) return;
        if(!workingTeams[ti].members.includes(val)) workingTeams[ti].members.push(val);
        renderGrid();
      });
    });
    grid.querySelectorAll('[data-remove-team]').forEach(btn => {
      btn.addEventListener('click', () => {
        workingTeams.splice(parseInt(btn.dataset.removeTeam,10),1);
        renderGrid();
      });
    });
  }
  renderGrid();
  document.addEventListener('click', (e) => {
    if(!e.target.closest('[data-team-style-panel]') && !e.target.closest('[data-team-style-toggle]')){
      document.querySelectorAll('[data-team-style-panel]').forEach(p => { p.style.display = 'none'; });
    }
  });

  document.getElementById('btn-add-team').addEventListener('click', () => {
    workingTeams.push({ name:`Tým ${workingTeams.length+1}`, members:[], emblem:'' });
    renderGrid();
  });

  document.getElementById('btn-save-teams').addEventListener('click', async () => {
    try{
      await updateDoc(doc(db,'tournaments',t.id), { teams: workingTeams });
      logAction('turnaj', `upravil rozdělení týmů v turnaji „${t.name}“`);
      if(onSaved) onSaved(); else appApi.renderTurnajPage();
    }catch(err){ alert('Uložení týmů se nepovedlo.'); console.error(err); }
  });
}

export function computeSwissTournament(t){
  const teams = t.teams || [];
  const n = teams.length;
  const results = t.results || {};
  const swissResults = t.swissResults || {};

  function resolvePair(resObj, key){
    const res = resObj[key];
    if(res && typeof res.a==='number' && typeof res.b==='number' && (res.a>=2||res.b>=2) && res.a!==res.b){
      return { result:res, winnerSide: res.a>res.b ? 'A' : 'B' };
    }
    return { result: res||null, winnerSide: null };
  }

  let round0 = [];
  let wins = new Array(n).fill(0);
  for(let i=0;i<n;i++){
    for(let j=i+1;j<n;j++){
      const key = `RR-${i}-${j}`;
      const { result, winnerSide } = resolvePair(results, key);
      const winnerIdx = winnerSide==='A' ? i : (winnerSide==='B' ? j : null);
      if(winnerIdx!==null) wins[winnerIdx]++;
      round0.push({ key, teamA:i, teamB:j, result, winnerIdx });
    }
  }
  const round0Complete = n >= 2 && round0.every(m => m.winnerIdx !== null);

  let rounds = [round0];
  let placements = [];

  if(round0Complete){
    let currentWins = [...wins];
    let currentActive = teams.map((_,i)=>i);
    let roundIndex = 1;
    let safety = 0;

    while(currentActive.length > 1 && safety < 25){
      safety++;
      const sorted = [...currentActive].sort((a,b) => currentWins[b]-currentWins[a] || a-b);
      const pairs = [];
      for(let i=0;i<sorted.length;i+=2){
        if(i+1 < sorted.length) pairs.push([sorted[i], sorted[i+1]]);
      }
      const leftover = sorted.length % 2 === 1 ? sorted[sorted.length-1] : null;

      const roundMatches = pairs.map(([a,b], idx) => {
        const key = `SR${roundIndex}-${idx}`;
        const { result, winnerSide } = resolvePair(swissResults, key);
        const winnerIdx = winnerSide==='A' ? a : (winnerSide==='B' ? b : null);
        return { key, teamA:a, teamB:b, result, winnerIdx };
      });

      const benched = [...placements.map(p => p.team)];
      if(leftover !== null) benched.push(leftover);
      const exhibitions = [];
      for(let bi = 0; bi + 1 < benched.length; bi += 2){
        const a = benched[bi], b = benched[bi+1];
        const key = `SR${roundIndex}-ex${bi/2}`;
        const { result, winnerSide } = resolvePair(swissResults, key);
        const winnerIdx = winnerSide==='A' ? a : (winnerSide==='B' ? b : null);
        exhibitions.push({ key, teamA:a, teamB:b, result, winnerIdx, exhibition:true });
      }

      rounds.push(exhibitions.length ? [...roundMatches, ...exhibitions] : roundMatches);

      const roundComplete = roundMatches.every(m => m.winnerIdx !== null);
      if(!roundComplete) break;

      roundMatches.forEach(m => { currentWins[m.winnerIdx]++; });

      const resorted = [...currentActive].sort((a,b) => currentWins[b]-currentWins[a] || a-b);
      const leaderIdx = resorted[0];
      const runnerUpIdx = resorted.length > 1 ? resorted[1] : null;

      if(runnerUpIdx !== null && currentWins[leaderIdx] > currentWins[runnerUpIdx]){
        const headToHead = roundMatches.find(m =>
          (m.teamA===leaderIdx && m.teamB===runnerUpIdx) || (m.teamA===runnerUpIdx && m.teamB===leaderIdx)
        );
        if(headToHead && headToHead.winnerIdx === leaderIdx){
          placements.push({ rank: placements.length+1, team: leaderIdx });
          currentActive = currentActive.filter(i => i !== leaderIdx);
        }
      }
      if(currentActive.length === 1){
        placements.push({ rank: placements.length+1, team: currentActive[0] });
        currentActive = [];
      }
      roundIndex++;
    }
  }

  return { round0, round0Complete, rounds, placements, wins };
}

export function renderSwissBody(t, swiss, container, compact){
  const wrap = document.createElement('div');
  wrap.className = 'bracket-wrap' + (compact ? ' bracket-compact' : '');
  wrap.style.position = 'relative';
  container.appendChild(wrap);

  swiss.rounds.forEach((roundMatches, ri) => {
    const col = document.createElement('div');
    col.className = 'bracket-round';
    col.dataset.bracketRoundIndex = ri;
    col.innerHTML = `<div class="bracket-round-title">Kolo ${ri+1}</div>`;
    const realMatches = roundMatches.filter(m => !m.exhibition);
    const exMatches = roundMatches.filter(m => m.exhibition);
    const matchesBox = document.createElement('div');
    matchesBox.className = 'bracket-round-matches';
    realMatches.forEach(m => matchesBox.appendChild(renderSwissMatchBox(t, ri===0?'results':'swissResults', m, compact)));
    col.appendChild(matchesBox);
    if(exMatches.length > 0){
      const exBox = document.createElement('div');
      exBox.className = 'bracket-round-exhibitions';
      exMatches.forEach(m => exBox.appendChild(renderSwissMatchBox(t, 'swissResults', m, compact)));
      col.appendChild(exBox);
    }
    wrap.appendChild(col);
  });

  if(!swiss.round0Complete){
    const col = document.createElement('div');
    col.className = 'bracket-round';
    col.innerHTML = `<div class="bracket-round-title">Další kola</div><div class="bracket-slot placeholder">Čeká na dohrání kola 1</div>`;
    wrap.appendChild(col);
  }

  if(!compact) requestAnimationFrame(() => {
    wrap.style.transform = 'none';
    layoutBracketRounds(wrap);
    drawBracketConnectors(wrap);
    fitBracketToScreen(wrap);
  });
}

function buildPodiumHtml(t, swiss, big){
  const p1 = swiss.placements.find(p=>p.rank===1);
  const p2 = swiss.placements.find(p=>p.rank===2);
  const p3 = swiss.placements.find(p=>p.rank===3);
  const rest = swiss.placements.filter(p=>p.rank>3);
  const step = (p, idx, rankClass, rank) => {
    const tm = teamObj(t, p.team);
    const nameStyle = tm.color ? `style="color:${tm.color};"` : '';
    return `<div class="podium-step podium-${rank}">
      <div class="podium-team" ${nameStyle}>${trophySvg(rank)}${tm.emblem ? escapeHtml(tm.emblem) + ' ' : ''}${escapeHtml(teamName(t,p.team))}</div>
      ${podiumCupHtml(t, rankClass, rank, teamName(t,p.team))}
      ${teamMembersHtml(t, tm)}
    </div>`;
  };
  let html = `<div class="podium-wrap ${big?'podium-wrap-big':''}">`;
  if(p2) html += step(p2, 2, 'silver', 2);
  if(p1) html += step(p1, 1, 'gold', 1);
  if(p3) html += step(p3, 3, 'bronze', 3);
  html += `</div>`;
  if(rest.length > 0){
    html += rest.map(p => {
      const isFourth = p.rank === 4;
      const tm = teamObj(t, p.team);
      return `<div class="bracket-slot" style="margin-top:8px; flex-direction:column; align-items:flex-start;">
        <span>${isFourth ? '🥔' : (p.rank+'.')} ${tm.emblem ? escapeHtml(tm.emblem) + ' ' : ''}<span ${tm.color?`style=\"color:${tm.color};\"`:''}>${escapeHtml(teamName(t,p.team))}</span></span>
        ${teamMembersHtml(t, tm)}
      </div>`;
    }).join('');
  }
  return html;
}

export function openTeamEditorModal(t){
  const backdrop = document.createElement('div');
  backdrop.className = 'score-modal-backdrop';
  backdrop.innerHTML = `
    <div class="score-modal result-modal team-editor-modal">
      <div style="font-size:16px; font-weight:600;">Upravit týmy — ${escapeHtml(t.name)}</div>
      <div id="team-editor-modal-body"></div>
      <button type="button" class="btn-ghost" id="team-editor-modal-close" style="align-self:flex-start;">Zavřít</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => { backdrop.remove(); appApi.renderTurnajPage(); };
  document.getElementById('team-editor-modal-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if(e.target === backdrop) close(); });
  renderTeamEditor(t, document.getElementById('team-editor-modal-body'), close);
}

export function openTournamentResultModal(t, swiss, ffaStandings){
  const backdrop = document.createElement('div');
  backdrop.className = 'score-modal-backdrop';
  const podiumHtml = ffaStandings ? buildFfaPodiumHtml(t, ffaStandings, true) : buildPodiumHtml(t, swiss, true);
  backdrop.innerHTML = `
    <div class="score-modal result-modal">
      <div style="font-size:18px; font-weight:700; font-family:'Cinzel', serif; color:var(--gold); text-align:center;">🏆 ${escapeHtml(t.name)}</div>
      ${podiumHtml}
      <button type="button" class="btn-ghost" id="result-modal-close" style="margin-top:16px;">Zavřít</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('result-modal-close').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if(e.target === backdrop) backdrop.remove(); });
}

export function fitBracketToScreen(wrap){
  const container = wrap.parentElement; // .bracket-scale-wrap
  if(!container) return;
  wrap.style.transform = 'none';
  container.style.height = 'auto';
  const naturalWidth = wrap.scrollWidth;
  const naturalHeight = wrap.scrollHeight;
  const availableWidth = container.clientWidth;
  const top = wrap.getBoundingClientRect().top;
  const availableHeight = Math.max(300, window.innerHeight - top - 70);
  let scale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);
  if(scale < 1){
    wrap.style.transformOrigin = 'top left';
    wrap.style.transform = `scale(${scale})`;
    container.style.height = (naturalHeight * scale) + 'px';
  }else{
    wrap.style.transform = 'none';
    container.style.height = naturalHeight + 'px';
  }
}

export function layoutBracketRounds(wrap){
  const roundCols = Array.from(wrap.querySelectorAll('[data-bracket-round-index]')).sort((a,b) => a.dataset.bracketRoundIndex - b.dataset.bracketRoundIndex);
  if(roundCols.length < 2) return;

  roundCols.forEach(col => { col.style.marginTop = ''; });

  for(let r = 1; r < roundCols.length; r++){
    const prevReal = roundCols[r-1].querySelectorAll('.bracket-round-matches .bracket-match');
    const curMatchesBox = roundCols[r].querySelector('.bracket-round-matches');
    if(prevReal.length === 0 || !curMatchesBox) continue;
    const firstRect = prevReal[0].getBoundingClientRect();
    const lastRect = prevReal[prevReal.length-1].getBoundingClientRect();
    const spanCenterY = (firstRect.top + lastRect.bottom) / 2;
    const boxRect = curMatchesBox.getBoundingClientRect();
    const desiredTop = spanCenterY - boxRect.height/2;
    const marginTop = desiredTop - boxRect.top;
    roundCols[r].style.marginTop = Math.max(0, marginTop) + 'px';
  }
}

export function drawBracketConnectors(wrap){
  const old = wrap.querySelector('svg.bracket-connectors');
  if(old) old.remove();
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'bracket-connectors');
  svg.style.position = 'absolute';
  svg.style.left = '0'; svg.style.top = '0';
  svg.style.width = wrap.scrollWidth + 'px';
  svg.style.height = wrap.scrollHeight + 'px';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '0';

  const wrapRect = wrap.getBoundingClientRect();
  const roundCols = Array.from(wrap.querySelectorAll('[data-bracket-round-index]')).sort((a,b) => a.dataset.bracketRoundIndex - b.dataset.bracketRoundIndex);

  for(let r = 0; r < roundCols.length - 1; r++){
    const matches = roundCols[r].querySelectorAll('.bracket-match:not(.bracket-match-exhibition)');
    const nextMatches = roundCols[r+1].querySelectorAll('.bracket-match:not(.bracket-match-exhibition)');
    if(nextMatches.length === 0) continue;
    matches.forEach((m, i) => {
      const targetIdx = Math.min(Math.floor(i/2), nextMatches.length-1);
      const target = nextMatches[targetIdx];
      if(!target) return;
      const a = m.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      const x1 = a.right - wrapRect.left;
      const y1 = a.top + a.height/2 - wrapRect.top;
      const x2 = b.left - wrapRect.left;
      const y2 = b.top + b.height/2 - wrapRect.top;
      const midX = x1 + (x2 - x1) / 2;
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--gold-dim)');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-dasharray', '4 4');
      path.setAttribute('opacity', '0.7');
      svg.appendChild(path);
    });
  }
  wrap.insertBefore(svg, wrap.firstChild);
}

function renderSwissMatchBox(t, resultField, m, compact){
  const div = document.createElement('div');
  div.className = 'bracket-match' + (m.exhibition ? ' bracket-match-exhibition' : '');
  const teamAObj = t.teams[m.teamA], teamBObj = t.teams[m.teamB];
  const labelA = teamName(t, m.teamA), labelB = teamName(t, m.teamB);
  const emblemA = teamAObj?.emblem ? teamAObj.emblem+' ' : '';
  const emblemB = teamBObj?.emblem ? teamBObj.emblem+' ' : '';
  const membersA = '';
  const membersB = '';
  const curA = m.result ? m.result.a : 0;
  const curB = m.result ? m.result.b : 0;
  const colorA = teamAObj?.color ? `style="color:${teamAObj.color};"` : '';
  const colorB = teamBObj?.color ? `style="color:${teamBObj.color};"` : '';
  const clickable = hasPerm('turnaj') && !compact;
  div.innerHTML = `
    ${m.exhibition ? `<div class="bracket-exhibition-label">Zápas mimo turnaj</div>` : ''}
    <div class="bracket-slot ${m.winnerIdx===m.teamA ? 'winner-slot':''} ${clickable?'bracket-slot-clickable':''}" ${clickable?'data-sw-slot="A"':''} title="${clickable?'Levé tlačítko = přidat výhru, pravé = ubrat':''}">
      <span class="bracket-slot-main"><span class="bracket-team-name" ${colorA}>${emblemA}${escapeHtml(labelA)}</span>${membersA?`<span class="bracket-team-members">${escapeHtml(membersA)}</span>`:''}</span><span class="bracket-slot-score">${curA}</span>
    </div>
    <div class="bracket-slot ${m.winnerIdx===m.teamB ? 'winner-slot':''} ${clickable?'bracket-slot-clickable':''}" ${clickable?'data-sw-slot="B"':''} title="${clickable?'Levé tlačítko = přidat výhru, pravé = ubrat':''}">
      <span class="bracket-slot-main"><span class="bracket-team-name" ${colorB}>${emblemB}${escapeHtml(labelB)}</span>${membersB?`<span class="bracket-team-members">${escapeHtml(membersB)}</span>`:''}</span><span class="bracket-slot-score">${curB}</span>
    </div>
  `;

  if(clickable){
    async function adjust(side, delta){
      let a = curA, b = curB;
      if(side === 'A') a = Math.max(0, Math.min(2, a + delta));
      else b = Math.max(0, Math.min(2, b + delta));
      try{ await updateDoc(doc(db,'tournaments',t.id), { [`${resultField}.${m.key}`]: { a, b } }); }
      catch(err){ console.error(err); }
    }
    const slotA = div.querySelector('[data-sw-slot="A"]');
    const slotB = div.querySelector('[data-sw-slot="B"]');
    slotA.addEventListener('click', () => adjust('A', 1));
    slotA.addEventListener('contextmenu', (e) => { e.preventDefault(); adjust('A', -1); });
    slotB.addEventListener('click', () => adjust('B', 1));
    slotB.addEventListener('contextmenu', (e) => { e.preventDefault(); adjust('B', -1); });
  }

  return div;
}

