const HANDS = { rock: { label: 'グー', symbol: '✊' }, scissors: { label: 'チョキ', symbol: '✌' }, paper: { label: 'パー', symbol: '🖐' } };
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const $ = (selector) => document.querySelector(selector);
const screens = { lobby: $('#lobby-screen'), waiting: $('#waiting-screen'), game: $('#game-screen') };
let peer;
let isHost = false;
let roomId = '';
let playerId = '';
let connection;
const connections = new Map();
let roomState;
let timerId;

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}
function setConnection(online, label) { $('#connection-dot').classList.toggle('online', online); $('#connection-label').textContent = label; }
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); window.setTimeout(() => $('#toast').classList.remove('show'), 2800); }
function uid() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function initialState() { return { settings: { players: 2, seconds: 15, mode: 'single' }, players: [], phase: 'lobby', parentIndex: 0, voteIndex: 0, board: { rock: [], scissors: [], paper: [] }, votes: [], choices: {}, result: null, gameNumber: 1 }; }
function sendAll(message) { connections.forEach((conn) => { if (conn.open) conn.send(message); }); }
function broadcast() { if (!isHost) return; const copy = JSON.parse(JSON.stringify(roomState)); sendAll({ type: 'state', state: copy }); renderState(copy); }

function createPeer() {
  isHost = true; playerId = uid(); roomId = uid(); roomState = initialState(); setConnection(false, '接続中'); peer = new Peer(roomId);
  peer.on('open', () => { roomState.players.push({ id: playerId, name: 'HOST', hand: [], score: 0 }); showScreen('waiting'); setConnection(false, '参加者を待機中'); broadcast(); });
  peer.on('connection', (conn) => {
    conn.on('data', (message) => handleHostMessage(conn, message));
    conn.on('open', () => { if (roomState.players.length >= 4) { conn.send({ type: 'full' }); return; } connections.set(conn.peer, conn); conn.send({ type: 'state', state: roomState }); });
    conn.on('close', () => { connections.delete(conn.peer); roomState.players = roomState.players.filter((player) => player.id !== conn.peer); broadcast(); });
  });
  peer.on('error', () => { toast('ルームを作成できませんでした'); setConnection(false, 'オフライン'); });
}
function joinRoom(value) {
  roomId = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(roomId)) { toast('6文字のルームIDを入力してください'); return; }
  isHost = false; playerId = uid(); setConnection(false, 'ルームを検索中'); peer = new Peer();
  peer.on('open', () => { connection = peer.connect(roomId, { reliable: true }); connection.on('open', () => { setConnection(true, 'オンライン'); connection.send({ type: 'join', id: playerId, name: `PLAYER ${Math.ceil(Math.random() * 99)}` }); }); connection.on('data', handleGuestMessage); connection.on('close', () => { setConnection(false, '切断されました'); toast('ホストとの接続が切れました'); }); });
  peer.on('error', (error) => { toast(error.type === 'peer-unavailable' ? 'ルームが見つかりません' : '接続に失敗しました'); setConnection(false, 'オフライン'); });
}
function handleGuestMessage(message) { if (message.type === 'state') { roomState = message.state; renderState(roomState); } if (message.type === 'full') toast('このテーブルは満席です'); }
function handleHostMessage(conn, message) {
  if (message.type === 'join') { if (roomState.players.length >= roomState.settings.players) { conn.send({ type: 'full' }); return; } roomState.players.push({ id: message.id, name: message.name, hand: [], score: 0 }); connections.set(conn.peer, conn); broadcast(); }
  if (message.type === 'action') handleAction(message.action, message.payload, message.playerId);
}
function request(action, payload = {}) { if (isHost) handleAction(action, payload, playerId); else if (connection?.open) connection.send({ type: 'action', action, payload, playerId }); }

function setupGame() {
  const count = roomState.players.length; const deck = [];
  ['rock', 'scissors', 'paper'].forEach((mark) => { for (let number = 1; number <= count * 3 + 1; number += 1) deck.push({ id: `${mark}-${number}`, mark, number }); });
  deck.sort(() => Math.random() - 0.5);
  roomState.players.forEach((player) => { player.hand = []; });
  roomState.players.forEach((player) => { for (let index = 0; index < 3; index += 1) ['rock', 'scissors', 'paper'].forEach((mark) => { const cardIndex = deck.findIndex((card) => card.mark === mark); player.hand.push(deck.splice(cardIndex, 1)[0]); }); });
  roomState.board = { rock: [deck.find((card) => card.mark === 'rock')], scissors: [deck.find((card) => card.mark === 'scissors')], paper: [deck.find((card) => card.mark === 'paper')] };
  roomState.phase = 'vote'; roomState.voteIndex = roomState.parentIndex; roomState.votes = []; roomState.choices = {}; roomState.result = null; broadcast();
}
function advanceVote() {
  roomState.voteIndex += 1;
  if (roomState.voteIndex >= roomState.players.length) {
    roomState.votes.forEach((vote) => roomState.board[vote.zone].push({ ...vote.card, hidden: true }));
    ['rock', 'scissors', 'paper'].forEach((zone) => { roomState.board[zone] = roomState.board[zone].map((card) => ({ ...card, hidden: false })); });
    roomState.phase = 'janken';
  }
  broadcast();
}
function validSelection(cards) {
  if (!cards.length || cards.some((card) => card.mark !== cards[0].mark)) return false;
  if (cards.length === 1) return true;
  if (cards.length < 3) return false;
  const numbers = cards.map((card) => card.number).sort((a, b) => a - b);
  return numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1);
}
function resolveJanken() {
  const choices = Object.values(roomState.choices); const marks = [...new Set(choices.map((choice) => choice.mark))]; let winners; let losers;
  if (marks.length === 2) { const winningMark = marks.find((mark) => BEATS[mark] === marks.find((other) => other !== mark)); winners = choices.filter((choice) => choice.mark === winningMark); losers = choices.filter((choice) => choice.mark !== winningMark); }
  else { const high = Math.max(...choices.map((choice) => choice.max)); const low = Math.min(...choices.map((choice) => choice.max)); winners = choices.filter((choice) => choice.max === high); losers = choices.filter((choice) => choice.max === low); }
  roomState.result = { winners: winners.map((choice) => choice.playerId), losers: losers.map((choice) => choice.playerId) };
  roomState.result.losers.forEach((id) => { const choice = roomState.choices[id]; roomState.players.find((player) => player.id === id).hand.push(...roomState.board[choice.mark].splice(0)); });
  roomState.result.winners.forEach((id) => { roomState.choices[id].placed = false; }); roomState.phase = winners.length ? 'place' : 'result'; if (roomState.phase === 'result') finishRound(); else broadcast();
}
function finishRound() {
  if (!roomState.players.some((player) => player.hand.length === 0)) { roomState.parentIndex = (roomState.parentIndex + 1) % roomState.players.length; roomState.voteIndex = roomState.parentIndex; roomState.phase = 'vote'; roomState.votes = []; roomState.choices = {}; roomState.result = null; broadcast(); return; }
  roomState.players.forEach((player) => { player.score -= player.hand.length; });
  if (roomState.settings.mode === 'full' && roomState.gameNumber < roomState.players.length) { roomState.gameNumber += 1; roomState.parentIndex = (roomState.parentIndex + 1) % roomState.players.length; setupGame(); return; }
  roomState.phase = 'result'; broadcast();
}
function handleAction(action, payload, actorId) {
  const actor = roomState.players.find((player) => player.id === actorId); if (!actor) return;
  if (action === 'settings' && isHost && roomState.phase === 'lobby') { roomState.settings = { ...roomState.settings, ...payload }; broadcast(); return; }
  if (action === 'start' && isHost && roomState.players.length === roomState.settings.players) { setupGame(); return; }
  if (action === 'vote' && roomState.phase === 'vote' && roomState.players[roomState.voteIndex]?.id === actorId) { const index = actor.hand.findIndex((card) => card.id === payload.cardId); if (index < 0 || !['rock', 'scissors', 'paper'].includes(payload.zone)) return; const card = actor.hand.splice(index, 1)[0]; roomState.votes.push({ card, zone: payload.zone }); advanceVote(); return; }
  if (action === 'janken' && roomState.phase === 'janken' && !roomState.choices[actorId]) { const selected = payload.cardIds.map((id) => actor.hand.find((card) => card.id === id)).filter(Boolean); if (!validSelection(selected)) return; actor.hand = actor.hand.filter((card) => !selected.some((picked) => picked.id === card.id)); roomState.choices[actorId] = { playerId: actorId, cards: selected, mark: selected[0].mark, max: Math.max(...selected.map((card) => card.number)) }; if (Object.keys(roomState.choices).length === roomState.players.length) resolveJanken(); else broadcast(); return; }
  if (action === 'place' && roomState.phase === 'place' && roomState.result.winners.includes(actorId) && ['rock', 'scissors', 'paper'].includes(payload.zone)) { const choice = roomState.choices[actorId]; choice.cards.forEach((card) => roomState.board[payload.zone].push(card)); choice.placed = true; if (roomState.result.winners.every((id) => roomState.choices[id].placed)) finishRound(); else broadcast(); }
}
function sortHand(hand) { return [...hand].sort((a, b) => ['rock', 'scissors', 'paper'].indexOf(a.mark) - ['rock', 'scissors', 'paper'].indexOf(b.mark) || a.number - b.number); }

function renderState(state) {
  $('#room-code').textContent = roomId; $('#room-code-large').textContent = roomId; $('#match-room').textContent = roomId; $('#player-count-label').textContent = `${state.players.length} / ${state.settings.players}`; $('#start-note').textContent = state.players.length === state.settings.players ? '全員そろいました。開始できます' : `あと${state.settings.players - state.players.length}人参加すると開始できます`;
  ['player-count', 'time-limit', 'game-mode'].forEach((id) => { const key = id === 'player-count' ? 'players' : id === 'time-limit' ? 'seconds' : 'mode'; $(`#${id}`).value = state.settings[key]; $(`#${id}`).disabled = !isHost; }); $('#start-game').disabled = !isHost || state.players.length !== state.settings.players || state.phase !== 'lobby'; $('#players-list').innerHTML = state.players.map((player, index) => `<div class="player-row"><span class="player-token token-${index}">${index + 1}</span><strong>${player.name}${player.id === playerId ? '（あなた）' : ''}</strong><span>${index === state.parentIndex ? '親' : '参加'}</span></div>`).join('');
  if (state.phase === 'lobby') showScreen('waiting'); else { showScreen('game'); renderGame(state); }
}
function renderGame(state) {
  const phase = { vote: '投票フェーズ', janken: 'じゃんけんフェーズ', place: '勝者の配置', result: '決着' }[state.phase]; $('#phase-label').textContent = phase; $('#game-title').textContent = state.phase === 'vote' ? '場にカードを置こう。' : state.phase === 'janken' ? '同時に、勝負。' : state.phase === 'place' ? '勝者が場を選ぶ。' : 'ゲームの結果'; $('#players-board').innerHTML = state.players.map((player) => `<div class="player-chip ${player.id === playerId ? 'is-you' : ''}"><span>${player.name}</span><strong>${player.hand.length}</strong><small>枚</small></div>`).join('');
  ['rock', 'scissors', 'paper'].forEach((zone) => { const pile = state.board[zone] || []; $(`#${zone}-count`).textContent = `${pile.length}枚`; $(`#${zone}-pile`).innerHTML = pile.slice(-5).map((card) => `<span class="table-card mark-${card.mark}">${card.hidden ? '？' : card.number}</span>`).join(''); });
  const me = state.players.find((player) => player.id === playerId); const hand = me ? sortHand(me.hand) : []; $('#hand-count').textContent = `${hand.length} cards`; $('#my-hand').innerHTML = hand.map((card) => `<button class="hand-card mark-${card.mark}" data-card-id="${card.id}" type="button"><span>${HANDS[card.mark].symbol}</span><b>${card.number}</b></button>`).join(''); document.querySelectorAll('.hand-card').forEach((button) => button.addEventListener('click', () => button.classList.toggle('selected')));
  const canVote = state.phase === 'vote' && state.players[state.voteIndex]?.id === playerId; const canPlace = state.phase === 'place' && state.result.winners.includes(playerId); $('#submit-move').classList.toggle('hidden', !canVote && state.phase !== 'janken' && !canPlace); $('#submit-move').textContent = state.phase === 'vote' ? '投票を確定 ↗' : state.phase === 'place' ? '場に置く ↗' : 'じゃんけんを確定 ↗'; $('#game-message').textContent = canVote ? 'あなたの投票です。カードと場を選んでください' : state.phase === 'vote' ? `${state.players[state.voteIndex]?.name}の投票を待っています` : state.phase === 'janken' ? 'カードを選んで、同時に公開します' : state.phase === 'place' ? (canPlace ? '出したカードを置く場を選んでください' : '勝者の配置を待っています') : '決着しました'; if (state.phase === 'result') renderResult(state); else $('#result-panel').classList.add('hidden'); startTimer(state);
}
function startTimer(state) { clearInterval(timerId); const canAct = (state.phase === 'vote' && state.players[state.voteIndex]?.id === playerId) || (state.phase === 'janken' && !state.choices[playerId]); $('#timer-label').textContent = state.phase === 'vote' ? 'VOTE TURN' : 'SELECT YOUR CARDS'; $('#timer').textContent = state.settings.seconds; $('#timer-bar').style.transform = 'scaleX(1)'; if (!canAct) return; let left = state.settings.seconds; timerId = setInterval(() => { left -= 1; $('#timer').textContent = left; $('#timer-bar').style.transform = `scaleX(${left / state.settings.seconds})`; if (left <= 0) { clearInterval(timerId); const me = state.players.find((player) => player.id === playerId); if (state.phase === 'vote') { const card = me.hand[Math.floor(Math.random() * me.hand.length)]; request('vote', { cardId: card.id, zone: ['rock', 'scissors', 'paper'][Math.floor(Math.random() * 3)] }); } else request('janken', { cardIds: [me.hand[0]?.id].filter(Boolean) }); } }, 1000); }
function renderResult(state) { $('#result-panel').classList.remove('hidden'); $('#result-title').textContent = 'GAME OVER'; $('#result-detail').textContent = '残りカードが少ない順に上位です'; $('#revealed-list').innerHTML = [...state.players].sort((a, b) => b.score - a.score).map((player, index) => `<div class="ranking-row"><b>${index + 1}</b><span>${player.name}</span><strong>${player.score} pt</strong></div>`).join(''); }

$('#create-room').addEventListener('click', createPeer); $('#join-form').addEventListener('submit', (event) => { event.preventDefault(); joinRoom($('#room-input').value); }); $('#how-to-play').addEventListener('click', () => $('#how-modal').classList.remove('hidden')); $('#close-how').addEventListener('click', () => $('#how-modal').classList.add('hidden')); $('#how-modal .modal-backdrop').addEventListener('click', () => $('#how-modal').classList.add('hidden')); $('#copy-room').addEventListener('click', async () => { await navigator.clipboard.writeText(roomId); toast('ルームIDをコピーしました'); }); $('#cancel-room').addEventListener('click', () => window.location.reload()); $('#leave-game').addEventListener('click', () => window.location.reload());
['player-count', 'time-limit', 'game-mode'].forEach((id) => $(`#${id}`).addEventListener('change', () => { const key = id === 'player-count' ? 'players' : id === 'time-limit' ? 'seconds' : 'mode'; request('settings', { [key]: id === 'game-mode' ? $(`#${id}`).value : Number($(`#${id}`).value) }); })); $('#start-game').addEventListener('click', () => request('start')); document.querySelectorAll('.board-zone').forEach((zone) => zone.addEventListener('click', () => { document.querySelectorAll('.board-zone').forEach((item) => item.classList.remove('chosen')); zone.classList.add('chosen'); })); $('#submit-move').addEventListener('click', () => { const selected = [...document.querySelectorAll('.hand-card.selected')].map((button) => button.dataset.cardId); const zone = document.querySelector('.board-zone.chosen')?.dataset.zone; if (roomState.phase === 'vote') { if (!selected[0] || !zone) { toast('カードと置き場を選んでください'); return; } request('vote', { cardId: selected[0], zone }); } else if (roomState.phase === 'janken') request('janken', { cardIds: selected }); else if (roomState.phase === 'place') { if (!zone) { toast('置き場を選んでください'); return; } request('place', { zone }); } }); $('#next-round').addEventListener('click', () => request('next')); window.addEventListener('beforeunload', () => { connections.forEach((conn) => conn.close()); peer?.destroy(); });
