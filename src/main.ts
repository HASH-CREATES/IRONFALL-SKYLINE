import './style.css';
import { Game } from './core/Game';

const game = new Game();
void game.boot();

// expose a tiny handle for exhibition debugging in the browser console
(window as unknown as { IRONFALL: Game }).IRONFALL = game;
