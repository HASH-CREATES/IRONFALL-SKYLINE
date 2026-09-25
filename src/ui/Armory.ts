import { SUITS, suitById, savedSuitId, type SuitFrame } from '../player/Suit';

/* ------------------------------------------------------------------ *
 * ARMORY — character/frame selection screen.
 * AAA armory pattern, unique execution: the live 3D hero stays
 * center-stage between the frame rail (left) and the dossier panel
 * (right). Selecting a frame re-skins the hero instantly; EQUIP commits
 * the frame's gameplay modifiers.
 * ------------------------------------------------------------------ */

function serialFor(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `IC-77-${((h >>> 0) % 90000 + 10000).toString()}-${id.slice(0, 2).toUpperCase()}`;
}

export class Armory {
  root: HTMLDivElement;
  visible = false;
  onAction: (action: string, payload?: string) => void = () => {};

  private selected: SuitFrame;
  private equipped: SuitFrame;
  private rail: HTMLDivElement;
  private dossier: HTMLDivElement;
  private cta: HTMLButtonElement;
  private status: HTMLDivElement;

  constructor() {
    this.equipped = suitById(savedSuitId());
    this.selected = this.equipped;

    this.root = document.createElement('div');
    this.root.className = 'ic-armory ic-hidden';
    this.root.innerHTML = `
      <div class="ia-top">
        <div class="ia-kicker">
          <span class="ia-tick"></span> ARMORY // FRAME SELECTION
        </div>
        <div class="ia-hint">SELECT · EVALUATE · EQUIP</div>
        <button class="ic-btn small ghost" data-act="close-armory">Back</button>
      </div>

      <div class="ia-rail" id="ia-rail"></div>

      <div class="ia-spacer" aria-hidden="true"></div>

      <div class="ia-dossier">
        <div class="ia-scan" aria-hidden="true"></div>
        <div class="ia-dossier-head">
          <div>
            <div class="ia-codename" id="ia-codename"></div>
            <div class="ia-frame-name" id="ia-frame-name"></div>
          </div>
          <div class="ia-role" id="ia-role"></div>
        </div>
        <p class="ia-story" id="ia-story"></p>
        <div class="ia-serial" id="ia-serial"></div>
        <div class="ia-stats" id="ia-stats"></div>
        <div class="ia-cta-row">
          <button class="ic-btn primary" id="ia-equip" data-act="equip-suit">Equip Frame</button>
          <div class="ia-status" id="ia-status"></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.rail = this.root.querySelector('#ia-rail') as HTMLDivElement;
    this.dossier = this.root.querySelector('.ia-dossier') as HTMLDivElement;
    this.cta = this.root.querySelector('#ia-equip') as HTMLButtonElement;
    this.status = this.root.querySelector('#ia-status') as HTMLDivElement;

    this.buildRail();
    this.renderDossier();
    this.syncEquipState();

    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!el) return;
      const act = el.dataset.act!;
      if (act === 'select-suit') {
        this.select(el.dataset.suit!);
        this.onAction('select-suit', el.dataset.suit);
      } else {
        this.onAction(act);
      }
    });
  }

  private buildRail(): void {
    this.rail.innerHTML = SUITS.map((s) => {
      const sw = `#${s.palette.primary.toString(16).padStart(6, '0')}`;
      const ac = `#${s.palette.glow.toString(16).padStart(6, '0')}`;
      return `
        <div class="ia-card" data-act="select-suit" data-suit="${s.id}">
          <div class="ia-chip" style="background:${sw};box-shadow:0 0 14px ${ac}55"></div>
          <div class="ia-card-body">
            <div class="ia-card-name">${s.name}</div>
            <div class="ia-card-code">${s.codename} · ${s.role}</div>
          </div>
          <div class="ia-equipped-tag" title="equipped">◆</div>
        </div>`;
    }).join('');
    this.markSelection();
  }

  private markSelection(): void {
    for (const card of Array.from(this.rail.children) as HTMLElement[]) {
      const id = card.dataset.suit;
      card.classList.toggle('sel', id === this.selected.id);
      card.classList.toggle('eq', id === this.equipped.id);
    }
  }

  private renderDossier(): void {
    const s = this.selected;
    (this.root.querySelector('#ia-codename') as HTMLDivElement).textContent = s.codename;
    (this.root.querySelector('#ia-frame-name') as HTMLDivElement).textContent = s.name;
    (this.root.querySelector('#ia-role') as HTMLDivElement).textContent = s.role;
    (this.root.querySelector('#ia-story') as HTMLParagraphElement).textContent = s.story;
    (this.root.querySelector('#ia-serial') as HTMLDivElement).textContent =
      `FRAME SERIAL ${serialFor(s.id)} · FABRICATED AT ZERO POINT WORKS · CERT FLIGHT/COMBAT`;

    const rows: [string, number, string][] = [
      ['THRUST', s.stats.speed, '#7fd7ff'],
      ['OUTPUT', s.stats.power, '#ffc46a'],
      ['ARMOR', s.stats.armor, '#ff7f6a'],
      ['REACTOR', s.stats.energy, '#8fffd2'],
    ];
    (this.root.querySelector('#ia-stats') as HTMLDivElement).innerHTML = rows
      .map(
        ([label, v, color]) => `
        <div class="ia-stat">
          <div class="ia-stat-label"><span>${label}</span><b>${v}</b></div>
          <div class="ia-stat-bar"><div class="ia-stat-fill" style="width:0%;background:${color}"></div></div>
        </div>`,
      )
      .join('');

    // animate the bars in on next frame
    requestAnimationFrame(() => {
      const fills = this.root.querySelectorAll<HTMLDivElement>('.ia-stat-fill');
      const values = [s.stats.speed, s.stats.power, s.stats.armor, s.stats.energy];
      fills.forEach((f, i) => {
        f.style.width = `${values[i]}%`;
      });
    });
  }

  private syncEquipState(): void {
    const equipped = this.selected.id === this.equipped.id;
    this.cta.textContent = equipped ? 'Frame Equipped' : 'Equip Frame';
    this.cta.classList.toggle('is-equipped', equipped);
    this.cta.setAttribute('aria-disabled', String(equipped));
    this.status.textContent = equipped ? 'FRAME LINKED // ACTIVE' : 'FRAME STAGED // AWAITING LINK';
    for (const card of Array.from(this.rail.children) as HTMLElement[]) {
      card.classList.toggle('eq', card.dataset.suit === this.equipped.id);
    }
  }

  /** Preview-select a frame (re-skins the hero via the Game handler). */
  select(id: string): void {
    const s = suitById(id);
    if (s.id === this.selected.id) return;
    this.selected = s;
    this.markSelection();
    this.renderDossier();
    this.syncEquipState();
  }

  /** Commit the equipped frame (called by Game after applySuit). */
  commitEquip(id: string): void {
    this.equipped = suitById(id);
    this.selected = this.equipped;
    this.markSelection();
    this.renderDossier();
    this.syncEquipState();
  }

  /** Id of the frame currently preview-selected (read by Game on equip). */
  selectedId(): string {
    return this.selected.id;
  }

  show(): void {
    this.visible = true;
    this.root.classList.remove('ic-hidden');
    this.root.classList.add('open');
    this.renderDossier();
    this.syncEquipState();
  }

  hide(): void {
    this.visible = false;
    this.root.classList.add('ic-hidden');
    this.root.classList.remove('open');
  }
}
