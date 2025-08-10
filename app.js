/* ================================
   Froll.net — On-chain Social + Swap
   Requires: ethers v5.7 (loaded in index.html)
================================== */

// ---------- Constants ----------
const FROLL_SOCIAL_ADDRESS = window.FROLL_SOCIAL_ADDRESS;
const FROLL_TOKEN_ADDRESS  = window.FROLL_TOKEN_ADDRESS;
const SWAP_CONTRACT_ADDRESS = window.SWAP_CONTRACT_ADDRESS;

// Fixed-rate info (from your swap contract spec)
const FIXED_RATE_FROLL_VIC = 100;   // 1 FROLL = 100 VIC
const FIXED_FEE_VIC        = 0.01;  // 0.01 VIC fee per swap tx

// Binance API for VIC price in USDT → FROLL = 100 * VIC
const BINANCE_VIC_TICKER = "https://api.binance.com/api/v3/ticker/price?symbol=VICUSDT";

// ---------- Minimal ABIs ----------
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

// FrollSocial ABI (only the parts we use; matches your compiled ABI)
const FROLL_SOCIAL_ABI = [
  "constructor(address frollToken)",
  "function FROLL() view returns (address)",
  "function MAX_POST_BYTES() view returns (uint256)",
  "function registerFee() view returns (uint256)",
  "function isRegistered(address) view returns (bool)",
  "function nextPostId() view returns (uint256)",
  "function register()",
  "function createPost(string content) returns (uint256)",
  "function getPost(uint256 id) view returns (tuple(uint256 id,address author,string content,uint64 timestamp))"
];

// Swap contract (fixed-rate)
const SWAP_ABI = [
  "function swapVicToFroll() payable",
  "function swapFrollToVic(uint256 frollAmount)"
];

// ---------- State ----------
let provider, signer, account;
let frollToken, frollSocial, swapContract;
let frollDecimals = 18;

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);

function shortAddr(addr) {
  if (!addr) return "Not connected";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function linkify(text) {
  const urlRegex = /\b(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)\b/gi;
  return text.replace(urlRegex, (url) => {
    const href = url.startsWith("http") ? url : `https://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

function bytesUtf8(s) {
  return new TextEncoder().encode(s).length;
}

function formatTime(tsSec) {
  const d = new Date(tsSec * 1000);
  return d.toLocaleString();
}

async function fetchVicPriceAndShow() {
  try {
    const res = await fetch(BINANCE_VIC_TICKER);
    const data = await res.json();
    const vicUsd = parseFloat(data.price); // USDT≈USD
    if (!isFinite(vicUsd)) throw new Error("Bad VIC price");
    const frollUsd = vicUsd * FIXED_RATE_FROLL_VIC;
    $("#froll-price-usd").textContent = `1 FROLL ≈ ${frollUsd.toFixed(2)} USD`;
  } catch (e) {
    $("#froll-price-usd").textContent = "Loading price...";
  }
}

async function ensureApproval(token, owner, spender, amountWei) {
  const current = await token.allowance(owner, spender);
  if (current.gte(amountWei)) return null;
  const tx = await token.approve(spender, amountWei);
  return tx.wait();
}

// ---------- Wallet / Contracts ----------
async function connect() {
  if (!window.ethereum) {
    alert("Please install MetaMask or a compatible wallet.");
    return;
  }
  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  account = await signer.getAddress();

  // Instances
  frollToken   = new ethers.Contract(FROLL_TOKEN_ADDRESS, ERC20_ABI, signer);
  frollSocial  = new ethers.Contract(FROLL_SOCIAL_ADDRESS, FROLL_SOCIAL_ABI, signer);
  swapContract = new ethers.Contract(SWAP_CONTRACT_ADDRESS, SWAP_ABI, signer);

  try { frollDecimals = await frollToken.decimals(); } catch {}
  $("#wallet-short").textContent = shortAddr(account);
  $("#connect-btn").textContent = "Disconnect";
  $("#connect-btn").dataset.connected = "1";

  await refreshFeed();
  await refreshRegisterButton();
}

function disconnectUi() {
  provider = signer = account = null;
  $("#wallet-short").textContent = "Not connected";
  $("#connect-btn").textContent = "Connect Wallet";
  $("#connect-btn").dataset.connected = "0";
}

// ---------- Registration ----------
async function refreshRegisterButton() {
  if (!signer) return;
  const reg = await frollSocial.isRegistered(account);
  $("#register-btn").disabled = reg;
  $("#register-btn").textContent = reg ? "Registered" : "Register";
}

async function onRegister() {
  if (!signer) return alert("Connect wallet first.");
  const fee = await frollSocial.registerFee(); // in FROLL wei (18)
  // Approve FROLL to contract if needed
  await ensureApproval(frollToken, account, FROLL_SOCIAL_ADDRESS, fee);
  const tx = await frollSocial.register();
  $("#register-btn").disabled = true;
  await tx.wait();
  await refreshRegisterButton();
  alert("Registration successful!");
}

// ---------- Posting ----------
async function onPost() {
  if (!signer) return alert("Connect wallet first.");
  const content = $("#post-content").value || "";
  const limit = await frollSocial.MAX_POST_BYTES();
  const size = bytesUtf8(content);
  if (size === 0) return alert("Please write something.");
  if (size > limit.toNumber()) return alert(`Post exceeds ${limit.toString()} bytes.`);

  // Must be registered
  const reg = await frollSocial.isRegistered(account);
  if (!reg) return alert("Please register first (0.001 FROLL).");

  const tx = await frollSocial.createPost(content);
  $("#post-btn").disabled = true;
  await tx.wait();
  $("#post-btn").disabled = false;
  $("#post-content").value = "";
  $("#byte-counter").textContent = `0 / ${limit}`;
  await refreshFeed();
}

// ---------- Feed ----------
async function refreshFeed() {
  try {
    const root = $("#feed");
    root.innerHTML = "";
    const count = await frollSocial.nextPostId(); // last id
    const last = count.toNumber();
    const start = Math.max(1, last - 19); // last 20 posts
    for (let id = last; id >= start; id--) {
      const p = await frollSocial.getPost(id);
      const contentEsc = escapeHtml(p.content);
      const contentHtml = linkify(contentEsc);
      const el = document.createElement("div");
      el.className = "post";
      el.innerHTML = `
        <div class="head">
          <span>${shortAddr(p.author)}</span>
          <span>${formatTime(p.timestamp)}</span>
        </div>
        <div class="content">${contentHtml}</div>
      `;
      root.appendChild(el);
    }
    if (last === 0) {
      root.innerHTML = `<div class="meta">No posts yet. Be the first!</div>`;
    }
  } catch (e) {
    console.error("refreshFeed error:", e);
  }
}

// ---------- Byte Counter ----------
function setupByteCounter() {
  const ta = $("#post-content");
  const counter = $("#byte-counter");
  function update() {
    const size = bytesUtf8(ta.value || "");
    counter.textContent = `${size} / 60000 bytes`;
  }
  ta.addEventListener("input", update);
  update();
}

// ---------- Swap ----------
function updateSwapPreview() {
  const fromToken = $("#from-token").value;
  const toToken   = $("#to-token").value;
  const fromAmt   = parseFloat($("#from-amount").value || "0");
  let out = 0;

  if (!isFinite(fromAmt) || fromAmt <= 0) {
    $("#to-amount").value = "";
    return;
  }

  if (fromToken === "VIC" && toToken === "FROLL") {
    // VIC → FROLL (rate: 1 FROLL = 100 VIC)
    out = fromAmt / FIXED_RATE_FROLL_VIC;
  } else if (fromToken === "FROLL" && toToken === "VIC") {
    out = fromAmt * FIXED_RATE_FROLL_VIC;
  } else {
    out = fromAmt; // same token (shouldn’t happen with our selects)
  }
  $("#to-amount").value = (out || 0).toString();
}

async function doSwap() {
  if (!signer) return alert("Connect wallet first.");
  const fromToken = $("#from-token").value;
  const toToken   = $("#to-token").value;

  const fromAmtNum = parseFloat($("#from-amount").value || "0");
  if (!isFinite(fromAmtNum) || fromAmtNum <= 0) return alert("Enter a valid amount.");

  try {
    if (fromToken === "VIC" && toToken === "FROLL") {
      // User pays VIC + fee (0.01 VIC) as msg.value
      const vicToSend = fromAmtNum + FIXED_FEE_VIC;
      const tx = await swapContract.swapVicToFroll({
        value: ethers.utils.parseEther(vicToSend.toString())
      });
      $("#swap-btn").disabled = true;
      await tx.wait();
      $("#swap-btn").disabled = false;
      alert("Swapped VIC → FROLL successfully.");
    } else if (fromToken === "FROLL" && toToken === "VIC") {
      // User approves FROLL and also sends 0.01 VIC fee in msg.value (per your spec)
      const frollWei = ethers.utils.parseUnits(fromAmtNum.toString(), frollDecimals);
      await ensureApproval(frollToken, account, SWAP_CONTRACT_ADDRESS, frollWei);
      const tx = await swapContract.swapFrollToVic(frollWei, {
        value: ethers.utils.parseEther(FIXED_FEE_VIC.toString())
      });
      $("#swap-btn").disabled = true;
      await tx.wait();
      $("#swap-btn").disabled = false;
      alert("Swapped FROLL → VIC successfully.");
    } else {
      alert("Please choose different tokens to swap.");
    }
  } catch (e) {
    console.error(e);
    alert("Swap failed. Please try again or adjust amount.");
  }
}

// ---------- UI wiring ----------
function setupUi() {
  // Connect / Disconnect
  $("#connect-btn").addEventListener("click", async () => {
    if ($("#connect-btn").dataset.connected === "1") {
      disconnectUi();
    } else {
      await connect();
    }
  });

  // Register
  $("#register-btn").addEventListener("click", onRegister);

  // Posting
  $("#post-btn").addEventListener("click", onPost);
  setupByteCounter();

  // Swap panel
  $("#swap-toggle").addEventListener("click", () => {
    const panel = $("#swap-panel");
    const hidden = panel.classList.toggle("hide");
    panel.setAttribute("aria-hidden", hidden ? "true" : "false");
  });

  // Swap input listeners
  $("#from-token").addEventListener("change", updateSwapPreview);
  $("#to-token").addEventListener("change", updateSwapPreview);
  $("#from-amount").addEventListener("input", updateSwapPreview);
  $("#swap-btn").addEventListener("click", doSwap);
}

// ---------- Init ----------
(async function init() {
  setupUi();
  await fetchVicPriceAndShow();

  // If wallet already connected (some wallets inject accounts)
  if (window.ethereum) {
    try {
      const p = new ethers.providers.Web3Provider(window.ethereum);
      const accs = await p.listAccounts();
      if (accs && accs.length) {
        await connect();
      }
      // Auto-refresh price periodically
      setInterval(fetchVicPriceAndShow, 60_000);
      // Wallet events
      window.ethereum.on?.("accountsChanged", () => window.location.reload());
      window.ethereum.on?.("chainChanged", () => window.location.reload());
    } catch {}
  }
})();
