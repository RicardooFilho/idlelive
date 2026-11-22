// Votos no idlehub.io: cada botão abre a página de voto do jogo já com o nick preenchido, no perfil do navegador
// em que está logada a conta (Google ou Discord) que vota. Clicar em "Votar" no site fica com o jogador.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, readJson, writeJson } from './store.js';

const VOTES_FILE = path.join(DATA_DIR, 'votes.json');

// O idlehub aceita um voto por conta e por jogo a cada 24 h, e dá a recompensa uma vez por nick a cada 24 h.
export const VOTE_COOLDOWN = 24 * 60 * 60 * 1000;
export const MAX_VOTERS = 20; // por jogo
const SLUGS = { pokeidle: 'pokeidle-io', lolidle: 'lol-idle' };
export const VOTE_GAMES = Object.keys(SLUGS);

// Ex.: https://idlehub.io/jogo/lol-idle?votar=1&jogador=loro17#votar
export function voteUrl(game, player) {
  const url = new URL(`https://idlehub.io/jogo/${SLUGS[game]}`);
  url.searchParams.set('votar', '1');
  url.searchParams.set('jogador', player);
  url.hash = 'votar';
  return url.href;
}

// Nick do jogo: sem espaços nas pontas e sem caracteres de controle.
export const normalizePlayer = (name) => String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();

// [{ id, game, player, profile, votedAt }]. votedAt = última vez que o botão abriu a página (não dá para saber se votou).
const saved = readJson(VOTES_FILE, []);
export const voters = Array.isArray(saved) ? saved : [];
const save = () => writeJson(VOTES_FILE, voters);

const find = (id) => {
  const voter = voters.find((v) => v.id === id);
  if (!voter) throw new Error('Voto não encontrado');
  return voter;
};

export function addVoter({ game, player, profile }) {
  if (!SLUGS[game]) throw new Error('Jogo desconhecido');
  const name = normalizePlayer(player);
  if (!name || name.length > 32) throw new Error('Digite o nick do jogo (até 32 letras)');
  profile ||= null;
  if (voters.some((v) => v.game === game && v.player.toLowerCase() === name.toLowerCase() && v.profile === profile)) {
    throw new Error('Esse nick já está na lista com esse perfil');
  }
  if (voters.filter((v) => v.game === game).length >= MAX_VOTERS) throw new Error(`Máximo de ${MAX_VOTERS} votos por jogo`);
  const voter = { id: randomUUID().slice(0, 8), game, player: name, profile, votedAt: null };
  voters.push(voter);
  save();
  return voter;
}

export function removeVoter(id) {
  voters.splice(voters.indexOf(find(id)), 1);
  save();
}

export function setVoterProfile(id, profile) {
  find(id).profile = profile || null;
  save();
}

// Trocou de navegador: os perfis são de cada navegador, então são escolhidos de novo.
export function clearVoterProfiles() {
  for (const v of voters) v.profile = null;
  save();
}

// Marca a hora em que a página de voto foi aberta e devolve o endereço dela.
export function openVote(id, now = Date.now()) {
  const voter = find(id);
  voter.votedAt = now;
  save();
  return voteUrl(voter.game, voter.player);
}

// Para o painel: readyAt = quando o próximo voto libera (null = já pode).
export const votesState = (now = Date.now()) => ({
  cooldown: VOTE_COOLDOWN,
  voters: voters.map((v) => {
    const readyAt = v.votedAt && v.votedAt + VOTE_COOLDOWN > now ? v.votedAt + VOTE_COOLDOWN : null;
    return { ...v, url: voteUrl(v.game, v.player), readyAt };
  }),
});
