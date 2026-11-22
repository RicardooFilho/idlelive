import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Pasta temporária no lugar da raiz: o módulo lê votes.json assim que é importado.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idlelive-votes-'));
process.env.IDLELIVE_DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const votes = await import('../src/votes.js');
const { voteUrl, addVoter, removeVoter, setVoterProfile, clearVoterProfiles, openVote, votesState, voters, VOTE_COOLDOWN, MAX_VOTERS } = votes;
const saved = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'votes.json'), 'utf8'));

test('voteUrl monta o endereço de voto de cada jogo com o nick', () => {
  assert.equal(voteUrl('lolidle', 'loro17'), 'https://idlehub.io/jogo/lol-idle?votar=1&jogador=loro17#votar');
  assert.equal(voteUrl('pokeidle', 'Ash K'), 'https://idlehub.io/jogo/pokeidle-io?votar=1&jogador=Ash+K#votar');
  assert.equal(voteUrl('pokeidle', 'a&b#c'), 'https://idlehub.io/jogo/pokeidle-io?votar=1&jogador=a%26b%23c#votar');
});

test('addVoter valida e grava', () => {
  const v = addVoter({ game: 'lolidle', player: '  loro17 ', profile: 'Profile 1' });
  assert.equal(v.player, 'loro17');
  assert.equal(v.profile, 'Profile 1');
  assert.equal(v.votedAt, null);
  assert.deepEqual(saved(), [v]);

  assert.throws(() => addVoter({ game: 'outro', player: 'x' }), /Jogo desconhecido/);
  assert.throws(() => addVoter({ game: 'lolidle', player: '   ' }), /nick/);
  assert.throws(() => addVoter({ game: 'lolidle', player: 'x'.repeat(33) }), /nick/);
  // Mesmo nick e perfil no mesmo jogo é repetido; em outro perfil ou outro jogo, não.
  assert.throws(() => addVoter({ game: 'lolidle', player: 'LORO17', profile: 'Profile 1' }), /já está/);
  addVoter({ game: 'lolidle', player: 'loro17', profile: 'Profile 2' });
  addVoter({ game: 'pokeidle', player: 'loro17', profile: 'Profile 1' });
  assert.equal(voters.length, 3);
});

test('openVote marca a hora e o estado mostra quando libera de novo', () => {
  const [v] = voters;
  const now = 1_000_000_000;
  assert.equal(openVote(v.id, now), 'https://idlehub.io/jogo/lol-idle?votar=1&jogador=loro17#votar');
  assert.equal(saved()[0].votedAt, now);
  const at = (t) => votesState(t).voters.find((x) => x.id === v.id).readyAt;
  assert.equal(at(now + 1000), now + VOTE_COOLDOWN);
  assert.equal(at(now + VOTE_COOLDOWN), null);
  assert.equal(votesState(now).voters.find((x) => x.id === voters[1].id).readyAt, null);
  assert.throws(() => openVote('nao-existe'), /não encontrado/);
});

test('perfil: trocar e limpar ao mudar de navegador', () => {
  setVoterProfile(voters[0].id, 'Profile 3');
  assert.equal(voters[0].profile, 'Profile 3');
  setVoterProfile(voters[0].id, '');
  assert.equal(voters[0].profile, null);
  clearVoterProfiles();
  assert.ok(saved().every((v) => v.profile === null));
});

test('removeVoter tira da lista', () => {
  const id = voters[0].id;
  removeVoter(id);
  assert.ok(!voters.some((v) => v.id === id));
  assert.ok(!saved().some((v) => v.id === id));
});

test('limite de votos por jogo', () => {
  for (let i = voters.filter((v) => v.game === 'pokeidle').length; i < MAX_VOTERS; i++) addVoter({ game: 'pokeidle', player: `nick${i}` });
  assert.throws(() => addVoter({ game: 'pokeidle', player: 'mais um' }), /Máximo/);
});
