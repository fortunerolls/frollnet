/* ============================================================
   froll.org — app.js (FINAL PATCHED)
   - Giữ nguyên logic xóc đĩa & swap
   - Vá:
     [P1] Không cần F5 sau lỗi: uiSoftReset() + global error listeners + gọi ở các catch
     [P2] Hết NaN (mobile) ở Swap: updateSwapBalances() dùng số "thô"
   ============================================================ */

/** [0] Ethers fallback (nếu trang chưa load ethers) */
(function ensureEthers() {
  if (typeof window === 'undefined') return;
  if (typeof window.ethers !== 'undefined') return;
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/ethers@5.7.2/dist/ethers.umd.min.js';
  s.onload = () => console.log('[LOAD] ethers fallback loaded.');
  s.onerror = () => console.error('[LOAD] failed to load ethers fallback.');
  document.head.appendChild(s);
})();

/** [1] Cấu hình mạng + hợp đồng (sửa 3 dòng này nếu địa chỉ của bạn khác) */
const CONFIG = {
  chainIdHex: '0x58', // Viction mainnet (88)
  chainIdDec: 88,
  chainName: 'Viction',
  rpcUrl: 'https://rpc.viction.xyz',
  blockExplorer: 'https://vicscan.xyz',

  // === SỬA NẾU CẦN ===
  FROLL: '0xB4d562A8f811CE7F134a1982992Bd153902290BC', // token FROLL
  DICE:  '0x85A12591d3BA2A7148d18e9Ca44E0D778e458906', // hợp đồng xóc đĩa
  SWAP:  '0x9197BF0813e0727df4555E8cb43a0977F4a3A068', // hợp đồng swap

  logsLookbackBlocks: 5000,
  minMinBet: '0.001',
  autoReconnectOnLoad: true,
  connectPopupWaitMs: 15000,
};

/** [2] ABI rút gọn cần thiết */
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)'
];

const DICE_ABI = [
  'function selectTable(uint256 _minBet) external',
  'function play(uint256 amount, bool guessEven) external',
  'function playerTable(address) external view returns (uint256 minBet, uint256 maxBet)',
  'event Played(address indexed player, uint256 amount, bool guessEven, bool resultEven, bool win)'
];

const SWAP_ABI = [
  { "inputs": [], "name": "swapVicToFroll", "outputs": [], "stateMutability": "payable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "frollAmount", "type": "uint256" }], "name": "swapFrollToVic", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
];

/** [3] Trạng thái runtime */
let injected, providerRW, providerRO, signer, user;
let froll, dice, swapC;
let frollDecimals = 18;
let currentSide = 'even';
let currentTable = { min: null, max: null };

let isConnecting = false;

/** [4] Tiện ích chung */
const $ = (id) => document.getElementById(id);
function setStatus(msg){ const el = $('tx-status'); if (el) el.textContent = msg || ''; }
function short(addr){ return addr ? (addr.slice(0,6)+'…'+addr.slice(-4)) : '—'; }
function setBusy(b){
  [
    'btn-approve','btn-play','btn-set-table','btn-clear','btn-half',
    'btn-double','btn-repeat','btn-even','btn-odd','btn-open-swap',
    'max-button','swap-now'
  ].forEach(id => { const el = $(id); if (el) el.disabled = !!b; });
}

const toWei  = (n, dec=18) => ethers.utils.parseUnits(String(n || '0'), dec);
const fromWeiPlain = (w, dec=18) => { try { return ethers.utils.formatUnits(w||0, dec); } catch { return '0'; } };
const fromWeiFmt   = (w, dec=18, d=4) => {
  try { return Number(ethers.utils.formatUnits(w||0, dec)).toLocaleString(undefined, { maximumFractionDigits: d }); }
  catch { return '0'; }
};

// [P1] CẦU CHÌ: phục hồi UI khi có lỗi, khỏi phải F5
function uiSoftReset(msg){
  try { $('bowl')?.classList.remove('shaking'); } catch {}
  try { setBusy(false); } catch {}
  if (msg) setStatus(msg);
  Promise.all([
    (typeof refreshBalances === 'function' ? refreshBalances().catch(()=>{}) : Promise.resolve()),
    (typeof refreshUserTable === 'function' ? refreshUserTable().catch(()=>{}) : Promise.resolve())
  ]).then(() => {
    setTimeout(() => { try { setStatus(''); } catch {} }, 6000);
  });
}
window.addEventListener('unhandledrejection', (evt) => {
  console.warn('[Global] Unhandled rejection:', evt.reason);
  uiSoftReset(evt?.reason?.message || 'Something went wrong. UI recovered.');
});
window.addEventListener('error', (evt) => {
  console.warn('[Global] Window error:', evt.error || evt.message);
  uiSoftReset('Unexpected error. UI recovered.');
});

/** [5] Wallet helpers */
function getInjectedProvider(){
  const eth = window.ethereum;
  if (!eth) return null;
  if (eth.providers && Array.isArray(eth.providers)){
    const mm = eth.providers.find(p => p.isMetaMask);
    return mm || eth.providers[0];
  }
  return eth;
}

function bindWalletEvents(p){
  p?.on?.('accountsChanged', async (accs) => {
    if (!accs || !accs.length){ disconnectWallet(); return; }
    user   = accs[0];
    signer = providerRW.getSigner();
    const a = $('addr-short'); if (a) a.textContent = short(user);
    await Promise.all([refreshBalances(), refreshUserTable()]);
    setStatus('Account changed.'); setTimeout(()=>setStatus(''), 3000);
  });
  p?.on?.('chainChanged', async (cid) => {
    if (cid !== CONFIG.chainIdHex){
      setStatus('Wrong network. Please switch to Viction.');
    } else {
      await Promise.all([refreshBalances(), refreshUserTable()]);
      setStatus('Network OK.');
    }
    setTimeout(()=>setStatus(''), 3000);
  });
}

async function ensureChain(){
  const curr = await providerRW.send('eth_chainId', []);
  if (curr === CONFIG.chainIdHex) return;
  try {
    await providerRW.send('wallet_switchEthereumChain', [{ chainId: CONFIG.chainIdHex }]);
  } catch (e){
    if (e && e.code === 4902){
      await providerRW.send('wallet_addEthereumChain', [{
        chainId: CONFIG.chainIdHex,
        chainName: CONFIG.chainName,
        nativeCurrency: { name:'VIC', symbol:'VIC', decimals:18 },
        rpcUrls: [CONFIG.rpcUrl],
        blockExplorerUrls: [CONFIG.blockExplorer]
      }]);
    } else {
      throw e;
    }
  }
}

async function requestAccountsWithTimeout(){
  const req = providerRW.send('eth_requestAccounts', []);
  const timeout = new Promise((_, rej)=> setTimeout(()=> rej(new Error('Wallet request timed out')), CONFIG.connectPopupWaitMs));
  return Promise.race([req, timeout]);
}

/** [6] Kết nối / ngắt kết nối */
async function connectWallet(){
  if (isConnecting) return;
  isConnecting = true;
  try{
    setStatus('Connecting wallet…');

    injected = getInjectedProvider();
    if (!injected){
      setStatus('No Web3 wallet detected. Please install MetaMask/Viction.');
      alert('No Web3 wallet detected. Please install MetaMask or Viction wallet.');
      return;
    }

    providerRW = new ethers.providers.Web3Provider(injected, 'any');
    providerRO = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);

    try {
      await requestAccountsWithTimeout();
    } catch (e){
      if (e?.code === 4001){ setStatus('You rejected the connection request.'); return; }
      throw e;
    }

    await ensureChain();

    signer = providerRW.getSigner();
    user   = await signer.getAddress();

    froll = new ethers.Contract(CONFIG.FROLL, ERC20_ABI, signer);
    dice  = new ethers.Contract(CONFIG.DICE,  DICE_ABI,  signer);
    swapC = new ethers.Contract(CONFIG.SWAP,  SWAP_ABI,  signer);

    try { frollDecimals = await froll.decimals(); } catch {}

    // Cập nhật UI ví
    const b1 = $('btn-connect'), wbox = $('wallet-info'), addr = $('addr-short');
    if (b1) b1.classList.add('hidden');
    if (wbox) wbox.classList.remove('hidden');
    if (addr) addr.textContent = short(user);

    await Promise.all([refreshBalances(), refreshUserTable()]);
    setStatus('Wallet connected.');
    bindWalletEvents(injected);
  } catch (err){
    console.error('connectWallet error:', err);
    setStatus('Wallet connection failed. Open your wallet and try again.');
    uiSoftReset();
  } finally {
    isConnecting = false;
  }
}

function disconnectWallet(){
  user=null; signer=null; providerRW=null; injected=null;
  const b1 = $('btn-connect'), wbox = $('wallet-info'), addr = $('addr-short');
  if (b1) b1.classList.remove('hidden');
  if (wbox) wbox.classList.add('hidden');
  if (addr) addr.textContent = '—';
  showTable(null,null);
  setStatus('Disconnected.');
}

async function trySilentReconnectOnLoad(){
  if (!CONFIG.autoReconnectOnLoad) return;
  injected = getInjectedProvider();
  if (!injected) return;

  providerRW = new ethers.providers.Web3Provider(injected, 'any');
  providerRO = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);

  try{
    const accs = await injected.request?.({ method: 'eth_accounts' });
    if (!accs || !accs.length){ setStatus('Ready. Click “Connect Wallet”.'); return; }

    await ensureChain();

    signer = providerRW.getSigner();
    user   = accs[0];

    froll = new ethers.Contract(CONFIG.FROLL, ERC20_ABI, signer);
    dice  = new ethers.Contract(CONFIG.DICE,  DICE_ABI,  signer);
    swapC = new ethers.Contract(CONFIG.SWAP,  SWAP_ABI,  signer);

    try { frollDecimals = await froll.decimals(); } catch {}

    const b1 = $('btn-connect'), wbox = $('wallet-info'), addr = $('addr-short');
    if (b1) b1.classList.add('hidden');
    if (wbox) wbox.classList.remove('hidden');
    if (addr) addr.textContent = short(user);

    await Promise.all([refreshBalances(), refreshUserTable()]);
    setStatus('Wallet reconnected.');
    bindWalletEvents(injected);
  } catch (e){
    console.warn('Silent reconnect failed:', e);
    setStatus('Ready. Click “Connect Wallet”.');
    uiSoftReset();
  }
}

/** [7] Hiển thị bàn & kết quả */
function showTable(minWei, maxWei){
  if (!minWei || !maxWei){
    const ct = $('current-table'); if (ct) ct.textContent = 'Not set';
    const lmin = $('limit-min'), lmax = $('limit-max');
    if (lmin) lmin.textContent = '—';
    if (lmax) lmax.textContent = '—';
    currentTable = { min:null, max:null };
    return;
  }
  const minF = fromWeiFmt(minWei, frollDecimals);
  const maxF = fromWeiFmt(maxWei, frollDecimals);
  const ct = $('current-table'); if (ct) ct.textContent = `${minF} – ${maxF} FROLL`;
  const lmin = $('limit-min'), lmax = $('limit-max');
  if (lmin) lmin.textContent = minF;
  if (lmax) lmax.textContent = maxF;
  currentTable = { min:minWei, max:maxWei };
}

function renderCoins({ parityEven, txHash }){
  const coinsEl = $('coins');
  if (!coinsEl) return;
  coinsEl.className = 'coins';
  coinsEl.innerHTML = '';

  // layout “ảo” dựa theo hash để nhìn đẹp
  function variant(m){ try { return parseInt((txHash||'').slice(-4), 16) % m; } catch { return 0; } }

  if (parityEven){
    const layouts=['layout-even-0','layout-even-2a','layout-even-4'];
    const cls = layouts[variant(layouts.length)];
    coinsEl.classList.add(cls);
    const reds = ({'layout-even-0':0,'layout-even-2a':2,'layout-even-4':4})[cls];
    for (let i=0;i<4;i++){
      const c = document.createElement('div'); c.className = 'coin '+(i<reds?'red':'white'); coinsEl.appendChild(c);
    }
  } else {
    const layouts=['layout-odd-1','layout-odd-3a'];
    const cls = layouts[variant(layouts.length)];
    coinsEl.classList.add(cls);
    const reds = ({'layout-odd-1':1,'layout-odd-3a':3})[cls];
    for (let i=0;i<4;i++){
      const c = document.createElement('div'); c.className = 'coin '+(i<reds?'red':'white'); coinsEl.appendChild(c);
    }
  }
}

function showResult({ resultEven, win, txHash }){
  const out = $('last-outcome'), pay = $('last-payout'), ltx = $('last-tx');
  if (out) out.textContent = (resultEven==null)?'—':(resultEven?'Even':'Odd');
  if (pay) pay.textContent = (win==null)?'—':(win?'Win':'Lose');
  if (ltx){
    ltx.textContent = txHash || '—';
    if (txHash){
      ltx.title = txHash;
      ltx.style.cursor = 'pointer';
      ltx.onclick = () => window.open(`${CONFIG.blockExplorer}/tx/${txHash}`, '_blank');
    } else {
      ltx.onclick = null;
    }
  }
  renderCoins({ parityEven: !!resultEven, txHash });
}

/** [8] Đọc dữ liệu */
async function refreshBalances(){
  if (!user || !providerRW) return;
  const vic = await providerRW.getBalance(user);
  const fb  = froll ? await froll.balanceOf(user) : ethers.constants.Zero;
  const pool= froll ? await froll.balanceOf(CONFIG.DICE) : ethers.constants.Zero;

  const v1 = $('vic-balance'), v2 = $('froll-balance'), v3 = $('pool-balance');
  if (v1) v1.textContent = fromWeiFmt(vic, 18);
  if (v2) v2.textContent = fromWeiFmt(fb, frollDecimals);
  if (v3) v3.textContent = fromWeiFmt(pool, frollDecimals);
}

async function refreshUserTable(){
  if (!user || !dice) return;
  const t = await dice.playerTable(user);
  const [min,max] = t;
  if (min && max && min.gt(0)) showTable(min, max);
}

async function showLatestContractRound(){
  try{
    const ro = providerRO || new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
    const current = await ro.getBlockNumber();
    const from = Math.max(current - CONFIG.logsLookbackBlocks, 0);
    const iface = new ethers.utils.Interface(DICE_ABI);
    const topic0 = iface.getEventTopic('Played');
    const logs = await ro.getLogs({ address:CONFIG.DICE, fromBlock:from, toBlock:current, topics:[topic0] });
    if (!logs.length){ showResult({ resultEven:true, win:null, txHash:null }); return; }
    const last = logs[logs.length-1];
    const parsed = iface.parseLog(last);
    showResult({ resultEven: parsed.args.resultEven, win:null, txHash:last.transactionHash });
  } catch(e){
    console.warn('showLatestContractRound error:', e);
    showResult({ resultEven:true, win:null, txHash:null });
  }
}

/** [9] Hành động: Set Table / Approve / Play */
function getNumberInput(id){
  const el = $(id);
  return (el && typeof el.value === 'string') ? el.value.trim() : '';
}

function startShake(){ $('bowl')?.classList.add('shaking'); }
function stopShake(){ $('bowl')?.classList.remove('shaking'); }

function ge(minStr, minAllowed='0.000000000000000001'){
  try { return toWei(minStr, frollDecimals).gte(toWei(minAllowed, frollDecimals)); } catch { return false; }
}

async function onSetTable(){
  if (!signer || !dice) return alert('Please connect wallet.');
  const minStr = getNumberInput('minBet');
  if (!minStr) return setStatus('Enter a min bet.');
  if (!ge(minStr, CONFIG.minMinBet)) return setStatus(`Min Bet must be at least ${CONFIG.minMinBet} FROLL.`);
  try{
    setBusy(true);
    setStatus('Sending selectTable transaction…');
    const tx = await dice.selectTable(toWei(minStr, frollDecimals));
    await tx.wait(1);
    await refreshUserTable();
    setStatus('Table set successfully.');
  }catch(e){
    console.error('selectTable error:', e);
    setStatus(e?.data?.message || e?.error?.message || e?.message || 'selectTable failed.');
    uiSoftReset();
  } finally { setBusy(false); }
}

async function onApprove(){
  if (!signer || !froll) return alert('Please connect wallet.');
  let apStr = getNumberInput('approve-amount');
  if (!apStr) apStr = getNumberInput('bet-amount');
  if (!apStr) return setStatus('Enter approve amount (FROLL).');

  try{
    const balance = await froll.balanceOf(user);
    const apWei = toWei(apStr, frollDecimals);
    if (apWei.lte(ethers.constants.Zero)) return setStatus('Approve amount must be greater than 0.');
    if (apWei.gt(balance)) return setStatus(`Approve amount exceeds your wallet balance (${fromWeiFmt(balance, frollDecimals, 6)} FROLL).`);

    setBusy(true);
    setStatus('Checking current allowance…');
    const cur = await froll.allowance(user, CONFIG.DICE);
    if (cur.gte(apWei)){ setStatus('Allowance already sufficient.'); return; }

    if (!cur.isZero()){
      setStatus('Resetting allowance to 0…');
      const tx0 = await froll.approve(CONFIG.DICE, ethers.constants.Zero);
      await tx0.wait(1);
    }

    setStatus('Approving…');
    const tx1 = await froll.approve(CONFIG.DICE, apWei);
    await tx1.wait(1);
    setStatus('Approve successful.');
    await refreshBalances();
  }catch(e){
    console.error('approve error:', e);
    setStatus(e?.data?.message || e?.error?.message || e?.message || 'Approve failed.');
    uiSoftReset();
  } finally { setBusy(false); }
}

async function onPlay(){
  if (!signer || !dice) return alert('Please connect wallet.');
  if (!currentTable.min) return setStatus('Please set a table first.');

  const amtStr = getNumberInput('bet-amount');
  if (!amtStr) return setStatus('Enter bet amount.');
  const amountWei = toWei(amtStr, frollDecimals);

  if (currentTable.min && amountWei.lt(currentTable.min)) return setStatus('Bet amount is below table minimum.');
  if (currentTable.max && amountWei.gt(currentTable.max)) return setStatus('Bet amount exceeds table maximum.');

  const [balance, allowance, pool] = await Promise.all([
    froll.balanceOf(user),
    froll.allowance(user, CONFIG.DICE),
    froll.balanceOf(CONFIG.DICE),
  ]);
  if (balance.lt(amountWei))  return setStatus(`Not enough FROLL (need ${fromWeiFmt(amountWei, frollDecimals, 6)}, have ${fromWeiFmt(balance, frollDecimals, 6)}).`);
  if (allowance.lt(amountWei))return setStatus(`Allowance insufficient (${fromWeiFmt(allowance, frollDecimals, 6)}). Approve first.`);
  if (pool.lt(amountWei.mul(2))) return setStatus('Contract pool is insufficient for 2× payout.');

  // PRE-FLIGHT: tránh CALL_EXCEPTION
  try{
    setStatus('Preflight check…');
    await dice.callStatic.play(amountWei, currentSide === 'even');
  } catch (preErr){
    console.error('preflight callStatic failed:', preErr);
    const m = (preErr?.error?.message || preErr?.data?.message || preErr?.reason || preErr?.message || '').toUpperCase();
    if (m.includes('BET') && m.includes('MIN')) setStatus('Bet is below table minimum. Increase amount.');
    else if (m.includes('ALLOW')) setStatus('Allowance too low. Please click “Approve FROLL”.');
    else if (m.includes('BAL') || m.includes('INSUFFICIENT')) setStatus('Balance or pool insufficient.');
    else setStatus('Preflight failed. Please adjust bet/allowance then try again.');
    uiSoftReset();
    return;
  }

  // Gửi giao dịch thật
  setBusy(true); startShake(); setStatus('Sending play transaction…');
  try{
    const tx = await dice.play(amountWei, currentSide === 'even');
    const receipt = await tx.wait(1);

    // bắt event
    let resultEven=null, win=null;
    for (const l of receipt.logs){
      try{
        const parsed = dice.interface.parseLog(l);
        if (parsed.name === 'Played'){ resultEven = parsed.args.resultEven; win = parsed.args.win; break; }
      } catch {}
    }
    stopShake();
    showResult({ resultEven, win, txHash: tx.hash });
    await refreshBalances();
    setStatus('Round completed.');
  } catch (e){
    console.error('play error:', e);
    stopShake();
    setStatus(e?.data?.message || e?.error?.message || e?.message || 'Play failed.');
    uiSoftReset();
  } finally { setBusy(false); }
}

/** [10] Nút tiện ích & chọn chẵn/lẻ */
function onClear(){ const el = $('bet-amount'); if (el) el.value=''; setStatus(''); }
function onHalf(){
  const el = $('bet-amount'); if (!el) return;
  const v = parseFloat(el.value||'0'); if (v<=0) return;
  el.value = String(Math.max(v/2, parseFloat(CONFIG.minMinBet)));
}
function onDouble(){
  const el = $('bet-amount'); if (!el) return;
  const v = parseFloat(el.value||'0');
  const max = currentTable.max ? parseFloat(fromWeiPlain(currentTable.max, frollDecimals)) : Infinity;
  if (v<=0){
    if (currentTable.min) el.value = fromWeiPlain(currentTable.min, frollDecimals);
  } else {
    el.value = String(Math.min(v*2, max));
  }
}
function onRepeat(){ /* nếu bạn có lưu last-round thì thêm ở đây, để nguyên cho an toàn */ }

function bindSideButtons(){
  const be = $('btn-even'), bo = $('btn-odd');
  if (be) be.addEventListener('click', ()=>{ currentSide='even'; be.classList.add('active'); bo?.classList.remove('active'); });
  if (bo) bo.addEventListener('click', ()=>{ currentSide='odd';  bo.classList.add('active');  be?.classList.remove('active'); });
}

/** [11] SWAP — UI helpers (chỉ phần giao diện swap) */
const elHome        = $('home-interface');
const elSwap        = $('swap-interface');
const btnOpenSwap   = $('btn-open-swap');
const btnBackToGame = $('btn-back-to-game');
const btnDisconnect = $('disconnect-wallet');

const fromAmountInput = $('from-amount');
const toAmountInput   = $('to-amount');
const fromTokenInfo   = $('from-token-info');
const toTokenInfo     = $('to-token-info');
const fromTokenLogo   = $('from-token-logo');
const toTokenLogo     = $('to-token-logo');
const swapDirectionBtn= $('swap-direction');
const maxBtn          = $('max-button');
const swapNowBtn      = $('swap-now');
const walletAddrLabel = $('wallet-address');

let swapFrom = 'VIC';  // 'VIC' | 'FROLL'
let swapTo   = 'FROLL';

function showHomeInterface(){ if (elSwap) elSwap.style.display='none'; if (elHome) elHome.style.display=''; }
function showSwapInterface(){ if (elHome) elHome.style.display='none'; if (elSwap) elSwap.style.display=''; if (walletAddrLabel) walletAddrLabel.textContent = user? short(user): '—'; }

// [P2] KHÔNG locale -> chuỗi “thô” để tránh NaN trên mobile
async function updateSwapBalances(){
  try{
    if (!providerRW || !user) return;
    const [vicBn, frollBn] = await Promise.all([
      providerRW.getBalance(user),
      froll ? froll.balanceOf(user) : ethers.constants.Zero
    ]);
    const vicPlain = fromWeiPlain(vicBn, 18);
    const frPlain  = fromWeiPlain(frollBn, frollDecimals);
    if (fromTokenInfo && toTokenInfo){
      const getP = (sym) => sym==='VIC' ? vicPlain : frPlain;
      fromTokenInfo.textContent = `${swapFrom}: ${getP(swapFrom)}`;
      toTokenInfo.textContent   = `${swapTo}: ${getP(swapTo)}`;
    }
  }catch(e){ console.warn('updateSwapBalances:', e); }
}

function clearSwapInputs(){ if (fromAmountInput) fromAmountInput.value=''; if (toAmountInput) toAmountInput.value=''; }

function flipDirection(){
  [swapFrom, swapTo] = [swapTo, swapFrom];
  if (fromTokenLogo && toTokenLogo){
    const t = fromTokenLogo.src; fromTokenLogo.src = toTokenLogo.src; toTokenLogo.src = t;
  }
  updateSwapBalances();
  clearSwapInputs();
}

function calcToAmount(){
  if (!fromAmountInput || !toAmountInput) return;
  const v = parseFloat(fromAmountInput.value);
  if (isNaN(v) || v <= 0){ toAmountInput.value=''; return; }
  // Hiển thị 1:1 (để UI không gây hiểu nhầm). Logic tỉ giá/fee do hợp đồng xử lý.
  toAmountInput.value = v.toString();
}

async function ensureSwapReady(){
  if (!user || !signer || !providerRW){
    await connectWallet();
  }
  if (!user || !signer || !providerRW) throw new Error('Wallet not connected.');
  if (!froll) froll = new ethers.Contract(CONFIG.FROLL, ERC20_ABI, signer);
  if (!swapC) swapC = new ethers.Contract(CONFIG.SWAP,  SWAP_ABI,  signer);
}

async function onSwapMax(){
  try{
    await ensureSwapReady();
    await updateSwapBalances();
    const text = fromTokenInfo?.textContent || '';
    const vStr = text.split(':')[1]?.trim() || '';
    if (fromAmountInput){
      fromAmountInput.value = vStr;
      calcToAmount();
    }
  }catch(e){
    alert(e?.message || 'Failed to set Max.');
    uiSoftReset();
  }
}

async function onSwapNow(){
  try{
    await ensureSwapReady();
    const amount = parseFloat(fromAmountInput?.value || '0');
    if (isNaN(amount) || amount <= 0) return alert('Please enter amount.');

    if (swapFrom === 'VIC'){
      // VIC -> FROLL
      const value = ethers.utils.parseEther(String(amount));
      const tx = await swapC.swapVicToFroll({ value });
      await tx.wait(1);
      alert('Swap VIC → FROLL successful.');
    } else {
      // FROLL -> VIC (cần approve)
      const amountWei = ethers.utils.parseUnits(String(amount), frollDecimals);
      const curAllo = await froll.allowance(user, CONFIG.SWAP);
      if (curAllo.lt(amountWei)){
        if (!curAllo.isZero()){
          const tx0 = await froll.approve(CONFIG.SWAP, ethers.constants.Zero);
          await tx0.wait(1);
        }
        const tx1 = await froll.approve(CONFIG.SWAP, amountWei);
        await tx1.wait(1);
      }
      const tx = await swapC.swapFrollToVic(amountWei);
      await tx.wait(1);
      alert('Swap FROLL → VIC successful.');
    }

    await Promise.all([refreshBalances(), updateSwapBalances()]);
    clearSwapInputs();
  } catch (e){
    console.error('Swap failed:', e);
    alert(e?.reason || e?.data?.message || e?.message || 'Swap failed.');
    uiSoftReset();
  }
}

/** [12] Khởi tạo & bind UI */
async function init(){
  // chờ ethers nếu đang load fallback
  let tries=0; while (typeof window.ethers==='undefined' && tries<30){ await new Promise(r=>setTimeout(r,150)); tries++; }
  if (typeof window.ethers==='undefined'){ setStatus('ethers.js failed to load.'); return; }

  providerRO = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
  await showLatestContractRound();

  // Buttons – Wallet
  $('btn-connect')?.addEventListener('click', connectWallet);
  $('btn-disconnect')?.addEventListener('click', disconnectWallet);

  // Table & Play
  $('btn-set-table')?.addEventListener('click', onSetTable);
  $('btn-approve')?.addEventListener('click', onApprove);
  $('btn-play')?.addEventListener('click', onPlay);

  // Utilities
  $('btn-clear')?.addEventListener('click', onClear);
  $('btn-half')?.addEventListener('click', onHalf);
  $('btn-double')?.addEventListener('click', onDouble);
  $('btn-repeat')?.addEventListener('click', onRepeat);
  bindSideButtons();

  // Swap UI
  if (btnOpenSwap) btnOpenSwap.addEventListener('click', async ()=>{
    try { await ensureSwapReady(); await updateSwapBalances(); showSwapInterface(); }
    catch(e){ alert(e?.message || 'Please connect wallet to use Swap.'); }
  });
  if (btnBackToGame) btnBackToGame.addEventListener('click', showHomeInterface);
  if (btnDisconnect) btnDisconnect.addEventListener('click', ()=>{
    try { disconnectWallet(); } catch {}
    showHomeInterface();
  });
  if (fromAmountInput) fromAmountInput.addEventListener('input', calcToAmount);
  if (swapDirectionBtn) swapDirectionBtn.addEventListener('click', flipDirection);
  if (maxBtn) maxBtn.addEventListener('click', onSwapMax);
  if (swapNowBtn) swapNowBtn.addEventListener('click', onSwapNow);

  // Reconnect nếu có sẵn tài khoản
  await trySilentReconnectOnLoad();
  setStatus('Ready.');
}

// Expose để gọi từ HTML (nếu có)
window.connectWallet   = connectWallet;
window.disconnectWallet= disconnectWallet;

// Run
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
