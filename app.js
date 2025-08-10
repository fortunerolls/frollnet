/* app.js — FROLL Social DApp (Connect fix + Swap wired; Social ready-to-wire) */

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

const FROLL = {
  address: '0xB4d562A8f811CE7F134a1982992Bd153902290BC' // FROLL on VIC
};

// Swap contract (fixed rate 1 FROLL = 100 VIC, fee 0.01 VIC)
const SWAP = {
  address: '0x9197BF0813e0727df4555E8cb43a0977F4a3A068',
  abi: [
    // Minimal ABI for the exposed methods
    {"inputs":[],"name":"swapVicToFroll","outputs":[],"stateMutability":"payable","type":"function"},
    {"inputs":[{"internalType":"uint256","name":"frollAmount","type":"uint256"}],"name":"swapFrollToVic","outputs":[],"stateMutability":"payable","type":"function"}
  ],
  FEE_VIC: ethers.parseEther("0.01"),
  RATE: 100n // 1 FROLL = 100 VIC
};

// Social (placeholder — fill when you have it)
const SOCIAL = {
  address: '', // <<< PUT YOUR SOCIAL CONTRACT ADDRESS HERE
  abi: [
    // EXAMPLE signatures — replace to your actual ABI:
    // {"inputs":[],"name":"register","outputs":[],"stateMutability":"nonpayable","type":"function"},
    // {"inputs":[{"internalType":"string","name":"content","type":"string"}],"name":"post","outputs":[{"internalType":"uint256","name":"postId","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
    // {"inputs":[{"internalType":"uint256","name":"postId","type":"uint256"}],"name":"like","outputs":[],"stateMutability":"nonpayable","type":"function"},
    // {"inputs":[{"internalType":"uint256","name":"postId","type":"uint256"}],"name":"share","outputs":[],"stateMutability":"nonpayable","type":"function"},
    // {"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"follow","outputs":[],"stateMutability":"nonpayable","type":"function"},
    // {"inputs":[{"internalType":"uint256","name":"from","type":"uint256"},{"internalType":"uint256","name":"count","type":"uint256"}],"name":"listPosts","outputs":[{"components":[{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"address","name":"author","type":"address"},{"internalType":"string","name":"content","type":"string"},{"internalType":"uint256","name":"likes","type":"uint256"},{"internalType":"uint256","name":"shares","type":"uint256"}],"internalType":"struct Post[]","name":"","type":"tuple[]"}],"stateMutability":"view","type":"function"}
  ],
  REGISTER_FEE_FROLL: ethers.parseUnits("0.001", 18) // if your contract uses ERC20 fee
};

// ERC20 mini ABI
const ERC20_ABI = [
  { "constant":true,"inputs":[{"name":"account","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"type":"function" },
  { "constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"type":"function" },
  { "constant":true,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"type":"function" },
  { "constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"type":"function" },
  { "constant":true,"inputs":[{"name":"owner","type":"address"},{"name":"spender","type":"address"}],"name":"allowance","outputs":[{"name":"","type":"uint256"}],"type":"function" }
];

/** ===== STATE ===== **/
let provider, signer, user;

/** ===== DOM ===== **/
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const connectBtn = $('#connect-wallet');
const statusEl = $('#connection-status');

const priceEl = $('#froll-price');

const fromTokenSel = $('#from-token');
const fromAmountInp = $('#from-amount');
const toTokenInp = $('#to-token');
const toAmountInp = $('#to-amount');
const fromBalEl = $('#from-balance');
const toBalEl = $('#to-balance');
const flipBtn = $('#flip');
const approveBtn = $('#approve-btn');
const swapBtn = $('#swap-btn');
const swapStatus = $('#swap-status');

const socialRegisterBtn = $('#social-register');
const socialStatus = $('#social-status');
const postTextarea = $('#post-content');
const postBtn = $('#post-btn');
const feedEl = $('#feed');
const likeBtn = $('#like-btn');
const shareBtn = $('#share-btn');
const followBtn = $('#follow-btn');
const targetPostIdInp = $('#target-post-id');
const followAddrInp = $('#follow-address');

/** ===== UI HELPERS ===== **/
function setStatus(t){ if(statusEl) statusEl.textContent = t; }
const short = a => a ? `${a.slice(0,6)}…${a.slice(-4)}` : '';

function setTabHandlers(){
  $$('.tab').forEach(btn=>{
    btn.onclick = ()=>{
      $$('.tab').forEach(b=>b.classList.remove('active'));
      $$('.tab-pane').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-target');
      document.querySelector(target).classList.add('active');
    };
  });
}

/** ===== NETWORK ===== **/
async function ensureVIC(){
  const eth = window.ethereum;
  if(!eth) throw new Error('No wallet found. Please install MetaMask.');
  const chainId = await eth.request({ method:'eth_chainId' });
  if(chainId === VIC.chainIdHex) return;
  try{
    await eth.request({ method:'wallet_switchEthereumChain', params:[{ chainId: VIC.chainIdHex }] });
  }catch(err){
    if(err && err.code === 4902){
      await eth.request({ method:'wallet_addEthereumChain', params:[VIC.params] });
    }else{
      throw err;
    }
  }
}

/** ===== CONNECT ===== **/
async function connect(){
  try{
    if(!window.ethereum){ setStatus('No wallet found.'); return; }
    connectBtn.disabled = true;
    setStatus('Connecting… check your wallet');

    const accounts = await window.ethereum.request({ method:'eth_requestAccounts' });
    if(!accounts || !accounts.length){ setStatus('No account connected.'); return; }

    await ensureVIC();

    provider = new ethers.BrowserProvider(window.ethereum, 'any');
    signer = await provider.getSigner();
    user = await signer.getAddress();

    setStatus(`Connected: ${short(user)}`);
    await refreshBalances();
    wireWalletEvents();
  }catch(err){
    if(err?.code === 4001) setStatus('Connect canceled in wallet.');
    else if(String(err?.message||'').toLowerCase().includes('wallet_switchethereumchain')) setStatus('Please switch to VIC network.');
    else { console.error(err); setStatus('Connect failed. Please approve or switch to VIC.'); }
  }finally{
    connectBtn.disabled = false;
  }
}

function wireWalletEvents(){
  if(!window.ethereum) return;
  window.ethereum.removeAllListeners?.('accountsChanged');
  window.ethereum.removeAllListeners?.('chainChanged');

  window.ethereum.on('accountsChanged', async (accs)=>{
    if(!accs || !accs.length){ setStatus('Wallet disconnected.'); user=undefined; return; }
    user = accs[0];
    setStatus(`Connected: ${short(user)}`);
    await refreshBalances();
  });

  window.ethereum.on('chainChanged', async (cid)=>{
    if(cid !== VIC.chainIdHex){ setStatus('Wrong network. Switching…'); try{ await ensureVIC(); location.reload(); }catch{} }
    else location.reload();
  });
}

/** ===== PRICE ===== **/
async function loadPrice(){
  if(!priceEl) return;
  try{
    priceEl.textContent = 'Loading price...';
    const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=VICUSDT');
    const j = await r.json();
    const vicUsd = parseFloat(j?.price||'0');
    if(vicUsd>0){
      const frollUsd = 100*vicUsd;
      priceEl.textContent = `1 FROLL = ${frollUsd.toFixed(2)} USD`;
    }else{
      priceEl.textContent = '1 FROLL = — USD';
    }
  }catch{
    priceEl.textContent = '1 FROLL = — USD';
  }
}

/** ===== BALANCES ===== **/
async function refreshBalances(){
  if(!provider || !user) { fromBalEl.textContent='—'; toBalEl.textContent='—'; return; }
  // VIC balance
  const vicWei = await provider.getBalance(user);
  const vic = Number(ethers.formatEther(vicWei));
  // FROLL balance
  const erc20 = new ethers.Contract(FROLL.address, ERC20_ABI, provider);
  const [sym, dec, raw] = await Promise.all([
    erc20.symbol(), erc20.decimals(), erc20.balanceOf(user)
  ]);
  const froll = Number(ethers.formatUnits(raw, dec));

  const fromToken = fromTokenSel.value;
  if(fromToken === 'VIC'){
    fromBalEl.textContent = `${vic.toFixed(4)} VIC`;
    toBalEl.textContent = `${froll.toFixed(4)} ${sym}`;
  }else{
    fromBalEl.textContent = `${froll.toFixed(4)} ${sym}`;
    toBalEl.textContent = `${vic.toFixed(4)} VIC`;
  }
}

/** ===== SWAP UI LOGIC ===== **/
function recalcQuote(){
  const fromToken = fromTokenSel.value;
  const val = Number(fromAmountInp.value || '0');
  if(val<=0){ toAmountInp.value=''; return; }
  if(fromToken === 'VIC'){
    // VIC -> FROLL: F = VIC / 100
    const out = val/100;
    toTokenInp.value = 'FROLL';
    toAmountInp.value = out.toFixed(6);
    approveBtn.style.display = 'none';
  }else{
    // FROLL -> VIC: VIC = FROLL * 100
    const out = val*100;
    toTokenInp.value = 'VIC';
    toAmountInp.value = out.toFixed(6);
    // might need approve for FROLL
    approveBtn.style.display = 'inline-block';
  }
}

async function ensureFrollAllowance(amount){
  const erc20 = new ethers.Contract(FROLL.address, ERC20_ABI, signer);
  const cur = await erc20.allowance(user, SWAP.address);
  if(cur >= amount) return true;
  const tx = await erc20.approve(SWAP.address, amount);
  swapStatus.textContent = 'Approving FROLL…';
  await tx.wait();
  return true;
}

/** ===== SWAP ACTION ===== **/
async function doSwap(){
  try{
    if(!signer || !user){ await connect(); if(!user) return; }
    await ensureVIC();

    const fromToken = fromTokenSel.value;
    const raw = fromAmountInp.value.trim();
    const amt = Number(raw);
    if(!raw || isNaN(amt) || amt <= 0){ swapStatus.textContent='Enter a valid amount.'; return; }

    const contract = new ethers.Contract(SWAP.address, SWAP.abi, signer);

    if(fromToken === 'VIC'){
      // User sends VIC; out FROLL = VIC/100 ; must also send 0.01 VIC fee
      const vicAmount = ethers.parseEther(raw);
      const value = vicAmount + SWAP.FEE_VIC; // pay swap amount + fee
      const tx = await contract.swapVicToFroll({ value });
      swapStatus.textContent = 'Swapping VIC→FROLL…';
      await tx.wait();
      swapStatus.textContent = 'Swap done!';
    }else{
      // FROLL -> VIC ; need approve FROLL; also send 0.01 VIC fee as msg.value
      const frollAmount = ethers.parseUnits(raw, 18);
      await ensureFrollAllowance(frollAmount);
      const tx = await contract.swapFrollToVic(frollAmount, { value: SWAP.FEE_VIC });
      swapStatus.textContent = 'Swapping FROLL→VIC…';
      await tx.wait();
      swapStatus.textContent = 'Swap done!';
    }

    fromAmountInp.value = '';
    toAmountInp.value = '';
    await refreshBalances();
  }catch(err){
    console.error(err);
    if(err?.code === 4001) swapStatus.textContent = 'Transaction rejected in wallet.';
    else swapStatus.textContent = 'Swap failed. See console for details.';
  }
}

/** ===== SOCIAL WIRES (UI only until ABI/addr provided) ===== **/
function checkSocialConfigured(){
  return SOCIAL.address && SOCIAL.address.startsWith('0x') && SOCIAL.address.length === 42 && SOCIAL.abi && SOCIAL.abi.length>0;
}

async function socialRegister(){
  try{
    if(!signer || !user){ await connect(); if(!user) return; }
    if(!checkSocialConfigured()){
      socialStatus.textContent = 'Social contract not configured yet. Provide address & ABI.';
      return;
    }
    const erc20 = new ethers.Contract(FROLL.address, ERC20_ABI, signer);
    // Approve fee first if your contract pulls fee in FROLL:
    const ok = await ensureFrollAllowance(SOCIAL.REGISTER_FEE_FROLL);
    if(ok){
      const social = new ethers.Contract(SOCIAL.address, SOCIAL.abi, signer);
      const tx = await social.register(); // adjust to your actual signature
      socialStatus.textContent = 'Registering…';
      await tx.wait();
      socialStatus.textContent = 'Registered!';
    }
  }catch(e){
    console.error(e);
    socialStatus.textContent = 'Register failed.';
  }
}

async function socialPost(){
  try{
    if(!signer || !user){ await connect(); if(!user) return; }
    if(!checkSocialConfigured()){ socialStatus.textContent='Social contract not configured yet.'; return; }
    const content = (postTextarea.value||'').trim();
    if(!content){ socialStatus.textContent='Write something first.'; return; }
    const social = new ethers.Contract(SOCIAL.address, SOCIAL.abi, signer);
    const tx = await social.post(content); // adjust to your actual signature
    socialStatus.textContent = 'Publishing…';
    const rc = await tx.wait();
    socialStatus.textContent = 'Published!';
    postTextarea.value = '';
    await loadFeed();
  }catch(e){
    console.error(e);
    socialStatus.textContent = 'Publish failed.';
  }
}

async function socialLikeShareFollow(kind){
  try{
    if(!signer || !user){ await connect(); if(!user) return; }
    if(!checkSocialConfigured()){ $('#social-action-status').textContent='Social contract not configured yet.'; return; }
    const social = new ethers.Contract(SOCIAL.address, SOCIAL.abi, signer);
    if(kind==='like'){
      const id = Number(targetPostIdInp.value||'0'); if(!id){ $('#social-action-status').textContent='Enter Post ID.'; return; }
      const tx = await social.like(id);
      $('#social-action-status').textContent = 'Liking…';
      await tx.wait();
      $('#social-action-status').textContent = 'Liked!';
    }else if(kind==='share'){
      const id = Number(targetPostIdInp.value||'0'); if(!id){ $('#social-action-status').textContent='Enter Post ID.'; return; }
      const tx = await social.share(id);
      $('#social-action-status').textContent = 'Sharing…';
      await tx.wait();
      $('#social-action-status').textContent = 'Shared!';
    }else if(kind==='follow'){
      const addr = (followAddrInp.value||'').trim();
      if(!(addr && addr.startsWith('0x') && addr.length===42)){ $('#social-action-status').textContent='Enter a valid address.'; return; }
      const tx = await social.follow(addr);
      $('#social-action-status').textContent = 'Following…';
      await tx.wait();
      $('#social-action-status').textContent = 'Followed!';
    }
  }catch(e){
    console.error(e);
    $('#social-action-status').textContent = 'Action failed.';
  }
}

async function loadFeed(){
  feedEl.innerHTML = '';
  if(!checkSocialConfigured()){
    // temporary mocked feed
    const demo = [
      {id:1,author:'0xDEMO1',content:'Welcome to FROLL Social! Configure contract to go on-chain.',likes:12,shares:3},
      {id:2,author:'0xDEMO2',content:'Swap FROLL ↔ VIC at a fixed rate. Fully transparent.',likes:7,shares:1}
    ];
    for(const p of demo){
      const el = document.createElement('div');
      el.className = 'post';
      el.innerHTML = `
        <div class="post-head">
          <span class="author">${p.author}</span>
          <span class="pid">#${p.id}</span>
        </div>
        <div class="post-content">${escapeHtml(p.content)}</div>
        <div class="post-meta">❤ ${p.likes} • 🔁 ${p.shares}</div>
      `;
      feedEl.appendChild(el);
    }
    return;
  }

  try{
    const social = new ethers.Contract(SOCIAL.address, SOCIAL.abi, provider);
    // Example call — adjust to your ABI:
    // const posts = await social.listPosts(0, 20);
    const posts = []; // until ABI available
    if(!posts.length){
      const el = document.createElement('div');
      el.className = 'muted';
      el.textContent = 'No posts yet.';
      feedEl.appendChild(el);
      return;
    }
    for(const p of posts){
      const el = document.createElement('div');
      el.className = 'post';
      el.innerHTML = `
        <div class="post-head">
          <span class="author">${p.author}</span>
          <span class="pid">#${p.id}</span>
        </div>
        <div class="post-content">${escapeHtml(p.content)}</div>
        <div class="post-meta">❤ ${p.likes} • 🔁 ${p.shares}</div>
      `;
      feedEl.appendChild(el);
    }
  }catch(e){
    console.error(e);
    const el = document.createElement('div');
    el.className = 'muted';
    el.textContent = 'Failed to load feed.';
    feedEl.appendChild(el);
  }
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

/** ===== INIT / WIRES ===== **/
function wireSwapUI(){
  fromTokenSel.addEventListener('change', ()=>{
    if(fromTokenSel.value==='VIC'){ toTokenInp.value='FROLL'; }
    else { toTokenInp.value='VIC'; }
    recalcQuote(); refreshBalances();
  });
  fromAmountInp.addEventListener('input', recalcQuote);
  flipBtn.addEventListener('click', ()=>{
    const cur = fromTokenSel.value;
    fromTokenSel.value = cur==='VIC' ? 'FROLL':'VIC';
    if(fromTokenSel.value==='VIC'){ toTokenInp.value='FROLL'; } else { toTokenInp.value='VIC'; }
    recalcQuote(); refreshBalances();
  });
  approveBtn.addEventListener('click', async ()=>{
    try{
      const raw = fromAmountInp.value.trim();
      if(!raw){ swapStatus.textContent='Enter amount first.'; return; }
      const amount = ethers.parseUnits(raw, 18);
      await ensureFrollAllowance(amount);
      swapStatus.textContent = 'Approve done.';
    }catch(e){ console.error(e); swapStatus.textContent='Approve failed.'; }
  });
  swapBtn.addEventListener('click', doSwap);
}

function wireSocialUI(){
  socialRegisterBtn.addEventListener('click', socialRegister);
  postBtn.addEventListener('click', socialPost);
  likeBtn.addEventListener('click', ()=>socialLikeShareFollow('like'));
  shareBtn.addEventListener('click', ()=>socialLikeShareFollow('share'));
  followBtn.addEventListener('click', ()=>socialLikeShareFollow('follow'));
}

function boot(){
  setTabHandlers();
  wireSwapUI();
  wireSocialUI();
  loadPrice();
  loadFeed();
  connectBtn.addEventListener('click', connect);
}
document.addEventListener('DOMContentLoaded', boot);
