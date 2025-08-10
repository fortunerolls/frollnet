/* =========================================
   Froll.net — On-chain Social + Swap (fixed)
   - Robust Connect: auto add/switch to VIC (chainId 88)
   - Enable buttons after connect
   - Linkify, feed, Register/Post
   - Simple Like/Follow/Share (frontend/localStorage)
   - Swap VIC↔FROLL via fixed-rate contract
   Requires: ethers v5.7 (loaded in index.html)
========================================== */

// -------- Config from index.html --------
const FROLL_SOCIAL_ADDRESS   = window.FROLL_SOCIAL_ADDRESS;
const FROLL_TOKEN_ADDRESS    = window.FROLL_TOKEN_ADDRESS;
const SWAP_CONTRACT_ADDRESS  = window.SWAP_CONTRACT_ADDRESS;
const VIC_CHAIN_ID_DEC       = window.VIC_CHAIN_ID_DEC || 88;
const VIC_CHAIN_ID_HEX       = window.VIC_CHAIN_ID_HEX || "0x58";
const VIC_PARAMS             = window.VIC_PARAMS;

// -------- Swap constants --------
const FIXED_RATE_FROLL_VIC = 100;   // 1 FROLL = 100 VIC
const FIXED_FEE_VIC        = 0.01;  // 0.01 VIC fee

// -------- Price source (VIC/USDT) --------
const BINANCE_VIC_TICKER = "https://api.binance.com/api/v3/ticker/price?symbol=VICUSDT";

// -------- Minimal ABIs --------
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];
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
const SWAP_ABI = [
  "function swapVicToFroll() payable",
  "function swapFrollToVic(uint256 frollAmount)"
];

// -------- State --------
let provider, signer, account;
let frollToken, frollSocial, swapContract;
let frollDecimals = 18;

// -------- Helpers --------
const $ = (s) => document.querySelector(s);
const store = {
  get(key, def) { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

function shortAddr(addr) { return addr ? addr.slice(0,6) + "…" + addr.slice(-4) : "Not connected"; }
function escapeHtml(str) {
  return (str||"").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
}
function linkify(text) {
  const url = /\b(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)\b/gi;
  return text.replace(url, (u) => `<a href="${u.startsWith('http')?u:`https://${u}`}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}
function bytesUtf8(s) { return new TextEncoder().encode(s||"").length; }
function formatTime(ts) { return new Date(Number(ts) * 1000).toLocaleString(); }

async function fetchVicPriceAndShow() {
  try {
    const res = await fetch(BINANCE_VIC_TICKER);
    const data = await res.json();
    const vicUsd = parseFloat(data.price);
    const frollUsd = vicUsd * FIXED_RATE_FROLL_VIC;
    $("#froll-price-usd").textContent = `1 FROLL ≈ ${frollUsd.toFixed(2)} USD`;
  } catch {
    $("#froll-price-usd").textContent = "Price unavailable";
  }
}

async function ensureApproval(token, owner, spender, amount) {
  const cur = await token.allowance(owner, spender);
  if (cur.gte(amount)) return;
  const tx = await token.approve(spender, amount);
  await tx.wait();
}

// -------- Wallet connect & chain handling --------
async function ensureVICChain() {
  const eth = window.ethereum;
  if (!eth) throw new Error("No wallet found");
  const current = await eth.request({ method: "eth_chainId" });
  if (current?.toLowerCase() === VIC_CHAIN_ID_HEX) return true;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: VIC_CHAIN_ID_HEX }] });
    return true;
  } catch (e) {
    // If the chain is not added
    if (e?.code === 4902 || /Unrecognized chain ID/i.test(e?.message || "")) {
      await eth.request({ method: "wallet_addEthereumChain", params: [VIC_PARAMS] });
      return true;
    }
    throw e;
  }
}

async function connectWallet() {
  if (!window.ethereum) { alert("Please install MetaMask or a compatible wallet."); return; }
  try {
    await ensureVICChain();
    provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer  = provider.getSigner();
    account = await signer.getAddress();

    frollToken   = new ethers.Contract(FROLL_TOKEN_ADDRESS, ERC20_ABI, signer);
    frollSocial  = new ethers.Contract(FROLL_SOCIAL_ADDRESS, FROLL_SOCIAL_ABI, signer);
    swapContract = new ethers.Contract(SWAP_CONTRACT_ADDRESS, SWAP_ABI, signer);

    try { frollDecimals = await frollToken.decimals(); } catch {}

    $("#wallet-short").textContent = shortAddr(account);
    $("#connect-btn").textContent = "Disconnect";
    $("#connect-btn").dataset.connected = "1";

    $("#register-btn").disabled = false;
    $("#post-btn").disabled = false;
    $("#swap-btn").disabled = false;

    await refreshRegisterState();
    await refreshFeed();
  } catch (e) {
    console.error(e);
    alert("Connect failed. Please approve wallet requests or switch to VIC network.");
  }
}

function disconnectUi() {
  provider = signer = account = null;
  $("#wallet-short").textContent = "Not connected";
  $("#connect-btn").textContent = "Connect Wallet";
  $("#connect-btn").dataset.connected = "0";
  $("#register-btn").disabled = true;
  $("#post-btn").disabled = true;
  // allow viewing feed without wallet
}

// -------- Register / Post --------
async function refreshRegisterState() {
  if (!signer) return;
  const reg = await frollSocial.isRegistered(account);
  $("#register-btn").disabled = reg;
  $("#register-btn").textContent = reg ? "Registered" : "Register";
}

async function onRegister() {
  if (!signer) return alert("Connect wallet first.");
  const fee = await frollSocial.registerFee();
  await ensureApproval(frollToken, account, FROLL_SOCIAL_ADDRESS, fee);
  const tx = await frollSocial.register();
  $("#register-btn").disabled = true;
  await tx.wait();
  await refreshRegisterState();
  alert("Registration successful!");
}

async function onPost() {
  if (!signer) return alert("Connect wallet first.");
  const content = $("#post-content").value || "";
  const limit = await frollSocial.MAX_POST_BYTES();
  const size  = bytesUtf8(content);
  if (size === 0) return alert("Please write something.");
  if (size > limit.toNumber()) return alert(`Post exceeds ${limit.toString()} bytes.`);
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

// -------- Feed + social (frontend) --------
function likeKey(id) { return `froll_like_${id}`; }
function followKey(addr) { return `froll_follow_${addr.toLowerCase()}`; }

function isLiked(id)    { return !!store.get(likeKey(id), false); }
function toggleLike(id) { const v = !isLiked(id); store.set(likeKey(id), v); return v; }

function isFollowed(addr)    { return !!store.get(followKey(addr), false); }
function toggleFollow(addr)  { const v = !isFollowed(addr); store.set(followKey(addr), v); return v; }

async function refreshFeed() {
  const root = $("#feed");
  root.innerHTML = "";
  try {
    const countBN = await frollSocial.nextPostId();
    const last = countBN.toNumber();
    const start = Math.max(1, last - 49); // 50 latest
    if (last === 0) {
      root.innerHTML = `<div class="meta">No posts yet. Be the first!</div>`;
      return;
    }
    for (let id = last; id >= start; id--) {
      const p = await frollSocial.getPost(id);
      const contentHtml = linkify(escapeHtml(p.content));
      const el = document.createElement("div");
      el.className = "post";
      el.id = `post-${id}`;
      const liked = isLiked(id);
      const followed = isFollowed(p.author);
      el.innerHTML = `
        <div class="head">
          <span>${shortAddr(p.author)}</span>
          <span>${formatTime(p.timestamp)}</span>
        </div>
        <div class="content">${contentHtml}</div>
        <div class="actions">
          <span class="chip ${liked?'active':''}" data-action="like" data-id="${id}">👍 Like</span>
          <span class="chip ${followed?'active':''}" data-action="follow" data-author="${p.author}">👤 Follow</span>
          <span class="chip" data-action="share" data-id="${id}">🔗 Share</span>
        </div>
      `;
      root.appendChild(el);
    }
  } catch (e) {
    console.error("refreshFeed:", e);
    root.innerHTML = `<div class="meta">Failed to load feed.</div>`;
  }
}

function setupFeedActions() {
  $("#feed").addEventListener("click", async (e) => {
    const el = e.target.closest(".chip");
    if (!el) return;
    const act = el.dataset.action;
    if (act === "like") {
      const id = Number(el.dataset.id);
      const v = toggleLike(id);
      el.classList.toggle("active", v);
    } else if (act === "follow") {
      const a = el.dataset.author;
      const v = toggleFollow(a);
      el.classList.toggle("active", v);
    } else if (act === "share") {
      const id = el.dataset.id;
      const url = `${location.origin}${location.pathname}#post-${id}`;
      if (navigator.share) {
        try { await navigator.share({ title:"Froll.net post", url }); } catch {}
      } else {
        try { await navigator.clipboard.writeText(url); alert("Post link copied!"); } catch { alert(url); }
      }
    }
  });
}

// -------- Byte counter --------
function setupByteCounter() {
  const ta = $("#post-content"); const counter = $("#byte-counter");
  const update = () => { counter.textContent = `${bytesUtf8(ta.value)} / 60000 bytes`; };
  ta.addEventListener("input", update); update();
}

// -------- Swap --------
function updateSwapPreview() {
  const from = $("#from-token").value;
  const to   = $("#to-token").value;
  const amt  = parseFloat($("#from-amount").value || "0");
  if (!isFinite(amt) || amt <= 0) { $("#to-amount").value = ""; return; }
  let out = 0;
  if (from === "VIC" && to === "FROLL") out = amt / FIXED_RATE_FROLL_VIC;
  else if (from === "FROLL" && to === "VIC") out = amt * FIXED_RATE_FROLL_VIC;
  $("#to-amount").value = out.toString();
}

async function doSwap() {
  if (!signer) return alert("Connect wallet first.");
  const from = $("#from-token").value;
  const to   = $("#to-token").value;
  const amtN = parseFloat($("#from-amount").value || "0");
  if (!isFinite(amtN) || amtN <= 0) return alert("Enter a valid amount.");
  try {
    if (from === "VIC" && to === "FROLL") {
      const value = ethers.utils.parseEther((amtN + FIXED_FEE_VIC).toString());
      const tx = await swapContract.swapVicToFroll({ value });
      $("#swap-btn").disabled = true;
      await tx.wait();
      $("#swap-btn").disabled = false;
      alert("Swapped VIC → FROLL successfully.");
    } else if (from === "FROLL" && to === "VIC") {
      const frollWei = ethers.utils.parseUnits(amtN.toString(), frollDecimals);
      await ensureApproval(frollToken, account, SWAP_CONTRACT_ADDRESS, frollWei);
      const tx = await swapContract.swapFrollToVic(frollWei, { value: ethers.utils.parseEther(FIXED_FEE_VIC.toString()) });
      $("#swap-btn").disabled = true;
      await tx.wait();
      $("#swap-btn").disabled = false;
      alert("Swapped FROLL → VIC successfully.");
    } else {
      alert("Please choose different tokens to swap.");
    }
  } catch (e) {
    console.error(e);
    alert("Swap failed. Try adjusting amount or check wallet.");
  }
}

// -------- UI wiring --------
function setupUi() {
  // Connect / Disconnect
  $("#connect-btn").addEventListener("click", async () => {
    if ($("#connect-btn").dataset.connected === "1") {
      disconnectUi();
    } else {
      await connectWallet();
    }
  });

  // Register + Post
  $("#register-btn").addEventListener("click", onRegister);
  $("#post-btn").addEventListener("click", onPost);
  setupByteCounter();

  // Swap panel
  $("#swap-toggle").addEventListener("click", () => {
    const panel = $("#swap-panel");
    const hidden = panel.classList.toggle("hide");
    panel.setAttribute("aria-hidden", hidden ? "true" : "false");
  });
  $("#from-token").addEventListener("change", updateSwapPreview);
  $("#to-token").addEventListener("change", updateSwapPreview);
  $("#from-amount").addEventListener("input", updateSwapPreview);
  $("#swap-btn").addEventListener("click", doSwap);

  // Feed
  setupFeedActions();
}

// -------- Init --------
(async function init() {
  setupUi();
  await fetchVicPriceAndShow();
  setInterval(fetchVicPriceAndShow, 60_000);

  // View-only feed without wallet:
  try {
    // read-only provider to allow calling view functions if no wallet
    const roProvider = new ethers.providers.JsonRpcProvider("https://rpc.viction.xyz");
    frollSocial = new ethers.Contract(FROLL_SOCIAL_ADDRESS, FROLL_SOCIAL_ABI, roProvider);
    await refreshFeed();
  } catch (e) { console.warn("RO feed init failed", e); }

  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", () => location.reload());
    window.ethereum.on?.("chainChanged",   () => location.reload());
  }
})();
