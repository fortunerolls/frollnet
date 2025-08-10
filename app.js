/* app.js — FROLL Social + Swap — HOTFIX CONNECT v2.1
   - Auto switch/add Viction (chainId 88 / 0x58)
   - Friendly errors (incl. -32002 pending request)
   - Works even if #connection-status chưa có (tự tạo)
   - Fallback bắt sự kiện click để chắc chắn bắt được nút
*/

/** ===== CONFIG ===== **/
const VIC = {
  chainIdHex: '0x58', // 88
  params: {
    chainId: '0x58',
    chainName: 'Viction Mainnet',
    nativeCurrency: { name: 'VIC', symbol: 'VIC', decimals: 18 },
    rpcUrls: ['https://rpc.viction.xyz','https://viction.blockpi.network/v1/rpc/public'],
    blockExplorerUrls: ['https://vicscan.xyz/']
  }
};

const FROLL = { address: '0xB4d562A8f811CE7F134a1982992Bd153902290BC' }; // FROLL on VIC

// Swap contract (fixed: 1 FROLL = 100 VIC, fee 0.01 VIC)
const SWAP = {
  address: '0x9197BF0813e0727df4555E8cb43a0977F4a3A068',
  abi: [
    {"inputs":[],"name":"swapVicToFroll","outputs":[],"stateMutability":"payable","type":"function"},
    {"inputs":[{"internalType":"uint256","name":"frollAmount","type":"uint256"}],"name":"swapFrollToVic","outputs":[],"stateMutability":"payable","type":"function"}
  ],
  FEE_VIC: typeof ethers !== 'undefined' ? ethers.parseEther("0.01") : null,
  RATE: 100n
};

// Social placeholder (cập nhật khi bạn đưa địa chỉ & ABI thật)
const SOCIAL = {
  address: '',
  abi: [],
  REGISTER_FEE_FROLL: typeof ethers !== 'undefined' ? ethers.parseUnits("0.001", 18) : null
};

const ERC20_ABI = [
  { "constant":true,"inputs":[{"name":"account","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"type":"function" },
  { "constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"type":"function" },
  { "constant":true,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"type":"function" },
  { "constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"type":"function" },
  { "constant":true,"inputs":[{"name":"owner","type":"address"},{"name":"spender","type":"address"}],"name":"allowance","outputs":[{"name":"","type":"uint256"}],"type":"function" }
];

/** ===== STATE & DOM ===== **/
let provider, signer, user;

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function getConnectBtn() {
  return $('#connect-wallet') || $('#connect') || document.querySelector('[data-connect]');
}
function ensureStatusEl() {
  let el = $('#connection-status');
  const btn = getConnectBtn();
  if (!el) {
    el = document.createElement('div');
    el.id = 'connection-status';
    el.className = 'status';
    el.style.marginLeft = '8px';
    if (btn && btn.parentElement) btn.parentElement.appendChild(el);
    else document.body.appendChild(el);
  }
  return el;
}
const statusEl = ensureStatusEl();
function setStatus(t) { if (statusEl) statusEl.textContent = t; }
const short = a => a ? `${a.slice(0,6)}…${a.slice(-4)}` : '';

/** ===== SAFETY CHECKS ===== **/
function envSanity() {
  if (!location.protocol.startsWith('https')) {
    setStatus('This page must be served over HTTPS.');
    console.warn('Not HTTPS – wallet may refuse connection.');
  }
  if (typeof ethers === 'undefined') {
    console.error('Ethers library not loaded.');
    setStatus('Internal error: ethers not loaded.');
    return false;
  }
  return true;
}

/** ===== NETWORK ===== **/
async function ensureVIC() {
  const eth = window.ethereum;
  if (!eth) throw new Error('No wallet found. Install MetaMask.');
  const cid = await eth.request({ method:'eth_chainId' });
  if (cid === VIC.chainIdHex) return;
  try {
    await eth.request({ method:'wallet_switchEthereumChain', params:[{ chainId: VIC.chainIdHex }] });
  } catch (err) {
    if (err && err.code === 4902) {
      await eth.request({ method:'wallet_addEthereumChain', params:[VIC.params] });
    } else {
      throw err;
    }
  }
}

/** ===== CONNECT ===== **/
async function connect() {
  try {
    if (!envSanity()) return;
    if (!window.ethereum) { setStatus('No wallet found. Install MetaMask.'); return; }

    const btn = getConnectBtn();
    if (btn) btn.disabled = true;
    setStatus('Connecting… check your wallet');

    // Request accounts
    const accounts = await window.ethereum.request({ method:'eth_requestAccounts' });
    if (!accounts || !accounts.length) { setStatus('No account connected.'); return; }

    // Ensure VIC
    await ensureVIC();

    provider = new ethers.BrowserProvider(window.ethereum, 'any');
    signer   = await provider.getSigner();
    user     = await signer.getAddress();

    setStatus(`Connected: ${short(user)}`);
    await Promise.all([refreshBalances(), loadFeed()]);
    wireWalletEvents();
  } catch (err) {
    console.error('CONNECT ERROR:', err);
    // Common cases
    if (err?.code === 4001) setStatus('Request rejected in wallet.');
    else if (err?.code === -32002) setStatus('Request already pending. Open your wallet and approve.');
    else if (String(err?.message||'').includes('wallet_addEthereumChain')) setStatus('Please approve adding VIC network in wallet.');
    else if (String(err?.message||'').includes('wallet_switchEthereumChain')) setStatus('Please switch to VIC network in wallet.');
    else setStatus('Connect failed. Please approve wallet or switch to VIC.');
  } finally {
    const btn = getConnectBtn();
    if (btn) btn.disabled = false;
  }
}

/** ===== WIRE EVENTS (robust) ===== **/
function wireConnectButton() {
  const btn = getConnectBtn();
  if (btn) btn.addEventListener('click', connect);
  // Fallback global click catcher (in case the element is re-rendered later)
  document.addEventListener('click', (e) => {
    if (e.target && (e.target.id === 'connect-wallet' || e.target.id === 'connect' || e.target.matches('[data-connect]'))) {
      connect();
    }
  });
}

function wireWalletEvents() {
  if (!window.ethereum) return;
  window.ethereum.removeAllListeners?.('accountsChanged');
  window.ethereum.removeAllListeners?.('chainChanged');

  window.ethereum.on('accountsChanged', async (accs) => {
    if (!accs || !accs.length) { setStatus('Wallet disconnected.'); user = undefined; return; }
    user = accs[0];
    setStatus(`Connected: ${short(user)}`);
    await refreshBalances();
  });

  window.ethereum.on('chainChanged', async (cid) => {
    if (cid !== VIC.chainIdHex) {
      setStatus('Wrong network. Switching…');
      try { await ensureVIC(); location.reload(); } catch { setStatus('Please switch to VIC network.'); }
    } else {
      location.reload();
    }
  });
}

/** ===== PRICE ===== **/
async function loadPrice() {
  const priceEl = document.getElementById('froll-price');
  if (!priceEl) return;
  try {
    priceEl.textContent = 'Loading price...';
    const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=VICUSDT');
    const j = await r.json();
    const vicUsd = parseFloat(j?.price||'0');
    priceEl.textContent = vicUsd>0 ? `1 FROLL = ${(100*vicUsd).toFixed(2)} USD` : '1 FROLL = — USD';
  } catch {
    priceEl.textContent = '1 FROLL = — USD';
  }
}

/** ===== BALANCES ===== **/
async function refreshBalances() {
  const fromTokenSel = $('#from-token');
  const fromBalEl = $('#from-balance');
  const toBalEl   = $('#to-balance');
  if (!provider || !user || !fromTokenSel || !fromBalEl || !toBalEl) return;

  const vicWei = await provider.getBalance(user);
  const vic = Number(ethers.formatEther(vicWei));

  const erc20 = new ethers.Contract(FROLL.address, ERC20_ABI, provider);
  const [sym, dec, raw] = await Promise.all([erc20.symbol(), erc20.decimals(), erc20.balanceOf(user)]);
  const froll = Number(ethers.formatUnits(raw, dec));

  const fromToken = fromTokenSel.value;
  if (fromToken === 'VIC') {
    fromBalEl.textContent = `${vic.toFixed(4)} VIC`;
    toBalEl.textContent   = `${froll.toFixed(4)} ${sym}`;
  } else {
    fromBalEl.textContent = `${froll.toFixed(4)} ${sym}`;
    toBalEl.textContent   = `${vic.toFixed(4)} VIC`;
  }
}

/** ===== SWAP UI ===== **/
function recalcQuote() {
  const fromTokenSel = $('#from-token');
  const fromAmountInp= $('#from-amount');
  const toTokenInp   = $('#to-token');
  const toAmountInp  = $('#to-amount');
  const approveBtn   = $('#approve-btn');

  if (!fromTokenSel || !fromAmountInp || !toTokenInp || !toAmountInp) return;

  const fromToken = fromTokenSel.value;
  const val = Number(fromAmountInp.value || '0');
  if (val<=0) { toAmountInp.value=''; return; }

  if (fromToken === 'VIC') {
    toTokenInp.value = 'FROLL';
    toAmountInp.value = (val/100).toFixed(6);
    if (approveBtn) approveBtn.style.display = 'none';
  } else {
    toTokenInp.value = 'VIC';
    toAmountInp.value = (val*100).toFixed(6);
    if (approveBtn) approveBtn.style.display = 'inline-block';
  }
}

async function ensureFrollAllowance(amount) {
  const erc20 = new ethers.Contract(FROLL.address, ERC20_ABI, signer);
  const cur = await erc20.allowance(user, SWAP.address);
  if (cur >= amount) return true;
  const tx = await erc20.approve(SWAP.address, amount);
  $('#swap-status').textContent = 'Approving FROLL…';
  await tx.wait();
  return true;
}

/** ===== SWAP ACTION ===== **/
async function doSwap() {
  const swapStatus = $('#swap-status');
  try {
    if (!signer || !user) { await connect(); if (!user) return; }
    await ensureVIC();

    const fromTokenSel = $('#from-token');
    const fromAmountInp= $('#from-amount');
    if (!fromTokenSel || !fromAmountInp) return;

    const fromToken = fromTokenSel.value;
    const raw = fromAmountInp.value.trim();
    const amt = Number(raw);
    if (!raw || isNaN(amt) || amt <= 0) { swapStatus.textContent='Enter a valid amount.'; return; }

    const contract = new ethers.Contract(SWAP.address, SWAP.abi, signer);

    if (fromToken === 'VIC') {
      const vicAmount = ethers.parseEther(raw);
      const value = vicAmount + SWAP.FEE_VIC;
      const tx = await contract.swapVicToFroll({ value });
      swapStatus.textContent = 'Swapping VIC→FROLL…';
      await tx.wait();
      swapStatus.textContent = 'Swap done!';
    } else {
      const frollAmount = ethers.parseUnits(raw, 18);
      await ensureFrollAllowance(frollAmount);
      const tx = await contract.swapFrollToVic(frollAmount, { value: SWAP.FEE_VIC });
      swapStatus.textContent = 'Swapping FROLL→VIC…';
      await tx.wait();
      swapStatus.textContent = 'Swap done!';
    }

    $('#from-amount').value = '';
    $('#to-amount').value = '';
    await refreshBalances();
  } catch (err) {
    console.error(err);
    if (err?.code === 4001) $('#swap-status').textContent = 'Transaction rejected in wallet.';
    else $('#swap-status').textContent = 'Swap failed. See console for details.';
  }
}

/** ===== SOCIAL (placeholder until ABI/addr) ===== **/
function socialConfigured() {
  return SOCIAL.address && SOCIAL.address.startsWith('0x') && SOCIAL.address.length===42 && SOCIAL.abi?.length>0;
}
async function socialRegister() {
  const socialStatus = $('#social-status');
  try {
    if (!signer || !user) { await connect(); if (!user) return; }
    if (!socialConfigured()) { socialStatus.textContent='Social not configured yet.'; return; }
    const erc20 = new ethers.Contract(FROLL.address, ERC20_ABI, signer);
    await ensureFrollAllowance(SOCIAL.REGISTER_FEE_FROLL);
    const social = new ethers.Contract(SOCIAL.address, SOCIAL.abi, signer);
    const tx = await social.register();
    socialStatus.textContent = 'Registering…';
    await tx.wait();
    socialStatus.textContent = 'Registered!';
  } catch (e) {
    console.error(e); $('#social-status').textContent = 'Register failed.';
  }
}
async function socialPost() {
  const socialStatus = $('#social-status');
  try {
    if (!signer || !user) { await connect(); if (!user) return; }
    if (!socialConfigured()) { socialStatus.textContent='Social not configured yet.'; return; }
    const content = ($('#post-content').value||'').trim();
    if (!content) { socialStatus.textContent='Write something first.'; return; }
    const social = new ethers.Contract(SOCIAL.address, SOCIAL.abi, signer);
    const tx = await social.post(content);
    socialStatus.textContent = 'Publishing…';
    await tx.wait();
    socialStatus.textContent = 'Published!';
    $('#post-content').value = '';
    await loadFeed();
  } catch (e) {
    console.error(e); socialStatus.textContent = 'Publish failed.';
  }
}
async function socialAction(kind) {
  const out = $('#social-action-status');
  try {
    if (!signer || !user) { await connect(); if (!user) return; }
    if (!socialConfigured()) { out.textContent='Social not configured yet.'; return; }
    const social = new ethers.Contract(SOCIAL.address, SOCIAL.abi, signer);
    if (kind==='like') {
      const id = Number(($('#target-post-id').value||'0')); if (!id) { out.textContent='Enter Post ID.'; return; }
      const tx = await social.like(id); out.textContent='Liking…'; await tx.wait(); out.textContent='Liked!';
    } else if (kind==='share') {
      const id = Number(($('#target-post-id').value||'0')); if (!id) { out.textContent='Enter Post ID.'; return; }
      const tx = await social.share(id); out.textContent='Sharing…'; await tx.wait(); out.textContent='Shared!';
    } else if (kind==='follow') {
      const addr = ($('#follow-address').value||'').trim(); if (!(addr && addr.startsWith('0x') && addr.length===42)) { out.textContent='Enter a valid address.'; return; }
      const tx = await social.follow(addr); out.textContent='Following…'; await tx.wait(); out.textContent='Followed!';
    }
  } catch (e) { console.error(e); out.textContent='Action failed.'; }
}
async function loadFeed() {
  const feedEl = $('#feed'); if (!feedEl) return;
  feedEl.innerHTML = '';
  if (!socialConfigured()) {
    const demo = [
      {id:1,author:'0xDEMO1',content:'Welcome to FROLL Social! Configure contract to go on-chain.',likes:12,shares:3},
      {id:2,author:'0xDEMO2',content:'Swap FROLL ↔ VIC at a fixed rate. Fully transparent.',likes:7,shares:1}
    ];
    demo.forEach(p=>{
      const el = document.createElement('div'); el.className = 'post';
      el.innerHTML = `<div class="post-head"><span class="author">${p.author}</span><span class="pid">#${p.id}</span></div>
      <div class="post-content">${p.content.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}</div>
      <div class="post-meta">❤ ${p.likes} • 🔁 ${p.shares}</div>`;
      feedEl.appendChild(el);
    });
    return;
  }
  // TODO: replace with on-chain listPosts when ABI có
}

/** ===== WIRE UI ===== **/
function wireSwapUI() {
  const fromTokenSel = $('#from-token');
  const fromAmountInp= $('#from-amount');
  const toTokenInp   = $('#to-token');
  const flipBtn      = $('#flip');
  const approveBtn   = $('#approve-btn');
  const swapBtn      = $('#swap-btn');

  if (fromTokenSel) fromTokenSel.addEventListener('change', ()=>{ toTokenInp.value = fromTokenSel.value==='VIC'?'FROLL':'VIC'; recalcQuote(); refreshBalances(); });
  if (fromAmountInp) fromAmountInp.addEventListener('input', recalcQuote);
  if (flipBtn) flipBtn.addEventListener('click', ()=>{
    if (!fromTokenSel || !toTokenInp) return;
    fromTokenSel.value = fromTokenSel.value==='VIC' ? 'FROLL' : 'VIC';
    toTokenInp.value   = fromTokenSel.value==='VIC' ? 'FROLL' : 'VIC';
    recalcQuote(); refreshBalances();
  });
  if (approveBtn) approveBtn.addEventListener('click', async ()=>{
    try {
      const raw = ($('#from-amount').value||'').trim(); if (!raw) { $('#swap-status').textContent='Enter amount first.'; return; }
      const amount = ethers.parseUnits(raw, 18);
      await ensureFrollAllowance(amount);
      $('#swap-status').textContent='Approve done.';
    } catch(e){ console.error(e); $('#swap-status').textContent='Approve failed.'; }
  });
  if (swapBtn) swapBtn.addEventListener('click', doSwap);
}

function wireSocialUI() {
  $('#social-register')?.addEventListener('click', socialRegister);
  $('#post-btn')?.addEventListener('click', socialPost);
  $('#like-btn')?.addEventListener('click', ()=>socialAction('like'));
  $('#share-btn')?.addEventListener('click', ()=>socialAction('share'));
  $('#follow-btn')?.addEventListener('click', ()=>socialAction('follow'));
}

function boot() {
  wireConnectButton();
  wireSwapUI();
  wireSocialUI();
  loadPrice();
  loadFeed();
}
window.addEventListener('load', boot);
