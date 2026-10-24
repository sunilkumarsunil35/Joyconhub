import '../shared/theme.css';
import './hub.css';
import type { GameDefinition } from '@joyconhub/game-sdk';
import { escapeHtml } from '../shared/storage.ts';
import { GAMES, findGame } from './registry.ts';
import { GameSession } from './session.ts';

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const app = document.getElementById('app')!;
let session: GameSession | null = null;

function card(g: GameDefinition): string {
  return `
    <button class="card" style="--card-accent:${g.accent}" data-game="${g.id}" ${g.available ? '' : 'disabled'}>
      <div class="icon">${g.icon}</div>
      <h3>${escapeHtml(g.title)}</h3>
      <div class="tagline">${escapeHtml(g.tagline)}</div>
      <p>${escapeHtml(g.description)}</p>
      ${g.available ? '<span class="cta">Play →</span>' : '<span class="soon">Coming soon</span>'}
    </button>`;
}

function renderHome(): void {
  document.title = 'JoyCon Hub';
  app.innerHTML = `
    <div class="hub">
      <header class="topbar">
        <span class="logo"><span class="pills"><i></i><i></i></span>JoyCon <b>Hub</b></span>
        <a href="#how">How it works</a>
      </header>
      <section class="hero">
        <span class="eyebrow">📱 No app. No sign-up. Just scan.</span>
        <h1>Your phone is the <em>controller</em>.</h1>
        <p>Pick a game on this screen, scan the QR code with your phone, and tilt to play. The motion sensors in your phone do the rest.</p>
      </section>
      <div class="section-title">Games</div>
      <section class="games">${GAMES.map(card).join('')}</section>
      <div class="section-title" id="how">How it works</div>
      <section class="how">
        <div class="step"><span class="num">1</span><h4>Pick a game</h4><p>Open JoyCon Hub on a laptop, desktop or TV browser and choose a game.</p></div>
        <div class="step"><span class="num">2</span><h4>Scan the QR</h4><p>Point your phone camera at the code. The controller opens in your phone's browser.</p></div>
        <div class="step"><span class="num">3</span><h4>Calibrate</h4><p>Hold the phone sideways like a gamepad and tap Calibrate. That pose means “fly straight”.</p></div>
        <div class="step"><span class="num">4</span><h4>Tilt to play</h4><p>Your phone's gyroscope and accelerometer stream your moves to the big screen in real time.</p></div>
      </section>
      <footer>JoyCon Hub · Built for phones with motion sensors (iOS Safari 13+, Android Chrome).</footer>
    </div>`;
  app.querySelectorAll<HTMLButtonElement>('[data-game]').forEach((b) => {
    b.onclick = () => openGame(b.dataset.game!);
  });
}

/** Current URL with some query params changed, keeping others such as debug/transport. */
function withParams(changes: Record<string, string | null>): string {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const qs = q.toString();
  return qs ? `${location.pathname}?${qs}` : location.pathname;
}

function openGame(id: string, push = true): void {
  const def = findGame(id);
  if (!def?.available || !def.load) return;
  session?.destroy();
  if (push) history.pushState({ game: id }, '', withParams({ game: id }));
  document.title = `${def.title} · JoyCon Hub`;
  session = new GameSession(def, app, { exit: goHome, debug });
  void session.start();
}

function goHome(): void {
  session?.destroy();
  session = null;
  history.pushState({}, '', withParams({ game: null }));
  renderHome();
}

function route(): void {
  const id = new URLSearchParams(location.search).get('game');
  if (id && findGame(id)?.available) {
    if (!session) openGame(id, false);
  } else {
    session?.destroy();
    session = null;
    renderHome();
  }
}

window.addEventListener('popstate', () => {
  session?.destroy();
  session = null;
  route();
});

route();
