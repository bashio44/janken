const ROUND_SECONDS = 15;
const HANDS = { rock: { emoji: '✊', label: 'グー' }, scissors: { emoji: '✌', label: 'チョキ' }, paper: { emoji: '🖐', label: 'パー' } };
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

const screens = { lobby: document.querySelector('#lobby-screen'), waiting: document.querySelector('#waiting-screen'), game: document.querySelector('#game-screen') };
const connectionDot = document.querySelector('#connection-dot');
const connectionLabel = document.querySelector('#connection-label');
let peer = null;
let connection = null;
let isHost = false;
let roomId = '';
let myChoice;
let opponentChoice;
let timerId = null;
let secondsLeft = ROUND_SECONDS;
let scores = { me: 0, opponent: 0 };

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function setConnection(online, label) {
  connectionDot.classList.toggle('online', online);
  connectionLabel.textContent = label;
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createPeer(id, host) {
  isHost = host;
  roomId = id;
  setConnection(false, '接続中');
  peer = new Peer(id);
  peer.on('open', (openedId) => {
    roomId = openedId.toUpperCase();
    document.querySelector('#room-code').textContent = roomId;
    document.querySelector('#match-room').textContent = roomId;
    if (isHost) showScreen('waiting');
    setConnection(false, isHost ? '相手を待機中' : '接続待機中');
  });
  peer.on('connection', (incoming) => {
    if (!isHost || connection) return;
    attachConnection(incoming);
  });
  peer.on('error', (error) => {
    if (error.type === 'unavailable-id') showToast('そのルームIDは使用中です。もう一度作成してください');
    else if (error.type === 'peer-unavailable') showToast('ルームが見つかりません。IDを確認してください');
    else showToast('接続に失敗しました。もう一度お試しください');
    setConnection(false, 'オフライン');
  });
  peer.on('disconnected', () => setConnection(false, '切断されました'));
}

function attachConnection(nextConnection) {
  connection = nextConnection;
  connection.on('open', () => {
    setConnection(true, 'オンライン');
    showScreen('game');
    document.querySelector('#match-room').textContent = roomId;
    startRound();
  });
  connection.on('data', handleMessage);
  connection.on('close', () => {
    setConnection(false, '相手が退出');
    showToast('対戦相手との接続が切れました');
  });
  connection.on('error', () => showToast('通信エラーが発生しました'));
}

function joinRoom(id) {
  const normalized = id.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalized)) {
    showToast('6文字のルームIDを入力してください');
    return;
  }
  roomId = normalized;
  setConnection(false, 'ルームを検索中');
  peer = new Peer();
  peer.on('open', () => attachConnection(peer.connect(roomId, { reliable: true })));
  peer.on('error', (error) => {
    showToast(error.type === 'peer-unavailable' ? 'ルームが見つかりません' : '接続に失敗しました');
    setConnection(false, 'オフライン');
  });
}

function send(message) {
  if (connection && connection.open) connection.send(message);
}

function startRound() {
  myChoice = undefined;
  opponentChoice = undefined;
  secondsLeft = ROUND_SECONDS;
  document.querySelector('#timer').textContent = secondsLeft;
  document.querySelector('#timer').classList.remove('urgent');
  document.querySelector('#timer-bar').style.transform = 'scaleX(1)';
  document.querySelector('#game-message').textContent = '手を選んでください';
  document.querySelector('#result-panel').classList.add('hidden');
  document.querySelectorAll('.hand-button').forEach((button) => {
    button.disabled = false;
    button.classList.remove('selected');
  });
  window.clearInterval(timerId);
  timerId = window.setInterval(() => {
    secondsLeft -= 1;
    document.querySelector('#timer').textContent = secondsLeft;
    document.querySelector('#timer-bar').style.transform = `scaleX(${secondsLeft / ROUND_SECONDS})`;
    if (secondsLeft <= 5) document.querySelector('#timer').classList.add('urgent');
    if (secondsLeft <= 0) {
      window.clearInterval(timerId);
      if (myChoice === undefined) submitChoice(null, true);
    }
  }, 1000);
}

function submitChoice(choice, timedOut = false) {
  if (myChoice !== undefined) return;
  myChoice = choice;
  document.querySelectorAll('.hand-button').forEach((button) => { button.disabled = true; });
  if (choice) document.querySelector(`[data-hand="${choice}"]`).classList.add('selected');
  document.querySelector('#game-message').textContent = timedOut ? '時間切れ。相手の手を待っています' : '選択しました。相手の手を待っています';
  send({ type: 'choice', choice });
  if (opponentChoice !== undefined) resolveRound();
}

function handleMessage(message) {
  if (message.type !== 'choice') return;
  opponentChoice = message.choice;
  if (myChoice === undefined && secondsLeft > 0) document.querySelector('#game-message').textContent = '相手が選択しました。あなたの手をどうぞ';
  if (myChoice !== undefined) resolveRound();
}

function resolveRound() {
  window.clearInterval(timerId);
  const resultTitle = document.querySelector('#result-title');
  const detail = document.querySelector('#result-detail');
  const yourHandEmoji = document.querySelector('#your-hand-emoji');
  const opponentHandEmoji = document.querySelector('#opponent-hand-emoji');
  const your = myChoice ? HANDS[myChoice] : { emoji: '⌛', label: '時間切れ' };
  const opponent = opponentChoice ? HANDS[opponentChoice] : { emoji: '⌛', label: '時間切れ' };
  yourHandEmoji.textContent = your.emoji;
  opponentHandEmoji.textContent = opponent.emoji;
  if (!myChoice && !opponentChoice) { resultTitle.textContent = 'DRAW'; detail.textContent = 'ふたりとも時間切れです'; }
  else if (!myChoice) { resultTitle.textContent = 'LOSE'; detail.textContent = '時間切れです'; scores.opponent += 1; }
  else if (!opponentChoice) { resultTitle.textContent = 'WIN'; detail.textContent = '相手が時間切れです'; scores.me += 1; }
  else if (myChoice === opponentChoice) { resultTitle.textContent = 'DRAW'; detail.textContent = `${your.label}で引き分け`; }
  else if (BEATS[myChoice] === opponentChoice) { resultTitle.textContent = 'WIN'; detail.textContent = `${your.label}で勝ちました`; scores.me += 1; }
  else { resultTitle.textContent = 'LOSE'; detail.textContent = `${opponent.label}に負けました`; scores.opponent += 1; }
  document.querySelector('#you-score').textContent = scores.me;
  document.querySelector('#opponent-score').textContent = scores.opponent;
  document.querySelector('#result-panel').classList.remove('hidden');
  document.querySelector('#game-message').textContent = '結果発表';
}

document.querySelector('#create-room').addEventListener('click', () => createPeer(makeRoomId(), true));
document.querySelector('#join-form').addEventListener('submit', (event) => { event.preventDefault(); joinRoom(document.querySelector('#room-input').value); });
document.querySelector('#copy-room').addEventListener('click', async () => {
  await navigator.clipboard.writeText(roomId);
  showToast('ルームIDをコピーしました');
});
document.querySelector('#cancel-room').addEventListener('click', () => window.location.reload());
document.querySelector('#leave-game').addEventListener('click', () => window.location.reload());
document.querySelectorAll('.hand-button').forEach((button) => button.addEventListener('click', () => submitChoice(button.dataset.hand)));
document.querySelector('#next-round').addEventListener('click', startRound);
window.addEventListener('beforeunload', () => { if (connection) connection.close(); if (peer) peer.destroy(); });
