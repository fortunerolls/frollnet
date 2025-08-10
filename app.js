/* app.js — FROLL Social DApp (fix connect wallet + auto switch/add VIC) */

/* ====== CONFIG ====== */
const VIC = {
  chainIdHex: '0x58',               // 88 (Viction Mainnet)
  chainIdDec: 88,
  params: {
    chainId: '0x58',
    chainName: 'Viction Mainnet',
    nativeCurrency: { name: 'VIC', symbol: 'VIC', decimals: 18 },
    rpcUrls: [
      'https://rpc.viction.xyz',
      'https://viction.blockpi.network/v1/rpc/public'
    ],
    blockExplorerUrls: ['https://vicscan.xyz/']
  }
};

// FROLL on Viction (from your notes)
const FROLL_TOKEN = '0xB4d562A8f811CE7F134a1982992Bd153902290BC';
const ERC20_MINI_ABI = [
  { "constant":true,"inputs":[{"name":"account","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"type":"function" },
  { "constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"type":"function" },
  { "constant":true,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"type":"function" }
];

/* ====== STATE ====== */
let provider, signer, userAddress;

/* ====== DOM HELPERS ====== */
const $ = (sel) => document.querySelector(sel);
const connectBtn = $('#connect-wallet');
const statusEl   = $('#connection-status') || (() => {
  const s = document.createElement('div');
  s.id = 'connection-status';
  s.style.textAlign = 'center';
  s.style.marginTop = '8px';
  connectBtn?.parentElement?.appendChild(s);
  return s;
})();

/* ====== UI ====== */
function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }
function short(addr){ return addr ? addr.slice(0,6)+'...'+addr.slice(-4) : ''; }

/* ====== NETWORK ====== */
async function ensureVICNetwork() {
  const eth = window.ethereum;
  if (!eth) throw new Error('No wallet found. Please install MetaMask or a compatible wallet.');

  const currentChainId = await eth.request({ method: 'eth_chainId' });
  if (currentChainId === VIC.chainIdHex) return true;

  // Try switch
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: VIC.chainIdHex }]
    });
    return true;
  } catch (err) {
    // If chain not added
    if (err?.code === 4902) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [VIC.params]
      });
      return true;
    }
    throw err;
  }
}

/* ====== CONNECT FLOW ====== */
async function connectWallet() {
  try {
    if (!window.ethereum) {
      setStatus('No wallet found. Please install MetaMask.');
      return;
    }

    connectBtn.disabled = true;
    setStatus('Connecting... check your wallet');

    // Request accounts
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) {
      setStatus('No account connected.');
      connectBtn.disabled = false;
      return;
    }

    // Ensure network
    await ensureVICNetwork();

    // Ethers v6 BrowserProvider
    provider = new ethers.BrowserProvider(window.ethereum, 'any');
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();

    setStatus(`Connected: ${short(userAddress)}`);

    // Update balances if you have placeholders in UI (optional)
    updateBalances().catch(()=>{});
    wireWalletEvents();
  } catch (err) {
    // Common errors
    if (err?.code === 4001) {
      setStatus('Connect canceled. Please approve in your wallet.');
    } else if (String(err?.message || '').toLowerCase().includes('wallet_switchethereumchain')) {
      setStatus('Please switch to VIC network in your wallet.');
    } else {
      console.error(err);
      setStatus('Connect failed. Please approve wallet requests or switch to VIC network.');
    }
  } finally {
    connectBtn.disabled = false;
  }
}

/* ====== BALANCES (optional display) ====== */
async function updateBalances() {
  if (!provider || !userAddress) return;
  // Native VIC
  const vicWei = await provider.getBalance(userAddress);
  const vic = Number(ethers.formatEther(vicWei));

  // FROLL
  const erc20 = new ethers.Contract(FROLL_TOKEN, ERC20_MINI_ABI, provider);
  const [dec, sym, raw] = await Promise.all([
    erc20.decimals(),
    erc20.symbol(),
    erc20.balanceOf(userAddress)
  ]);
  const froll = Number(ethers.formatUnits(raw, dec));

  const vicEl = $('#vic-balance');
  const frEl  = $('#froll-balance');
  if (vicEl) vicEl.textContent = `${vic.toFixed(4)} VIC`;
  if (frEl)  frEl.textContent  = `${froll.toFixed(4)} ${sym}`;
}

/* ====== EVENTS ====== */
function wireWalletEvents() {
  if (!window.ethereum) return;
  window.ethereum.removeAllListeners?.('accountsChanged');
  window.ethereum.removeAllListeners?.('chainChanged');

  window.ethereum.on('accountsChanged', (accs) => {
    if (!accs || accs.length === 0) {
      setStatus('Wallet disconnected.');
      userAddress = undefined;
      return;
    }
    userAddress = accs[0];
    setStatus(`Connected: ${short(userAddress)}`);
    updateBalances().catch(()=>{});
  });

  window.ethereum.on('chainChanged', async (cid) => {
    // Force reload to reset provider/signers & stay on VIC
    if (cid !== VIC.chainIdHex) {
      setStatus('Wrong network. Switching to VIC...');
      try { await ensureVICNetwork(); location.reload(); } catch (_) { setStatus('Please switch to VIC network.'); }
    } else {
      location.reload();
    }
  });
}

/* ====== PRICE (if you show price text "Loading price...") ====== */
async function loadVicPriceToUsd() {
  const priceEl = document.getElementById('froll-price');
  if (!priceEl) return;
  try {
    priceEl.textContent = 'Loading price...';
    // FROLL = 100 VIC (fixed), get VIC/USDT from Binance
    const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=VICUSDT');
    const data = await r.json();
    const vicUsd = parseFloat(data?.price || '0');
    if (vicUsd > 0) {
      const frollUsd = 100 * vicUsd;
      priceEl.textContent = `1 FROLL = ${frollUsd.toFixed(2)} USD`;
    } else {
      priceEl.textContent = '1 FROLL = — USD';
    }
  } catch {
    priceEl.textContent = '1 FROLL = — USD';
  }
}

/* ====== INIT ====== */
function boot() {
  if (connectBtn) connectBtn.addEventListener('click', connectWallet);
  loadVicPriceToUsd();
}
document.addEventListener('DOMContentLoaded', boot);
